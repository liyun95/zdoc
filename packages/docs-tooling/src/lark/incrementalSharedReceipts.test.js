'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { sharedReceiptsForPlanning } = require('./incrementalSharedReceipts')

const MANIFEST = 'packages/docs-tooling/src/lark/meta/source-cache/guides-manifest.json'
const AUTHORITY = 'generated/en/manifests/shared-pages/guides/_publication.json'

function write(root, relative, value) {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2))
  return file
}

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-receipts-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

const sharedSnapshot = {
  schema_version: 3, manual: 'guides', build_env: 'uat',
  records: [
    { record_id: 'rec-feishu', placement_type: 'canonical', doc_token: 'feishu', source_file: 'feishu.json' },
    { record_id: 'rec-shared', placement_type: 'canonical', source_kind: 'shared-page', shared_page: { group: 'guides', page: 'example', record: 'generated/en/manifests/shared-pages/guides/rec-shared.json' } },
  ],
}

test('snapshots without shared records never touch the workspace', t => {
  const root = workspace(t)
  write(root, MANIFEST, '{ not json')
  const snapshot = { ...sharedSnapshot, records: sharedSnapshot.records.filter(record => record.source_kind === undefined) }
  assert.deepEqual(sharedReceiptsForPlanning({ workspace: root, sourceDirName: 'guides', snapshot }), new Map())
  assert.deepEqual(sharedReceiptsForPlanning({ workspace: root, sourceDirName: 'guides', snapshot: null }), new Map())
})

test('the promoted source-cache manifest supplies the receipts the cache gate accepted', t => {
  const root = workspace(t)
  const receipt = { token: 'receipt-token', inputs: { fetch: {} }, outputs: [] }
  write(root, MANIFEST, { schemaVersion: 2, site: 'en', manual: 'guides', buildEnv: 'uat', sharedReceipts: { 'rec-shared': receipt } })
  const receipts = sharedReceiptsForPlanning({ workspace: root, sourceDirName: 'guides', snapshot: sharedSnapshot })
  assert.deepEqual([...receipts.keys()], ['rec-shared'])
  assert.deepEqual(receipts.get('rec-shared'), receipt)
})

test('the manifest is read for the requested source identity only', t => {
  const root = workspace(t)
  write(root, MANIFEST, { schemaVersion: 2, sharedReceipts: { 'rec-shared': { token: 'en' } } })
  assert.deepEqual(sharedReceiptsForPlanning({ workspace: root, sourceDirName: 'guides-zh-CN', snapshot: sharedSnapshot }), new Map())
  assert.throws(() => sharedReceiptsForPlanning({ workspace: root, sourceDirName: '../guides', snapshot: sharedSnapshot }), /bare source directory name/)
  assert.throws(() => sharedReceiptsForPlanning({ workspace: root, snapshot: sharedSnapshot }), /bare source directory name/)
})

test('a manifest without receipts, a corrupt manifest, or a symlinked manifest falls through to published authority', t => {
  const root = workspace(t)
  const receipt = { token: 'from-authority' }
  write(root, 'generated/en/manifests/shared-pages/guides/rec-shared.json', receipt)
  write(root, AUTHORITY, { schema_version: 1 })
  let observed = null
  const publication = require('./sharedPagePublication')
  const original = publication.publishedEvidence
  publication.publishedEvidence = (ws, snapshot, options) => {
    observed = { ws, snapshot, options }
    return { receipts: new Map([['rec-shared', receipt]]), fallbackIds: new Set(), active: null }
  }
  t.after(() => { publication.publishedEvidence = original })

  for (const manifest of [{ schemaVersion: 2 }, '{ not json', { schemaVersion: 2, sharedReceipts: [] }]) {
    write(root, MANIFEST, manifest)
    observed = null
    const receipts = sharedReceiptsForPlanning({ workspace: root, sourceDirName: 'guides', snapshot: sharedSnapshot })
    assert.deepEqual(receipts.get('rec-shared'), receipt)
    assert.equal(observed.ws, root)
    assert.equal(observed.snapshot, sharedSnapshot)
    assert.deepEqual(observed.options, { verifyFiles: false })
  }

  fs.rmSync(path.join(root, MANIFEST))
  fs.symlinkSync(path.join(root, 'elsewhere.json'), path.join(root, MANIFEST))
  observed = null
  assert.deepEqual(sharedReceiptsForPlanning({ workspace: root, sourceDirName: 'guides', snapshot: sharedSnapshot }).get('rec-shared'), receipt)
  assert.ok(observed, 'a symlinked manifest must not be trusted')
})

test('missing receipts degrade to an empty map so planning keeps its full-fetch decision', t => {
  const root = workspace(t)
  assert.deepEqual(sharedReceiptsForPlanning({ workspace: root, sourceDirName: 'guides', snapshot: sharedSnapshot }), new Map())
  write(root, AUTHORITY, '{ corrupt authority')
  assert.deepEqual(sharedReceiptsForPlanning({ workspace: root, sourceDirName: 'guides', snapshot: sharedSnapshot }), new Map())
})
