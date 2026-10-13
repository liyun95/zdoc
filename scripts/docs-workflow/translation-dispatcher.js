'use strict'

// Hourly translation dispatcher: count pending work per translation unit
// through the producer's own selection mechanism, maintain the persisted
// dispatch plan (task list), and dispatch at most one producer run per cycle
// within a per-run file budget. Dispatch granularity is the source group —
// the same granularity Fetch already dispatches at — expressed as a
// comma-separated group selector, so the dispatched handoff is built and
// strict-validated by the existing handoff tooling instead of being filtered
// by hand. Scheduling and execution are deliberately separate: nothing here
// waits on a child run; the next hourly cycle re-observes git state, which is
// the only truth. On any ambiguity (producer activity unknown, count failure)
// it stops without dispatching.

const fs = require('node:fs')
const path = require('node:path')
const {spawnSync} = require('node:child_process')
const {createDispatchPlan, isOpenStatus, mergeDispatchPlan, markDispatched, markBlocked, summarizePlan, parseDispatchPlan} = require('./translation-dispatch-plan')
const {countPendingUnit} = require('./translation-pending-count')
const {validateTranslationHandoff} = require('./translation-handoff')
const {parseBuildFailures, attributeBuildFailures} = require('./translation-build-gate')

const DEFAULT_BUDGET = 300
const DEFAULT_GUIDES_MAX_FILES = 150
// Backoff budget per source checkpoint: a deterministic producer failure
// (broken source, incompatible handoff) re-dispatched hourly is a paid retry
// loop, so after this many failed attempts the unit blocks until the source
// checkpoint moves — which resets the budget through the normal supersede.
const MAX_DISPATCH_ATTEMPTS = 2
const FAILURE_CONCLUSIONS = new Set(['failure', 'startup_failure', 'cancelled', 'timed_out', 'stale'])
const PRODUCER_WORKFLOWS = ['translate-codex.yml', 'publish-translation.yml', 'recover-translation.yml']
const ACTIVE_RUN_STATUSES = new Set(['queued', 'requested', 'in_progress', 'waiting', 'pending', 'action_required', 'stale'])

function unitKeyOf(unit) {
  return `translation/${unit.target}/${unit.group}`
}

// Groups ride together with both of their locale tracks (ja + zh-CN), exactly
// like a Fetch dispatch, so budgets and rotation operate per source group.
function aggregateGroupTotals({plan, units}) {
  const groups = new Map()
  for (const unit of units) {
    if (!groups.has(unit.group)) groups.set(unit.group, {group: unit.group, pendingCount: 0, unitKeys: []})
    const entry = groups.get(unit.group)
    const current = plan.units[unitKeyOf(unit)]?.current
    if (current && isOpenStatus(current.status)) {
      entry.pendingCount += current.pendingCount
      entry.unitKeys.push(unitKeyOf(unit))
    }
  }
  return [...groups.values()].filter(entry => entry.pendingCount > 0)
}

// Same admission rule as unit selection: largest backlog first, stop at the
// budget, never strand a group larger than the whole budget.
function selectDispatchGroups({groupTotals, budget}) {
  const ordered = [...groupTotals].sort((left, right) => right.pendingCount - left.pendingCount || left.group.localeCompare(right.group))
  const selected = []
  let total = 0
  for (const entry of ordered) {
    if (selected.length > 0 && total + entry.pendingCount > budget) continue
    selected.push(entry.group)
    total += entry.pendingCount
    if (total >= budget) break
  }
  return {groups: selected, unitKeys: selected.flatMap(group => ordered.find(entry => entry.group === group).unitKeys), totalPending: total}
}

