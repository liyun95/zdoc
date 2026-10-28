const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const yaml = require('js-yaml')
const {serializeDocument, assertCanonicalBytes, listFragmentFiles, loadCanonicalFragments} = require('./formatter')
const {loadRestUpstreamLock, findLockSource} = require('./lock')
const {loadRestUpstreamLedger} = require('./ledger')
const {downgradeDocument} = require('./oasDowngrade')
const {diffSpecifications} = require('./diff')
const {loadChangeSet, diffDigestOf} = require('./changeSet')
const {applyChangeSet, reconcile, writeCanonicalOutputs} = require('./applier')
const {buildLedgerProposal, parseRestUpstreamLedgerProposal, mergeLedgerProposal} = require('./ledgerBootstrap')
const {prepareRestUpstreamStaging} = require('./staging')

// Six levels up from upstreamDiff/: rest → reference → src → docs-tooling → packages → repo root.
const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..')
const DEFAULT_INSTRUCTIONS = path.join(REPOSITORY_ROOT, '.github', 'prompts', 'codex-rest-refresh-agent.md')

const REST_ROOT = path.join(__dirname, '..')
const DEFAULTS = {
    lock: path.join(REST_ROOT, 'meta', 'upstream', 'rest-upstream-lock.json'),
    ledger: path.join(REST_ROOT, 'meta', 'upstream', 'ledger.json'),
    rules: path.join(REST_ROOT, 'meta', 'upstream', 'refresh-rules.json'),
    fragments: path.join(REST_ROOT, 'meta', 'openapi'),
    titles: path.join(REST_ROOT, 'meta', 'titles.json'),
    migration: path.join(REST_ROOT, 'meta', 'fragment-migration.json'),
}

function fail(code, message) {
    throw new Error(`${code}: ${message}`)
}

// fragment-migration.json classifies every fragment by api surface; the diff
// uses it to scope `fragment-only` reporting to the source's own surface.
function loadFragmentSurfaces(filePath) {
    const migration = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (!Array.isArray(migration.fragments)) fail('REST_UPSTREAM_MIGRATION_INVALID', `${filePath}: fragments array missing`)
    return new Map(migration.fragments.map(fragment => [fragment.file, fragment.apiSurface]))
}

function loadRuleset(filePath) {
    const ruleset = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (!Array.isArray(ruleset.internalFieldDenylist)) fail('REST_UPSTREAM_RULESET_INVALID', `${filePath}: internalFieldDenylist missing`)
    return ruleset
}

function loadSpecFile(filePath) {
    const raw = fs.readFileSync(filePath)
    const text = raw.toString('utf8')
    const document = /\.ya?ml$/i.test(filePath) ? yaml.load(text) : JSON.parse(text)
    if (!document || typeof document !== 'object') fail('REST_UPSTREAM_SPEC_INVALID', filePath)
    return {document, contentSha256: crypto.createHash('sha256').update(raw).digest('hex')}
}

// Shared loading + diff path for rest-upstream-diff and rest-upstream-prepare:
// one authority for lock/ledger/ruleset/fragment/spec validation ordering.
function computeUpstreamDiff(opts) {
    const lock = loadRestUpstreamLock(opts.lock)
    const source = findLockSource(lock, opts.source)
    if (source.artifact.kind !== 'spec-file') fail('REST_UPSTREAM_SOURCE_KIND_UNSUPPORTED', `${source.id}: only spec-file sources diff directly; source-tree sources need the extractor skeleton`)
    const ledger = loadRestUpstreamLedger(opts.ledger)
    const ruleset = loadRuleset(opts.rules)
    const fragments = loadCanonicalFragments(opts.fragments)
    const fragmentSurfaces = loadFragmentSurfaces(opts.migration)
    const {document, contentSha256} = loadSpecFile(opts.spec)
    if (opts.expectPinned && source.pin.contentSha256 && source.pin.contentSha256 !== contentSha256) {
        fail('REST_UPSTREAM_SPEC_DIGEST_MISMATCH', `${opts.spec} sha256 ${contentSha256} != lock ${source.pin.contentSha256}`)
    }
    const upstreamCommit = opts.upstreamCommit || source.pin.commit
    if (!/^[a-f0-9]{40}$/.test(upstreamCommit)) fail('REST_UPSTREAM_COMMIT_INVALID', upstreamCommit)
    const upstream = downgradeDocument(document)
    const diff = diffSpecifications({source, upstreamPin: upstreamCommit, upstream, fragments, ledger, ruleset, fragmentSurfaces})
    return {diff, specSha256: contentSha256, source, ruleset, lock}
}

