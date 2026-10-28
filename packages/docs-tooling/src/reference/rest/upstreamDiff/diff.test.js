const test = require('node:test')
const assert = require('node:assert/strict')
const {diffSpecifications} = require('./diff')
const {downgradeDocument} = require('./oasDowngrade')

const SHA = 'c'.repeat(40)
const RULESET = {internalFieldDenylist: ['accessKey', 'secretKey', 'token', 'innerCall']}
const SOURCE = {id: 'zilliz-cloud-control-plane', publicationTarget: 'zilliz'}
const EMPTY_LEDGER = {schemaVersion: '1.0', entries: []}

// Synthetic stand-in for 11-import-operations-v2.json: four scenario branches that
// deliberately repeat parameters per scenario, a milvus-only operation, and a
// success/failure response pair.
function importFragment() {
    return {
        openapi: '3.0.1',
        info: {title: 'REST', version: 'v2'},
        components: {schemas: {Common: {properties: {clusterId: {type: 'string', description: 'Target cluster.'}}}}},
        paths: {
            '/v2/vectordb/jobs/import/create': {
                post: {
                    summary: 'Import Data',
                    description: 'Create an import job.',
                    requestBody: {content: {'application/json': {schema: {oneOf: [
                        {'x-tab-label': 'Volume (Serving)', type: 'object', required: ['clusterId'], properties: {
                            clusterId: {$ref: '#/components/schemas/Common/properties/clusterId'},
                            volumeName: {type: 'string'},
                        }},
                        {'x-tab-label': 'Volume (On-demand)', type: 'object', required: ['projectId'], properties: {
                            projectId: {type: 'string'},
                            volumeName: {type: 'string'},
                        }},
                        {'x-tab-label': 'External storage (Serving)', type: 'object', properties: {
                            clusterId: {$ref: '#/components/schemas/Common/properties/clusterId'},
                            objectUrl: {type: 'string', maxLength: 128},
                            files: {type: 'array'},
                        }},
                        {'x-tab-label': 'External storage (On-demand)', type: 'object', properties: {
                            projectId: {type: 'string'},
                            objectUrl: {type: 'string', maxLength: 128},
                        }},
                    ]}}}},
                    responses: {'200': {description: 'ok', content: {'application/json': {schema: {oneOf: [
                        {'x-tab-label': 'success', type: 'object', properties: {code: {type: 'integer'}, data: {type: 'object', properties: {jobId: {type: 'string'}}}}},
                        {'x-tab-label': 'failure', type: 'object', properties: {code: {type: 'integer'}, message: {type: 'string'}}},
                    ]}}}}},
                },
            },
            '/v2/vectordb/jobs/import/abort': {
                post: {summary: 'Abort Import', 'x-include-target': ['milvus'], responses: {'200': {description: 'ok'}}},
            },
            '/v2/projects/{projectId}/regions/{regionId}': {
                delete: {summary: 'Remove Project Region', responses: {'200': {description: 'ok'}}},
            },
        },
    }
}

// Upstream merged object (what a generated control-plane spec looks like): the
// union of all branch fields plus internal fields, with no required array.
function importUpstream() {
    return downgradeDocument({
        openapi: '3.1.0',
        info: {title: 'Cloud-Controller-API', version: 'v1'},
        paths: {
            '/v2/vectordb/jobs/import/create': {
                post: {
                    summary: 'Import Data',
                    description: 'Create an import job.',
                    requestBody: {content: {'application/json': {schema: {type: 'object', properties: {
                        clusterId: {type: 'string', description: 'Target cluster.'},
                        projectId: {type: 'string'},
                        volumeName: {type: 'string'},
                        objectUrl: {type: 'string', maxLength: 256},
                        stageName: {type: 'string'},
                        accessKey: {type: 'string'},
                        innerCall: {type: 'boolean'},
                    }}}}},
                    responses: {'200': {description: 'ok', content: {'application/json': {schema: {type: 'object', properties: {
                        code: {type: 'integer'}, data: {type: 'object', properties: {jobId: {type: 'string'}}}, requestId: {type: 'string'},
                    }}}}}},
                },
            },
            '/v2/vectordb/jobs/import/get_progress': {
                post: {summary: 'Get Import Progress', responses: {'200': {description: 'ok'}}},
            },
        },
    })
}

function run(overrides = {}) {
    return diffSpecifications({
        source: SOURCE,
        upstreamPin: SHA,
        upstream: importUpstream(),
        fragments: new Map([['11-import-operations-v2.json', importFragment()]]),
        ledger: EMPTY_LEDGER,
        ruleset: RULESET,
        ...overrides,
    })
}

function ids(result, predicate = () => true) {
    return result.entries.filter(predicate).map(entry => entry.id)
}

