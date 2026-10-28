#!/usr/bin/env node
'use strict'

// REST upstream drift watchdog core (design §7 T1). Read-only: for every
// spec-file source in the lock it compares the tracked ref's HEAD with the
// pin, and on drift downloads the upstream spec at HEAD and runs the
// deterministic diff to classify what moved. Source-tree sources report a
// pin-only check until the milvus extractor skeleton lands (P2). The lock
// file is never written here: the pin moves only through reviewed refresh PRs,
// so lastVerifiedAt rides those PRs instead of scheduled watchdog commits.

const fs = require('node:fs')
const path = require('node:path')
const {spawnSync} = require('node:child_process')
const {loadRestUpstreamLock} = require(path.join(__dirname, '..', '..', 'packages', 'docs-tooling', 'src', 'reference', 'rest', 'upstreamDiff', 'lock'))
const {substantiveDriftEntries} = require(path.join(__dirname, '..', '..', 'packages', 'docs-tooling', 'src', 'reference', 'rest', 'upstreamDiff', 'cli'))
const {diffDigestOf} = require(path.join(__dirname, '..', '..', 'packages', 'docs-tooling', 'src', 'reference', 'rest', 'upstreamDiff', 'changeSet'))
const {serializeDocument} = require(path.join(__dirname, '..', '..', 'packages', 'docs-tooling', 'src', 'reference', 'rest', 'upstreamDiff', 'formatter'))

const REST_UPSTREAM_ENTRY = path.join(__dirname, '..', '..', 'packages', 'docs-tooling', 'src', 'reference', 'rest', 'index.js')
const GITHUB_API = 'https://api.github.com'

function fail(message) {
    throw new Error(message)
}

async function githubJson(fetchImpl, url, token) {
    const headers = {Accept: 'application/vnd.github+json'}
    if (token) headers.Authorization = `Bearer ${token}`
    const response = await fetchImpl(url, {headers})
    if (!response.ok) fail(`GITHUB_API_FAILED: ${url} -> ${response.status}`)
    return response.json()
}

async function resolveHeadSha(fetchImpl, {repository, ref, token}) {
    const body = await githubJson(fetchImpl, `${GITHUB_API}/repos/${repository}/commits/${encodeURIComponent(ref)}`, token)
    if (typeof body.sha !== 'string' || !/^[a-f0-9]{40}$/.test(body.sha)) fail(`GITHUB_API_UNEXPECTED: ${repository}@${ref} returned no commit sha`)
    return body.sha
}

