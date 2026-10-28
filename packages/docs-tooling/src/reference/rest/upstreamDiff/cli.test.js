const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {spawnSync} = require('node:child_process')
const {loadRestUpstreamLock} = require('./lock')
const {loadRestUpstreamLedger} = require('./ledger')
const {loadRuleset, DEFAULTS} = require('./cli')
const {diffDigestOf} = require('./changeSet')

const INDEX = path.join(__dirname, '..', 'index.js')

function runCli(args, cwd) {
    const result = spawnSync(process.execPath, [INDEX, ...args], {cwd, encoding: 'utf8'})
    return {status: result.status, stdout: result.stdout, stderr: result.stderr}
}

test('committed lock, ledger, and ruleset parse and pin real upstream sources', () => {
    const lock = loadRestUpstreamLock(DEFAULTS.lock)
    assert.deepEqual(lock.sources.map(source => [source.id, source.repository, source.artifact.kind, source.publicationTarget]), [
        ['zilliz-cloud-control-plane', 'zilliztech/zilliz-cloud', 'spec-file', 'zilliz'],
        ['milvus-data-plane', 'milvus-io/milvus', 'source-tree', 'milvus'],
    ])
    assert.equal(loadRestUpstreamLedger(DEFAULTS.ledger).entries.length, 0)
    const ruleset = loadRuleset(DEFAULTS.rules)
    assert.deepEqual(ruleset.internalFieldDenylist, ['accessKey', 'secretKey', 'token', 'innerCall'])
    assert.ok(ruleset.policies.some(policy => policy.id === 'doc-design-zdoc'))
})

test('rest-upstream-lock lists sources and rest-upstream-format reports canonical fragments', () => {
    const lock = runCli(['rest-upstream-lock'])
    assert.equal(lock.status, 0, lock.stderr)
    assert.match(lock.stdout, /zilliz-cloud-control-plane\tzilliztech\/zilliz-cloud@e64f3bd7/)

    const format = runCli(['rest-upstream-format'])
    assert.equal(format.status, 0, format.stderr)
    assert.match(format.stdout, /All fragments are canonical/)
})

test('rest-upstream-format --write normalizes a tight fragment; check mode exits non-zero', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rest-upstream-format-'))
    try {
        fs.writeFileSync(path.join(dir, '99-tight.json'), '{"openapi":"3.0.1","paths":{}}')
        const check = runCli(['rest-upstream-format', '--dir', dir])
        assert.equal(check.status, 1)
        assert.match(check.stdout, /Non-canonical: 99-tight.json/)
        const write = runCli(['rest-upstream-format', '--dir', dir, '--write'])
        assert.equal(write.status, 0, write.stderr)
        assert.equal(fs.readFileSync(path.join(dir, '99-tight.json'), 'utf8'), '{\n  "openapi": "3.0.1",\n  "paths": {}\n}\n')
    } finally {
        fs.rmSync(dir, {recursive: true, force: true})
    }
})