// Adapters are injected so tests never touch git, the GitHub API, or the
// network. listActiveProducerRuns returns null when activity cannot be
// determined (safe stop), otherwise a possibly-empty list of active runs.
async function runDispatcher({plan, budget = DEFAULT_BUDGET, guidesMaxFiles = DEFAULT_GUIDES_MAX_FILES, now, dispatch = false, adapters, log = console}) {
  if (typeof now !== 'string' || !now) throw new Error('A dispatch timestamp is required')
  if (!adapters || typeof adapters !== 'object') throw new Error('Dispatcher adapters are required')

  const active = adapters.listActiveProducerRuns()
  if (active === null || active === undefined) {
    log.log('[translation-dispatcher] producer activity unknown; refusing to dispatch this cycle')
    return {action: 'skip-unknown', plan}
  }
  if (active.length > 0) {
    log.log(`[translation-dispatcher] producer work already active (${active.map(run => `${run.workflow}#${run.id}`).join(', ')}); skipping this cycle`)
    return {action: 'skip-busy', plan}
  }

  const handoff = adapters.buildHandoff({groups: 'all'})
  const units = handoff.units.filter(unit => unit.group !== 'rest')
  if (units.length === 0) return {action: 'idle', plan}

  const observations = []
  const unitFiles = new Map()
  for (const unit of units) {
    const summary = adapters.countUnit(unit, {printFiles: dispatch})
    observations.push({unitKey: unitKeyOf(unit), sourceCheckpointSha: unit.sourceCheckpointSha, pendingCount: summary.pendingCount})
    if (summary.files) unitFiles.set(unitKeyOf(unit), summary.files)
    log.log(`[translation-dispatcher] ${unitKeyOf(unit)} pending=${summary.pendingCount} mode=${summary.effectiveMode}`)
  }

  const mergedPlan = mergeDispatchPlan({plan, observations, now})
  const backoff = applyDispatchBackoff({plan: mergedPlan, adapters, now, log})
  if (backoff.unknown) {
    log.log('[translation-dispatcher] dispatch conclusions cannot be determined; refusing to dispatch this cycle')
    return {action: 'skip-unknown', plan: mergedPlan}
  }
  let gatedPlan = backoff.plan
  const selection = selectDispatchGroups({groupTotals: aggregateGroupTotals({plan: gatedPlan, units}), budget})
  if (selection.groups.length === 0) {
    log.log(`[translation-dispatcher] nothing to dispatch (open units: ${summarizePlan(gatedPlan).open + summarizePlan(gatedPlan).dispatched})`)
    return {action: 'idle', plan: gatedPlan}
  }

  if (!dispatch) {
    log.log(`[translation-dispatcher] dry-run: would dispatch groups ${selection.groups.join(', ')} (${selection.totalPending} files, budget ${budget})`)
    return {action: 'dry-run', plan: gatedPlan, selection}
  }

  // Counting spans many minutes (fresh worktree, install, per-unit
  // materialization); a producer dispatched in that window — by Fetch's
  // end-of-run handoff or an operator — would ride a duplicate paid run, so
  // producer activity is re-checked immediately before dispatching.
  const reappearance = adapters.listActiveProducerRuns()
  if (reappearance === null || reappearance === undefined || reappearance.length > 0) {
    log.log('[translation-dispatcher] producer activity appeared during counting; refusing to dispatch this cycle')
    return {action: 'skip-busy', plan: gatedPlan}
  }

  const gate = await gateSourceBuild({plan: gatedPlan, selection, unitFiles, adapters, log, now})
  gatedPlan = gate.plan
  if (gate.action === 'skip-build-red') return {action: 'skip-build-red', plan: gatedPlan}
  if (gate.action === 'blocked-build') return {action: 'blocked-build', plan: gatedPlan, selection: gate.selection}
  const dispatchSelection = gate.selection

  const dispatchHandoff = adapters.buildHandoff({groups: dispatchSelection.groups.join(',')})
  validateTranslationHandoff(dispatchHandoff)
  const requestId = adapters.nextRequestId()
  const dispatchResult = adapters.dispatchTranslation({handoff: dispatchHandoff, mode: 'auto', publish: true, guidesMaxFiles, requestId})
  const dispatchedPlan = markDispatched({plan: gatedPlan, unitKeys: dispatchSelection.unitKeys, runId: dispatchResult.runId, requestId, dispatchedAt: now})
  log.log(`[translation-dispatcher] dispatched groups ${dispatchSelection.groups.join(', ')} (${dispatchSelection.totalPending} files) -> run ${dispatchResult.runId}`)
  return {action: 'dispatched', plan: dispatchedPlan, selection: dispatchSelection, runId: dispatchResult.runId}
}

// Source-side build gate. Translating broken English ships broken output to
// every locale, so an armed cycle first builds the current dev tree and
// attributes failures to the dispatch set. The expensive build result is
// cached per dev HEAD; attribution is pure and re-derived every cycle against
// the CURRENT selection, so a cached verdict never goes stale when rotation
// picks different groups on an unchanged dev. Only source-side hits block
// (whole groups — the source is shared by both locale tracks); target-side
// hits never block because dispatching is the repair path for translated
// files, and an unattributable red fails the whole cycle closed.
async function gateSourceBuild({plan, selection, unitFiles, adapters, log, now}) {
  const devSha = adapters.resolveDevSha()
  if (typeof devSha !== 'string' || !/^[0-9a-f]{40}$/.test(devSha)) throw new Error('A dev HEAD SHA is required for the build gate')
  let verdict = plan.buildGate && plan.buildGate.devSha === devSha ? plan.buildGate : null
  if (!verdict) {
    log.log(`[translation-dispatcher] running the source build gate against dev ${devSha.slice(0, 12)} (build:en)`)
    verdict = await adapters.runSourceBuildGate({devSha})
    if (!verdict || typeof verdict !== 'object' || !verdict.failures || typeof verdict.green !== 'boolean') throw new Error('The build gate adapter must return a verdict')
  }
  let gatedPlan = {...plan, buildGate: {...verdict, checkedAt: verdict.checkedAt || now}}
  if (verdict.green) return {plan: gatedPlan, selection}

  const groupFiles = new Map()
  for (const unitKey of selection.unitKeys) {
    const group = unitKey.split('/')[2]
    if (!groupFiles.has(group)) groupFiles.set(group, [])
    groupFiles.get(group).push(...(unitFiles.get(unitKey) || []))
  }
  const blockedGroups = []
  let sawAttribution = false
  for (const [group, files] of groupFiles) {
    const attribution = attributeBuildFailures({failures: verdict.failures, files})
    if (attribution.sourceHits.length > 0) {
      blockedGroups.push(group)
      sawAttribution = true
      log.log(`[translation-dispatcher] build gate blocked group ${group}: broken source in the dispatch set (${attribution.sourceHits.slice(0, 5).join(', ')})`)
    }
    if (attribution.targetHits.length > 0) {
      sawAttribution = true
      log.log(`[translation-dispatcher] broken translated file(s) outside the repair path (${attribution.targetHits.slice(0, 5).join(', ')}); dispatching is the repair path, not blocking`)
    }
  }
  if (!sawAttribution && blockedGroups.length === 0) {
    log.log('[translation-dispatcher] build is red but no failure attributes to the dispatch set; failing the cycle closed instead of dispatching blind')
    return {plan: gatedPlan, action: 'skip-build-red'}
  }
  const remainingGroups = selection.groups.filter(group => !blockedGroups.includes(group))
  if (remainingGroups.length === 0) {
    return {plan: gatedPlan, action: 'blocked-build', selection}
  }
  const remainingUnitKeys = selection.unitKeys.filter(unitKey => remainingGroups.includes(unitKey.split('/')[2]))
  const remainingSelection = {
    groups: remainingGroups,
    unitKeys: remainingUnitKeys,
    totalPending: remainingUnitKeys.reduce((total, unitKey) => total + (plan.units[unitKey]?.current?.pendingCount || 0), 0),
  }
  return {plan: gatedPlan, selection: remainingSelection}
}

// A dispatched unit whose producer run has gone terminal is retried when the
// failure looks transient, and blocked once the per-checkpoint attempt budget
// is exhausted — an hourly redispatch of deterministic breakage is a paid
// retry loop. The right remediation for a failed producer run is usually
// recover-translation (salvaging completed batches), not a fresh dispatch.
function applyDispatchBackoff({plan, adapters, now, log, maxAttempts = MAX_DISPATCH_ATTEMPTS}) {
  let gated = plan
  for (const unit of Object.values(plan.units)) {
    const current = unit.current
    if (!current || current.status !== 'dispatched' || !current.lastDispatch) continue
    const conclusion = adapters.getRunConclusion(current.lastDispatch.runId)
    if (conclusion === null || conclusion === undefined) {
      log.log(`[translation-dispatcher] conclusion for run ${current.lastDispatch.runId} (${current.unitKey}) is unknown; safe stop`)
      return {plan, unknown: true}
    }
    if (!FAILURE_CONCLUSIONS.has(conclusion)) continue
    const attempts = current.lastDispatch.attempts || 1
    if (attempts < maxAttempts) {
      log.log(`[translation-dispatcher] dispatch attempt ${attempts} for ${current.unitKey} ended ${conclusion}; retry remains before backoff`)
      continue
    }
    gated = markBlocked({plan: gated, unitKeys: [current.unitKey], blockedAt: now, reason: `${attempts} dispatch attempt(s) ended ${conclusion} (last run ${current.lastDispatch.runId})`})
    log.log(`[translation-dispatcher] blocked ${current.unitKey} after ${attempts} failed dispatch attempt(s); salvage with: gh workflow run recover-translation.yml --ref master -f previous_translation_run_id=${current.lastDispatch.runId} -f publish=false`)
  }
  return {plan: gated, unknown: false}
}

function runCapture(command, args, options) {
  const result = spawnSync(command, args, {encoding: 'utf8', ...options})
  if (result.status !== 0) throw new Error(`command failed (${result.status}): ${command} ${args.join(' ')}\n${(result.stderr || result.stdout || '').slice(-2000)}`)
  return result.stdout
}

function createCliAdapters({repository, sourceBranch = 'dev'}) {
  const repositoryRoot = path.resolve(repository)
  const toolingSha = runCapture('git', ['rev-parse', 'HEAD'], {cwd: repositoryRoot}).trim()
  // Counting replays the producer's materialization, which mutates the tree
  // (restore/materialize/tmp), so every unit counts inside one dedicated
  // installed worktree — a bare checkout lacks the per-package node_modules
  // the TypeScript loaders resolve through. One install serves all units;
  // translation-pending-count resets per-unit state inside it.
  const countingWorkspace = path.join(repositoryRoot, 'tmp', 'dispatch-count-workspace')
  const buildWorkspace = path.join(repositoryRoot, 'tmp', 'dispatch-build-workspace')
  let countingReady = false
  let buildReady = false
  const ensureCountingWorkspace = () => {
    if (countingReady) return
    fs.mkdirSync(path.dirname(countingWorkspace), {recursive: true})
    runCapture('git', ['worktree', 'add', '--detach', countingWorkspace, toolingSha], {cwd: repositoryRoot})
    runCapture('pnpm', ['install', '--frozen-lockfile'], {cwd: countingWorkspace})
    countingReady = true
  }
  return {
    cleanup() {
      if (buildReady) runCapture('git', ['worktree', 'remove', '--force', buildWorkspace], {cwd: repositoryRoot})
      if (countingReady) runCapture('git', ['worktree', 'remove', '--force', countingWorkspace], {cwd: repositoryRoot})
    },
    resolveDevSha() {
      return runCapture('git', ['rev-parse', 'refs/remotes/origin/dev'], {cwd: repositoryRoot}).trim()
    },
    // The gate builds the CONTENT branch with its own toolchain: dev is the
    // tree every dispatched translation consumes, and it is the tree sync
    // validates, so a green dev build is exactly the state translations
    // should be produced from. A nonzero build exit is the verdict, not an
    // infrastructure error — only install/worktree failures throw.
    async runSourceBuildGate({devSha}) {
      if (!buildReady) {
        fs.mkdirSync(path.dirname(buildWorkspace), {recursive: true})
        runCapture('git', ['worktree', 'add', '--detach', buildWorkspace, devSha], {cwd: repositoryRoot})
        runCapture('pnpm', ['install', '--frozen-lockfile'], {cwd: buildWorkspace})
        buildReady = true
      }
      const result = spawnSync('pnpm', ['--filter', '@zilliz/docs-site', 'run', 'build:en'], {
        cwd: buildWorkspace,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        env: {...process.env, CI: '1'},
      })
      const logText = `${result.stdout || ''}\n${result.stderr || ''}`
      return {
        devSha,
        green: result.status === 0,
        failures: parseBuildFailures({logText}),
        checkedAt: new Date().toISOString(),
      }
    },
    listActiveProducerRuns() {
      const active = []
      try {
        for (const workflow of PRODUCER_WORKFLOWS) {
          const stdout = runCapture('gh', ['run', 'list', '--repo', process.env.GITHUB_REPOSITORY || 'zilliztech/zdoc', '--workflow', workflow, '--limit', '30', '--json', 'databaseId,status'], {cwd: repositoryRoot})
          for (const row of JSON.parse(stdout)) {
            if (ACTIVE_RUN_STATUSES.has(row.status)) active.push({workflow, id: String(row.databaseId)})
          }
        }
      } catch {
        // An unreadable activity answer is unknown, not idle: surface it as
        // null so the dispatcher takes the safe stop instead of a failed run.
        return null
      }
      return active
    },
    getRunConclusion(runId) {
      try {
        const stdout = runCapture('gh', ['run', 'view', runId, '--repo', process.env.GITHUB_REPOSITORY || 'zilliztech/zdoc', '--json', 'status,conclusion'], {cwd: repositoryRoot})
        const row = JSON.parse(stdout)
        if (row.status !== 'completed') return null
        return typeof row.conclusion === 'string' && row.conclusion ? row.conclusion : null
      } catch {
        // Same rule as activity: unreadable means unknown, and the caller
        // takes the safe stop rather than guessing the attempt outcome.
        return null
      }
    },
    buildHandoff({groups}) {
      const outputPath = path.join(repositoryRoot, 'tmp', `dispatch-translation-handoff-${groups === 'all' ? 'all' : 'selected'}.json`)
      fs.mkdirSync(path.dirname(outputPath), {recursive: true})
      runCapture('node', ['scripts/docs-workflow/build-manual-translation-handoff.js', '--source-branch', sourceBranch, '--repository', repositoryRoot, '--locale', 'all', '--group', groups, '--output', outputPath], {cwd: repositoryRoot})
      return JSON.parse(fs.readFileSync(outputPath, 'utf8'))
    },
    countUnit(unit, {printFiles = false} = {}) {
      ensureCountingWorkspace()
      const stdout = runCapture('node', ['scripts/docs-workflow/translation-pending-count.js',
        '--repository', countingWorkspace,
        '--target', unit.target,
        '--group', unit.group,
        '--source-baseline-sha', unit.sourceBaselineSha,
        '--source-checkpoint-sha', unit.sourceCheckpointSha,
        '--target-baseline-sha', unit.targetBaselineSha || unit.sourceCheckpointSha,
        ...(printFiles ? ['--print-files', 'true'] : []),
      ], {cwd: repositoryRoot})
      const line = stdout.trim().split('\n').filter(part => part.startsWith('[translation-pending-count] ')).pop()
      if (!line) throw new Error(`pending count produced no summary for ${unitKeyOf(unit)}`)
      return JSON.parse(line.slice('[translation-pending-count] '.length))
    },
    dispatchTranslation({handoff, mode, publish, guidesMaxFiles, requestId}) {
      const repository = process.env.GITHUB_REPOSITORY || 'zilliztech/zdoc'
      runCapture('gh', ['workflow', 'run', 'translate-codex.yml',
        '--repo', repository,
        '--ref', 'master',
        '-f', `handoff_json=${JSON.stringify(handoff)}`,
        '-f', `mode=${mode}`,
        '-f', `publish=${publish}`,
        '-f', `request_id=${requestId}`,
        '-f', `guides_max_files=${guidesMaxFiles}`,
      ], {cwd: repositoryRoot})
      // Record the real producer run, not the dispatcher's own run id, so
      // triage follows the paid run; title-match the dispatch like Fetch does
      // and fail closed when the run cannot be identified (the next cycle's
      // busy-check sees the active run either way).
      const expectedTitle = `translate docs (${requestId})`
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const stdout = runCapture('gh', ['run', 'list', '--repo', repository, '--workflow', 'translate-codex.yml', '--event', 'workflow_dispatch', '--limit', '50', '--json', 'databaseId,displayTitle,headBranch'], {cwd: repositoryRoot})
        const matches = JSON.parse(stdout).filter(row => row.displayTitle === expectedTitle && row.headBranch === 'master')
        if (matches.length === 1) return {runId: String(matches[0].databaseId), requestId}
        if (matches.length > 1) throw new Error(`ambiguous producer dispatches for ${expectedTitle}`)
        runCapture('sleep', ['5'])
      }
      throw new Error(`dispatched producer run for '${expectedTitle}' did not appear in the run list before the retry bound`)
    },
    nextRequestId() {
      return `${process.env.GITHUB_RUN_ID || 'local'}-${process.env.GITHUB_RUN_ATTEMPT || 1}`
    },
  }
}

