const fs = require('node:fs')
const path = require('node:path')
const Ajv2020 = require('ajv/dist/2020')

// Source-tree skeleton loader and converter (design §6). The Go extractor
// (milvus/extractor.go) produces the skeleton; this module is the Node-side
// gate that validates it against the contract, re-checks the invariants the
// schema cannot express, and converts it into the minimal OpenAPI document
// shape the branch-aware diff consumes for source-tree lock sources.

const skeletonSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'rest-upstream-source-tree-skeleton.schema.json'), 'utf8'))

function fail(code, message) {
    throw new Error(`${code}: ${message}`)
}

function compileSchema(schema) {
    return new Ajv2020({allErrors: true, strict: false}).compile(schema)
}

const validateSkeleton = compileSchema(skeletonSchema)

// Invariants beyond the JSON schema: deterministic ordering, reference
// integrity, and mount-prefix consistency. All extractor guarantees, re-checked
// here so a hand-edited skeleton cannot smuggle drift past the diff.
function assertSkeletonInvariants(skeleton) {
    const schemas = skeleton.components.schemas
    // The extractor sorts by the (path, method) tuple; compare the same way.
    // String order on "method path" would invert the tuple order across methods
    // ("get /z" sorts before "post /a"; the tuple puts /a first) and reject a
    // correctly sorted mixed-method skeleton.
    for (let index = 1; index < skeleton.operations.length; index++) {
        const previous = skeleton.operations[index - 1]
        const current = skeleton.operations[index]
        const ordered = previous.path < current.path || (previous.path === current.path && previous.method <= current.method)
        if (!ordered) fail('REST_UPSTREAM_SKELETON_ORDER', `${current.method} ${current.path} follows ${previous.method} ${previous.path}: operations must be sorted by (path, method)`)
    }
    for (const op of skeleton.operations) {
        if (!op.path.startsWith(skeleton.extractedFrom.mountPrefix)) {
            fail('REST_UPSTREAM_SKELETON_MOUNT_PREFIX', `${op.path} does not start with ${skeleton.extractedFrom.mountPrefix}`)
        }
        const ref = op.requestSchema?.$ref
        if (ref) {
            const name = ref.replace('#/components/schemas/', '')
            if (!schemas[name]) fail('REST_UPSTREAM_SKELETON_REF_DANGLING', `${op.path}: ${ref}`)
        }
    }
    for (const [name, schema] of Object.entries(schemas)) {
        for (const member of schema.required ?? []) {
            if (!(member in (schema.properties ?? {}))) {
                fail('REST_UPSTREAM_SKELETON_REQUIRED_DANGLING', `${name}: required member ${member} has no property`)
            }
        }
        for (const [field, property] of Object.entries(schema.properties ?? {})) {
            const ref = property.$ref
            if (ref && !schemas[ref.replace('#/components/schemas/', '')]) {
                fail('REST_UPSTREAM_SKELETON_REF_DANGLING', `${name}.${field}: ${ref}`)
            }
            if (property.items?.$ref && !schemas[property.items.$ref.replace('#/components/schemas/', '')]) {
                fail('REST_UPSTREAM_SKELETON_REF_DANGLING', `${name}.${field}: ${property.items.$ref}`)
            }
        }
    }
}

function parseRestUpstreamSkeleton(text, label = 'skeleton.json') {
    let skeleton
    try {
        skeleton = JSON.parse(text)
    } catch (error) {
        fail('REST_UPSTREAM_SKELETON_MALFORMED_JSON', `${label}: ${error.message}`)
    }
    if (!validateSkeleton(skeleton)) {
        const details = validateSkeleton.errors.map(error => `${error.instancePath || '/'} ${error.message}`).join('; ')
        fail('REST_UPSTREAM_SKELETON_SCHEMA_INVALID', details)
    }
    assertSkeletonInvariants(skeleton)
    return skeleton
}

function loadRestUpstreamSkeleton(filePath) {
    return parseRestUpstreamSkeleton(fs.readFileSync(filePath, 'utf8'), path.basename(filePath))
}

// Convert the skeleton into the OpenAPI document shape the diff expects.
// Every operation carries its handler and request struct as x-milvus-*
// evidence; no responses are emitted because a source-tree skeleton has no
// extractable response contract — the diff's structure-only mode (source-tree
// sources) skips response comparison instead of reporting the gap.
function skeletonToUpstreamDocument(skeleton) {
    const paths = {}
    for (const op of skeleton.operations) {
        const item = paths[op.path] || (paths[op.path] = {})
        if (item[op.method]) fail('REST_UPSTREAM_SKELETON_DUPLICATE_ROUTE', `${op.method} ${op.path}`)
        item[op.method] = {
            'x-milvus-handler': op.handler,
            'x-milvus-request-struct': op.requestStruct,
            ...(op.deprecated ? {deprecated: true} : {}),
            ...(op.requestSchema ? {requestBody: {content: {'application/json': {schema: op.requestSchema}}}} : {}),
        }
    }
    return {
        openapi: '3.0.3',
        info: {title: 'REST upstream source-tree skeleton', version: skeleton.extractedFrom.mountPrefix},
        paths,
        components: skeleton.components,
    }
}

// The skeleton must come from the same repository the lock pins; a skeleton
// from any other tree must not drive fragment refresh decisions.
function assertSkeletonMatchesSource(skeleton, source) {
    if (skeleton.extractedFrom.repository !== source.repository) {
        fail('REST_UPSTREAM_SKELETON_SOURCE_MISMATCH', `${skeleton.extractedFrom.repository} != lock ${source.repository}`)
    }
}

module.exports = {parseRestUpstreamSkeleton, loadRestUpstreamSkeleton, skeletonToUpstreamDocument, assertSkeletonMatchesSource}
