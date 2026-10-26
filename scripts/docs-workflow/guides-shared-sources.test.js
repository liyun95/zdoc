'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const yaml = require('js-yaml')
const {loadTypeScript} = require('../lib/load-typescript')
const {git, write, pageYaml} = loadTypeScript(path.resolve(__dirname, '../../packages/docs-tooling/src/shared-docs/testing/build/demo.ts'))
const adapter = require('../../packages/docs-tooling/src/lark/sharedPageFetch')
const {generateSharedSources} = require('./guides-shared-sources')
const {createSourceSnapshot} = require('../../packages/docs-tooling/src/lark/sourceSnapshot')
const {validateSourceCompleteness} = require('../../packages/docs-tooling/src/lark/sourceCompleteness')
const Scraper = require('../../packages/docs-tooling/src/lark/larkDocScraper')
const rootToken = 'root'
const image = Buffer.from([137, 80, 78, 71, 1, 2, 3])
const heading = {block_id: 'old-heading', block_type: 4, heading2: {elements: [{text_run: {content: 'Current heading {#current-anchor}', text_element_style: {}}}]}}
const inbound = {node_token: 'reader', slug: 'reader', blocks: {items: [{block_id: 'reader-block', block_type: 2,
  text: {elements: [{text_run: {content: 'Read more', text_element_style: {link: {url: 'https://example.feishu.cn/wiki/old#old-heading'}}}}]}}]}}