function main() {
  const args = new Map()
  for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1])
  const repository = args.get('--repository') || process.cwd()
  const outputPlanPath = args.get('--output-plan')
  const previousPlanPath = args.get('--previous-plan')
  const budget = Number(args.get('--budget') || DEFAULT_BUDGET)
  const guidesMaxFiles = Number(args.get('--guides-max-files') || DEFAULT_GUIDES_MAX_FILES)
  const dispatch = args.get('--dispatch') === 'true'
  const plan = previousPlanPath && previousPlanPath !== '-' && fs.existsSync(previousPlanPath)
    ? parseDispatchPlan(JSON.parse(fs.readFileSync(previousPlanPath, 'utf8')))
    : createDispatchPlan({generatedAt: new Date().toISOString()})
  const adapters = createCliAdapters({repository})
  return runDispatcher({
    plan,
    budget,
    guidesMaxFiles,
    now: new Date().toISOString(),
    dispatch,
    adapters,
  }).finally(() => {
    if (adapters.cleanup) adapters.cleanup()
  }).then(finished => {
    if (outputPlanPath) {
      fs.mkdirSync(path.dirname(path.resolve(outputPlanPath)), {recursive: true})
      fs.writeFileSync(outputPlanPath, `${JSON.stringify(finished.plan)}\n`)
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      const summary = summarizePlan(finished.plan)
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
        '## Translation dispatcher', '',
        `- Action: \`${finished.action}\``,
        `- Open units: ${summary.open}, dispatched: ${summary.dispatched}, cleared: ${summary.cleared}, blocked: ${summary.blocked}`,
        ...summary.rows.slice(0, 8).map(row => `- ${row.unitKey}: ${row.status} (${row.pendingCount} pending${row.lastDispatch ? `, run ${row.lastDispatch}` : ''})`),
        ...summary.rows.filter(row => row.status === 'blocked').slice(0, 8).map(row =>
          `- Blocked ${row.unitKey}: salvage with \`gh workflow run recover-translation.yml --ref master -f previous_translation_run_id=${row.lastDispatch} -f publish=false\``),
        '',
      ].join('\n'))
    }
  })
}

if (require.main === module) {
  main().catch(error => {
    console.error(String(error && error.message || error))
    process.exitCode = 1
  })
}

module.exports = {
  DEFAULT_BUDGET,
  DEFAULT_GUIDES_MAX_FILES,
  MAX_DISPATCH_ATTEMPTS,
  PRODUCER_WORKFLOWS,
  aggregateGroupTotals,
  selectDispatchGroups,
  runDispatcher,
  applyDispatchBackoff,
  createCliAdapters,
  unitKeyOf,
}