// Substantive drift = every refreshable delta the agent could address.
// zdoc-only entries are deliberate documentation design; ledger-classified
// fragment-only/upstream-added operations are already-decided stock. Everything
// else (including unclassified operations and field-level drift) needs a run.
function substantiveDriftEntries(diff) {
    return diff.entries.filter(entry => entry.category !== 'zdoc-only' && (entry.ledgerStatus ?? 'pending') !== 'classified')
}

function renderDiffMarkdown(diff) {
    const lines = [`# rest-upstream diff: ${diff.source} @ ${diff.upstreamPin}`, '']
    lines.push(`Publication target: ${diff.publicationTarget}`, '')
    lines.push('## Summary', '')
    for (const [category, count] of Object.entries(diff.summary).sort()) lines.push(`- ${category}: ${count}`)
    lines.push('')
    const byOperation = new Map()
    for (const entry of diff.entries) {
        if (!byOperation.has(entry.opKey)) byOperation.set(entry.opKey, [])
        byOperation.get(entry.opKey).push(entry)
    }
    for (const [opKey, entries] of [...byOperation.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
        const fragment = entries.find(entry => entry.fragment)?.fragment
        lines.push(`## \`${opKey}\`${fragment ? ` (${fragment})` : ''}`, '')
        for (const entry of entries) {
            const where = [entry.scope, entry.branch ? `branch "${entry.branch}"` : null, entry.field ? `\`${entry.field}\`` : null].filter(Boolean).join(' · ')
            const change = entry.change
            const detail = change.key ? `${change.kind} ${change.key}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`
                : (change.before !== null || change.after !== null) ? `${change.kind}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}` : change.kind
            const flags = [
                entry.ledgerStatus ? `ledger: ${entry.ledgerStatus}` : null,
                entry.requiresConfirmation ? `⚠️ confirm with R&D (${entry.requiresConfirmation})` : null,
            ].filter(Boolean)
            lines.push(`- **${entry.category}** — ${where}: ${detail}${flags.length ? ` [${flags.join('; ')}]` : ''}`)
            lines.push(`  - id: \`${entry.id}\``)
        }
        lines.push('')
    }
    return `${lines.join('\n')}\n`
}

function registerLockCommand(command) {
    command
        .description('Validate the rest-upstream lock file and list pinned sources')
        .option('--lock <path>', 'Lock file path', DEFAULTS.lock)
        .action(opts => {
            const lock = loadRestUpstreamLock(opts.lock)
            for (const source of lock.sources) {
                const artifact = source.artifact.kind === 'spec-file' ? source.artifact.path : source.artifact.paths.join(',')
                console.log(`${source.id}\t${source.repository}@${source.pin.commit}\t${source.artifact.kind}:${artifact}\t${source.apiSurface}/${source.publicationTarget}`)
            }
        })
}

function registerFormatCommand(command) {
    command
        .description('Check (default) or rewrite REST fragments to the canonical JSON byte format')
        .option('--dir <path>', 'Fragment directory', DEFAULTS.fragments)
        .option('--write', 'Rewrite non-canonical fragments in place', false)
        .action(opts => {
            const offending = []
            for (const fileName of listFragmentFiles(opts.dir)) {
                const filePath = path.join(opts.dir, fileName)
                const raw = fs.readFileSync(filePath, 'utf8')
                try {
                    assertCanonicalBytes(raw, fileName)
                } catch (error) {
                    if (!/REST_FRAGMENT_NONCANONICAL_FORMAT/.test(error.message)) throw error
                    offending.push(fileName)
                    if (opts.write) fs.writeFileSync(filePath, serializeDocument(JSON.parse(raw)))
                }
            }
            if (offending.length === 0) {
                console.log('All fragments are canonical.')
                return
            }
            console.log(`${opts.write ? 'Rewrote' : 'Non-canonical'}: ${offending.join(', ')}`)
            if (!opts.write) process.exitCode = 1
        })
}

function registerDiffCommand(command) {
    command
        .description('Diff a fetched upstream spec against the REST fragments (branch-aware, deterministic)')
        .requiredOption('--source <id>', 'Source id from the lock file')
        .requiredOption('--spec <path>', 'Upstream spec file (.yaml/.yml/.json) fetched at the commit under review')
        .requiredOption('--out <dir>', 'Output directory for diff.json and diff.md')
        .option('--upstream-commit <sha>', 'Commit the spec was fetched from; defaults to the lock pin')
        .option('--expect-pinned', 'Fail unless the spec bytes match the lock contentSha256', false)
        .option('--lock <path>', 'Lock file path', DEFAULTS.lock)
        .option('--ledger <path>', 'Ledger file path', DEFAULTS.ledger)
        .option('--rules <path>', 'Refresh ruleset path', DEFAULTS.rules)
        .option('--fragments <dir>', 'Fragment directory', DEFAULTS.fragments)
        .option('--migration <path>', 'fragment-migration.json used to scope fragment-only reporting by api surface', DEFAULTS.migration)
        .action(opts => {
            const {diff} = computeUpstreamDiff(opts)
            fs.mkdirSync(opts.out, {recursive: true})
            fs.writeFileSync(path.join(opts.out, 'diff.json'), serializeDocument(diff))
            fs.writeFileSync(path.join(opts.out, 'diff.md'), renderDiffMarkdown(diff))
            console.log(`diff ${diffDigestOf(diff)} -> ${opts.out}`)
            for (const [category, count] of Object.entries(diff.summary).sort()) console.log(`  ${category}: ${count}`)
        })
}

function registerApplyCommand(command) {
    command
        .description('Apply an agent-authored change set to the fragments deterministically and reconcile it against the diff')
        .requiredOption('--diff <path>', 'diff.json the change set was authored against')
        .requiredOption('--change-set <path>', 'Change set JSON')
        .requiredOption('--out <dir>', 'Output directory for the applied fragments, titles.json, and applied.json')
        .option('--rules <path>', 'Refresh ruleset path', DEFAULTS.rules)
        .option('--fragments <dir>', 'Fragment directory', DEFAULTS.fragments)
        .option('--titles <path>', 'titles.json path', DEFAULTS.titles)
        .action(opts => {
            const diff = JSON.parse(fs.readFileSync(opts.diff, 'utf8'))
            const changeSet = loadChangeSet(opts.changeSet)
            const ruleset = loadRuleset(opts.rules)
            const documents = loadCanonicalFragments(opts.fragments)
            const titles = JSON.parse(fs.readFileSync(opts.titles, 'utf8'))
            const result = applyChangeSet({documents, titles, changeSet, diff, ruleset})
            const unaddressed = reconcile(result.appliedLog, changeSet, diff)
            writeCanonicalOutputs({outDir: opts.out, fragmentsDir: opts.fragments, documents: result.documents, changedFiles: result.changedFiles, titles: result.titles})
            fs.writeFileSync(path.join(opts.out, 'applied.json'), serializeDocument({
                schemaVersion: '1.0',
                source: changeSet.source,
                diffDigest: changeSet.diffDigest,
                changedFiles: [...result.changedFiles].sort(),
                appliedLog: result.appliedLog,
                overrides: result.overrides,
                titleLog: result.titleLog,
                ledgerDrafts: result.ledgerDrafts,
                unaddressedDiffEntries: unaddressed,
            }))
            console.log(`applied ${result.appliedLog.length} entries; changed ${result.changedFiles.size} fragment(s); ${unaddressed.length} diff entries left unaddressed -> ${opts.out}`)
        })
}

function registerLedgerBootstrapCommand(command) {
    command
        .description('Pre-register existing drift (generate a proposal from a full diff) or merge a reviewed proposal into the ledger')
        .option('--from-diff <path>', 'diff.json produced by rest-upstream-diff at the pinned commit')
        .option('--merge <path>', 'Human-reviewed proposal to merge into the append-only ledger')
        .option('--date <YYYY-MM-DD>', 'UTC date recorded on generated entries (default: today)')
        .option('--out <path>', 'Proposal output path (generate mode)')
        .option('--ledger <path>', 'Ledger file path', DEFAULTS.ledger)
        .action(opts => {
            if (opts.fromDiff) {
                if (opts.merge) fail('REST_UPSTREAM_BOOTSTRAP_MODE_CONFLICT', 'use either --from-diff or --merge, not both')
                if (!opts.out) fail('REST_UPSTREAM_BOOTSTRAP_OUT_REQUIRED', 'generate mode needs --out')
                const date = opts.date || new Date().toISOString().slice(0, 10)
                const diff = JSON.parse(fs.readFileSync(opts.fromDiff, 'utf8'))
                const proposal = buildLedgerProposal(diff, {date})
                fs.mkdirSync(path.dirname(path.resolve(opts.out)), {recursive: true})
                fs.writeFileSync(opts.out, serializeDocument(proposal))
                console.log(`bootstrap proposal ${proposal.entries.length} entr(ies) -> ${opts.out}`)
                for (const entry of proposal.entries) console.log(`  ${entry.classification}\t${entry.opKey}${entry.fragment ? `\t${entry.fragment}` : ''}`)
                return
            }
            if (!opts.merge) fail('REST_UPSTREAM_BOOTSTRAP_MODE_REQUIRED', 'pass --from-diff to generate a proposal or --merge to merge a reviewed one')
            const proposal = parseRestUpstreamLedgerProposal(fs.readFileSync(opts.merge, 'utf8'), path.basename(opts.merge))
            const merged = mergeLedgerProposal(proposal, fs.readFileSync(opts.ledger, 'utf8'), path.basename(opts.ledger))
            fs.writeFileSync(opts.ledger, merged)
            console.log(`merged ${proposal.entries.length} ledger entr(ies) -> ${opts.ledger}`)
        })
}

function registerPrepareCommand(command) {
    command
        .description('Build the isolated agent staging directory (diff + touched fragment copies + ruleset + instructions)')
        .requiredOption('--source <id>', 'Source id from the lock file')
        .requiredOption('--spec <path>', 'Upstream spec file (.yaml/.yml/.json) fetched at the commit under review')
        .requiredOption('--staging <dir>', 'Staging directory to create (must be absent or empty)')
        .option('--upstream-commit <sha>', 'Commit the spec was fetched from; defaults to the lock pin')
        .option('--expect-pinned', 'Fail unless the spec bytes match the lock contentSha256', false)
        .option('--allow-empty-drift', 'Stage even when no substantive drift exists (rehearsal escape hatch)', false)
        .option('--instructions <path>', 'Agent instruction pack', path.join(REPOSITORY_ROOT, '.github', 'prompts', 'codex-rest-refresh-agent.md'))
        .option('--lock <path>', 'Lock file path', DEFAULTS.lock)
        .option('--ledger <path>', 'Ledger file path', DEFAULTS.ledger)
        .option('--rules <path>', 'Refresh ruleset path', DEFAULTS.rules)
        .option('--titles <path>', 'titles.json path', DEFAULTS.titles)
        .option('--fragments <dir>', 'Fragment directory', DEFAULTS.fragments)
        .option('--migration <path>', 'fragment-migration.json used to scope fragment-only reporting by api surface', DEFAULTS.migration)
        .action(opts => {
            // The default pack anchors REPOSITORY_ROOT; a wrong root would
            // only surface as an ENOENT deep in staging. Trip here instead.
            if (!fs.existsSync(opts.instructions)) {
                fail('REST_UPSTREAM_INSTRUCTIONS_MISSING', `${opts.instructions}: instruction pack not found (REPOSITORY_ROOT=${REPOSITORY_ROOT})`)
            }
            const {diff, specSha256, source} = computeUpstreamDiff(opts)
            const drift = substantiveDriftEntries(diff)
            if (drift.length === 0 && !opts.allowEmptyDrift) {
                fail('REST_UPSTREAM_PREPARE_NO_DRIFT', `${source.id}: no substantive drift at ${diff.upstreamPin}; pass --allow-empty-drift only for rehearsals`)
            }
            const touchedFiles = [...new Set(diff.entries.map(entry => entry.fragment).filter(Boolean))].sort()
            const fragments = loadCanonicalFragments(opts.fragments)
            for (const fileName of touchedFiles) {
                if (!fragments.has(fileName)) fail('REST_UPSTREAM_PREPARE_FRAGMENT_MISSING', fileName)
            }
            const manifest = prepareRestUpstreamStaging({
                stagingDir: opts.staging,
                repositoryRoot: REPOSITORY_ROOT,
                diff,
                diffMarkdown: renderDiffMarkdown(diff),
                specSha256,
                upstreamCommit: diff.upstreamPin,
                fragments,
                fragmentFiles: touchedFiles,
                rulesPath: opts.rules,
                titlesPath: opts.titles,
                ledgerPath: opts.ledger,
                lockPath: opts.lock,
                instructionsPath: opts.instructions,
            })
            console.log(`staged ${touchedFiles.length} fragment(s), ${drift.length} substantive drift entr(ies) -> ${opts.staging}`)
            console.log(`diff ${manifest.diffDigest}`)
            for (const file of manifest.files) console.log(`  ${file.path}`)
        })
}

function registerUpstreamCommands(cli) {
    registerLockCommand(cli.command('rest-upstream-lock'))
    registerFormatCommand(cli.command('rest-upstream-format'))
    registerDiffCommand(cli.command('rest-upstream-diff'))
    registerApplyCommand(cli.command('rest-upstream-apply'))
    registerLedgerBootstrapCommand(cli.command('rest-upstream-ledger-bootstrap'))
    registerPrepareCommand(cli.command('rest-upstream-prepare'))
}

const UPSTREAM_COMMANDS = new Set(['rest-upstream-lock', 'rest-upstream-format', 'rest-upstream-diff', 'rest-upstream-apply', 'rest-upstream-ledger-bootstrap', 'rest-upstream-prepare'])

module.exports = {registerUpstreamCommands, renderDiffMarkdown, loadSpecFile, loadRuleset, loadFragmentSurfaces, computeUpstreamDiff, substantiveDriftEntries, UPSTREAM_COMMANDS, DEFAULTS, REPOSITORY_ROOT}