function record(id, page) {
  return {record_id: id, base_table_id: 'table', base_table_name: 'Manage Data', base_record_index: 0,
    fields: {Docs: {text: page, link: `https://github.com/zilliztech/zdoc/tree/master/shared-docs/guides/pages/${page}`},
      Slug: page, Labels: 'Fresh Base label', Targets: ['Zilliz.SaaS', 'Zilliz.PaaS'], Progress: 'Published',
      'Placement Type': 'Canonical', 'Release Channel': 'NEXT'}}
}
async function fixture(t, {pages = ['sample'], old = true, active = false, imageSource = false, singleTarget = false, metadataMarker = false} = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wp9-source-')))
  t.after(() => fs.rmSync(root, {recursive: true, force: true}))
  const repositoryRoot = path.join(root, 'master'), baselineRoot = path.join(root, 'dev'), repo = path.join(root, 'upstream'), sourceDir = path.join(root, 'sources')
  for (const directory of [repositoryRoot, baselineRoot, repo, sourceDir]) fs.mkdirSync(directory)
  for (const page of pages) {
    await write(repo, `site/en/${page}.md`, `---\nid: ${page}.md\ntitle: ${metadataMarker ? 'Title --- text' : 'Shared example'}\nsummary: ${metadataMarker ? 'Summary --- text' : 'A generated example.'}\n---\n\n# Shared example\n\nUse {{var.example_endpoint}} with {{var.example_token}}.\n\n## Current heading\n\nBody text.\n${imageSource ? '\n![Diagram](assets/diagram.png)\n' : ''}`)
  }
  await write(repo, 'site/en/assets/diagram.png', image)
  await git(repo, 'init', '--quiet', '--initial-branch=release/docs', '--template=')
  await git(repo, 'add', '.'); await git(repo, 'commit', '--quiet', '-m', 'Pinned synthetic source')
  const upstreamCommit = await git(repo, 'rev-parse', 'HEAD')
  const config = 'shared-docs/guides'
  await write(repositoryRoot, `${config}/source.yaml`, 'schema_version: 1\nrepository: https://github.com/milvus-io/milvus-docs\ntrack: release/docs\n')
  await write(repositoryRoot, `${config}/Variables.json`, JSON.stringify({example_endpoint: 'https://endpoint.example.test', example_token: 'EXAMPLE_TOKEN'}))
  await write(repositoryRoot, `${config}/links.yaml`, '{}\n')
  await write(repositoryRoot, `${config}/product-names.yaml`, 'check: [Milvus, "localhost:19530"]\nallow: []\n')
  await write(repositoryRoot, `${config}/presentation/cloud-sdk-tabs.yaml`, fs.readFileSync(path.resolve(__dirname, '../../packages/docs-tooling/src/shared-docs/fixtures/site/cloud-sdk-tabs.yaml')))
  for (const page of pages) {
    await write(repositoryRoot, `${config}/pages/${page}/page.yaml`, pageYaml(`site/en/${page}.md`, `tutorials/manage-data/${page}`))
    await write(repositoryRoot, `${config}/pages/${page}/lock.yaml`, JSON.stringify({schema_version: 1, current: upstreamCommit, next: upstreamCommit}))
  }
  await write(repositoryRoot, `${config}/pages/inactive/page.yaml`, 'broken: [')
  await git(repositoryRoot, 'init', '--quiet', '--initial-branch=master', '--template=')
  await git(repositoryRoot, 'add', '.'); await git(repositoryRoot, 'commit', '--quiet', '-m', 'Pinned selected configuration')
  const masterCommit = await git(repositoryRoot, 'rev-parse', 'HEAD')
  const records = pages.map((page, index) => ({...record(`rec${index}`, page), base_record_index: index}))
  if (metadataMarker) for (const record of records) record.fields.Labels = 'Before --- After'
  const previous = {schema_version: 3, manual: 'guides', build_env: 'uat', records: old ? pages.map((page, index) => ({record_id: `rec${index}`, slug: page,
    placement_type: 'canonical', doc_token: index ? `old${index}` : 'old', output_paths: [`content/en/guides/tutorials/manage-data/${page}.md`, ...(singleTarget ? [] : [`content/en/byoc/tutorials/manage-data/${page}.mdx`])]})) : []}
  await write(baselineRoot, adapter.snapshotPath, JSON.stringify(previous))
  for (const physical of ['guides', 'byoc']) {
    await write(baselineRoot, `content/en/${physical}/existing.md`, '---\nslug: /existing\ntitle: Existing\n---\nExisting.\n')
    if (old) for (const page of pages) await write(baselineRoot, `content/en/${physical}/tutorials/manage-data/${page}.${physical === 'guides' ? 'md' : 'mdx'}`, `---\nslug: /${page}\ntitle: Old\n---\nOLD ${physical} ${page}\n`)
  }
  if (active) await write(baselineRoot, 'generated/en/manifests/shared-pages/guides/active.json', JSON.stringify({schema_version: 1,
    pages: [{page: pages[0], record: 'rec0', feishu_token: 'old', anchors: {'old-heading': 'current-anchor'}, activated_in: '10'}]}))
  await git(baselineRoot, 'init', '--quiet', '--initial-branch=dev', '--template=')
  await git(baselineRoot, 'add', '.'); await git(baselineRoot, 'commit', '--quiet', '-m', 'Pinned baseline')
  const devCommit = await git(baselineRoot, 'rev-parse', 'HEAD')
  const prepared = adapter.prepareSharedSources({records, repositoryRoot, baselineRoot, masterCommit, devCommit})
  const scraper = new Scraper(rootToken, 'base:*', 'wiki', sourceDir)
  scraper.records = records; scraper.base_tables = [{table_id: 'table', name: 'Manage Data'}]; scraper.routingContext = prepared.context
  await scraper.__apply_base_navigation()
  const candidate = createSourceSnapshot({manualName: 'guides', buildEnv: 'uat', docSourceDir: sourceDir, baseAppToken: 'base', records, routingContext: prepared.context})
  const options = {preparation: prepared.data, repositoryRoot, baselineRoot, repo, sourceDir, candidate, rootToken,
    out: path.join(root, 'bundle'), scratch: path.join(root, 'scratch'), runId: '123', plan: {mode: 'incremental', affected_tables: [], changed_records: structuredClone(candidate.records)}}
  return {root, ...options, prepared, records, upstreamCommit, masterCommit, devCommit}
}
function output(options, bundle, manual) {
  const page = bundle.outcomes[0].outputs.find(output => output.manual === manual)
  return fs.readFileSync(path.join(options.out, page.file), 'utf8')
}
test('real selected source build uses pinned inputs, both manuals, current Base metadata and scratch-only accepted image bytes', {timeout: 120000}, async t => {
  const options = await fixture(t, {imageSource: true})
  let reads = 0
  const bundle = await generateSharedSources(options, {fetchOld: async token => {reads++; assert.equal(token, 'old'); return {blocks: {items: [heading]}}}})
  assert.equal(bundle.outcomes[0].status, 'success', JSON.stringify(bundle.outcomes))
  assert.equal(reads, 1)
  assert.equal(bundle.outcomes[0].outputs[0].path.endsWith('.md'), true)
  assert.equal(bundle.outcomes[0].outputs[1].path.endsWith('.mdx'), true)
  for (const manual of ['guides', 'guides-byoc']) {
    const mdx = output(options, bundle, manual), front = yaml.load(mdx.split('---')[1])
    assert.equal(front.sidebar_label, 'Fresh Base label'); assert.equal(front.sidebar_position, 1)
    assert.doesNotMatch(mdx, /https:\/\/zdoc-images[^\s]*https:\/\//)
    assert.equal(front.channel, 'next'); assert.equal(front.sidebar_custom_props.channel, 'next')
    assert.equal(front.custom_edit_url, 'https://github.com/milvus-io/milvus-docs/edit/release%2Fdocs/site/en/sample.md')
    assert.match(mdx, /https:\/\/endpoint.example.test/)
    assert.match(mdx, /EXAMPLE_TOKEN/)
    assert.doesNotMatch(mdx, /\{\{\s*var\./i)
    assert.ok(mdx.includes('## Current heading\\{#current-heading}'))
  }
  const accepted = bundle.outcomes[0].images[0]
  assert.deepEqual(fs.readFileSync(path.join(options.scratch, 'images', accepted.sha256)), image)
  assert.equal(bundle.outcomes[0].identity.inputs_sha256, options.candidate.records[0].shared_page.inputs_sha256)
  assert.equal(bundle.outcomes[0].identity.inputs_sha256, options.plan.changed_records[0].shared_page.inputs_sha256)
  assert.notEqual(bundle.outcomes[0].identity.inputs_sha256, options.prepared.data.inputs.rec0.identity.inputs_sha256)
  assert.equal(bundle.effective_active.pages[0].activated_in, '123')
  assert.deepEqual(options.plan.affected_tables, ['table'])
  assert.equal(bundle.outcomes[0].input_context.upstream.current.find(file => file.path === 'site/en/sample.md').sha256,
    adapter.digest(fs.readFileSync(path.join(options.repo, 'site/en/sample.md'))))
})
test('brand-new records emit .mdx in both manuals without old-document fetches', {timeout: 120000}, async t => {
  const options = await fixture(t, {old: false})
  const bundle = await generateSharedSources(options, {fetchOld: async () => {throw new Error('must not fetch')}})
  assert.equal(bundle.outcomes[0].status, 'success', JSON.stringify(bundle.outcomes))
  assert.ok(bundle.outcomes[0].outputs.every(output => output.path.endsWith('.mdx')))
  assert.equal(bundle.effective_active.pages[0].feishu_token, null)
})
test('cold cache old-document failure preserves both manual baselines while a sibling succeeds', {timeout: 120000}, async t => {
  const options = await fixture(t, {pages: ['sample', 'sibling']})
  const seen = []
  const bundle = await generateSharedSources(options, {fetchOld: async token => {seen.push(token); if (token === 'old') throw new Error('old doc unavailable'); return {blocks: {items: []}}}})
  assert.deepEqual(bundle.outcomes.map(page => page.status), ['fallback', 'success'], JSON.stringify(bundle.outcomes))
  assert.equal(bundle.outcomes[0].code, 'ACTIVATE_CHECK_FAILED')
  assert.deepEqual(seen, ['old', 'old1'])
  assert.equal(bundle.outcomes[0].baseline.outputs.length, 2)
  for (const output of bundle.outcomes[0].baseline.outputs) assert.deepEqual(fs.readFileSync(path.join(options.out, output.file)), fs.readFileSync(path.join(options.baselineRoot, output.path)))
  assert.deepEqual(bundle.effective_active.pages.map(page => page.page), ['sibling'])
})
test('first activation checks current inbound block IDs in both manuals and reports linking evidence', {timeout: 120000}, async t => {
  const options = await fixture(t)
  const base = {record: options.records[0], page: 'sample', active: options.prepared.data.active, previousSnapshot: options.prepared.data.previous_snapshot,
    currentSources: [inbound], sourceDir: options.sourceDir, rootToken, runId: '123'}
  let reads = 0
  const result = await adapter.activationDraft({...base, pages: ['guides', 'guides-byoc'].map(manual => ({manual, mdx: '## Current heading {#current-anchor}\n'})),
    fetchOld: async () => {reads++; return {blocks: {items: [heading]}}}})
  assert.equal(reads, 1); assert.deepEqual(result.entry.anchors, {'old-heading': 'current-anchor'})
  for (const mode of ['missing-heading', 'missing-byoc']) {
    await assert.rejects(adapter.activationDraft({...base, pages: [{manual: 'guides', mdx: '## Current heading {#current-anchor}\n'},
      {manual: 'guides-byoc', mdx: mode === 'missing-byoc' ? '## Other\n' : '## Current heading {#current-anchor}\n'}],
      fetchOld: async () => ({blocks: {items: mode === 'missing-heading' ? [] : [heading]}})}), error => {
      assert.equal(error.code, 'ACTIVATE_CHECK_FAILED'); assert.equal(error.detail.old_token, 'old')
      assert.equal(error.detail.links[0].block_id, 'reader-block'); return true
    })
  }
  // A stale snapshot outgoing token carries no block IDs and is not an inbound graph.
  const unlinked = await adapter.activationDraft({...base, currentSources: [], pages: [{manual: 'guides', mdx: '## Other'}], fetchOld: async () => ({blocks: {items: []}})})
  assert.deepEqual(unlinked.entry.anchors, {})
})
test('baseline active pages do not read the old document again', {timeout: 120000}, async t => {
  const options = await fixture(t, {active: true})
  const bundle = await generateSharedSources(options, {fetchOld: async () => {throw new Error('must not fetch')}})
  assert.equal(bundle.outcomes[0].status, 'success', JSON.stringify(bundle.outcomes))
  assert.deepEqual(bundle.effective_active, options.preparation.active)
})
test('no selected records ignores malformed inactive configs and leaves output paths absent', {timeout: 120000}, async t => {
  const options = await fixture(t)
  const records = [record('ordinary', 'sample')]; records[0].fields.Docs.link = 'https://example.feishu.cn/wiki/ordinary'
  const prepared = adapter.prepareSharedSources({...options, records})
  assert.equal(prepared, null)
  assert.equal(await generateSharedSources({...options, preparation: null}), null)
  assert.equal(fs.existsSync(options.out), false); assert.equal(fs.existsSync(options.scratch), false)
})
test('pending source phase accepts only bound shared identities; ordinary completeness remains strict', {timeout: 120000}, async t => {
  const options = await fixture(t)
  const checked = adapter.pendingSourceSnapshot(options.candidate, options.prepared.context)
  assert.equal(checked.records.length, 0)
  assert.throws(() => adapter.pendingSourceSnapshot(options.candidate, null), /Unauthenticated/)
  const malformed = structuredClone(options.candidate); delete malformed.records[0].shared_page.inputs_sha256
  assert.throws(() => adapter.pendingSourceSnapshot(malformed, options.prepared.context), /digest|missing/)
  const strict = validateSourceCompleteness({manual: 'guides', buildEnv: 'uat', rootToken, sourceDir: options.sourceDir, snapshot: options.candidate})
  assert.equal(strict.complete, false); assert.match(strict.identityErrors.join(' '), /missing shared receipt/)
})
test('workflow enables route preparation before bodies and generation before audit/media without changing the table matrix', () => {
  const workflow = yaml.load(fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/_fetch-guides-sources.yml'), 'utf8'))
  const steps = workflow.jobs.fetch.steps, index = name => steps.findIndex(step => step.name === name)
  assert.ok(index('Prepare immutable baseline') < index('Preflight Guides Base before source fetch'))
  assert.ok(index('Fetch shared guides sources') < index('Generate selected shared Guides sources'))
  assert.ok(index('Generate selected shared Guides sources') < index('Audit canonical links in fetched Guides sources'))
  assert.ok(index('Generate selected shared Guides sources') < index('Prefetch shared guides media'))
  const upstream = steps.find(step => step.name === 'Prepare selected shared Guides upstream')
  assert.match(upstream.run, /--operation prepare-upstream/)
  assert.equal(upstream['continue-on-error'], undefined)
})

test('source preparation binds routing before body access, preserving both inspection and active sets', {timeout: 120000}, async t => {
  const options = await fixture(t)
  const calls = []
  const scraper = {async __base() {calls.push('base'); this.records = options.records}, async bodies() {
    calls.push('bodies'); assert.equal(this.routingContext.routesByRecordId.get('rec0').kind, 'shared-page')
    assert.equal(this.routingContext.inspectedDocsByRecordId.get('rec0'), options.records[0].fields.Docs.link)
    assert.equal(this.routingContext.aliasesByToken.get('old'), 'rec0')
  }}
  await adapter.initializeSharedScraper(scraper, {...options, site: 'en'})
  await scraper.bodies()
  assert.deepEqual(calls, ['base', 'bodies'])
  const restored = adapter.restoreRouting(options.preparation)
  assert.deepEqual(restored.inspectedDocsByRecordId, scraper.routingContext.inspectedDocsByRecordId)
  assert.deepEqual(restored.activeRecordIds, scraper.routingContext.activeRecordIds)
})
test('real generation finds anchors from the refreshed current source graph and forces the referring table', {timeout: 120000}, async t => {
  const options = await fixture(t)
  await write(options.sourceDir, 'reader.json', JSON.stringify(inbound))
  options.candidate.records.push({record_id: 'reader-record', table_id: 'reader-table', doc_token: 'reader', source_file: 'reader.json'})
  const actualHeading = {...heading, heading2: {elements: [{text_run: {content: 'Current heading', text_element_style: {}}}]}}
  const bundle = await generateSharedSources(options, {fetchOld: async () => ({blocks: {items: [actualHeading]}})})
  assert.equal(bundle.outcomes[0].status, 'success', JSON.stringify(bundle.outcomes))
  assert.deepEqual(bundle.effective_active.pages[0].anchors, {'old-heading': 'current-heading'})
  assert.deepEqual(bundle.referring_tables, ['reader-table'])
  assert.deepEqual(options.plan.affected_tables, ['reader-table', 'table'])
})
test('paired target rejection retains both baseline files and failed new pages emit no outputs', {timeout: 120000}, async t => {
  for (const old of [true, false]) {
    const options = await fixture(t, {old})
    const file = 'shared-docs/guides/pages/sample/page.yaml'
    await write(options.repositoryRoot, file, pageYaml('site/en/sample.md', 'tutorials/incorrect'))
    await git(options.repositoryRoot, 'add', '.'); await git(options.repositoryRoot, 'commit', '--quiet', '-m', 'Mismatched path')
    const masterCommit = await git(options.repositoryRoot, 'rev-parse', 'HEAD')
    const prepared = adapter.prepareSharedSources({...options, masterCommit})
    const bundle = await generateSharedSources({...options, preparation: prepared.data}, {fetchOld: async () => {throw new Error('not reached')}})
    assert.equal(bundle.outcomes[0].status, 'fallback')
    assert.match(bundle.outcomes[0].message, /CONFIG_PATH_UNKNOWN/)
    assert.equal(bundle.outcomes[0].baseline.outputs.length, old ? 2 : 0)
    assert.equal(fs.existsSync(path.join(options.out, 'pages')), false)
    assert.deepEqual(bundle.effective_active.pages, [])
  }
})
test('heading-only Feishu adapter resolves a fresh revision once without downloading body attachments', async () => {
  const calls = []
  const scraper = {__wiki_obj_type_from_link: () => 'docx', async fetch_wiki_node(token, type) {calls.push(['node', token, type]); return {obj_type: 'docx', obj_token: 'document'}},
    async fetch_docx_metadata(token) {calls.push(['metadata', token]); return {revision_id: 42}},
    async __fetch_block_pages(result, token, revision) {calls.push(['blocks', token, revision]); result.blocks = {items: [heading, {block_id: 'image', block_type: 27, image: {token: 'do-not-download'}}]}}}
  const result = await adapter.fetchActivationHeadings(scraper, 'old', 'https://example.feishu.cn/docx/old')
  assert.deepEqual(result.blocks.items, [heading])
  assert.deepEqual(calls, [['node', 'old', 'docx'], ['metadata', 'document'], ['blocks', 'document', 42]])
})
test('an anchor-looking heading inside a fenced example cannot satisfy activation', {timeout: 120000}, async t => {
  const options = await fixture(t)
  await assert.rejects(adapter.activationDraft({record: options.records[0], page: 'sample', active: options.preparation.active,
    previousSnapshot: options.preparation.previous_snapshot, currentSources: [inbound], sourceDir: options.sourceDir, rootToken, runId: '123',
    pages: ['guides', 'guides-byoc'].map(manual => ({manual, mdx: '```markdown\n## Heading {#current-anchor}\n```\n'})),
    fetchOld: async () => ({blocks: {items: [heading]}})}), /ACTIVATE_CHECK_FAILED/)
})

test('a fresh no-selection Base scan removes stale preparation and keeps legacy snapshot bytes', {timeout: 120000}, async t => {
  const options = await fixture(t)
  const records = [record('ordinary', 'sample')]; records[0].fields.Docs.link = 'https://example.feishu.cn/wiki/ordinary'
  const preparationFile = path.join(options.root, 'preparation.json')
  await write(options.root, 'preparation.json', JSON.stringify(options.preparation))
  const scraper = {records}
  t.mock.timers.enable({apis: ['Date'], now: 100000})
  const snapshot = () => JSON.stringify(createSourceSnapshot({manualName: 'guides', buildEnv: 'uat', docSourceDir: options.sourceDir,
    baseAppToken: 'base', records, routingContext: scraper.routingContext}))
  const before = snapshot()
  assert.equal(await adapter.initializeSharedScraper(scraper, {...options, site: 'en', output: preparationFile}), null)
  assert.equal(fs.existsSync(preparationFile), false)
  assert.equal(snapshot(), before)
})
test('a navigation move retains the record original physical extension', {timeout: 120000}, async t => {
  const options = await fixture(t)
  const previousSnapshot = structuredClone(options.preparation.previous_snapshot)
  previousSnapshot.records[0].output_paths = ['content/en/guides/tutorials/former/sample.md', 'content/en/byoc/tutorials/former/sample.mdx']
  const targets = adapter.planFetchTargets({record: options.records[0], sourceDir: options.sourceDir, baselineRoot: options.baselineRoot,
    rootToken, page: 'sample', navigation: options.preparation.navigation, previousSnapshot})
  assert.deepEqual(targets.map(target => target.extension), ['.md', '.mdx'])
  assert.deepEqual(targets.map(target => target.path), ['tutorials/manage-data/sample', 'tutorials/manage-data/sample'])
})

test('source workflow generation CLI freezes matching candidate and plan identities using the real build', {timeout: 120000}, async t => {
  const options = await fixture(t, {old: false})
  await write(options.root, 'preparation.json', JSON.stringify(options.preparation))
  await write(options.root, 'candidate.json', JSON.stringify(options.candidate))
  await write(options.root, 'plan.json', JSON.stringify(options.plan))
  const {execFile} = require('node:child_process')
  const {promisify} = require('node:util')
  await promisify(execFile)(process.execPath, [path.join(__dirname, 'guides-shared-sources.js'),
    '--preparation', path.join(options.root, 'preparation.json'), '--workspace', options.repositoryRoot,
    '--baseline', options.baselineRoot, '--repo', options.repo, '--source-dir', options.sourceDir, '--root-token', rootToken,
    '--snapshot', path.join(options.root, 'candidate.json'), '--plan', path.join(options.root, 'plan.json'),
    '--out', options.out, '--scratch', options.scratch, '--run-id', '123', '--image-timeout', '12'], {timeout: 120000})
  const bundle = JSON.parse(fs.readFileSync(path.join(options.out, 'bundle.json')))
  const candidate = JSON.parse(fs.readFileSync(path.join(options.root, 'candidate.json')))
  const plan = JSON.parse(fs.readFileSync(path.join(options.root, 'plan.json')))
  assert.equal(bundle.outcomes[0].status, 'success', JSON.stringify(bundle.outcomes))
  assert.deepEqual(candidate.records[0].shared_page, bundle.outcomes[0].identity)
  assert.deepEqual(plan.changed_records[0].shared_page, bundle.outcomes[0].identity)
  assert.deepEqual(candidate.navigation_records[0].shared_page, bundle.outcomes[0].identity)
})

test('activation reuses writer repair for standalone trailing anchors without mutating either manual evidence', {timeout: 120000}, async t => {
  const options = await fixture(t)
  const oldHeading = {block_id: 'old-heading', block_type: 4, heading2: {elements: [
    {text_run: {content: 'Current heading ', text_element_style: {}}},
    {text_run: {content: '{stable-anchor}', text_element_style: {}}},
  ]}}
  const before = structuredClone(oldHeading)
  const result = await adapter.activationDraft({record: options.records[0], page: 'sample', active: options.preparation.active,
    previousSnapshot: options.preparation.previous_snapshot, currentSources: [inbound], sourceDir: options.sourceDir, rootToken, runId: '123',
    pages: ['guides', 'guides-byoc'].map(manual => ({manual, mdx: '## Current heading {#stable-anchor}\n'})),
    fetchOld: async () => ({blocks: {items: [oldHeading]}})})
  assert.deepEqual(result.entry.anchors, {'old-heading': 'stable-anchor'})
  assert.deepEqual(oldHeading, before)
})
test('workflow upstream preparation reaches paired fallback for a missing tracking ref', {timeout: 120000}, async t => {
  const options = await fixture(t)
  const workflow = yaml.load(fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/_fetch-guides-sources.yml'), 'utf8'))
  const steps = workflow.jobs.fetch.steps
  const prepare = steps.find(step => step.name === 'Prepare selected shared Guides upstream')
  assert.ok(prepare, 'controlled upstream preparation must replace fatal checkout')
  const baseline = path.join(options.root, 'baseline')
  fs.renameSync(options.baselineRoot, baseline)
  await write(options.root, 'preparation.json', JSON.stringify(options.preparation))
  const report = 'packages/docs-tooling/src/lark/meta/reports'
  await write(options.repositoryRoot, `${report}/guides-source-snapshot-candidate.json`, JSON.stringify(options.candidate))
  await write(options.repositoryRoot, `${report}/guides-incremental-fetch-plan.json`, JSON.stringify(options.plan))
  const env = {...process.env, GITHUB_WORKSPACE: options.repositoryRoot, RUNNER_TEMP: options.root,
    DOCS_TOOLING_SHARED_PREPARATION: path.join(options.root, 'preparation.json'), SHARED_TRACKING_BRANCH: 'deleted-branch',
    source_dir: options.sourceDir, root_token: rootToken}
  const {execFile} = require('node:child_process'), {promisify} = require('node:util')
  const command = text => text.replaceAll('node scripts/docs-workflow/guides-shared-sources.js', `${process.execPath} ${path.join(__dirname, 'guides-shared-sources.js')}`)
    .replaceAll('https://github.com/milvus-io/milvus-docs.git', options.repo)
    .replaceAll('${{ github.run_id }}', '123').replaceAll('${{ inputs.shared_image_timeout }}', '120')
  await promisify(execFile)('bash', ['-euo', 'pipefail', '-c', command(prepare.run)], {cwd: options.repositoryRoot, env, timeout: 120000})
  // A successful setup step allows the ordinary source-fetch boundary to proceed.
  await write(options.root, 'ordinary-source-completed', 'complete')
  const generate = steps.find(step => step.name === 'Generate selected shared Guides sources')
  await promisify(execFile)('bash', ['-euo', 'pipefail', '-c', command(generate.run)], {cwd: options.repositoryRoot, env, timeout: 120000})
  const bundle = JSON.parse(fs.readFileSync(path.join(options.repositoryRoot, 'tmp/docs-tooling/en/shared-pages/guides/bundle.json')))
  assert.equal(fs.readFileSync(path.join(options.root, 'ordinary-source-completed'), 'utf8'), 'complete')
  assert.equal(bundle.outcomes[0].status, 'fallback')
  assert.equal(bundle.outcomes[0].code, 'SHARED_UPSTREAM_REF_MISSING')
  assert.equal(bundle.outcomes[0].baseline.outputs.length, 2)
  assert.deepEqual(bundle.effective_active.pages, [])
})
test('upstream preparation preserves hard failures for unavailable remotes rather than emitting a missing-ref fallback', {timeout: 120000}, async t => {
  const options = await fixture(t)
  const {prepareUpstream} = require('./guides-shared-sources')
  const status = path.join(options.root, 'upstream-status.json')
  assert.throws(() => prepareUpstream({repository: path.join(options.root, 'unavailable-remote'), track: 'release/docs',
    out: path.join(options.root, 'clone'), statusFile: status}), /git|repository|remote/i)
  assert.equal(fs.existsSync(status), false)
})

test('full-history preparation permits missing locked commits to fall back per page while siblings generate', {timeout: 120000}, async t => {
  const options = await fixture(t, {old: false, pages: ['sample', 'sibling']})
  const {prepareUpstream, lockedInventory} = require('./guides-shared-sources')
  const clone = path.join(options.root, 'prepared-upstream'), statusFile = path.join(options.root, 'upstream-status.json')
  const status = prepareUpstream({repository: options.repo, track: 'release/docs', out: clone, statusFile})
  assert.equal(status.status, 'ready')
  assert.equal(await git(clone, 'rev-parse', '--is-shallow-repository'), 'false')
  assert.equal(await git(clone, 'rev-parse', 'refs/heads/release/docs'), options.upstreamCommit)
  await write(options.repositoryRoot, 'shared-docs/guides/pages/sample/lock.yaml', JSON.stringify({schema_version: 1, current: '0'.repeat(40), next: options.upstreamCommit}))
  await git(options.repositoryRoot, 'add', '.'); await git(options.repositoryRoot, 'commit', '--quiet', '-m', 'Missing retained lock input')
  const masterCommit = await git(options.repositoryRoot, 'rev-parse', 'HEAD')
  const prepared = adapter.prepareSharedSources({...options, masterCommit})
  const bundle = await generateSharedSources({...options, repo: clone, preparation: prepared.data, upstreamStatus: status},
    {fetchOld: async () => {throw new Error('New records have no old document')}})
  assert.deepEqual(bundle.outcomes.map(outcome => outcome.status), ['fallback', 'success'])
  assert.equal(bundle.outcomes[0].code, 'SHARED_UPSTREAM_LOCK_MISSING')
  assert.deepEqual(bundle.outcomes[0].baseline.outputs, [])
  assert.throws(() => lockedInventory(path.join(options.root, 'not-prepared'), options.upstreamCommit), error => error.code === 'SHARED_UPSTREAM_NOT_PREPARED' && !error.hardStop)
  assert.throws(() => lockedInventory(options.sourceDir, options.upstreamCommit), error => error.hardStop === true)
})

test('portable bundle authenticates both manual outputs, evidence, images and rejects incomplete or extra payloads', {timeout: 120000}, async t => {
  const options = await fixture(t, {imageSource: true})
  const bundle = await generateSharedSources(options, {fetchOld: async () => ({blocks: {items: []}})})
  const {loadBundle, validateBundle} = require('../../packages/docs-tooling/src/lark/sharedPageBundle')
  const handoff = loadBundle(options.out, {masterSha: options.masterCommit, devBaselineSha: options.devCommit})
  assert.equal(handoff.routing.inspectedDocsByRecordId.size, options.records.length)
  assert.ok(Object.isFrozen(handoff.bundle))
  for (const target of bundle.outcomes[0].outputs) assert.match(handoff.files.get(target.file).toString(), /https:\/\/zdoc-images.s3.us-west-2.amazonaws.com\/shared\//)
  const change = mutate => {
    const files = new Map(handoff.files), data = structuredClone(bundle)
    mutate(data, files); files.set('bundle.json', Buffer.from(JSON.stringify(data)))
    return () => validateBundle(files, {masterSha: options.masterCommit, devBaselineSha: options.devCommit})
  }
  assert.throws(change(data => data.outcomes[0].outputs.pop()), /incomplete paired/)
  assert.throws(change(data => data.outcomes.push(data.outcomes[0])), /duplicate/)
  assert.throws(change(data => data.master_commit = 'a'.repeat(40)), /commit binding/)
  assert.throws(change(data => data.dev_commit = 'b'.repeat(40)), /commit binding/)
  assert.throws(change((data, files) => files.set(data.outcomes[0].outputs[0].file, Buffer.from('tampered'))), /digest mismatch/)
  assert.throws(change((data, files) => files.set('images/secret.png', image)), /extra bundle evidence/)
  assert.throws(change(data => data.outcomes[0].outputs[0].file = '../outside'), /unsafe/)
  const imageFile = path.join(options.out, 'symlink.png'); fs.symlinkSync(path.join(options.scratch, 'images', bundle.outcomes[0].images[0].sha256), imageFile)
  assert.throws(() => loadBundle(options.out), /symlink/)
})
for (const metadataMarker of [false, true]) test(`actual offline writer places finalized prebuilt bytes in both physical extensions without changing source identity${metadataMarker ? ' with --- metadata' : ''}`, {timeout: 120000}, async t => {
  const options = await fixture(t, {metadataMarker})
  const bundle = await generateSharedSources(options, {fetchOld: async () => ({blocks: {items: []}})})
  const before = JSON.stringify(options.candidate)
  fs.cpSync(path.join(options.repositoryRoot, 'shared-docs'), path.join(options.root, 'shared-docs'), {recursive: true})
  const {loadBundle} = require('../../packages/docs-tooling/src/lark/sharedPageBundle')
  const handoff = loadBundle(options.out)
  const Writer = require('../../packages/docs-tooling/src/lark/larkDocWriter')
  const Index = require('../../packages/docs-tooling/src/lark/larkSourceIndex')
  for (const output of bundle.outcomes[0].outputs) {
    const writer = Object.create(Writer.prototype)
    Object.assign(writer, {root_token: rootToken, targets: output.manual === 'guides' ? 'zilliz.saas' : 'zilliz.paas', sourceIndex: Index.load(options.sourceDir),
      docSourceDir: options.sourceDir, sharedBundle: handoff, sharedWorkspace: options.root, block_types: Writer.prototype.__block_types()})
    const source = writer.sourceIndex.find('base_record_id', 'rec0')
    const destination = path.join(options.root, `tmp/docs-tooling/en/${output.manual}/${output.path}`)
    const request = {path: path.dirname(destination), page_title: source.title, page_slug: source.slug, page_token: source.node_token,
      sidebar_label: metadataMarker ? 'Before --- After' : 'Fresh Base label', sidebar_position: 1, page_channel: 'next'}
    fs.mkdirSync(path.dirname(destination), {recursive: true})
    await writer.write_docs(path.join(options.root, `tmp/docs-tooling/en/${output.manual}/content/en/${output.manual === 'guides' ? 'guides' : 'byoc'}/tutorials`), rootToken)
    const emitted = fs.readFileSync(destination)
    assert.equal(adapter.digest(emitted), output.sha256)
    if (metadataMarker) {
      const lines = emitted.toString('utf8').split('\n')
      const front = yaml.load(lines.slice(1, lines.indexOf('---', 1)).join('\n'))
      const suffix = output.manual === 'guides' ? 'Cloud' : 'BYOC'
      assert.equal(front.sidebar_label, 'Before --- After')
      assert.equal(front.title, `Title --- text | ${suffix}`)
      assert.equal(front.description, `Summary --- text | ${suffix}`)
    }
    await assert.rejects(writer.write_doc({...request, sidebar_position: 2}), /navigation changed/)
    await assert.rejects(writer.write_doc({...request, path: path.join(request.path, 'wrong')}), /destination mismatch/)
  }
  assert.equal(JSON.stringify(options.candidate), before)
})
test('table cleanup conserves exact old fallback paths absent from current traversal and table artifact binds their bytes', {timeout: 120000}, async t => {
  const options = await fixture(t)
  const bundle = await generateSharedSources(options, {fetchOld: async () => {throw Error('unavailable')}})
  const {ROOT} = require('../../packages/docs-tooling/src/lark/sharedPageBundle')
  fs.mkdirSync(path.dirname(path.join(options.root, ROOT)), {recursive: true}); fs.cpSync(options.out, path.join(options.root, ROOT), {recursive: true})
  const {renderGuidesTable} = require('./render-guides-table')
  const {createGuidesTableArtifact} = require('./guides-table-artifact')
  for (const [target, manual] of [['zilliz.saas', 'guides'], ['zilliz.paas', 'guides-byoc']]) for (const cleanup of [false, true]) {
    const entry = {site: 'en', table_id: 'old-table', table_slug: 'manage-data', table_name: 'Manage Data', target, cleanup}
    const result = renderGuidesTable({...entry, workspace: options.root, spawnSync() {assert.equal(cleanup, false); return {status: 0}}})
    const descriptor = bundle.outcomes[0].baseline.outputs.find(output => output.path.includes(manual === 'guides' ? '/guides/' : '/byoc/'))
    assert.deepEqual(fs.readFileSync(path.join(options.root, `tmp/docs-tooling/en/${manual}/${descriptor.path}`)), fs.readFileSync(path.join(options.baselineRoot, descriptor.path)))
    const artifact = await createGuidesTableArtifact({workspace: options.root, output: path.join(options.root, `artifact-${manual}`), entry,
      masterSha: options.masterCommit, devBaselineSha: options.devCommit, sourceArtifactSha256: 'a'.repeat(64)})
    assert.equal(artifact.files.length, 1); assert.equal(artifact.files[0].sha256, descriptor.sha256)
    assert.ok(artifact.files[0].path.startsWith(result.outputPath + '/'))
  }
})
test('source image orchestration reuses accepted scratch across pages and rejects tampering', {timeout: 120000}, async t => {
  const options = await fixture(t, {pages: ['sample', 'sibling'], imageSource: true})
  const bundle = await generateSharedSources(options, {fetchOld: async () => ({blocks: {items: []}})})
  const {uploadSharedImages} = require('./guides-shared-images')
  const {SharedImageUploader} = require('../../packages/docs-tooling/src/lark/sharedImageUploader')
  const accepted = bundle.outcomes[0].images[0]
  let calls = 0
  const uploader = new SharedImageUploader({mode: 'skip'})
  const original = uploader.upload.bind(uploader)
  uploader.upload = input => {calls++; assert.deepEqual(Buffer.from(input.bytes), image); return original(input)}
  assert.deepEqual(await uploadSharedImages({bundleRoot: options.out, scratch: options.scratch, uploader}), {images: 1})
  assert.equal(calls, 1)
  fs.writeFileSync(path.join(options.scratch, 'images', accepted.sha256), 'tamper')
  await assert.rejects(uploadSharedImages({bundleRoot: options.out, scratch: options.scratch, mode: 'skip'}), {code: 'PUBLISH_IMAGE_UPLOAD_FAILED'})
})
test('authenticated fallback preserves exactly the historical target set, including a legitimate one-target page', {timeout: 120000}, async t => {
  const options = await fixture(t, {singleTarget: true})
  const bundle = await generateSharedSources(options, {fetchOld: async () => {throw Error('unavailable')}})
  const {loadBundle, validateBundle} = require('../../packages/docs-tooling/src/lark/sharedPageBundle')
  const handoff = loadBundle(options.out)
  assert.equal(bundle.outcomes[0].baseline.outputs.length, 1)
  const data = structuredClone(bundle); data.outcomes[0].baseline.outputs = []
  const files = new Map(handoff.files); files.set('bundle.json', Buffer.from(JSON.stringify(data)))
  assert.throws(() => validateBundle(files), /incomplete baseline outputs/)
  files.delete(bundle.outcomes[0].baseline.outputs[0].file); files.set('bundle.json', Buffer.from(JSON.stringify(bundle)))
  assert.throws(() => validateBundle(files), /missing/)
})
test('real source artifact creation and restoration authenticate the portable shared bundle before offline placement', {timeout: 120000}, async t => {
  const options = await fixture(t)
  await generateSharedSources(options, {fetchOld: async () => ({blocks: {items: []}})})
  const workspace = path.join(options.root, 'artifact-workspace'), artifact = path.join(options.root, 'artifact'), restored = path.join(options.root, 'restored')
  const {ROOT, loadBundle} = require('../../packages/docs-tooling/src/lark/sharedPageBundle')
  const {createGuidesStageArtifact, restoreGuidesStageArtifact, validateGuidesStageArtifact} = require('./guides-stage-artifact')
  const put = (file, value) => {const full = path.join(workspace, file); fs.mkdirSync(path.dirname(full), {recursive: true}); fs.writeFileSync(full, JSON.stringify(value))}
  const reports = 'packages/docs-tooling/src/lark/meta/reports/'
  fs.mkdirSync(path.join(workspace, 'packages/docs-tooling/src/lark/meta/sources'), {recursive: true})
  fs.cpSync(options.sourceDir, path.join(workspace, 'packages/docs-tooling/src/lark/meta/sources/guides'), {recursive: true})
  fs.mkdirSync(path.dirname(path.join(workspace, ROOT)), {recursive: true}); fs.cpSync(options.out, path.join(workspace, ROOT), {recursive: true})
  put(reports + 'guides-source-snapshot-candidate.json', options.candidate)
  put('packages/docs-tooling/src/lark/meta/media-cache/guides.json', {schemaVersion: 1, entries: []})
  put(reports + 'guides-media-prefetch.json', {schemaVersion: 1, generated_at: '2026-10-26T00:00:00.000Z', mode: 'recovery', cacheState: 'missing', metrics: {
    canonicalReferencesRequired: 0, selectedReferences: 0, validatedManifestReuse: 0, committedDocsReconstruction: 0, resolvedByNetwork: 0, staleEntriesDropped: 0, finalManifestEntries: 0}})
  put(reports + 'guides-assembly-decision.json', {schemaVersion: 1, generated_at: '2026-10-26T00:00:00.000Z', masterSha: options.masterCommit,
    devBaselineSha: options.devCommit, baselineSourceSha: options.devCommit, mode: 'reuse', reasons: [], tableCount: 0,
    semanticSourceGraphSha256: '1'.repeat(64), navigationOwnershipSha256: '2'.repeat(64), generatorFingerprintSha256: '3'.repeat(64),
    baselineDescriptorPresent: true, baselineDescriptorValid: true, baselineDescriptorSha256: '4'.repeat(64),
    baselineSaasSidebarPresent: true, baselineSaasSidebarValid: true, baselineSaasSidebarSha256: '5'.repeat(64),
    baselineByocSidebarPresent: true, baselineByocSidebarValid: true, baselineByocSidebarSha256: '6'.repeat(64)})
  const manifest = await createGuidesStageArtifact({stage: 'source', workspace, baselineDir: options.baselineRoot, output: artifact,
    masterSha: options.masterCommit, devBaselineSha: options.devCommit, rootToken})
  assert.ok(manifest.files.some(file => file.path === ROOT + '/bundle.json'))
  assert.ok(!manifest.files.some(file => file.path.includes('/images/')))
  await restoreGuidesStageArtifact({artifact, target: restored, expected: {masterSha: options.masterCommit, devBaselineSha: options.devCommit}})
  assert.equal(loadBundle(path.join(restored, ROOT)).bundle.outcomes.length, 1)
  const image = manifest.files.find(file => file.path === ROOT + '/bundle.json')
  const manifestFile = path.join(artifact, 'manifest.json')
  image.size++; fs.writeFileSync(manifestFile, JSON.stringify(manifest))
  await assert.rejects(validateGuidesStageArtifact(artifact), /size mismatch/)
  image.size--; image.size = 33 * 1024 * 1024; fs.writeFileSync(manifestFile, JSON.stringify(manifest))
  await assert.rejects(validateGuidesStageArtifact(artifact), /limit exceeded/)
})
test('actual shared-upload workflow shell fails before source artifacts and preserves existing reconciliation gates', {timeout: 120000}, async t => {
  const options = await fixture(t, {imageSource: true})
  const bundle = await generateSharedSources(options, {fetchOld: async () => ({blocks: {items: []}})})
  const repoRoot = path.resolve(__dirname, '../..')
  const workflow = yaml.load(fs.readFileSync(path.join(repoRoot, '.github/workflows/_fetch-guides-sources.yml'), 'utf8'))
  const steps = workflow.jobs.fetch.steps, upload = steps.find(step => step.name === 'Upload accepted shared Guides images')
  assert.equal(upload['continue-on-error'], undefined)
  assert.ok(steps.indexOf(upload) > steps.findIndex(step => step.id === 'media_prefetch'))
  assert.ok(steps.indexOf(upload) < steps.findIndex(step => step.name === 'Create shared source artifact'))
  const bad = bundle.outcomes[0].images[0]
  fs.writeFileSync(path.join(options.scratch, 'images', bad.sha256), 'tampered')
  const script = upload.run.replace('tmp/docs-tooling/en/shared-pages/guides', JSON.stringify(options.out))
    .replace('"$RUNNER_TEMP/guides-shared-images"', JSON.stringify(options.scratch)).replace('${{ inputs.media_upload_mode }}', 'skip')
  const run = require('node:child_process').spawnSync('bash', ['-e', '-c', script], {cwd: repoRoot, encoding: 'utf8'})
  assert.equal(run.status, 1); assert.match(run.stderr, /PUBLISH_IMAGE_UPLOAD_FAILED/)
  const root = yaml.load(fs.readFileSync(path.join(repoRoot, '.github/workflows/fetch-docs.yml'), 'utf8'))
  assert.match(root.jobs.render_guides_tables.if, /produce_guides_sources.outputs.status == 'artifact_ready'/)
  assert.match(root.jobs.produce_guides.if, /produce_guides_sources.outputs.status == 'artifact_ready'/)
  const gate = Object.values(root.jobs).flatMap(job => job.steps || []).find(step => step.id === 'validate_producers')
  assert.match(gate.if, /run_translations == 'true'/)
  // Run the existing producer validator only under the same true branch as the workflow.
  const {buildFetchPublicationSelection} = require('./fetch-publication-selection')
  const {validateReconciliationProducers} = require('./validate-reconciliation-producers')
  const selection = buildFetchPublicationSelection({repository: 'zilliztech/zdoc', runId: 123, runAttempt: 1, toolingSha: options.masterCommit,
    targetBranch: 'dev', initialTargetSha: options.devCommit, sourceBaselineSha: options.devCommit, selectedGroup: 'guides', publish: true, runTranslations: true})
  const selectionFile = path.join(options.root, 'selection.json'); fs.writeFileSync(selectionFile, JSON.stringify(selection))
  let reads = 0
  const validate = async translations => {if (translations) await validateReconciliationProducers(selectionFile, {listJobs: async () => {reads++; return []}})}
  await assert.rejects(validate(true), /Reconciliation producers are not ready/)
  await validate(false); assert.equal(reads, 1)
})
