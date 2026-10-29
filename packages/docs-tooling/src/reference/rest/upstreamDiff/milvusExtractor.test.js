const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {spawnSync} = require('node:child_process')
const {parseRestUpstreamSkeleton} = require('./sourceTree')

// The Go extractor (milvus/extractor.go) runs from the Go toolchain only
// (design §6.1: Go stays out of the regular build chain). When `go` is on
// PATH the hermetic fixture set pins its behavior byte-for-byte; without it
// the suite reports an explicit skip instead of pretending coverage.
const EXTRACTOR = path.join(__dirname, 'milvus', 'extractor.go')
const TESTDATA = path.join(__dirname, 'milvus', 'testdata')

function goAvailable() {
    const probe = spawnSync('go', ['version'], {encoding: 'utf8'})
    return probe.status === 0
}

function extract(fixtureDir) {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rest-upstream-extract-'))
    const skeletonPath = path.join(outDir, 'skeleton.json')
    const result = spawnSync('go', ['run', EXTRACTOR, '--dir', fixtureDir, '--out', skeletonPath], {encoding: 'utf8'})
    return {result, skeletonPath, outDir}
}

test('extractor reproduces the golden skeleton from the hermetic fixture', t => {
    if (!goAvailable()) return t.skip('go toolchain not on PATH; extractor behavior is covered wherever Go is installed')
    const {result, skeletonPath, outDir} = extract(path.join(TESTDATA, 'httpserver'))
    try {
        assert.equal(result.status, 0, result.stderr)
        const golden = fs.readFileSync(path.join(TESTDATA, 'expected-skeleton.json'), 'utf8')
        assert.equal(fs.readFileSync(skeletonPath, 'utf8'), golden)
        const skeleton = parseRestUpstreamSkeleton(golden)
        // Fixture coverage: constant-composed paths, middleware-wrapped multiline
        // routes, deprecated action comments, binding required, nested structs,
        // pointers, maps, untyped fields, and route-reachable components only.
        assert.deepEqual(skeleton.operations.map(op => [op.path, op.handler, Boolean(op.deprecated)]), [
            ['/v2/vectordb/collections/create', 'createCollection', false],
            ['/v2/vectordb/collections/get_progress', 'getProgress', true],
            ['/v2/vectordb/collections/list', 'listCollections', false],
            ['/v2/vectordb/entities/delete', 'deleteEntities', false],
        ])
        assert.ok(!('Unreachable' in skeleton.components.schemas))
    } finally {
        fs.rmSync(outDir, {recursive: true, force: true})
    }
})

test('extractor fails closed on unknown path constants, external types, and a missing route table', t => {
    if (!goAvailable()) return t.skip('go toolchain not on PATH; extractor behavior is covered wherever Go is installed')
    for (const [fixture, code] of [
        ['bad-ident', 'REST_UPSTREAM_EXTRACT_PATH_UNKNOWN_IDENT'],
        ['external-type', 'REST_UPSTREAM_EXTRACT_EXTERNAL_TYPE'],
        ['no-table', 'REST_UPSTREAM_EXTRACT_ROUTE_TABLE_MISSING'],
    ]) {
        const {result, outDir} = extract(path.join(TESTDATA, fixture))
        fs.rmSync(outDir, {recursive: true, force: true})
        assert.notEqual(result.status, 0, `${fixture} must fail`)
        assert.match(result.stderr, new RegExp(code), `${fixture} must report ${code}`)
    }
})
