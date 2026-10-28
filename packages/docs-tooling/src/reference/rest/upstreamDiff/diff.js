const {isDeepStrictEqual} = require('node:util')

// Branch-aware diff between a pinned upstream spec and the zdoc fragments.
// Truth assignment (design §4): upstream/code wins on API truth; the fragments
// win on documentation design. Most importantly (user decision 2026-10-28):
// oneOf/anyOf scenario branches are documentation assets — an upstream merged
// object is treated as the UNION of all branch fields, deliberate per-branch
// omissions are silent, and fields that NO branch covers become `unattributed`
// ledger candidates. The diff never proposes adding fields to branches.

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'])
const BRANCH_COMBINATORS = ['oneOf', 'anyOf']
const CONSTRAINT_KEYS = ['type', 'format', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems', 'enum', 'default', 'nullable', 'deprecated']

function fail(code, message) {
    throw new Error(`${code}: ${message}`)
}

function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeText(text) {
    return String(text).replace(/\s+/g, ' ').trim()
}

function encodePointerToken(token) {
    return String(token).replace(/~/g, '~0').replace(/\//g, '~1')
}

function resolvePointer(document, pointer) {
    if (!pointer.startsWith('#/')) fail('REST_UPSTREAM_REF_UNSUPPORTED', pointer)
    let value = document
    for (const rawToken of pointer.slice(2).split('/')) {
        if (value === null || typeof value !== 'object') fail('REST_UPSTREAM_REF_DANGLING', pointer)
        const token = rawToken.replace(/~1/g, '/').replace(/~0/g, '~')
        value = Array.isArray(value) ? value[Number(token)] : value[token]
    }
    return value
}

// Resolve a local $ref and overlay sibling keywords (fragments attach x-* and
// field overrides to $ref objects). Cycles fail closed.
function resolveSchema(document, schema, depth = 0) {
    if (!isPlainObject(schema)) return schema
    if (depth > 8) fail('REST_UPSTREAM_REF_CYCLE', 'depth limit exceeded')
    const {$ref, ...siblings} = schema
    if (typeof $ref === 'string') {
        const target = resolvePointer(document, $ref)
        return resolveSchema(document, {...(isPlainObject(target) ? target : {}), ...siblings}, depth + 1)
    }
    if (Array.isArray(schema.allOf)) {
        const merged = {...schema}
        delete merged.allOf
        for (const member of schema.allOf) {
            const resolvedMember = resolveSchema(document, member, depth + 1)
            if (!isPlainObject(resolvedMember)) continue
            for (const [key, value] of Object.entries(resolvedMember)) {
                if (key === 'properties' && isPlainObject(merged.properties) && isPlainObject(value)) {
                    merged.properties = {...value, ...merged.properties}
                } else if (key === 'required' && Array.isArray(merged.required) && Array.isArray(value)) {
                    merged.required = [...new Set([...value, ...merged.required])]
                } else if (!(key in merged)) {
                    merged[key] = value
                }
            }
        }
        return merged
    }
    return schema
}

function branchesOf(document, schema) {
    const effective = resolveSchema(document, schema)
    for (const combinator of BRANCH_COMBINATORS) {
        const value = effective[combinator]
        if (Array.isArray(value) && value.filter(isPlainObject).length >= 2) {
            const objects = value.filter(isPlainObject)
            return {
                combinator,
                branches: objects.map(branch => resolveSchema(document, branch)),
                labels: objects.map((branch, index) => (typeof branch['x-tab-label'] === 'string' ? branch['x-tab-label'] : `branch-${index + 1}`)),
            }
        }
    }
    return null
}

function propertiesOf(document, schema) {
    const effective = resolveSchema(document, schema)
    const properties = isPlainObject(effective.properties) ? effective.properties : {}
    return Object.fromEntries(Object.entries(properties).map(([name, property]) => [name, resolveSchema(document, property)]))
}

function requiredOf(document, schema) {
    const effective = resolveSchema(document, schema)
    return Array.isArray(effective.required) ? effective.required : null
}

function constraintPairs(document, schema) {
    const effective = resolveSchema(document, schema)
    return CONSTRAINT_KEYS.filter(key => key in effective).map(key => [key, effective[key]])
}

function indexOperationsFromDocument(document) {
    const operations = new Map()
    for (const [endpoint, pathItem] of Object.entries(document.paths || {})) {
        if (!isPlainObject(pathItem)) continue
        for (const [method, operation] of Object.entries(pathItem)) {
            if (!HTTP_METHODS.has(method) || !isPlainObject(operation)) continue
            operations.set(`${method} ${endpoint}`, {document, operation, endpoint, method})
        }
    }
    return operations
}

function indexFragmentOperations(fragments) {
    const operations = new Map()
    for (const [file, document] of fragments) {
        for (const [opKey, record] of indexOperationsFromDocument(document)) {
            if (!operations.has(opKey)) operations.set(opKey, [])
            operations.get(opKey).push({...record, file})
        }
    }
    return operations
}

function entryId(entry) {
    return [
        entry.category, entry.opKey, entry.scope || '', entry.branch || '', entry.field || '',
        entry.change ? entry.change.kind : '', entry.change && entry.change.key || '',
    ].join('|')
}

function makeEntry(parts) {
    const entry = {...parts}
    entry.id = entryId(entry)
    return entry
}

function includesTarget(operation, publicationTarget) {
    const targets = operation['x-include-target']
    if (!Array.isArray(targets)) return true
    return targets.includes(publicationTarget)
}

function denylisted(ruleset, name) {
    return (ruleset.internalFieldDenylist || []).includes(name)
}

/*
 * Field-level comparison of one schema pair. `context.suppressUpstreamOnlyFields`
 * is set for branch-mode pairs: fields present in the upstream union but missing
 * from THIS branch are deliberate documentation design and stay silent there;
 * union-level coverage gaps are reported once by the caller.
 */
function diffSchemaPair(context) {
    const {upstreamDocument, upstreamSchema, fragmentDocument, fragmentSchema, ruleset} = context
    const entries = []
    const upstreamProperties = propertiesOf(upstreamDocument, upstreamSchema)
    const fragmentProperties = propertiesOf(fragmentDocument, fragmentSchema)
    const upstreamRequired = requiredOf(upstreamDocument, upstreamSchema)
    const fragmentRequired = requiredOf(fragmentDocument, fragmentSchema)

    for (const [name, fragmentProperty] of Object.entries(fragmentProperties)) {
        if (denylisted(ruleset, name)) continue
        const upstreamProperty = upstreamProperties[name]
        if (!upstreamProperty) {
            entries.push(makeEntry({...context.meta, category: 'zdoc-only', scope: context.scope, branch: context.branch, field: name,
                change: {kind: 'field-absent-upstream', before: null, after: null}, evidence: context.upstreamEvidencePath}))
            continue
        }
        for (const [key, after] of constraintPairs(upstreamDocument, upstreamProperty)) {
            if (isDeepStrictEqual(fragmentProperty[key], after)) continue
            entries.push(makeEntry({...context.meta, category: 'upstream-modified', scope: context.scope, branch: context.branch, field: name,
                change: {kind: 'constraint', key, before: fragmentProperty[key] === undefined ? null : fragmentProperty[key], after},
                evidence: context.upstreamEvidencePath}))
        }
        for (const key of CONSTRAINT_KEYS) {
            if (key in fragmentProperty && !(key in upstreamProperty)) {
                entries.push(makeEntry({...context.meta, category: 'zdoc-only', scope: context.scope, branch: context.branch, field: name,
                    change: {kind: 'constraint', key, before: fragmentProperty[key], after: null}, evidence: context.upstreamEvidencePath}))
            }
        }
        if (normalizeText(upstreamProperty.description ?? '') !== normalizeText(fragmentProperty.description ?? '')) {
            entries.push(makeEntry({...context.meta, category: 'upstream-modified', scope: context.scope, branch: context.branch, field: name,
                change: {kind: 'description', before: fragmentProperty.description ?? null, after: upstreamProperty.description ?? null},
                evidence: context.upstreamEvidencePath}))
        }
        const inFragmentRequired = Array.isArray(fragmentRequired) && fragmentRequired.includes(name)
        const inUpstreamRequired = Array.isArray(upstreamRequired) && upstreamRequired.includes(name)
        if (inFragmentRequired !== inUpstreamRequired && upstreamRequired !== null) {
            entries.push(makeEntry({...context.meta, category: 'upstream-modified', scope: context.scope, branch: context.branch, field: name,
                change: {kind: 'required', before: inFragmentRequired, after: inUpstreamRequired}, evidence: context.upstreamEvidencePath}))
        }
    }

    if (!context.suppressUpstreamOnlyFields) {
        for (const name of Object.keys(upstreamProperties)) {
            if (denylisted(ruleset, name) || name in fragmentProperties) continue
            entries.push(makeEntry({...context.meta, category: 'upstream-added-field', scope: context.scope, branch: context.branch, field: name,
                change: {kind: 'field-uncovered', before: null, after: null}, evidence: context.upstreamEvidencePath}))
        }
        if (fragmentRequired !== null && upstreamRequired === null && fragmentRequired.length > 0) {
            entries.push(makeEntry({...context.meta, category: 'upstream-modified', scope: context.scope, branch: context.branch,
                change: {kind: 'required-array-missing-upstream', before: fragmentRequired, after: null}, evidence: context.upstreamEvidencePath,
                requiresConfirmation: 'required-array'}))
        }
    }
    return entries
}

function overlapScore(fragmentProperties, upstreamProperties) {
    const fragmentNames = new Set(Object.keys(fragmentProperties))
    const upstreamNames = new Set(Object.keys(upstreamProperties))
    if (fragmentNames.size === 0 && upstreamNames.size === 0) return 0
    let shared = 0
    for (const name of fragmentNames) if (upstreamNames.has(name)) shared++
    return shared / (fragmentNames.size + upstreamNames.size - shared)
}

/*
 * Shared comparison for request/response bodies. When the fragment side is
 * scenario-branched, the upstream union is compared per branch (deliberate
 * branch omissions stay silent) and union-level gaps become either
 * `unattributed` (request body: ledger candidates) or `upstream-added-field`
 * (responses: structural lane), once per field.
 */
function diffBodied(context, fragmentContent, upstreamContent, scope) {
    const {upstreamDocument, fragmentDocument, ruleset} = context
    if (!isPlainObject(fragmentContent.schema)) return []
    if (!upstreamContent || !isPlainObject(upstreamContent.schema)) {
        return [makeEntry({...context.meta, category: 'upstream-modified', scope,
            change: {kind: 'body-schema-absent-upstream', before: 'present', after: null}, evidence: context.upstreamEvidencePath})]
    }

    const fragmentBranches = branchesOf(fragmentDocument, fragmentContent.schema)
    if (!fragmentBranches) {
        return diffSchemaPair({...context, fragmentSchema: fragmentContent.schema, upstreamSchema: upstreamContent.schema, scope})
    }

    const upstreamBranches = branchesOf(upstreamDocument, upstreamContent.schema)
    const upstreamUnionProperties = {}
    for (const branch of upstreamBranches ? upstreamBranches.branches : [upstreamContent.schema]) {
        Object.assign(upstreamUnionProperties, propertiesOf(upstreamDocument, branch))
    }
    const upstreamUnionRequired = upstreamBranches ? null : requiredOf(upstreamDocument, upstreamContent.schema)
    const upstreamUnionSchema = {type: 'object', properties: upstreamUnionProperties, required: upstreamUnionRequired}

    const entries = []
    const coveredNames = new Set()
    for (let index = 0; index < fragmentBranches.branches.length; index++) {
        const branchProperties = propertiesOf(fragmentDocument, fragmentBranches.branches[index])
        for (const name of Object.keys(branchProperties)) coveredNames.add(name)
        entries.push(...diffSchemaPair({
            ...context,
            fragmentSchema: fragmentBranches.branches[index],
            upstreamSchema: upstreamUnionSchema,
            branch: fragmentBranches.labels[index],
            scope,
            suppressUpstreamOnlyFields: true,
        }))
    }

    const uncoveredCategory = scope === 'requestBody' ? 'unattributed' : 'upstream-added-field'
    for (const name of Object.keys(upstreamUnionProperties)) {
        if (denylisted(ruleset, name) || coveredNames.has(name)) continue
        entries.push(makeEntry({...context.meta, category: uncoveredCategory, scope, field: name,
            change: {kind: 'field-uncovered', before: null, after: null}, evidence: context.upstreamEvidencePath}))
    }
    if (scope === 'requestBody' && upstreamUnionRequired === null
        && fragmentBranches.branches.some(branch => (requiredOf(fragmentDocument, branch) || []).length > 0)) {
        entries.push(makeEntry({...context.meta, category: 'upstream-modified', scope,
            change: {kind: 'required-array-missing-upstream', before: 'per-branch required arrays', after: null},
            evidence: context.upstreamEvidencePath, requiresConfirmation: 'required-array'}))
    }
    return entries
}

function diffRequestBody(context) {
    const {upstreamDocument, upstreamOperation, fragmentDocument, fragmentOperation} = context
    const fragmentBody = fragmentOperation.requestBody
    if (!fragmentBody) return []
    if (!upstreamOperation.requestBody) {
        return [makeEntry({...context.meta, category: 'zdoc-only', scope: 'requestBody',
            change: {kind: 'request-body-absent-upstream', before: null, after: null}, evidence: context.upstreamEvidencePath})]
    }
    const fragmentContent = isPlainObject(fragmentBody.content) ? fragmentBody.content['application/json'] : null
    const upstreamContent = isPlainObject(upstreamOperation.requestBody.content) ? upstreamOperation.requestBody.content['application/json'] : null
    if (!fragmentContent) return []
    if (!upstreamContent) {
        return [makeEntry({...context.meta, category: 'upstream-modified', scope: 'requestBody',
            change: {kind: 'body-media-absent-upstream', before: 'application/json', after: null}, evidence: context.upstreamEvidencePath})]
    }
    return diffBodied(context, fragmentContent, upstreamContent, 'requestBody')
}

function diffResponses(context) {
    const {upstreamDocument, upstreamOperation, fragmentDocument, fragmentOperation} = context
    const entries = []
    const fragmentResponses = isPlainObject(fragmentOperation.responses) ? fragmentOperation.responses : {}
    const upstreamResponses = isPlainObject(upstreamOperation.responses) ? upstreamOperation.responses : {}
    for (const [status, fragmentResponse] of Object.entries(fragmentResponses)) {
        if (!isPlainObject(fragmentResponse)) continue
        const upstreamResponse = upstreamResponses[status]
        if (!isPlainObject(upstreamResponse)) {
            entries.push(makeEntry({...context.meta, category: 'zdoc-only', scope: 'response', field: status,
                change: {kind: 'response-absent-upstream', before: null, after: null}, evidence: context.upstreamEvidencePath}))
            continue
        }
        const fragmentContent = isPlainObject(fragmentResponse.content) ? fragmentResponse.content['application/json'] : null
        const upstreamContent = isPlainObject(upstreamResponse.content) ? upstreamResponse.content['application/json'] : null
        if (!fragmentContent) continue
        if (!upstreamContent) {
            entries.push(makeEntry({...context.meta, category: 'upstream-modified', scope: 'response', field: status,
                change: {kind: 'body-media-absent-upstream', before: 'application/json', after: null}, evidence: context.upstreamEvidencePath}))
            continue
        }
        const fragmentBranches = branchesOf(fragmentDocument, fragmentContent.schema)
        if (fragmentBranches) {
            // Match the upstream shape to the branch it most overlaps; the remaining
            // tabs (e.g. failure shapes) are preserved untouched.
            const upstreamProperties = propertiesOf(upstreamDocument, upstreamContent.schema)
            let best = -1
            let bestScore = -1
            fragmentBranches.branches.forEach((branch, index) => {
                const score = overlapScore(propertiesOf(fragmentDocument, branch), upstreamProperties)
                if (score > bestScore) {
                    bestScore = score
                    best = index
                }
            })
            if (best >= 0) {
                entries.push(...diffSchemaPair({...context, fragmentSchema: fragmentBranches.branches[best],
                    upstreamSchema: upstreamContent.schema, branch: fragmentBranches.labels[best],
                    scope: 'response', suppressUpstreamOnlyFields: true}))
            }
            const coveredNames = new Set()
            for (const branch of fragmentBranches.branches) {
                for (const name of Object.keys(propertiesOf(fragmentDocument, branch))) coveredNames.add(name)
            }
            for (const name of Object.keys(upstreamProperties)) {
                if (denylisted(context.ruleset, name) || coveredNames.has(name)) continue
                entries.push(makeEntry({...context.meta, category: 'upstream-added-field', scope: 'response', field: name,
                    change: {kind: 'field-uncovered', before: null, after: null}, evidence: context.upstreamEvidencePath}))
            }
            continue
        }
        entries.push(...diffBodied(context, fragmentContent, upstreamContent, 'response'))
    }
    return entries
}

function diffParameters(context) {
    const {upstreamOperation, fragmentOperation, meta, upstreamEvidencePath, ruleset} = context
    const entries = []
    const fragmentParams = (fragmentOperation.parameters || []).filter(isPlainObject)
    const upstreamParams = (upstreamOperation.parameters || []).filter(isPlainObject)
    const fragmentIndex = new Map()
    for (const parameter of fragmentParams) {
        const key = `${parameter.name}:${parameter.in}`
        if (!fragmentIndex.has(key)) fragmentIndex.set(key, [])
        fragmentIndex.get(key).push(parameter)
    }
    for (const upstreamParameter of upstreamParams) {
        if (denylisted(ruleset, upstreamParameter.name)) continue
        const key = `${upstreamParameter.name}:${upstreamParameter.in}`
        const matches = fragmentIndex.get(key) || []
        if (matches.length === 0) {
            entries.push(makeEntry({...meta, category: 'upstream-added-param', scope: 'parameter', field: key,
                change: {kind: 'param-uncovered', before: null, after: null}, evidence: upstreamEvidencePath}))
            continue
        }
        for (const [index, fragmentParameter] of matches.entries()) {
            const copyIndex = matches.length > 1 ? index : undefined
            if (Boolean(fragmentParameter.required) !== Boolean(upstreamParameter.required)) {
                entries.push(makeEntry({...meta, category: 'upstream-modified', scope: 'parameter', field: key,
                    change: {kind: 'required', before: Boolean(fragmentParameter.required), after: Boolean(upstreamParameter.required)},
                    evidence: upstreamEvidencePath, copyIndex}))
            }
            if (normalizeText(upstreamParameter.description ?? '') !== normalizeText(fragmentParameter.description ?? '')) {
                entries.push(makeEntry({...meta, category: 'upstream-modified', scope: 'parameter', field: key,
                    change: {kind: 'description', before: fragmentParameter.description ?? null, after: upstreamParameter.description ?? null},
                    evidence: upstreamEvidencePath, copyIndex}))
            }
        }
    }
    for (const fragmentParameter of fragmentParams) {
        if (denylisted(ruleset, fragmentParameter.name)) continue
        const key = `${fragmentParameter.name}:${fragmentParameter.in}`
        if (upstreamParams.some(parameter => `${parameter.name}:${parameter.in}` === key)) continue
        entries.push(makeEntry({...meta, category: 'zdoc-only', scope: 'parameter', field: key,
            change: {kind: 'param-absent-upstream', before: null, after: null}, evidence: upstreamEvidencePath}))
    }
    return entries
}

function diffOperationPair(context) {
    const {upstreamOperation, fragmentOperation} = context
    const entries = []
    if (normalizeText(upstreamOperation.summary ?? '') !== normalizeText(fragmentOperation.summary ?? '')) {
        entries.push(makeEntry({...context.meta, category: 'upstream-modified', scope: 'operation',
            change: {kind: 'summary', before: fragmentOperation.summary ?? null, after: upstreamOperation.summary ?? null},
            evidence: context.upstreamEvidencePath}))
    }
    if (normalizeText(upstreamOperation.description ?? '') !== normalizeText(fragmentOperation.description ?? '')) {
        entries.push(makeEntry({...context.meta, category: 'upstream-modified', scope: 'operation',
            change: {kind: 'description', before: fragmentOperation.description ?? null, after: upstreamOperation.description ?? null},
            evidence: context.upstreamEvidencePath}))
    }
    if (Boolean(fragmentOperation.deprecated) !== Boolean(upstreamOperation.deprecated)) {
        entries.push(makeEntry({...context.meta, category: 'upstream-modified', scope: 'operation',
            change: {kind: 'deprecated', before: Boolean(fragmentOperation.deprecated), after: Boolean(upstreamOperation.deprecated)},
            evidence: context.upstreamEvidencePath}))
    }
    entries.push(...diffParameters(context))
    entries.push(...diffRequestBody(context))
    entries.push(...diffResponses(context))
    return entries
}

/*
 * diffSpecifications({source, upstreamPin, upstream, fragments, ledger, ruleset, fragmentSurfaces}) ->
 * {schemaVersion, source, upstreamPin, publicationTarget, summary, entries}
 * Deterministic: same inputs -> byte-identical output (no timestamps).
 *
 * Operations that exist upstream are compared wherever a fragment documents
 * them, regardless of the fragment's api surface (the control-plane spec covers
 * import jobs that live in a data-plane fragment). `fragment-only` is only
 * reported for fragments on the source's own api surface: a data-plane
 * fragment missing from the control-plane spec is expected, not drift. When
 * `fragmentSurfaces` is supplied every fragment must be classified.
 */
function diffSpecifications({source, upstreamPin, upstream, fragments, ledger, ruleset, fragmentSurfaces = null}) {
    if (!isPlainObject(ruleset) || !Array.isArray(ruleset.internalFieldDenylist)) {
        fail('REST_UPSTREAM_RULESET_INVALID', 'ruleset.internalFieldDenylist is required')
    }
    if (fragmentSurfaces) {
        for (const file of fragments.keys()) {
            if (!fragmentSurfaces.has(file)) fail('REST_UPSTREAM_FRAGMENT_SURFACE_UNKNOWN', `${file} is not classified in fragment-migration.json`)
        }
    }
    const onSourceSurface = file => !fragmentSurfaces || fragmentSurfaces.get(file) === source.apiSurface
    const upstreamOps = indexOperationsFromDocument(upstream)
    const fragmentOps = indexFragmentOperations(fragments)
    const entries = []

    for (const opKey of [...upstreamOps.keys()].sort()) {
        const upstreamRecord = upstreamOps.get(opKey)
        const meta = {opKey, fragment: undefined}
        const upstreamEvidencePath = `/paths/${encodePointerToken(upstreamRecord.endpoint)}/${upstreamRecord.method}`
        if (!fragmentOps.has(opKey)) {
            const ledgerEntry = ledger.entries.find(candidate => candidate.source === source.id && candidate.opKey === opKey)
            entries.push(makeEntry({...meta, category: 'upstream-added', scope: 'operation',
                change: {kind: 'operation-absent-in-fragments', before: null, after: null}, evidence: upstreamEvidencePath,
                ledgerStatus: ledgerEntry ? 'classified' : 'pending'}))
            continue
        }
        for (const fragmentRecord of fragmentOps.get(opKey)) {
            entries.push(...diffOperationPair({
                meta: {...meta, fragment: fragmentRecord.file},
                upstreamDocument: upstreamRecord.document,
                upstreamOperation: upstreamRecord.operation,
                fragmentDocument: fragmentRecord.document,
                fragmentOperation: fragmentRecord.operation,
                upstreamEvidencePath,
                ruleset,
            }))
        }
    }

    for (const opKey of [...fragmentOps.keys()].sort()) {
        if (upstreamOps.has(opKey)) continue
        for (const fragmentRecord of fragmentOps.get(opKey)) {
            if (!onSourceSurface(fragmentRecord.file)) continue
            if (!includesTarget(fragmentRecord.operation, source.publicationTarget)) continue
            const ledgerEntry = ledger.entries.find(candidate => candidate.source === source.id && candidate.opKey === opKey)
            entries.push(makeEntry({opKey, fragment: fragmentRecord.file, category: 'fragment-only', scope: 'operation',
                change: {kind: 'operation-absent-upstream', before: null, after: null},
                evidence: `fragment ${fragmentRecord.file}`,
                ledgerStatus: ledgerEntry ? 'classified' : 'pending'}))
        }
    }

    entries.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    const summary = {}
    for (const entry of entries) summary[entry.category] = (summary[entry.category] || 0) + 1
    return {
        schemaVersion: '1.0',
        source: source.id,
        publicationTarget: source.publicationTarget,
        upstreamPin,
        summary,
        entries,
    }
}

module.exports = {
    diffSpecifications,
    branchesOf,
    resolveSchema,
    propertiesOf,
    requiredOf,
    includesTarget,
    encodePointerToken,
    HTTP_METHODS,
}