test('scenario branches are documentation assets: deliberate omissions stay silent, uncovered fields become unattributed', () => {
    const result = run()
    const create = entry => entry.opKey === 'post /v2/vectordb/jobs/import/create'

    // projectId is absent from the two Serving branches on purpose: never proposed there.
    assert.deepEqual(ids(result, entry => create(entry) && entry.field === 'projectId'), [])
    // volumeName is absent from the External storage branches on purpose: never proposed there.
    assert.deepEqual(ids(result, entry => create(entry) && entry.field === 'volumeName'), [])
    // stageName is covered by no branch: exactly one union-level ledger candidate.
    assert.deepEqual(ids(result, entry => create(entry) && entry.field === 'stageName'),
        ['unattributed|post /v2/vectordb/jobs/import/create|requestBody||stageName|field-uncovered|'])
    // Internal fields never surface anywhere.
    assert.deepEqual(ids(result, entry => ['accessKey', 'innerCall'].includes(entry.field)), [])
    // objectUrl maxLength drifted: reported inside each branch that documents it, with upstream evidence.
    const objectUrl = result.entries.filter(entry => create(entry) && entry.field === 'objectUrl')
    assert.deepEqual(objectUrl.map(entry => [entry.branch, entry.change.key, entry.change.before, entry.change.after]), [
        ['External storage (On-demand)', 'maxLength', 128, 256],
        ['External storage (Serving)', 'maxLength', 128, 256],
    ])
    assert.equal(objectUrl[0].evidence, '/paths/~1v2~1vectordb~1jobs~1import~1create/post')
    // files exists only in the fragment: informational zdoc-only entry on its branch.
    assert.deepEqual(ids(result, entry => create(entry) && entry.field === 'files'),
        ['zdoc-only|post /v2/vectordb/jobs/import/create|requestBody|External storage (Serving)|files|field-absent-upstream|'])
    // Upstream lacks required arrays entirely: one confirmation item per operation, not per branch.
    const confirmation = result.entries.filter(entry => entry.requiresConfirmation === 'required-array')
    assert.equal(confirmation.length, 1)
    assert.equal(confirmation[0].scope, 'requestBody')
})

test('responses match the best-overlapping branch and report uncovered fields once', () => {
    const result = run()
    const response = result.entries.filter(entry => entry.scope === 'response')
    assert.deepEqual(response.map(entry => [entry.category, entry.branch, entry.field]), [
        ['upstream-added-field', undefined, 'requestId'],
    ])
})

test('operation inventory: upstream-added needs a ledger decision, milvus-only fragments are out of scope, in-scope fragment-only ops need a decision', () => {
    const result = run()
    const operations = result.entries.filter(entry => entry.scope === 'operation')
    assert.deepEqual(operations.map(entry => [entry.category, entry.opKey, entry.ledgerStatus]), [
        ['fragment-only', 'delete /v2/projects/{projectId}/regions/{regionId}', 'pending'],
        ['upstream-added', 'post /v2/vectordb/jobs/import/get_progress', 'pending'],
    ])
    assert.deepEqual(result.summary, {'fragment-only': 1, 'unattributed': 1, 'upstream-added': 1, 'upstream-added-field': 1, 'upstream-modified': 3, 'zdoc-only': 1})

    const ledger = {schemaVersion: '1.0', entries: [{
        opKey: 'post /v2/vectordb/jobs/import/get_progress', source: SOURCE.id, firstSeenPin: SHA, firstSeenAt: '2026-10-28',
        classification: 'deferred', reason: 'await PM', owner: 'doc-team', decidedAt: '2026-10-28',
    }]}
    const classified = run({ledger})
    assert.equal(classified.entries.find(entry => entry.category === 'upstream-added').ledgerStatus, 'classified')
})

test('non-branched bodies report field-level drift directly', () => {
    const fragment = {openapi: '3.0.1', paths: {'/v2/projects': {post: {
        summary: 'Create Project',
        requestBody: {content: {'application/json': {schema: {type: 'object', required: ['projectName'], properties: {
            projectName: {type: 'string', description: 'Name.'}, legacyFlag: {type: 'boolean'},
        }}}}},
        responses: {'200': {description: 'ok'}},
    }}}}
    const upstream = {openapi: '3.0.3', paths: {'/v2/projects': {post: {
        summary: 'Create Project',
        deprecated: true,
        requestBody: {content: {'application/json': {schema: {type: 'object', required: ['projectName', 'plan'], properties: {
            projectName: {type: 'string', maxLength: 50, description: 'Project name.'}, plan: {type: 'string'},
        }}}}},
        responses: {'200': {description: 'ok'}},
    }}}}
    const result = run({upstream, fragments: new Map([['21-project-operations-v2.json', fragment]])})
    assert.deepEqual(result.entries.map(entry => [entry.category, entry.scope, entry.field, entry.change.kind, entry.change.key]), [
        ['upstream-added-field', 'requestBody', 'plan', 'field-uncovered', undefined],
        ['upstream-modified', 'operation', undefined, 'deprecated', undefined],
        ['upstream-modified', 'requestBody', 'projectName', 'constraint', 'maxLength'],
        ['upstream-modified', 'requestBody', 'projectName', 'description', undefined],
        ['zdoc-only', 'requestBody', 'legacyFlag', 'field-absent-upstream', undefined],
    ])
})

test('output is deterministic and sorted', () => {
    const first = JSON.stringify(run())
    const second = JSON.stringify(run())
    assert.equal(first, second)
    const idsSorted = run().entries.map(entry => entry.id)
    assert.deepEqual(idsSorted, [...idsSorted].sort())
})

test('ruleset without a denylist fails closed', () => {
    assert.throws(() => run({ruleset: {}}), /REST_UPSTREAM_RULESET_INVALID/)
})