async function fetchSpecBytes(fetchImpl, {repository, specPath, ref, token}) {
    const headers = {Accept: 'application/vnd.github.raw+json'}
    if (token) headers.Authorization = `Bearer ${token}`
    const response = await fetchImpl(`${GITHUB_API}/repos/${repository}/contents/${specPath.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`, {headers})
    if (!response.ok) fail(`GITHUB_API_FAILED: contents ${repository}:${specPath}@${ref} -> ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
}

// One source check. `no-drift` is the cheap daily path; `drift` runs the diff
// at HEAD; `pin-only` covers source-tree sources ahead of the P2 extractor.
async function checkSource(fetchImpl, {source, tokens}) {
    const isPrivate = source.repository === 'zilliztech/zilliz-cloud'
    const token = isPrivate ? tokens.private : tokens.public
    if (isPrivate && !token) fail('REST_UPSTREAM_WATCHDOG_TOKEN_MISSING: provision REST_UPSTREAM_GITHUB_TOKEN (or PRODUCT_DOC_LINKS_GITHUB_TOKEN) with contents:read on zilliztech/zilliz-cloud')
    const headSha = await resolveHeadSha(fetchImpl, {repository: source.repository, ref: source.trackedRef, token})
    const base = {id: source.id, repository: source.repository, trackedRef: source.trackedRef, pin: source.pin.commit, head: headSha}
    if (headSha === source.pin.commit) return {...base, status: 'no-drift'}
    if (source.artifact.kind !== 'spec-file') {
        return {...base, status: 'pin-behind', note: 'source-tree source: the extractor skeleton (P2) is required before this drift can be classified'}
    }
    return {...base, status: 'drift', artifactPath: source.artifact.path}
}

async function runWatchdog({lockPath, outDir, tokens, fetchImpl = globalThis.fetch, date = new Date().toISOString().slice(0, 10)}) {
    const lock = loadRestUpstreamLock(lockPath)
    const sources = []
    for (const source of lock.sources) {
        const check = await checkSource(fetchImpl, {source, tokens})
        if (check.status === 'drift') {
            const sourceDir = path.join(outDir, source.id)
            fs.mkdirSync(sourceDir, {recursive: true})
            // Keep the upstream extension: loadSpecFile dispatches YAML vs JSON on it.
            const specPath = path.join(sourceDir, `upstream-spec${path.extname(check.artifactPath) || '.yaml'}`)
            fs.writeFileSync(specPath, await fetchSpecBytes(fetchImpl, {repository: source.repository, specPath: check.artifactPath, ref: check.head, token: source.repository === 'zilliztech/zilliz-cloud' ? tokens.private : tokens.public}))
            const diffDir = path.join(sourceDir, 'diff')
            const result = spawnSync(process.execPath, [REST_UPSTREAM_ENTRY, 'rest-upstream-diff', '--source', source.id, '--spec', specPath, '--upstream-commit', check.head, '--out', diffDir], {encoding: 'utf8'})
            if (result.status !== 0) fail(`REST_UPSTREAM_WATCHDOG_DIFF_FAILED: ${source.id}: ${result.stderr.slice(0, 1000)}`)
            const diffDocument = JSON.parse(fs.readFileSync(path.join(diffDir, 'diff.json'), 'utf8'))
            const driftEntries = substantiveDriftEntries(diffDocument)
            Object.assign(check, {
                substantiveCount: driftEntries.length,
                summary: diffDocument.summary,
                diffDigest: diffDigestOf(diffDocument),
            })
        }
        sources.push(check)
    }
    const report = {schemaVersion: '1.0', generatedOn: date, sources}
    fs.mkdirSync(outDir, {recursive: true})
    fs.writeFileSync(path.join(outDir, 'watchdog-report.json'), serializeDocument(report))
    fs.writeFileSync(path.join(outDir, 'watchdog-report.md'), renderWatchdogMarkdown(report))
    return report
}

function renderWatchdogMarkdown(report) {
    const lines = [`# REST upstream drift watchdog — ${report.generatedOn}`, '']
    for (const source of report.sources) {
        const label = source.status === 'no-drift' ? '✅ no drift'
            : source.status === 'drift' ? `⚠️ drift — ${source.substantiveCount} substantive entr(ies)`
            : `⚠️ pin behind (not classifiable yet)`
        lines.push(`## ${source.id} — ${label}`, '')
        lines.push(`- upstream: \`${source.repository}@${source.trackedRef}\`, HEAD \`${source.head}\`, pin \`${source.pin}\``)
        if (source.note) lines.push(`- ${source.note}`)
        if (source.summary) lines.push(`- diff summary: ${Object.entries(source.summary).map(([category, count]) => `${category} ${count}`).sort().join(', ')}`)
        lines.push('')
    }
    return `${lines.join('\n')}\n`
}

function watchdogCardStatus(report) {
    return report.sources.every(source => source.status === 'no-drift') ? 'success' : 'fail'
}

module.exports = {runWatchdog, renderWatchdogMarkdown, watchdogCardStatus, resolveHeadSha, fetchSpecBytes}

if (require.main === module) {
    const args = process.argv.slice(2)
    const readOption = name => {
        const index = args.indexOf(name)
        return index >= 0 ? args[index + 1] : undefined
    }
    const lockPath = readOption('--lock') || path.join(__dirname, '..', '..', 'packages', 'docs-tooling', 'src', 'reference', 'rest', 'meta', 'upstream', 'rest-upstream-lock.json')
    const outDir = readOption('--out')
    if (!outDir) fail('Usage: node scripts/rest-upstream/drift-watchdog.js --out <dir> [--lock <path>]')
    runWatchdog({
        lockPath,
        outDir,
        tokens: {
            private: process.env.REST_UPSTREAM_GITHUB_TOKEN || process.env.PRODUCT_DOC_LINKS_GITHUB_TOKEN,
            public: process.env.REST_UPSTREAM_PUBLIC_GITHUB_TOKEN || process.env.GITHUB_TOKEN,
        },
    }).then(report => {
        console.log(`watchdog: ${report.sources.map(source => `${source.id}=${source.status}`).join(', ')}`)
    }).catch(error => {
        console.error(String(error?.message || error))
        process.exitCode = 1
    })
}
