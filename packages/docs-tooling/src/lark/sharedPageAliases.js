'use strict'

// Bounded local evidence only: never fetch Git history or call Feishu here.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const SNAPSHOT = 'packages/docs-tooling/src/lark/meta/snapshots/guides-uat-last-success.json'
const MANIFEST = 'generated/en/manifests/shared-pages/guides'
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const valid = token => typeof token === 'string' && /^[A-Za-z0-9_-]+$/.test(token) && !/^(?:base_|shared-)/.test(token)
function tokens(value) {
  return [...new Set([value?.doc_token, value?.node_token, value?.origin_node_token, value?.obj_token,
    value?.feishu_token, ...(value?.feishu_aliases || [])].filter(valid))].sort()
}
const activeTokens = entry => tokens({feishu_token: entry?.feishu_token, feishu_aliases: entry?.feishu_aliases})
const matches = (entry, token) => !!token && activeTokens(entry).includes(token)
function check(condition, message) {if (!condition) throw new Error(`Shared aliases: ${message}`)}

const objectHash = (type, bytes) => crypto.createHash('sha1').update(Buffer.from(`${type} ${bytes.length}\0`)).update(bytes).digest('hex')
function treeEntry(bytes, name) {
  let offset = 0
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset), end = bytes.indexOf(0, space)
    check(space >= offset && end > space && end + 21 <= bytes.length, 'malformed Git tree proof')
    const entry = {mode: bytes.subarray(offset, space).toString(), name: bytes.subarray(space + 1, end).toString(), oid: bytes.subarray(end + 1, end + 21).toString('hex')}
    if (entry.name === name) return entry
    offset = end + 21
  }
  throw new Error('Shared aliases: snapshot path absent from Git proof')
}
function gitProof(root, devCommit, commit, git) {
  const parents = new Map()
  if (devCommit !== commit) {
    const lines = git(root, ['rev-list', '--ancestry-path', '--parents', '--topo-order', '--max-count=2048', `${commit}..${devCommit}`], {stdio: ['ignore', 'pipe', 'pipe']}).toString().trim().split('\n')
    for (const line of lines) {const [id, ...ids] = line.split(' '); parents.set(id, ids)}
  }
  const visited = new Set()
  function route(id) {
    if (id === commit) return [id]
    if (visited.has(id)) return null
    visited.add(id)
    for (const parent of parents.get(id) || []) {const rest = route(parent); if (rest) return [id, ...rest]}
    return null
  }
  const ids = route(devCommit)
  check(ids, 'bounded pinned ancestry proof unavailable')
  const commits = ids.map(oid => ({oid, content: git(root, ['cat-file', 'commit', oid]).toString('utf8')}))
  let tree = /^tree ([a-f0-9]{40})$/m.exec(commits.at(-1).content)?.[1]
  check(tree, 'missing snapshot commit tree')
  const trees = []
  for (const part of SNAPSHOT.split('/')) {
    const bytes = git(root, ['cat-file', 'tree', tree])
    trees.push({oid: tree, content: bytes.toString('base64')})
    tree = treeEntry(bytes, part).oid
  }
  return {commits, trees}
}
function verifyProof(item, devCommit) {
  check(item.proof && Array.isArray(item.proof.commits) && item.proof.commits.length > 0 && item.proof.commits.length <= 2049
    && Array.isArray(item.proof.trees) && item.proof.trees.length === SNAPSHOT.split('/').length, 'invalid Git proof')
  let expected = devCommit
  for (const [index, commit] of item.proof.commits.entries()) {
    check(commit.oid === expected && typeof commit.content === 'string' && objectHash('commit', Buffer.from(commit.content)) === commit.oid, 'unbound snapshot commit proof')
    const next = item.proof.commits[index + 1]
    if (next) {
      check(commit.content.split('\n\n')[0].split('\n').includes(`parent ${next.oid}`), 'unbound snapshot ancestry proof')
      expected = next.oid
    }
  }
  const commit = item.proof.commits.at(-1)
  check(commit.oid === item.commit, 'snapshot commit proof mismatch')
  let tree = /^tree ([a-f0-9]{40})$/m.exec(commit.content)?.[1]
  for (const [index, part] of SNAPSHOT.split('/').entries()) {
    const proof = item.proof.trees[index], bytes = Buffer.from(proof.content, 'base64')
    check(proof.oid === tree && objectHash('tree', bytes) === tree, 'unbound snapshot tree proof')
    const entry = treeEntry(bytes, part)
    check(index === item.proof.trees.length - 1 ? ['100644', '100755'].includes(entry.mode) : entry.mode === '40000', 'unsafe snapshot Git mode')
    tree = entry.oid
  }
  check(objectHash('blob', Buffer.from(item.content)) === tree, 'unbound snapshot blob proof')
}
function legacy(record) {return record && record.source_kind !== 'shared-page' && !record.shared_page}
function recordAt(snapshot, id) {
  const records = (snapshot.records || []).filter(row => row.record_id === id)
  check(records.length <= 1, `conflicting snapshot owner ${id}`)
  return legacy(records[0]) ? records[0] : null
}
function collect({baselineRoot, devCommit, active, previousSnapshot, sourceDir, repositoryRoot, rootToken, retainedEvidence, recordIds, git, regularBytes}) {
  const evidence = {dev_commit: devCommit, snapshots: [], caches: [], gaps: []}, snapshots = new Map()
  let total = 0
  function addSnapshot(commit) {
    if (snapshots.has(commit)) return snapshots.get(commit)
    const content = git(baselineRoot, ['show', `${commit}:${SNAPSHOT}`], {stdio: ['ignore', 'pipe', 'pipe']}).toString('utf8')
    const item = {commit, path: SNAPSHOT, sha256: hash(content), content, proof: gitProof(baselineRoot, devCommit, commit, git)}
    const nextTotal = total + Buffer.byteLength(JSON.stringify(item))
    check(nextTotal <= 16 * 1024 * 1024, 'history evidence exceeds size limit')
    total = nextTotal
    const snapshot = JSON.parse(content)
    snapshots.set(commit, snapshot); evidence.snapshots.push(item)
    return snapshot
  }
  if (previousSnapshot) addSnapshot(devCommit)
  for (const id of recordIds) {
    const entry = active.pages.find(row => row.record === id)
    if (!entry || recordAt(previousSnapshot || {}, id)) continue
    try {
      const receipt = JSON.parse(git(baselineRoot, ['show', `${devCommit}:${MANIFEST}/${entry.page}.json`], {stdio: ['ignore', 'pipe', 'pipe']}))
      const pinned = receipt.inputs.dev.commit
      check(/^[a-f0-9]{40}$/.test(pinned), 'invalid receipt dev commit')
      git(baselineRoot, ['merge-base', '--is-ancestor', pinned, devCommit], {stdio: ['ignore', 'pipe', 'pipe']})
      const commits = [pinned, ...git(baselineRoot, ['log', '--format=%H', '--max-count=256', pinned, '--', SNAPSHOT], {stdio: ['ignore', 'pipe', 'pipe']}).toString().trim().split('\n').filter(Boolean)]
      let found = false
      for (const commit of new Set(commits)) {
        const candidate = snapshots.get(commit) || JSON.parse(git(baselineRoot, ['show', `${commit}:${SNAPSHOT}`], {stdio: ['ignore', 'pipe', 'pipe']}))
        if (recordAt(candidate, id)) {addSnapshot(commit); found = true; break}
      }
      if (!found) evidence.gaps.push({record_id: id, message: 'Historical Feishu snapshot is unavailable in the bounded pinned dev history'})
    } catch (error) {
      evidence.gaps.push({record_id: id, message: 'Pinned receipt or local snapshot history is unavailable'})
    }
  }
  if (retainedEvidence?.cache_generation) {
    validateEvidence(retainedEvidence, devCommit)
    evidence.cache_generation = retainedEvidence.cache_generation
    evidence.caches = [...retainedEvidence.caches.filter(item => item.generation_sha256)]
  }
  // Reuse the existing v5/v4 source-manifest identity while the restored cache
  // is still frozen. Later Base projection can change other files in this directory.
  if (repositoryRoot && sourceDir && rootToken) {
    const manifestPath = 'packages/docs-tooling/src/lark/meta/source-cache/guides-manifest.json'
    if (fs.existsSync(path.join(repositoryRoot, manifestPath)) && fs.existsSync(path.join(repositoryRoot, SNAPSHOT))) try {
      require('../../../../scripts/docs-workflow/guides-source-cache').validateSourceCache({site: 'en', sourceDir, rootToken,
        snapshotPath: path.join(repositoryRoot, SNAPSHOT), manifestPath: path.join(repositoryRoot, manifestPath)})
      const manifest = regularBytes(repositoryRoot, manifestPath).toString('utf8'), snapshot = regularBytes(repositoryRoot, SNAPSHOT).toString('utf8')
      check(total + Buffer.byteLength(manifest) + Buffer.byteLength(snapshot) <= 16 * 1024 * 1024, 'source-cache identity exceeds evidence size limit')
      if (evidence.cache_generation?.manifest.sha256 !== hash(manifest)) evidence.caches = []
      evidence.cache_generation = {manifest: {path: manifestPath, sha256: hash(manifest), content: manifest},
        snapshot: {path: SNAPSHOT, sha256: hash(snapshot), content: snapshot}}
    } catch (error) {
      for (const id of recordIds) evidence.gaps.push({record_id: id, message: 'Restored source-cache generation is unavailable or no longer frozen'})
    }
  }
  total += evidence.cache_generation ? Buffer.byteLength(evidence.cache_generation.manifest.content) + Buffer.byteLength(evidence.cache_generation.snapshot.content) : 0
  total += evidence.caches.reduce((sum, item) => sum + Buffer.byteLength(item.content), 0)
  const cacheOwners = new Map()
  if (sourceDir && fs.existsSync(sourceDir)) for (const name of fs.readdirSync(sourceDir).filter(name => name.endsWith('.json')).sort()) {
    const bytes = regularBytes(sourceDir, name), source = JSON.parse(bytes)
    if (!legacy(source) || !source.base_record_id) continue
    for (const token of tokens(source)) {
      const owner = cacheOwners.get(token)
      check(!owner || owner === source.base_record_id, `conflicting frozen cache owner for ${token}`)
      cacheOwners.set(token, source.base_record_id)
    }
    if (!recordIds.includes(source.base_record_id)) continue
    const binding = evidence.snapshots.find(item => {
      const old = recordAt(snapshots.get(item.commit), source.base_record_id)
      return old?.source_file === name && old.source_hash === hash(bytes)
    })
    const generation = evidence.cache_generation, manifest = generation && JSON.parse(generation.manifest.content)
    const generatedFile = manifest?.files.find(file => file.path === name && file.sha256 === hash(bytes) && file.size === bytes.length)
    if (!evidence.caches.some(item => item.path === name) && (binding || generatedFile) && (total + bytes.length > 16 * 1024 * 1024 || evidence.caches.length >= 2048)) {
      evidence.gaps.push({record_id: source.base_record_id, message: `Frozen legacy cache exceeds bounded evidence limits: ${name}`})
      continue
    }
    if (!evidence.caches.some(item => item.path === name) && (binding || generatedFile)) {
      total += bytes.length
      evidence.caches.push({path: name, sha256: hash(bytes), content: bytes.toString('utf8'),
      ...(binding ? {snapshot_commit: binding.commit} : {generation_sha256: generation.manifest.sha256})})
    } else if (!evidence.caches.some(item => item.path === name) && tokens(source).some(token => !tokens(recordAt(previousSnapshot || {}, source.base_record_id)).includes(token))) {
      evidence.gaps.push({record_id: source.base_record_id, message: `Frozen legacy cache has no authenticated snapshot identity: ${name}`})
    }
  }
  evidence.gaps = [...new Map(evidence.gaps.map(item => [JSON.stringify(item), item])).values()]
  return evidence
}
function validateEvidence(evidence = {snapshots: [], caches: [], gaps: []}, devCommit = evidence.dev_commit) {
  check(evidence && Array.isArray(evidence.snapshots) && Array.isArray(evidence.caches) && Array.isArray(evidence.gaps)
    && evidence.snapshots.length <= 257 && evidence.caches.length <= 2048, 'invalid evidence')
  let bytes = 0
  const snapshots = new Map(), seenCaches = new Set()
  for (const item of evidence.snapshots) {
    check(/^[a-f0-9]{40}$/.test(item.commit) && item.path === SNAPSHOT && typeof item.content === 'string'
      && item.sha256 === hash(item.content) && !snapshots.has(item.commit), 'invalid snapshot evidence')
    check(/^[a-f0-9]{40}$/.test(devCommit) && evidence.dev_commit === devCommit, 'invalid evidence dev binding')
    verifyProof(item, devCommit)
    snapshots.set(item.commit, JSON.parse(item.content)); bytes += Buffer.byteLength(JSON.stringify(item))
  }
  let generationManifest, generationSnapshot
  if (evidence.cache_generation) {
    const {manifest, snapshot} = evidence.cache_generation
    check(manifest?.path === 'packages/docs-tooling/src/lark/meta/source-cache/guides-manifest.json' && snapshot?.path === SNAPSHOT
      && typeof manifest.content === 'string' && typeof snapshot.content === 'string'
      && hash(manifest.content) === manifest.sha256 && hash(snapshot.content) === snapshot.sha256, 'invalid cache generation evidence')
    bytes += Buffer.byteLength(manifest.content) + Buffer.byteLength(snapshot.content)
    generationManifest = JSON.parse(manifest.content); generationSnapshot = JSON.parse(snapshot.content)
    check(generationManifest.schemaVersion === 2 && generationManifest.manual === 'guides' && generationManifest.buildEnv === 'uat'
      && (generationManifest.site === undefined || generationManifest.site === 'en') && Array.isArray(generationManifest.files)
      && generationManifest.snapshotHash === require('./sourceCompleteness').hashSnapshot(generationSnapshot), 'invalid cache generation identity')
    const paths = new Set()
    for (const file of generationManifest.files) {
      check(typeof file.path === 'string' && /^[^/\\]+\.json$/.test(file.path) && !paths.has(file.path)
        && /^[a-f0-9]{64}$/.test(file.sha256) && Number.isSafeInteger(file.size) && file.size >= 0, 'invalid cache generation inventory')
      paths.add(file.path)
    }
  }
  for (const item of evidence.caches) {
    check(typeof item.path === 'string' && /^[^/\\]+\.json$/.test(item.path) && !seenCaches.has(item.path)
      && typeof item.content === 'string' && item.sha256 === hash(item.content), 'invalid cache evidence')
    seenCaches.add(item.path); bytes += Buffer.byteLength(item.content)
    const source = JSON.parse(item.content), record = recordAt(snapshots.get(item.snapshot_commit) || {}, source.base_record_id)
    const generationFile = generationManifest?.files.find(file => file.path === item.path)
    const generationBound = item.generation_sha256 === evidence.cache_generation?.manifest.sha256 && generationFile?.sha256 === item.sha256
      && generationFile.size === Buffer.byteLength(item.content) && generationSnapshot?.records?.some(row => row.record_id === source.base_record_id)
    check(legacy(source) && ((record?.source_file === item.path && record.source_hash === item.sha256) || generationBound), 'unbound cache evidence')
  }
  check(bytes <= 16 * 1024 * 1024, 'evidence exceeds size limit')
  return evidence
}
function recover({active, previousSnapshot, evidence, recordIds}) {
  validateEvidence(evidence)
  const owners = new Map(), byRecord = new Map()
  function add(id, values) {
    for (const token of values) {
      const owner = owners.get(token)
      check(!owner || owner === id, `conflicting alias owner for ${token}`)
      owners.set(token, id)
      if (!byRecord.has(id)) byRecord.set(id, new Set())
      byRecord.get(id).add(token)
    }
  }
  for (const entry of active.pages) add(entry.record, activeTokens(entry))
  for (const snapshot of [previousSnapshot, ...(evidence?.snapshots || []).map(item => JSON.parse(item.content))]) {
    for (const row of snapshot?.records || []) if (legacy(row)) add(row.record_id, tokens(row))
  }
  for (const item of evidence?.caches || []) {const source = JSON.parse(item.content); add(source.base_record_id, tokens(source))}
  const result = structuredClone(active)
  for (const entry of result.pages) if (recordIds.includes(entry.record)) entry.feishu_aliases = [...(byRecord.get(entry.record) || [])].sort()
  return {active: result, aliases: Object.fromEntries(recordIds.map(id => [id, [...(byRecord.get(id) || [])].sort()]))}
}
function verifyEnrichment(old, current, aliases) {
  check(current && ['page', 'record', 'feishu_token', 'anchors', 'activated_in'].every(key => same(old[key], current[key])), 'baseline active fields changed')
  const known = activeTokens(old), next = activeTokens(current)
  check(known.every(token => next.includes(token)) && next.every(token => known.includes(token) || aliases.includes(token)), 'unverified or dropped alias')
}
function index(context, byRecord) {
  for (const [id, values] of Object.entries(byRecord)) for (const token of values) {
    const owner = context.aliasesByToken.get(token)
    check(!owner || owner === id, `conflicting alias owner for ${token}`)
    for (const [recordId, route] of context.routesByRecordId) check(route.kind !== 'feishu' || route.token !== token || recordId === id, `conflicting alias owner for ${token}`)
    context.aliasesByToken.set(token, id)
  }
}
function authenticate({devCommit, evidence}) {validateEvidence(evidence, devCommit)}

module.exports = {tokens, activeTokens, matches, collect, validateEvidence, recover, verifyEnrichment, authenticate, index}
