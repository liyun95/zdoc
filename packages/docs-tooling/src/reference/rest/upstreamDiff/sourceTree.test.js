const test = require('node:test')
const assert = require('node:assert/strict')
const {parseRestUpstreamSkeleton, skeletonToUpstreamDocument, assertSkeletonMatchesSource} = require('./sourceTree')

// A minimal skeleton in the exact shape the Go extractor emits.
function validSkeleton() {
    return {
        schemaVersion: '1.0',
        extractedFrom: {repository: 'milvus-io/milvus', sourceDir: 'internal/distributed/proxy/httpserver', mountPrefix: '/v2/vectordb'},
        operations: [
            {
                path: '/v2/vectordb/collections/list',
                method: 'post',
                handler: 'listCollections',
                requestStruct: 'DatabaseReq',
                requestSchema: {$ref: '#/components/schemas/DatabaseReq'},
            },
            {
                path: '/v2/vectordb/jobs/import/get_progress',
                method: 'post',
                handler: 'getProgress',
                requestStruct: 'JobIDReq',
                deprecated: true,
                requestSchema: {$ref: '#/components/schemas/JobIDReq'},
            },
        ],
        components: {schemas: {
            DatabaseReq: {type: 'object', properties: {dbName: {type: 'string'}}},
            JobIDReq: {type: 'object', properties: {jobId: {type: 'string'}}, required: ['jobId']},
        }},
    }
}

const LOCK_SOURCE = {id: 'milvus-data-plane', repository: 'milvus-io/milvus'}

test('skeleton parses, validates, and keeps extractor invariants', () => {
    const skeleton = parseRestUpstreamSkeleton(JSON.stringify(validSkeleton()))
    assert.equal(skeleton.operations.length, 2)
    assert.equal(skeleton.components.schemas.JobIDReq.required[0], 'jobId')
})

test('skeleton rejects schema violations and broken invariants', () => {
    // schema: unknown method
    assert.throws(() => parseRestUpstreamSkeleton(JSON.stringify({
        ...validSkeleton(),
        operations: [{...validSkeleton().operations[0], method: 'fetch'}],
    })), /REST_UPSTREAM_SKELETON_SCHEMA_INVALID/)

    // operations must be sorted
    const unsorted = validSkeleton()
    unsorted.operations = [unsorted.operations[1], unsorted.operations[0]]
    assert.throws(() => parseRestUpstreamSkeleton(JSON.stringify(unsorted)), /REST_UPSTREAM_SKELETON_ORDER/)

    // dangling $ref
    const dangling = validSkeleton()
    dangling.operations[0].requestSchema = {$ref: '#/components/schemas/Missing'}
    assert.throws(() => parseRestUpstreamSkeleton(JSON.stringify(dangling)), /REST_UPSTREAM_SKELETON_REF_DANGLING/)

    // required member without a property
    const brokenRequired = validSkeleton()
    brokenRequired.components.schemas.DatabaseReq.required = ['ghost']
    assert.throws(() => parseRestUpstreamSkeleton(JSON.stringify(brokenRequired)), /REST_UPSTREAM_SKELETON_REQUIRED_DANGLING/)

    // operation path outside the mount prefix
    const offMount = validSkeleton()
    offMount.operations[0].path = '/v1/vector/collections'
    assert.throws(() => parseRestUpstreamSkeleton(JSON.stringify(offMount)), /REST_UPSTREAM_SKELETON_MOUNT_PREFIX/)
})

test('skeleton converts into the OpenAPI shape the diff consumes', () => {
    const document = skeletonToUpstreamDocument(parseRestUpstreamSkeleton(JSON.stringify(validSkeleton())))
    assert.equal(document.openapi, '3.0.3')
    const list = document.paths['/v2/vectordb/collections/list'].post
    assert.equal(list['x-milvus-handler'], 'listCollections')
    assert.equal(list['x-milvus-request-struct'], 'DatabaseReq')
    assert.deepEqual(list.requestBody.content['application/json'].schema, {$ref: '#/components/schemas/DatabaseReq'})
    assert.equal(list.requestBody.responses, undefined)
    const progress = document.paths['/v2/vectordb/jobs/import/get_progress'].post
    assert.equal(progress.deprecated, true)
    assert.equal(document.paths['/v2/vectordb/collections/list'].post.deprecated, undefined)
    assert.deepEqual(document.components, validSkeleton().components)
})

test('skeleton from another repository is refused for a locked source', () => {
    const skeleton = parseRestUpstreamSkeleton(JSON.stringify(validSkeleton()))
    assert.throws(() => assertSkeletonMatchesSource(skeleton, {id: 'milvus-data-plane', repository: 'other/repo'}),
        /REST_UPSTREAM_SKELETON_SOURCE_MISMATCH/)
    assertSkeletonMatchesSource(skeleton, LOCK_SOURCE)
})
