'use strict'

// Published authority is derived only after authenticated table restore. Drafts never enter this API as receipts.
const fs = require('node:fs')
const path = require('node:path')
const yaml = require('js-yaml')
const {digest, regularBytes, pendingSourceSnapshot, git, snapshotPath} = require('./sharedPageFetch')
const {validateSharedReceipt, validateSharedSnapshotRecord, validateActiveState} = require('./sharedPageRouting')
const hashSnapshot = snapshot => require('./sourceCompleteness').hashSnapshot(snapshot)
const MANIFEST = 'generated/en/manifests/shared-pages/guides'
const EFFECTIVE = 'packages/docs-tooling/src/lark/meta/reports/guides-source-snapshot-effective.json'
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
function check(condition, message) { if (!condition) throw new Error(`Shared publication: ${message}`) }
function json(root, file) { return JSON.parse(regularBytes(root, file)) }
function put(root, file, value) {
  const destination = path.join(root, file)
  fs.mkdirSync(path.dirname(destination), {recursive: true})
  fs.writeFileSync(destination, JSON.stringify(value, null, 2) + '\n')
}
function verifyOutput(root, output, token) {
  check(/^content\/en\/(guides|byoc)\/tutorials\/.+\.mdx?$/.test(output.path), 'invalid output path')
  const bytes = regularBytes(root, output.path)
  check(digest(bytes) === output.sha256, `output digest mismatch: ${output.path}`)
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(bytes.toString())
  check(front && String(yaml.load(front[1])?.token) === token, `output token mismatch: ${output.path}`)
}
function validatePublishedReceipt(receipt, record, {workspace, snapshot} = {}) {
  validateSharedSnapshotRecord(record); validateSharedReceipt(receipt, record.shared_page)
  const navigation = receipt.inputs.fetch.navigation
  check(navigation && typeof navigation === 'object' && Array.isArray(navigation.navigationRecords), 'draft navigation is not publication authority')
  const draftInputs = {...receipt.inputs, fetch: {...receipt.inputs.fetch, navigation: digest(JSON.stringify(navigation))}}
  check(digest(JSON.stringify(draftInputs)) === record.shared_page.inputs_sha256, 'receipt input identity mismatch')
  const nav = navigation.navigationRecords.filter(row => row.record_id === record.record_id)
  check(nav.length === 1 && nav[0].source_kind === 'shared-page' && nav[0].shared_page?.page === record.shared_page.page
    && nav[0].doc_link === record.doc_link && nav[0].slug === record.slug, 'receipt canonical record/navigation mismatch')
  check(equal(receipt.outputs.map(o => o.path).sort(), [...record.output_paths].sort()), 'receipt output set mismatch')
  if (snapshot) {
    const current = snapshot.navigation_records.find(row => row.record_id === record.record_id)
    // The stored immutable projection predates injection of the final input identity.
    const withoutIdentity = row => {const result = structuredClone(row); if (result.shared_page) result.shared_page = {group: result.shared_page.group, page: result.shared_page.page}; return result}
    check(current && equal(withoutIdentity(current), withoutIdentity(nav[0])), 'receipt navigation differs from effective snapshot')
  }
  if (workspace) for (const output of receipt.outputs) verifyOutput(workspace, output, receipt.token)
  return receipt
}
function effectiveSnapshot(candidate, handoff) {
  if (!handoff) return structuredClone(candidate)
  pendingSourceSnapshot(candidate, handoff.routing)
  const snapshot = structuredClone(candidate), previous = handoff.bundle.preparation.previous_snapshot
  for (const outcome of handoff.bundle.outcomes) {
    if (outcome.status === 'success') {
      const record = snapshot.records.find(row => row.record_id === outcome.record_id)
      check(record && equal(record.shared_page, outcome.identity), 'observed successful identity mismatch')
      record.output_paths = outcome.outputs.map(o => o.path).sort()
    } else {
      snapshot.records = snapshot.records.filter(row => row.record_id !== outcome.record_id)
      snapshot.navigation_records = snapshot.navigation_records.filter(row => row.record_id !== outcome.record_id)
      const old = previous?.records?.find(row => row.record_id === outcome.record_id)
      if (old) {
        snapshot.records.push(structuredClone(old))
        const nav = previous.navigation_records?.find(row => row.record_id === outcome.record_id)
        check(nav, `missing baseline navigation: ${outcome.record_id}`)
        snapshot.navigation_records.push(structuredClone(nav))
      }
    }
  }
  snapshot.records.sort((a, b) => a.record_id.localeCompare(b.record_id))
  snapshot.navigation_records.sort((a, b) => a.table_id.localeCompare(b.table_id) || a.order - b.order || a.record_id.localeCompare(b.record_id))
  snapshot.table_digests = Object.fromEntries([...new Set(snapshot.navigation_records.map(row => row.table_id))].sort().map(id =>
    [id, digest(JSON.stringify(snapshot.navigation_records.filter(row => row.table_id === id)))]))
  return snapshot
}
function finalizePublication({workspace, handoff, candidate}) {
  if (!handoff) return null
  const {bundle, files} = handoff, snapshot = effectiveSnapshot(candidate, handoff)
  const fallbacks = []
  // Read and verify every byte before writing any new authority.
  const receipts = [], baselineReceipts = []
  for (const outcome of bundle.outcomes) {
    if (outcome.status === 'success') {
      const receipt = JSON.parse(files.get(outcome.receipt))
      receipt.inputs.fetch.navigation = structuredClone(bundle.navigation)
      const record = snapshot.records.find(row => row.record_id === outcome.record_id)
      validatePublishedReceipt(receipt, record, {workspace, snapshot})
      receipts.push([record.shared_page.record, receipt])
    } else {
      const record = bundle.preparation.previous_snapshot?.records?.find(row => row.record_id === outcome.record_id)
      for (const output of outcome.baseline.outputs) {
        check(digest(regularBytes(workspace, output.path)) === output.sha256, `fallback bytes changed: ${output.path}`)
      }
      if (outcome.baseline.receipt) {
        const receipt = outcome.baseline.receipt, bytes = files.get(receipt.file)
        check(bytes && digest(bytes) === receipt.sha256, 'fallback receipt changed')
        baselineReceipts.push([receipt.path, bytes])
      }
      if (record) fallbacks.push({record, outputs: outcome.baseline.outputs.map(({path, sha256}) => ({path, sha256}))})
    }
  }
  validateActiveState(bundle.effective_active)
  const publication = {schema_version: 1, dev_commit: bundle.dev_commit, observed_sha256: hashSnapshot(candidate),
    effective_sha256: hashSnapshot(snapshot), active: bundle.effective_active, cache_eligible: bundle.outcomes.every(row => row.status === 'success'),
    baseline_snapshot: bundle.previous_snapshot_file ? files.get(bundle.previous_snapshot_file).toString('utf8') : null,
    fallbacks}
  // A clean assembly checkout has no dev-owned receipt directory. The bundle
  // binds these exact bytes to the pinned baseline; never reserialize old receipts.
  for (const [file, bytes] of baselineReceipts) {
    const destination = path.join(workspace, file)
    fs.mkdirSync(path.dirname(destination), {recursive: true}); fs.writeFileSync(destination, bytes)
  }
  for (const [file, receipt] of receipts) put(workspace, file, receipt)
  if (bundle.effective_active.pages.length) put(workspace, `${MANIFEST}/active.json`, bundle.effective_active)
  put(workspace, `${MANIFEST}/_publication.json`, publication)
  put(workspace, EFFECTIVE, snapshot)
  put(workspace, 'packages/docs-tooling/src/lark/meta/reports/guides-shared-publication.json', {schema_version: 1, generated_at: new Date().toISOString(), failures: bundle.outcomes.filter(row => row.status === 'fallback').map(({record_id, code, message, detail}) => ({record_id, code, message, detail})), notices: bundle.notices || []})
  return {snapshot, publication}
}
function publishedEvidence(workspace, snapshot, {verifyFiles = true} = {}) {
  const receipts = new Map(), fallbackIds = new Set()
  let active = null
  for (const record of snapshot.records || []) if (record.source_kind === 'shared-page') {
    receipts.set(record.record_id, validatePublishedReceipt(json(workspace, record.shared_page.record), record, {workspace: verifyFiles ? workspace : undefined, snapshot}))
  }
  const file = `${MANIFEST}/_publication.json`
  if (receipts.size || fs.existsSync(path.join(workspace, MANIFEST, 'active.json'))) check(fs.existsSync(path.join(workspace, file)), 'missing final publication authority')
  if (fs.existsSync(path.join(workspace, file))) {
    const authority = json(workspace, file)
    check(authority.schema_version === 1 && authority.effective_sha256 === hashSnapshot(snapshot), 'effective snapshot binding mismatch')
    check(/^[a-f0-9]{40}$/.test(authority.dev_commit) && /^[a-f0-9]{64}$/.test(authority.observed_sha256)
      && typeof authority.cache_eligible === 'boolean' && Array.isArray(authority.fallbacks), 'invalid publication authority')
    active = validateActiveState(authority.active)
    if (authority.active.pages.length) check(equal(json(workspace, `${MANIFEST}/active.json`), authority.active), 'active state mismatch')
    const oldSnapshot = authority.baseline_snapshot ? JSON.parse(authority.baseline_snapshot) : null
    if (authority.baseline_snapshot) check(git(workspace, ['show', `${authority.dev_commit}:${snapshotPath}`]).toString('utf8') === authority.baseline_snapshot, 'activation baseline snapshot mismatch')
    let oldActive = {schema_version: 1, pages: []}
    const oldActivePath = `${MANIFEST}/active.json`
    const exists = git(workspace, ['ls-tree', authority.dev_commit, '--', oldActivePath]).length
    if (exists) oldActive = validateActiveState(JSON.parse(git(workspace, ['show', `${authority.dev_commit}:${oldActivePath}`])))
    for (const old of oldActive.pages) check(equal(old, authority.active.pages.find(entry => entry.record === old.record)), 'baseline active entry was changed')
    for (const entry of authority.active.pages) if (!oldActive.pages.some(old => old.record === entry.record)) {
      const record = snapshot.records.find(row => row.record_id === entry.record)
      const previous = oldSnapshot?.records.find(row => row.record_id === entry.record)
      check(record?.source_kind === 'shared-page' && record.shared_page.page === entry.page && entry.feishu_token === (previous?.doc_token || previous?.node_token || null), 'activation provenance mismatch')
    }
    if (authority.fallbacks.length) {
      check(/^[a-f0-9]{40}$/.test(authority.dev_commit), 'invalid fallback baseline')
      const pinned = git(workspace, ['show', `${authority.dev_commit}:${snapshotPath}`]).toString('utf8')
      check(pinned === authority.baseline_snapshot, 'fallback snapshot is not pinned baseline')
      const previous = JSON.parse(pinned)
      for (const fallback of authority.fallbacks) {
        const old = previous.records.find(row => row.record_id === fallback.record.record_id)
        check(old && equal(old, fallback.record) && equal(old, snapshot.records.find(row => row.record_id === old.record_id)), 'fallback canonical record mismatch')
        check(equal([...old.output_paths].sort(), fallback.outputs.map(o => o.path).sort()), 'fallback output set mismatch')
        for (const output of fallback.outputs) {
          check(digest(git(workspace, ['show', `${authority.dev_commit}:${output.path}`])) === output.sha256, 'fallback is not pinned baseline bytes')
          if (verifyFiles) check(digest(regularBytes(workspace, output.path)) === output.sha256, 'published fallback bytes mismatch')
        }
        fallbackIds.add(old.record_id)
      }
    }
  }
  return {receipts, fallbackIds, active}
}
function baselineRefHref(handoff, ref, canonicalSlug, manual, workspace) {
  const rows = handoff.bundle.preparation.previous_snapshot?.navigation_records || []
  const old = rows.find(row => row.record_id === ref.base_record_id)
  if (!old || old.placement_type !== 'ref' || old.ref_target_token !== ref.base_nav_ref_target_token
    || old.ref_target_anchor !== ref.base_nav_ref_target_anchor) return null
  const byId = new Map(rows.map(row => [row.record_id, row])), parts = [], seen = new Set()
  let current = old
  while ((current.parent_record_ids || []).some(id => byId.has(id))) {
    check(!seen.has(current.record_id), 'baseline ref navigation cycle'); seen.add(current.record_id)
    current = byId.get(current.parent_record_ids.find(id => byId.has(id)))
    parts.unshift(current.slug || require('slugify')(current.title, {lower: true, strict: true}))
  }
  const key = `ref:tutorials/${[require('./guidesTableSlugs').guidesTableSlug('en', old.table_name || old.table_id), ...parts, old.slug || canonicalSlug].join('/')}`
  const sidebarPath = `generated/en/sidebars/${manual === 'guides' ? 'guides' : 'guides-byoc'}.sidebar.js`
  const bytes = git(workspace, ['show', `${handoff.bundle.dev_commit}:${sidebarPath}`])
  const sandbox = {module: {exports: {}}}
  require('node:vm').runInNewContext(bytes.toString('utf8'), sandbox, {timeout: 1000})
  const matches = []
  const visit = items => {for (const item of items || []) {if (item.type === 'link' && item.key === key) matches.push(item.href); if (item.items) visit(item.items)}}
  visit(sandbox.module.exports.default || sandbox.module.exports)
  check(matches.length === 1 && typeof matches[0] === 'string', 'missing authenticated baseline ref href')
  return matches[0]
}
function projectFallbackSidebar(items, handoff, manual) {
  if (!handoff) return items
  const result = structuredClone(items)
  // Writer omits failed current records. Insert only exactly authenticated historic output IDs.
  for (const outcome of handoff.bundle.outcomes) if (outcome.status === 'fallback') {
    const previous = handoff.bundle.preparation.previous_snapshot
    const nav = previous?.navigation_records?.find(row => row.record_id === outcome.record_id)
    for (const output of outcome.baseline.outputs) {
      const prefix = `content/en/${manual === 'guides' ? 'guides' : 'byoc'}/`
      if (!output.path.startsWith(prefix)) continue
      check(nav, 'missing fallback sidebar navigation')
      const id = output.path.slice(prefix.length).replace(/\.mdx?$/, ''), dir = path.posix.dirname(id)
      const key = `category:${dir}`
      let container
      const visit = rows => {for (const row of rows) {if (row.type === 'category' && row.key === key) container = row; if (row.items) visit(row.items)}}
      visit(result)
      if (!container) {container = {type: 'category', label: nav.table_name, key, items: []}; result.push(container)}
      container.items.push({type: 'doc', id, label: nav.labels || nav.title, key: `doc:${id}`})
    }
  }
  return result
}
module.exports = {MANIFEST, EFFECTIVE, validatePublishedReceipt, effectiveSnapshot, finalizePublication, publishedEvidence, projectFallbackSidebar, baselineRefHref}
