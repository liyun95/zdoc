// Machine-generated candidate list for the refresh decision stage (decisions-first
// pipeline, 2026-10-29). The diff stays the only structural authority: candidates
// restate each stanceable drift entry as one compact line the decision model must
// echo or omit. No path, value, or locus ever appears as something the model has
// to produce — the assembler derives those from the diff entry itself.

const STANCEABLE_CATEGORIES = new Set([
    'upstream-modified',
    'unattributed',
    'upstream-added',
    'upstream-added-field',
    'upstream-added-param',
    'fragment-only',
])

function candidateSummary(entry) {
    const change = entry.change || {}
    return [
        entry.opKey,
        entry.scope,
        entry.branch ? `branch=${entry.branch}` : '',
        entry.field ? `field=${entry.field}` : '',
        change.kind ? `change=${change.kind}${change.key ? `(${change.key})` : ''}` : '',
        entry.requiresConfirmation ? `requiresConfirmation=${entry.requiresConfirmation}` : '',
        'before' in change ? `before=${JSON.stringify(change.before)}` : '',
        'after' in change ? `after=${JSON.stringify(change.after)}` : '',
    ].filter(Boolean).join(' ')
}

// Ledger-classified drift is already decided stock; zdoc-only drift is
// deliberate documentation design. Everything stanceable is offered to the
// decision stage, one line per diff entry.
function buildCandidateLines(diffDocument, {fragmentFilter = null} = {}) {
    const lines = []
    for (const entry of diffDocument.entries) {
        if (!STANCEABLE_CATEGORIES.has(entry.category)) continue
        if ((entry.ledgerStatus ?? 'pending') === 'classified') continue
        if (fragmentFilter && entry.fragment !== fragmentFilter) continue
        lines.push({d: entry.id, c: candidateSummary(entry)})
    }
    return lines
}

function serializeCandidateLines(lines) {
    return `${lines.map(line => JSON.stringify(line)).join('\n')}\n`
}

module.exports = {buildCandidateLines, serializeCandidateLines, STANCEABLE_CATEGORIES}
