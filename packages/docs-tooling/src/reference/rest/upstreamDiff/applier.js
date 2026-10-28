const fs = require('node:fs')
const path = require('node:path')
const {isDeepStrictEqual} = require('node:util')
const {serializeDocument} = require('./formatter')
const {verifyAgainstDiff} = require('./changeSet')

// Deterministic applier: the agent authors a schema-validated change set; this
// module (plain code, never the agent) mutates the canonical fragment objects.
// Invariants (design §8.2/§8.3):
//   - every applied entry traces to a diff output entry (no unsourced changes)
//   - writes are limited to whitelisted mutable leaves; the structural skeleton
//     (everything except mutable leaves) must be byte-equal before and after, so
//     properties, oneOf/anyOf branches, and x-* keys can never drift through here
//   - internal denylisted field names can never be introduced

const PROSE_KEYS = new Set(['summary', 'description', 'example'])
const CONSTRAINT_KEYS = new Set(['type', 'format', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems', 'enum', 'default', 'nullable', 'deprecated', 'required'])
const LIFECYCLE_KEYS = new Set(['x-added-at', 'x-last-modified', 'x-deprecated-since'])
const LIFECYCLE_TRACK = /^[0-9]+\.[0-9]+\.x$/
// Value shapes a constraint write may carry; anything else is rejected so a
// constraint entry cannot smuggle structure (e.g. an object into `type`).
const CONSTRAINT_VALUE_CHECKS = {
    type: value => typeof value === 'string',
    format: value => typeof value === 'string',
    pattern: value => typeof value === 'string',
    minimum: value => typeof value === 'number',
    maximum: value => typeof value === 'number',
    exclusiveMinimum: value => typeof value === 'number' || typeof value === 'boolean',
    exclusiveMaximum: value => typeof value === 'number' || typeof value === 'boolean',
    minLength: value => Number.isInteger(value) && value >= 0,
    maxLength: value => Number.isInteger(value) && value >= 0,
    minItems: value => Number.isInteger(value) && value >= 0,
    maxItems: value => Number.isInteger(value) && value >= 0,
    uniqueItems: value => typeof value === 'boolean',
    nullable: value => typeof value === 'boolean',
    deprecated: value => typeof value === 'boolean',
    enum: value => Array.isArray(value) && value.every(item => item === null || ['string', 'number', 'boolean'].includes(typeof item)),
    required: value => Array.isArray(value) && value.every(item => typeof item === 'string'),
    default: () => true,
}

function fail(code, message) {
    throw new Error(`${code}: ${message}`)
}

function decodePointer(pointer) {
    if (!pointer.startsWith('/')) fail('REST_UPSTREAM_APPLY_POINTER_INVALID', pointer)
    return pointer.split('/').slice(1).map(token => token.replace(/~1/g, '/').replace(/~0/g, '~'))
}

function mutableKeyFor(kind) {
    if (kind === 'prose') return PROSE_KEYS
    if (kind === 'constraint') return CONSTRAINT_KEYS
    if (kind === 'lifecycle') return LIFECYCLE_KEYS
    return null
}

function resolveParent(document, pointer, diffEntryId) {
    const tokens = decodePointer(pointer)
    const leaf = tokens[tokens.length - 1]
    let parent = document
    for (const token of tokens.slice(0, -1)) {
        if (Array.isArray(parent)) {
            const index = Number(token)
            if (!/^[0-9]+$/.test(token) || index >= parent.length) {
                fail('REST_UPSTREAM_APPLY_TARGET_MISSING', `${diffEntryId}: ${pointer} (index "${token}" out of range)`)
            }
            parent = parent[index]
            continue
        }
        if (!isPlainObject(parent) || !(token in parent)) {
            fail('REST_UPSTREAM_APPLY_TARGET_MISSING', `${diffEntryId}: ${pointer} (missing "${token}")`)
        }
        parent = parent[token]
    }
    return {parent, leaf}
}

function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stripMutableLeaves(value) {
    if (Array.isArray(value)) return value.map(stripMutableLeaves)
    if (!isPlainObject(value)) return value
    const result = {}
    for (const [key, child] of Object.entries(value)) {
        if (PROSE_KEYS.has(key) || CONSTRAINT_KEYS.has(key) || LIFECYCLE_KEYS.has(key)) continue
        result[key] = stripMutableLeaves(child)
    }
    return result
}

function assertSkeletonUnchanged(before, after, label) {
    if (!isDeepStrictEqual(stripMutableLeaves(before), stripMutableLeaves(after))) {
        fail('REST_UPSTREAM_STRUCTURE_CHANGED', `${label}: structural skeleton drifted; structural edits are a human/ledger lane`)
    }
}

function assertNoInternalFields(before, after, denylist, label) {
    const beforeKeys = collectKeys(before)
    for (const key of collectKeys(after)) {
        if (denylist.includes(key) && !beforeKeys.has(key)) {
            fail('REST_UPSTREAM_INTERNAL_FIELD', `${label}: "${key}" is an internal field and must never enter the docs`)
        }
    }
}

function collectKeys(value, seen = new Set(), out = new Set()) {
    if (seen.has(value)) return out
    if (Array.isArray(value)) {
        seen.add(value)
        for (const item of value) collectKeys(item, seen, out)
        return out
    }
    if (!isPlainObject(value)) return out
    seen.add(value)
    for (const [key, child] of Object.entries(value)) {
        out.add(key)
        collectKeys(child, seen, out)
    }
    return out
}

function applyFragmentEntry(document, entry, denylist) {
    const label = entry.diffEntryId
    const kind = entry.kind
    const forbiddenTarget = (denylist || []).includes(decodePointer(entry.opPath).pop())
    if (forbiddenTarget) fail('REST_UPSTREAM_INTERNAL_FIELD', `${label}: "${entry.opPath}" targets an internal field`)
    if (kind === 'lifecycle' && entry.value !== null && !LIFECYCLE_TRACK.test(entry.value)) {
        fail('REST_UPSTREAM_APPLY_VALUE_INVALID', `${label}: lifecycle values use the major.minor.x track format`)
    }
    const {parent, leaf} = resolveParent(document, entry.opPath, label)
    const allowedKeys = mutableKeyFor(kind)
    if (allowedKeys && !allowedKeys.has(leaf)) {
        fail('REST_UPSTREAM_APPLY_TARGET_INVALID', `${label}: ${kind} entries may only write ${[...allowedKeys].join(', ')}; got "${leaf}"`)
    }
    if (kind === 'constraint' && !CONSTRAINT_VALUE_CHECKS[leaf](entry.value)) {
        fail('REST_UPSTREAM_APPLY_VALUE_INVALID', `${label}: unsupported value shape for "${leaf}"`)
    }
    if (!isPlainObject(parent)) {
        fail('REST_UPSTREAM_APPLY_TARGET_INVALID', `${label}: parent of ${entry.opPath} is not an object`)
    }
    parent[leaf] = entry.value
}

function applyTitleEntries(titles, titleEntries) {
    const result = {...titles}
    const log = []
    for (const entry of titleEntries) {
        const {action, zhTitle, slug} = entry.value
        if (action === 'add') {
            if (result[zhTitle] !== undefined && result[zhTitle] !== slug) {
                fail('REST_UPSTREAM_TITLES_CONFLICT', `${entry.diffEntryId}: "${zhTitle}" already maps to ${result[zhTitle]}`)
            }
            result[zhTitle] = slug
        } else {
            if (result[zhTitle] === undefined) fail('REST_UPSTREAM_TITLES_CONFLICT', `${entry.diffEntryId}: "${zhTitle}" is not mapped`)
            if (result[zhTitle] !== slug) fail('REST_UPSTREAM_TITLES_CONFLICT', `${entry.diffEntryId}: "${zhTitle}" maps to ${result[zhTitle]}, not ${slug}`)
            delete result[zhTitle]
        }
        log.push({diffEntryId: entry.diffEntryId, action, zhTitle, slug})
    }
    return {titles: result, log}
}

/*
 * applyChangeSet({documents, titles, changeSet, diff, ruleset}) ->
 * {documents, titles, appliedLog, ledgerDrafts, titleLog}
 * documents: Map<fragmentFile, parsed object>. Only files named by entries are
 * mutated; everything else is returned untouched.
 */
function applyChangeSet({documents, titles = {}, changeSet, diff, ruleset}) {
    verifyAgainstDiff(changeSet, diff)
    const denylist = ruleset.internalFieldDenylist || []
    const snapshots = new Map()
    const appliedLog = []
    const ledgerDrafts = []
    const titleEntries = []

    for (const entry of changeSet.entries) {
        if (entry.kind === 'ledgerDraft') {
            ledgerDrafts.push({diffEntryId: entry.diffEntryId, ...entry.ledgerDraft})
            appliedLog.push({diffEntryId: entry.diffEntryId, kind: entry.kind})
            continue
        }
        if (entry.kind === 'title') {
            titleEntries.push(entry)
            appliedLog.push({diffEntryId: entry.diffEntryId, kind: entry.kind})
            continue
        }
        if (!snapshots.has(entry.targetFragment)) {
            if (!documents.has(entry.targetFragment)) {
                fail('REST_UPSTREAM_APPLY_FRAGMENT_UNKNOWN', `${entry.diffEntryId}: ${entry.targetFragment}`)
            }
            snapshots.set(entry.targetFragment, structuredClone(documents.get(entry.targetFragment)))
        }
        applyFragmentEntry(documents.get(entry.targetFragment), entry, denylist)
        appliedLog.push({diffEntryId: entry.diffEntryId, kind: entry.kind, targetFragment: entry.targetFragment, opPath: entry.opPath})
    }

    for (const [file, before] of snapshots) {
        assertSkeletonUnchanged(before, documents.get(file), file)
        assertNoInternalFields(before, documents.get(file), denylist, file)
    }

    const titleResult = applyTitleEntries(titles, titleEntries)
    return {
        documents,
        changedFiles: new Set(snapshots.keys()),
        titles: titleResult.titles,
        appliedLog,
        ledgerDrafts,
        titleLog: titleResult.log,
    }
}

// Reconcile (design §8.2): every change-set entry must have been applied exactly
// once; applied-log entries must trace back to the change set. Returns the set
// of diff entries left unaddressed (a report, not a failure — deferral is legal).
function reconcile(appliedLog, changeSet, diffDocument) {
    const changeSetIds = changeSet.entries.map(entry => entry.diffEntryId)
    const appliedIds = appliedLog.map(logEntry => logEntry.diffEntryId)
    for (const id of appliedIds) {
        if (!changeSetIds.includes(id)) fail('REST_UPSTREAM_RECONCILE_STRAY', id)
    }
    for (const id of changeSetIds) {
        if (appliedIds.filter(candidate => candidate === id).length !== 1) fail('REST_UPSTREAM_RECONCILE_INCOMPLETE', id)
    }
    return diffDocument.entries.map(entry => entry.id).filter(id => !changeSetIds.includes(id))
}

function writeCanonicalOutputs({outDir, fragmentsDir, documents, changedFiles, titles}) {
    fs.mkdirSync(outDir, {recursive: true})
    const written = []
    for (const fileName of fs.readdirSync(fragmentsDir).filter(name => name.endsWith('.json')).sort()) {
        const target = path.join(outDir, fileName)
        if (changedFiles.has(fileName)) {
            fs.writeFileSync(target, serializeDocument(documents.get(fileName)))
        } else {
            fs.copyFileSync(path.join(fragmentsDir, fileName), target)
        }
        written.push(fileName)
    }
    if (titles) fs.writeFileSync(path.join(outDir, 'titles.json'), serializeDocument(titles))
    return written
}

module.exports = {applyChangeSet, reconcile, writeCanonicalOutputs, stripMutableLeaves, applyTitleEntries}
