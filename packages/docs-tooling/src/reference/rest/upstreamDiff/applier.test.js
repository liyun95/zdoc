const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {diffSpecifications} = require('./diff')
const {parseChangeSet, diffDigestOf} = require('./changeSet')
const {applyChangeSet, applyTitleEntries, reconcile, writeCanonicalOutputs} = require('./applier')
const {assertCanonicalBytes} = require('./formatter')

const SHA = 'c'.repeat(40)
const RULESET = {internalFieldDenylist: ['accessKey', 'secretKey', 'token', 'innerCall']}
const SOURCE = {id: 'zilliz-cloud-control-plane', publicationTarget: 'zilliz'}

function importFragment() {
    return {
        openapi: '3.0.1',
        info: {title: 'REST', version: 'v2'},
        paths: {
            '/v2/vectordb/jobs/import/create': {
                post: {
                    summary: 'Import Data.',
                    description: 'Create an import job.',
                    requestBody: {content: {'application/json': {schema: {oneOf: [
                        {'x-tab-label': 'Volume (Serving)', type: 'object', properties: {clusterId: {type: 'string'}}},
                        {'x-tab-label': 'External storage (Serving)', type: 'object', properties: {
                            objectUrl: {type: 'string', maxLength: 128},
                        }},
                        {'x-tab-label': 'External storage (On-demand)', type: 'object', properties: {
                            objectUrl: {type: 'string', maxLength: 128},
                        }},
                    ]}}}},
                    responses: {'200': {description: 'ok'}},
                },
            },
        },
    }
}

function importUpstream() {
    return {openapi: '3.0.3', paths: {
        '/v2/vectordb/jobs/import/create': {post: {
            summary: 'Import Data',
            description: 'Create an import job',
            requestBody: {content: {'application/json': {schema: {type: 'object', properties: {
                clusterId: {type: 'string'},
                objectUrl: {type: 'string', maxLength: 256},
                stageName: {type: 'string'},
            }}}}},
            responses: {'200': {description: 'ok'}},
        }},
        '/v2/vectordb/jobs/import/get_progress': {post: {summary: 'Get Import Progress', responses: {'200': {description: 'ok'}}}},
    }}
}

function baseDiff() {
    return diffSpecifications({source: SOURCE, upstreamPin: SHA, upstream: importUpstream(),
        fragments: new Map([['11-import-operations-v2.json', importFragment()]]),
        ledger: {schemaVersion: '1.0', entries: []}, ruleset: RULESET})
}

const SUMMARY_ID = 'upstream-modified|post /v2/vectordb/jobs/import/create|operation|||summary|'
const DESCRIPTION_ID = 'upstream-modified|post /v2/vectordb/jobs/import/create|operation|||description|'
const MAXLENGTH_SERVING_ID = 'upstream-modified|post /v2/vectordb/jobs/import/create|requestBody|External storage (Serving)|objectUrl|constraint|maxLength'
const MAXLENGTH_ONDEMAND_ID = 'upstream-modified|post /v2/vectordb/jobs/import/create|requestBody|External storage (On-demand)|objectUrl|constraint|maxLength'
const UNATTRIBUTED_STAGE_NAME_ID = 'unattributed|post /v2/vectordb/jobs/import/create|requestBody||stageName|field-uncovered|'
const ADDED_OP_ID = 'upstream-added|post /v2/vectordb/jobs/import/get_progress|operation|||operation-absent-in-fragments|'
const CREATE_POINTER = '/paths/~1v2~1vectordb~1jobs~1import~1create/post'

function changeSet(entries, diff = baseDiff()) {
    return {
        schemaVersion: '1.0',
        source: SOURCE.id,
        diffDigest: diffDigestOf(diff),
        entries: entries.map(({id, ...rest}) => ({evidence: 'upstream pin e64f3bd7', ...rest, diffEntryId: rest.diffEntryId || id})),
    }
}

