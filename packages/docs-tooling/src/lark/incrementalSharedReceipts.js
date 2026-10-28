'use strict'

// Shared-page records satisfy source completeness through published receipts
// rather than Feishu body files. Incremental planning must therefore see the
// same receipts the source-cache gate accepted; without them every shared
// record counts as a missing canonical source and the planner degrades each
// English Guides fetch to a full fetch.
const fs = require('node:fs')
const path = require('node:path')

const SOURCE_CACHE_DIR = 'packages/docs-tooling/src/lark/meta/source-cache'

function sharedRecords(snapshot) {
  return (snapshot?.records || []).filter(record => record.source_kind === 'shared-page')
}

function receiptsFromSourceCacheManifest(workspace, sourceDirName) {
  const manifestPath = path.join(workspace, SOURCE_CACHE_DIR, `${sourceDirName}-manifest.json`)
  const stat = fs.lstatSync(manifestPath)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('source cache manifest must be a regular file')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (!manifest.sharedReceipts || typeof manifest.sharedReceipts !== 'object' || Array.isArray(manifest.sharedReceipts)) {
    throw new Error('source cache manifest has no shared receipts')
  }
  return new Map(Object.entries(manifest.sharedReceipts))
}

function receiptsFromPublishedAuthority(workspace, snapshot) {
  return require('./sharedPagePublication').publishedEvidence(workspace, snapshot, {verifyFiles: false}).receipts
}

// Receipts are only located here; validateSourceCompleteness still authenticates
// every receipt against the snapshot record, so a stale or foreign receipt set
// degrades to the existing full-fetch decision instead of being trusted.
function sharedReceiptsForPlanning({ workspace = process.cwd(), sourceDirName, snapshot } = {}) {
  if (typeof sourceDirName !== 'string' || !sourceDirName || sourceDirName.includes('/') || sourceDirName.includes('\\')) {
    throw new Error('sourceDirName must be a bare source directory name')
  }
  if (sharedRecords(snapshot).length === 0) return new Map()
  const sources = [
    () => receiptsFromSourceCacheManifest(workspace, sourceDirName),
    () => receiptsFromPublishedAuthority(workspace, snapshot),
  ]
  for (const source of sources) {
    try {
      const receipts = source()
      if (receipts.size > 0) return receipts
    } catch (_) {
      // The next receipt source may still be available in this workspace.
    }
  }
  return new Map()
}

module.exports = { sharedReceiptsForPlanning }