test('diff then apply round trip through the CLI against a YAML upstream spec', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rest-upstream-cli-'))
    try {
        const fragmentsDir = path.join(dir, 'fragments')
        fs.mkdirSync(fragmentsDir)
        fs.writeFileSync(path.join(fragmentsDir, '21-project-operations-v2.json'), `${JSON.stringify({
            openapi: '3.0.1',
            paths: {'/v2/projects': {post: {
                summary: 'Create Project.',
                requestBody: {content: {'application/json': {schema: {type: 'object', required: ['projectName'], properties: {
                    projectName: {type: 'string', maxLength: 32},
                }}}}},
                responses: {'200': {description: 'ok'}},
            }}},
        }, null, 2)}\n`)
        fs.writeFileSync(path.join(dir, 'titles.json'), '{\n  "创建项目": "create-project"\n}\n')
        fs.writeFileSync(path.join(dir, 'upstream.yaml'), [
            'openapi: 3.1.0',
            'info: {title: Cloud-Controller-API, version: v1}',
            'paths:',
            '  /v2/projects:',
            '    post:',
            '      summary: Create Project',
            '      requestBody:',
            '        content:',
            '          application/json:',
            '            schema:',
            '              type: object',
            '              required: [projectName]',
            '              properties:',
            '                projectName: {type: string, maxLength: 50}',
            '      responses:',
            "        '200': {description: ok}",
            '',
        ].join('\n'))
        const outDir = path.join(dir, 'diff')
        const diff = runCli(['rest-upstream-diff', '--source', 'zilliz-cloud-control-plane', '--spec', path.join(dir, 'upstream.yaml'),
            '--fragments', fragmentsDir, '--out', outDir])
        assert.equal(diff.status, 0, diff.stderr)
        assert.match(diff.stdout, /upstream-modified: 2/)
        const diffDocument = JSON.parse(fs.readFileSync(path.join(outDir, 'diff.json'), 'utf8'))
        assert.equal(diffDocument.upstreamPin, 'e64f3bd77c94971d2352ca61eb86d1a1f11bf2cb')
        assert.match(fs.readFileSync(path.join(outDir, 'diff.md'), 'utf8'), /## `post \/v2\/projects` \(21-project-operations-v2.json\)/)

        const summaryId = 'upstream-modified|post /v2/projects|21-project-operations-v2.json|operation||||summary|'
        const maxLengthId = 'upstream-modified|post /v2/projects|21-project-operations-v2.json|requestBody|||projectName|constraint|maxLength'
        assert.deepEqual(diffDocument.entries.map(entry => entry.id), [summaryId, maxLengthId])
        fs.writeFileSync(path.join(dir, 'change-set.json'), JSON.stringify({
            schemaVersion: '1.0',
            source: 'zilliz-cloud-control-plane',
            diffDigest: diffDigestOf(diffDocument),
            entries: [
                {diffEntryId: summaryId, kind: 'prose', evidence: '/paths/~1v2~1projects/post', targetFragment: '21-project-operations-v2.json',
                    opPath: '/paths/~1v2~1projects/post/summary', value: 'Create Project'},
                {diffEntryId: maxLengthId, kind: 'constraint', evidence: '/paths/~1v2~1projects/post', targetFragment: '21-project-operations-v2.json',
                    opPath: '/paths/~1v2~1projects/post/requestBody/content/application~1json/schema/properties/projectName/maxLength', value: 50},
            ],
        }))
        const applyOut = path.join(dir, 'applied')
        const apply = runCli(['rest-upstream-apply', '--diff', path.join(outDir, 'diff.json'), '--change-set', path.join(dir, 'change-set.json'),
            '--fragments', fragmentsDir, '--titles', path.join(dir, 'titles.json'), '--out', applyOut])
        assert.equal(apply.status, 0, apply.stderr)
        assert.match(apply.stdout, /applied 2 entries; changed 1 fragment\(s\); 0 diff entries left unaddressed/)
        const applied = JSON.parse(fs.readFileSync(path.join(applyOut, '21-project-operations-v2.json'), 'utf8'))
        assert.equal(applied.paths['/v2/projects'].post.summary, 'Create Project')
        assert.equal(applied.paths['/v2/projects'].post.requestBody.content['application/json'].schema.properties.projectName.maxLength, 50)
        const log = JSON.parse(fs.readFileSync(path.join(applyOut, 'applied.json'), 'utf8'))
        assert.deepEqual(log.changedFiles, ['21-project-operations-v2.json'])
        assert.deepEqual(log.unaddressedDiffEntries, [])

        const tampered = runCli(['rest-upstream-apply', '--diff', path.join(outDir, 'diff.json'), '--change-set', path.join(dir, 'change-set.json'),
            '--fragments', applyOut, '--titles', path.join(dir, 'titles.json'), '--out', path.join(dir, 'again')])
        // Re-applying against already-applied fragments is still sourced and idempotent-safe: same values written again.
        assert.equal(tampered.status, 0, tampered.stderr)
    } finally {
        fs.rmSync(dir, {recursive: true, force: true})
    }
})

test('diff refuses source-tree sources until the extractor skeleton exists, and unclassified fragments', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rest-upstream-cli-tree-'))
    try {
        fs.writeFileSync(path.join(dir, 'spec.json'), '{"openapi":"3.0.3","paths":{}}')
        const result = runCli(['rest-upstream-diff', '--source', 'milvus-data-plane', '--spec', path.join(dir, 'spec.json'), '--out', path.join(dir, 'out')])
        assert.equal(result.status, 1)
        assert.match(result.stderr, /REST_UPSTREAM_SOURCE_KIND_UNSUPPORTED/)

        const fragmentsDir = path.join(dir, 'fragments')
        fs.mkdirSync(fragmentsDir)
        fs.writeFileSync(path.join(fragmentsDir, '98-unclassified.json'), '{\n  "openapi": "3.0.1",\n  "paths": {}\n}\n')
        const unclassified = runCli(['rest-upstream-diff', '--source', 'zilliz-cloud-control-plane', '--spec', path.join(dir, 'spec.json'),
            '--fragments', fragmentsDir, '--out', path.join(dir, 'out2')])
        assert.equal(unclassified.status, 1)
        assert.match(unclassified.stderr, /REST_UPSTREAM_FRAGMENT_SURFACE_UNKNOWN.*98-unclassified.json/)
    } finally {
        fs.rmSync(dir, {recursive: true, force: true})
    }
})