test('happy path: sourced entries apply, skeleton stays put, reconcile reports the remainder', () => {
    const diff = baseDiff()
    const diffIds = new Set(diff.entries.map(entry => entry.id))
    for (const id of [SUMMARY_ID, DESCRIPTION_ID, MAXLENGTH_SERVING_ID, MAXLENGTH_ONDEMAND_ID, UNATTRIBUTED_STAGE_NAME_ID, ADDED_OP_ID]) {
        assert.ok(diffIds.has(id), `fixture drift: ${id} missing from diff`)
    }
    const documents = new Map([['11-import-operations-v2.json', importFragment()]])
    const changeSetDoc = parseChangeSet(JSON.stringify(changeSet([
        {id: SUMMARY_ID, kind: 'prose', targetFragment: '11-import-operations-v2.json', opPath: `${CREATE_POINTER}/summary`, value: 'Import Data'},
        {id: MAXLENGTH_SERVING_ID, kind: 'constraint', targetFragment: '11-import-operations-v2.json',
            opPath: `${CREATE_POINTER}/requestBody/content/application~1json/schema/oneOf/1/properties/objectUrl/maxLength`, value: 256},
        {id: MAXLENGTH_ONDEMAND_ID, kind: 'constraint', targetFragment: '11-import-operations-v2.json',
            opPath: `${CREATE_POINTER}/requestBody/content/application~1json/schema/oneOf/2/properties/objectUrl/maxLength`, value: 256},
        {id: UNATTRIBUTED_STAGE_NAME_ID, kind: 'ledgerDraft', ledgerDraft: {opKey: 'post /v2/vectordb/jobs/import/create',
            classification: 'deferred', reason: 'branch attribution needs PM input', owner: 'doc-team'}},
        {id: ADDED_OP_ID, kind: 'title', value: {action: 'add', zhTitle: '查询导入进度', slug: 'get-import-progress'}},
        {id: DESCRIPTION_ID, kind: 'lifecycle', targetFragment: '11-import-operations-v2.json', opPath: `${CREATE_POINTER}/x-added-at`, value: '3.1.x'},
    ])))

    const result = applyChangeSet({documents, titles: {'查看导入': 'import-data'}, changeSet: changeSetDoc, diff, ruleset: RULESET})
    const operation = result.documents.get('11-import-operations-v2.json').paths['/v2/vectordb/jobs/import/create'].post
    assert.equal(operation.summary, 'Import Data')
    assert.equal(operation['x-added-at'], '3.1.x')
    const schema = operation.requestBody.content['application/json'].schema
    assert.equal(schema.oneOf[1].properties.objectUrl.maxLength, 256)
    assert.equal(schema.oneOf[2].properties.objectUrl.maxLength, 256)
    // scenario branch structure untouched
    assert.equal(schema.oneOf.length, 3)
    assert.deepEqual(result.titles, {'查看导入': 'import-data', '查询导入进度': 'get-import-progress'})
    assert.deepEqual(result.ledgerDrafts.map(draft => draft.classification), ['deferred'])
    assert.deepEqual(result.appliedLog.map(logEntry => logEntry.kind), ['prose', 'constraint', 'constraint', 'ledgerDraft', 'title', 'lifecycle'])

    const unaddressed = reconcile(result.appliedLog, changeSetDoc, diff)
    assert.deepEqual(unaddressed, [])
    // Deferring an entry is legal: reconcile reports it instead of failing.
    const partialChangeSet = {...changeSetDoc, entries: changeSetDoc.entries.filter(entry => entry.diffEntryId !== DESCRIPTION_ID)}
    const partialLog = result.appliedLog.filter(logEntry => logEntry.diffEntryId !== DESCRIPTION_ID)
    assert.deepEqual(reconcile(partialLog, partialChangeSet, diff), [DESCRIPTION_ID])
    assert.throws(() => reconcile(result.appliedLog, partialChangeSet, diff), /REST_UPSTREAM_RECONCILE_STRAY/)
    assert.throws(() => reconcile(partialLog, changeSetDoc, diff), /REST_UPSTREAM_RECONCILE_INCOMPLETE/)
})

test('every sourcing and shape guarantee fails closed', () => {
    const diff = baseDiff()
    const documents = new Map([['11-import-operations-v2.json', importFragment()]])

    assert.throws(() => parseChangeSet(JSON.stringify(changeSet([
        {id: SUMMARY_ID, kind: 'prose', targetFragment: '11-import-operations-v2.json', opPath: `${CREATE_POINTER}/summary`, value: 'a'},
        {id: SUMMARY_ID, kind: 'prose', targetFragment: '11-import-operations-v2.json', opPath: `${CREATE_POINTER}/description`, value: 'b'},
    ]))), /REST_UPSTREAM_CHANGESET_DUPLICATE_DIFF_ENTRY/)

    assert.throws(() => parseChangeSet(JSON.stringify(changeSet([
        {id: SUMMARY_ID, kind: 'lifecycle', targetFragment: '11-import-operations-v2.json', opPath: `${CREATE_POINTER}/x-added-at`, value: 'soon'},
    ]))), /REST_UPSTREAM_CHANGESET_VALUE_INVALID/)

    const wrongDigest = changeSet([{id: SUMMARY_ID, kind: 'prose', targetFragment: '11-import-operations-v2.json', opPath: `${CREATE_POINTER}/summary`, value: 'x'}])
    wrongDigest.diffDigest = `sha256:${'0'.repeat(64)}`
    assert.throws(() => applyChangeSet({documents, changeSet: wrongDigest, diff, ruleset: RULESET}), /REST_UPSTREAM_CHANGESET_DIFF_MISMATCH/)

    const unsourced = changeSet([{diffEntryId: 'upstream-modified|post /v2/nope|operation|||summary|', kind: 'prose',
        targetFragment: '11-import-operations-v2.json', opPath: `${CREATE_POINTER}/summary`, value: 'x'}])
    assert.throws(() => applyChangeSet({documents, changeSet: unsourced, diff, ruleset: RULESET}), /REST_UPSTREAM_CHANGESET_UNSOURCED/)

    const structural = changeSet([{id: SUMMARY_ID, kind: 'constraint', targetFragment: '11-import-operations-v2.json',
        opPath: `${CREATE_POINTER}/requestBody/content/application~1json/schema/oneOf/1/properties/evil`, value: 'x'}])
    assert.throws(() => applyChangeSet({documents, changeSet: structural, diff, ruleset: RULESET}), /REST_UPSTREAM_APPLY_TARGET_INVALID/)

    const internal = changeSet([{id: SUMMARY_ID, kind: 'constraint', targetFragment: '11-import-operations-v2.json',
        opPath: `${CREATE_POINTER}/requestBody/content/application~1json/schema/properties/token`, value: 'x'}])
    assert.throws(() => applyChangeSet({documents, changeSet: internal, diff, ruleset: RULESET}), /REST_UPSTREAM_INTERNAL_FIELD/)

    const smuggledType = changeSet([{id: SUMMARY_ID, kind: 'constraint', targetFragment: '11-import-operations-v2.json',
        opPath: `${CREATE_POINTER}/requestBody/content/application~1json/schema/oneOf/0/properties/clusterId/type`, value: {object: true}}])
    assert.throws(() => applyChangeSet({documents, changeSet: smuggledType, diff, ruleset: RULESET}), /REST_UPSTREAM_APPLY_VALUE_INVALID/)

    const unknownFragment = changeSet([{id: SUMMARY_ID, kind: 'prose', targetFragment: '99-unknown.json', opPath: `${CREATE_POINTER}/summary`, value: 'x'}])
    assert.throws(() => applyChangeSet({documents, changeSet: unknownFragment, diff, ruleset: RULESET}), /REST_UPSTREAM_APPLY_FRAGMENT_UNKNOWN/)
})

test('title conflicts fail closed in both directions', () => {
    assert.throws(() => applyTitleEntries({'查看导入': 'other-slug'}, [
        {diffEntryId: 'x', value: {action: 'add', zhTitle: '查看导入', slug: 'import-data'}},
    ]), /REST_UPSTREAM_TITLES_CONFLICT/)
    assert.throws(() => applyTitleEntries({}, [
        {diffEntryId: 'x', value: {action: 'remove', zhTitle: '不存在', slug: 'nope'}},
    ]), /REST_UPSTREAM_TITLES_CONFLICT/)
})

test('writeCanonicalOutputs leaves untouched fragments byte-identical and changed ones canonical', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rest-upstream-apply-'))
    const outDir = path.join(dir, 'out')
    try {
        fs.writeFileSync(path.join(dir, '11-import-operations-v2.json'), JSON.stringify(importFragment(), null, 2) + '\n')
        fs.writeFileSync(path.join(dir, '12-alias-operations-v2.json'), JSON.stringify({openapi: '3.0.1', paths: {}}, null, 2) + '\n')
        const documents = new Map([['11-import-operations-v2.json', importFragment()]])
        const changeSetDoc = parseChangeSet(JSON.stringify(changeSet([
            {id: SUMMARY_ID, kind: 'prose', targetFragment: '11-import-operations-v2.json', opPath: `${CREATE_POINTER}/summary`, value: 'Import Data'},
        ])))
        const diff = baseDiff()
        const result = applyChangeSet({documents, changeSet: changeSetDoc, diff, ruleset: RULESET})
        const written = writeCanonicalOutputs({outDir, fragmentsDir: dir, documents: result.documents, changedFiles: result.changedFiles, titles: result.titles})
        assert.deepEqual(written, ['11-import-operations-v2.json', '12-alias-operations-v2.json'])
        assert.equal(fs.readFileSync(path.join(outDir, '12-alias-operations-v2.json'), 'utf8'), fs.readFileSync(path.join(dir, '12-alias-operations-v2.json'), 'utf8'))
        const reparsed = assertCanonicalBytes(fs.readFileSync(path.join(outDir, '11-import-operations-v2.json'), 'utf8'), 'applied')
        assert.equal(reparsed.paths['/v2/vectordb/jobs/import/create'].post.summary, 'Import Data')
    } finally {
        fs.rmSync(dir, {recursive: true, force: true})
    }
})
