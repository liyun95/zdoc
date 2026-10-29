# WP9b Fetch follow-ups implementation plan

**Status:** Plan only; implementation waits for rulings posted on the fork draft PR. Those comments are the source of truth. No implementation, fixture, catalog, generated content, or workflow changes are included in this commit.

**Goal:** Deliver the shared-docs whitespace correction separately, then add receipt-based regeneration protection, recorded-image reuse, persistent Feishu aliases, conditional activation reads, receipt notes, accurate link reporting, and executable requirement accounting.

**Architecture:** Keep page generation and clean replay in the source job, authenticated prebuilt bytes in the existing source/table handoff, and final receipt/output checks in the checkpoint transaction. Continue using page-local paired fallback and the existing production publication queue. Keep I/O in adapters and Fetch modules, never in shared-docs core.

**Stack:** Node.js, TypeScript, Vitest, node:test, pinned pnpm 10.33.0, the installed locked md2md dependency, local Git replay repositories.

## 1. Inputs and delivery gates

Read the [WP9b card](https://github.com/liyun95/milvus-zilliz-docs-design/blob/main/docs/implementation/tasks/WP9b-zdoc-fetch-followups.md), including its final Decisions section, before implementation discovery. Read only its listed design sections: WP9 publication protections and planning item 6; WP9 walkthrough known/production problems; design 05 receipts/publication protection; 05b active state/inbound links; 02b images; 09 publication/cutover errors; PRD 4-3, scenario 9 and publication protection; implementation guide 2.1, L4 and section 5. Also follow the repository README/runbook and both applicable AGENTS.md files.

Verified on 2026-10-29:

- `git fetch origin master` advanced the remote-tracking branch to `8404678a8ec6dc91c890b367b6c243426bd4cd80`.
- [Upstream WP11 PR #921](https://github.com/zilliztech/zdoc/pull/921) is merged; its merge commit is that upstream tip, and the ancestry check passed.
- `wp9b-fetch-followups` was created from that exact tip in `.claude/worktrees/wp9b-fetch-followups`. The primary checkout and unrelated worktrees were left untouched.
- The fork remote is `liyun95/zdoc`. All PRs for this task target that fork's `master`, never upstream.
- There are 15 page configurations in the pinned master tree. The three removal pages pin both versions to Milvus commit `c57ca852d73015743db78748695351fcb5423639`.
- No `.codegraph/` exists in the primary or task checkout; ordinary source search was used.
- The task card blob is `f84299b8b9e61eea7271df1e62971921f34ada03`; design `main` was `d78666ade1d1a63f4adcf624fdcbcb49cb5af752` when checked. Re-read the card and PR rulings before implementation if either changes.
- Fork `master` was `19628451cda1c11e8eb1ca924eeff8ba5dc291d2`, 41 commits behind this upstream baseline with zero fork-only commits. Fast-forward it to the verified baseline before opening the plan PR, so the review diff contains this plan alone.

### Required sequence

1. Commit this single plan as `wip: WP9b plan`, push `wp9b-fetch-followups` to `fork`, open a draft titled `feat(shared-docs): WP9b Fetch follow-ups`, and stop for PR-comment rulings.
2. After rulings, fetch `origin master`, create `wp9b-1-shared-docs` from `origin/master` in its own `.claude/worktrees/` directory, and implement WP9b-1 tests first. Open its separate fork PR, complete its checks, mark it ready, and stop. No upstream PR or maintainer message is sent by this task.
3. Resume WP9b-2 only after the user says WP9b-1 merged upstream and passed a real Fetch. Record the upstream merge, successful Fetch run/attempt, tooling/config SHAs, dev baseline/result SHA, and retained artifact IDs/digests. Check that the actual Fetch used the whitespace fix and successfully published the affected pages; parent-run success alone is insufficient.
4. Merge the refreshed `origin/master` into `wp9b-fetch-followups` normally; never rebase or force-push. Implement WP9b-2 tests first on this branch. The existing draft becomes its implementation PR.
5. Do not finalize the WP9b-2 retained-output comparison before step 3. Preserve both pre-fix and post-fix identities so expected whitespace changes cannot hide new changes.

No real-dev Fetch dispatch, image-store upload, Base write, paid Translation, production push, or real card send is authorized here. All publication replay uses a local bare remote. No edits to workflow triggers/concurrency/permissions, `apps/docs/`, or `packages/docs-ui/`. Stop for a ruling if those paths appear necessary. Do not alter real page configs or generated publication state.

## 2. Rulings required before implementation

The following are observed conflicts or missing contract details, not decisions made by this plan. The proposals below make the choices reviewable; apply the eventual PR-comment ruling.

| ID | Evidence / contradiction | Proposed ruling to review |
|---|---|---|
| R1 | WP9b-2's allowed paths exclude shared-docs implementation, but `FetchBuildContext` and the call to `rewriteLinksAndImages` live in `adapters/build-page.ts`; `ActivePage` and the exact-key validator live in `core/handoff/source-state.ts`; alias indexing lives in `adapters/handoff/routing.ts`. The validator rejects `feishu_aliases` today. | Permit narrowly scoped WP9b-2 edits to those three files, `commands/build.ts` only if dependency plumbing requires it, and their existing build/handoff/link tests. Keep WP9b-1 limited to whitespace/dead-code/catalog work. |
| R2 | The card requires an `IMAGE_SOURCE_CHANGED` card notice, but `scripts/collect-build-card-notes.js:sharedPublicationNote` hardcodes `SHARED_ANCHOR_UNKNOWN` for every notice. This file is outside the card's allowed `scripts/docs-workflow/` root. | Permit that formatter and `scripts/collect-build-card-notes.test.js` to render typed shared notices through the existing card path. Tests inspect payloads; no live sends. |
| R3 | Root instructions require release-operator changes in `README.md` and matrix gaps fixed in the same change. The card does not list README or the human-readable matrix, and the new `.claude/plans/2026-10-29-wp9b-fetch-followups.md` path is unmapped. | Approve README, `scripts/docs-workflow/test-matrix.json`, its selector tests, and `.claude/specs/2026-08-31-docs-workflow-code-test-matrix.md` as narrow supporting changes. This explicitly requested plan-only commit reports the failed selector; it does not silently expand scope to fix it. Resolve the mapping before implementation is declared L1-complete. |
| R4 | Design 05b says active state changes only at activation/removal and is copied otherwise; it also says activation fetches the old document unconditionally. The final task card explicitly adds alias backfill and conditional reads. `sharedPagePublication.js` currently enforces byte-for-byte old-entry equality. | Implement the card's explicit exceptions; retain immutable page/record/token/anchors/activation-run fields and permit only authenticated alias enrichment. Document the design discrepancy without editing the design repository. |
| R5 | The card says only requirement `9-3` text differs. The live exported catalog also changes `OWNERSHIP_REVERTED.when` and `source.prd_commit` from `1556bf513b68ab7831efed8debd6f423a18b0dfb` to `5b5d49a3276c64ed328b11762799a28749abaefe`. Catalog blob: `b294ef851076ecd06797c77c4007f4ac97b61b1b`. | Copy the complete authoritative catalog verbatim, retaining its provenance. Do not hand-edit it to force a one-field diff. |
| R6 | The final card removes ten Fetch-covered IDs from pending, but the root README reserves several for WP14. Actual `T06` is pending under WP9, not WP14. Some acceptance IDs include behavior beyond the Fetch tests. | Follow the final Decisions section for scanning/tagging/removal, while stating remaining WP14/dev-PR/old-writer coverage separately and retaining the full site/browser evidence gate for T06. Do not claim all Phase 1 acceptance is complete. |
| R7 | The card requires a Guides artifact-only real Fetch; the implementation guide L4 additionally requires an SDK artifact-only Fetch when record parsing/Fetch flow changes. The user forbids this agent from running Fetch against real dev. | Maintainers supply both applicable real-run evidence sets, with `publish=false` and no image writes. This task runs neither. Maintainer production Fetch after WP9b-1 remains a separate user-confirmed sequencing gate. |
| R8 | Some active records may lack a recoverable pre-activation snapshot/cache. No source specifies whether incomplete aliases should block the page or merely report a warning. | Preserve every previously known alias and all old activation fields; never guess an alias or query a deleted document just to recover it. Propose a page-local fallback plus an actionable incomplete-alias diagnostic for a migrated legacy record whose evidence cannot be recovered. A genuinely new record with `feishu_token: null` legitimately has `[]`. Await ruling on fallback versus warning-only and diagnostic naming. |
| R9 | Design 05 specifies exact tool versions for historical replay. The card also requires the whitespace fix to pass Fetch before WP9b-2 compares retained outputs. It does not explicitly distinguish validating the new candidate receipt from comparing an old published receipt using newer tooling. | The live gate replays the new candidate receipt with its pinned tools/inputs; the post-WP9b-1 retained run supplies the qualification baseline. Replay historical receipts with their recorded tool identity; label a comparison under new WP9b-2 tooling as an upgrade comparison, not an exact historical replay. Never compare genuinely changed source inputs against old output hashes as a publication veto. Confirm this interpretation. |
| R10 | WP5 chooses a recorded digest but build-page currently insists observed bytes match the chosen digest. The card does not define what happens when the original URL fails entirely or the accepted object is missing/corrupt. | Use hash-verified accepted object bytes for recorded digests; a successful changed-source read yields a notice, not failure. Preserve explicit missing/corrupt accepted-image failure; do not replace accepted content. Keep existing original-source read failure behavior unless the owner explicitly approves offline recovery when that URL is unavailable. |

## 3. WP9b-1: scoped shared-docs change

### Cause and minimal fix

`core/transforms/index.ts:planTransforms` emits an empty `lines` replacement for a level-0 `remove`, consuming the opening marker through the closing marker. `applyPlan` keeps both surrounding source blank lines. `stripMappedMarkers` calls `normalizeBlockSeparators`, but `core/transforms/spacing.ts` only collapses runs containing a `blockSeparator` sentinel, currently emitted for `add` only.

Use that same boundary mechanism for whole-block removal: emit one blank `MappedLine` carrying `blockSeparator: true` and the transform's origin. After markers are stripped, normalize only the blank run touching that marker. Interior runs become one empty line; runs at either document edge disappear. Do not globally trim or normalize Markdown, code fences, unrelated blank lines, language removal, or line removal. Keep source mappings valid for later diagnostics.

Files: `core/transforms/index.ts`, `core/transforms/spacing.ts` (comment/contract), `testing/transforms/engine.test.ts`, and `testing/transforms/provenance-fetch.test.ts` if needed for mapped-line assertions, all under `packages/docs-tooling/src/shared-docs/`.

- [ ] Add failing `[4-3]` tests for `Before\n\n<block>\n\nAfter` producing exactly `Before\n\nAfter`, leading/trailing removals leaving no edge blank line, and all-content removal producing an empty body.
- [ ] Add adjacent remove/remove and add/remove cases, an unrelated multi-blank run, a code-fence body with blank lines, and unchanged provenance for surviving source lines. Use existing `execute`, `block`, and `body` helpers.
- [ ] Run `pnpm vitest run packages/docs-tooling/src/shared-docs/testing/transforms/engine.test.ts` and record the expected failing spacing assertion.
- [ ] Implement the local separator sentinel; rerun transform and provenance tests. Keep every unaffected golden byte unchanged.

### Expected real-page byte changes

Compare both manuals for all 15 master configurations using exactly the same pinned inputs on both sides. At Milvus lock `c57ca852d73015743db78748695351fcb5423639`, each listed removal has one empty source line on each side:

| Page | Removed block boundaries | Expected MDX change per manual |
|---|---|---|
| `lindera-tokenizer` | `lindera-compile-prerequisites` | One excess empty line removed between the POS-filter discussion and Configuration: one LF byte fewer. |
| `stop-filter` | `stop-words-sources`, `stop-words-file-resource` | Two excess empty lines removed: after Configuration and before Examples; two LF bytes fewer. |
| `decompounder-filter` | `decompounder-overview`, `decompounder-word-list-sources`, `decompounder-file-resource` | Three excess empty lines removed: before Configuration, after Configuration, and before Examples; three LF bytes fewer. |
| Other 12 pages | No removal transforms | Exact byte equality in every emitted output. |

These are expected counts from inspected source boundaries, not completed generation results. Acceptance must use actual file bytes and SHA-256, including complete path-set equality. Do not use whitespace-insensitive diffs as the oracle. For the six affected manual outputs, assert that each diff hunk only removes the enumerated blank line; no changed nonblank byte, front matter, link, code, or metadata. If actual counts differ, preserve evidence and report the discrepancy instead of widening the allowlist.

- [ ] Pin the Milvus `v3.0.x` checkout and all page locks, master configuration tree, dev inventory, dependency version, and image responses. The latest branch tip is recorded but never substituted for `lock.yaml`.
- [ ] Generate all 15 pages before/after in separate clean output directories under a preserved evidence root, using actual master `shared-docs/guides/` and the same dev and Milvus inputs. Use the existing build command/API and a fixture-only comparison driver under shared-docs testing if one is needed. Any Git worktrees stay below `.claude/worktrees/`.
- [ ] Save path/hash/size inventories and exact unified diffs. Report unchanged-page count, changed-page count, per-manual LF deltas, and input identities in the WP9b-1 PR. No generated output is committed to master.

### Dead code and requirements

- [ ] In `adapters/build-page.ts`, remove `BuildFailure`, the unused local `failures` array, all empty `failures` properties, and the always-false `failures.length` condition. In `commands/build.ts`, remove iteration over `result.failures`; retain error printing and nonzero exit behavior. Search current callers/tests for the type/property before editing; update only affected assertions within shared-docs.
- [ ] Copy design `docs/implementation/requirements.json` byte-for-byte to `spec/requirements.json` after R5 is settled. Record the source commit/blob and exact diff. No pending IDs are removed in WP9b-1.
- [ ] Run `pnpm test:shared-docs`, `pnpm typecheck`, `pnpm test:workflow-policy`, `pnpm test:replay:all`, the complete path selector union, and `git diff --check`. Fix regressions without changing Fetch behavior in this PR.
- [ ] Open the separate fork PR, use the required six description sections, include the real-page comparison, mark ready only after checks, then stop.

## 4. WP9b-2: receipt-based regeneration and transaction validation

Primary files: `scripts/docs-workflow/guides-shared-sources.js`, a proposed `scripts/docs-workflow/guides-shared-regeneration.js` with a focused `.test.js`, `packages/docs-tooling/src/lark/sharedPageBundle.js`, `sharedPagePublication.js`, `scripts/docs-workflow/guides-shared-publication.js`, and `fetch-publication-selection{,.test}.js`. Extend existing replay fixtures/harness rather than inventing a separate publication architecture. Register a new helper/test in the matrix and assembly fingerprint/test if needed.

### Inputs and boundary

Run the independent rebuild inside `generateSharedSources`, after candidate generation/receipt construction and before successful outcome admission, image upload, source sealing, or table publication. Materialize a fresh replay directory; do not reuse the first run's built objects, generated MDX, prepared-image maps, mutable source tree, or output digest cache.

| Receipt field | Replay source and verification |
|---|---|
| `inputs.zdoc.commit/files` | Exact master configuration blobs from Git. Verify every recorded SHA-256, including page/lock, content files, variables, links, product rules and Tabs rules. |
| `inputs.milvus_docs.current/next/files` | Exact two commits from the retained upstream repository and recorded per-version files/fragments. Verify hashes; no fallback to current branch HEAD. |
| `inputs.dev.commit/files` | Exact baseline Git tree, including Cloud page inventories, source snapshot and retained shared authority. Restore/hydrate recorded blobs and verify their hashes. No live-dev reads. |
| `inputs.fetch.navigation` | Drafts currently contain only a digest; resolve it against `input_context.navigation`/`bundle.navigation` and verify the digest. Final receipts contain the full immutable navigation object. Reconstruct per-record targets, labels/order/channel and retained extension from those authenticated inputs and the receipt output set, not today's Base. |
| `inputs.fetch.image_base_url` | Exact recorded base URL, validated as an explicit safe URL; no environment-default substitution during replay. |
| `inputs.tools` | Exact tooling SHA and installed md2md version; assert tool identity rather than silently using whatever is installed. Qualification comparisons label any intentionally different tooling separately (R9). |
| `inputs.images` | Source-to-digest/object map and hash-verified accepted bytes from isolated scratch or retained accepted-object fixtures. Replay does not redownload mutable origins or upload images. |
| `outputs` | Exact `(manual,path)` set, extension, and SHA-256 of full UTF-8 bytes. Compare each output and reject missing/extra files, not only the first mismatch. |

The current navigation projection omits a full raw source tree, while `planFetchTargets` consults writer/source placement. Use the authenticated navigation and receipt output paths to reconstruct the build target context independently, and verify them against the candidate's existing path contract. If inspection shows any further render-affecting input is absent, record an explicit receipt-format ruling before implementation; do not derive it from mutable live sources.

### Detecting the existing whole-page image replacement

Today `guides-shared-sources.js` uses `output.mdx.split(address).join(base + '/' + address)`. That changes matching strings inside fenced/inline code as well as actual image destinations. Running that same replacement twice would reproduce the defect and falsely pass comparison.

The replay oracle must apply the image base only to parsed image-reference destination spans (Markdown images and HTML `img src`) outside code, using the existing reference collector's code exclusions. It must not call the producer's whole-page replacement. Keep initial production candidate bytes available for comparison, so the existing broad replacement is detected and the page falls back. A later replacement of that production operation with structured rewriting requires an explicit ruling if included in this task; the card asks for detection, not an unreviewed broader output change.

- [ ] First add `[PUBLISH_REGEN_MISMATCH]` tests: change one receipt output digest; mutate one emitted output; omit/add an output; include a real image plus the exact `shared/<sha>.<ext>` string and original URL in fenced/inline code; corrupt an input inventory. Assert file-specific diagnostic evidence and no adoption of the bad candidate.
- [ ] Include a valid sibling in both-manual fallback tests. A mismatch restores the failing page's exact baseline output(s), receipt, active state, and navigation; a new failed page remains absent. Successful siblings still publish. Partial runs still cannot promote a successful cache.
- [ ] Compare direct bytes as well as hashes; report page, manual, output path, expected/actual hash and relevant `page.yaml`/source file. Do not translate a known mismatch into generic build failure.
- [ ] Retain bounded regeneration evidence with the bundle, binding it to the same receipt-input digest/output set. Revalidate it through bundle loading and assembly without trusting an unbound `passed: true` field.

### Checkpoint integration

`fetch-publication-selection.js:validationCommands` already adds this command for English Guides:

```sh
node scripts/docs-workflow/guides-shared-publication.js --operation validate --snapshot packages/docs-tooling/src/lark/meta/snapshots/guides-uat-last-success.json
```

Extend that exact validation contract to cover the final receipt/input identity and actual output bytes associated with the source replay. Keep it in the returned command list; add assertions for inclusion, tamper rejection, and absence from unrelated groups/sites. Do not add a redundant second invocation or regenerate at table/checkpoint time. Checkpoint validation remains offline and independent of source-job scratch. Post-seal tampering safely rejects the transaction; the source-stage mismatch is where page-local fallback is chosen.

Preserve legacy no-shared checkpoints and authenticated requested-closure continuation. A requested Fetch that does not touch shared owners copies retained bytes; it is not a reason to regenerate or upload them. Existing older receipts must remain readable; any strengthened validation must distinguish legacy authority from new replay evidence without inventing a successful replay for old artifacts.

### Explicit image base

Remove the silent production default at shared generation and uploader construction. Validate an explicitly supplied `IMAGE_BED_URL` before accepting selected shared work; missing/invalid configuration fails Guides as an infrastructure error, not merely a page fallback. Test the real CLI/environment path and uploader path. All fixtures pass an explicit test URL. Preserve the early no-shared path, with no new output or service calls; confirm through R9/PR review if the owner intends the environment requirement to cover ordinary-only Guides runs too.

## 5. Recorded images and receipt notes

### Previous receipt and accepted bytes

In `generateSharedSources`, before `runBuild`, locate the page through pinned baseline `active.json` and the corresponding baseline snapshot record. Read `generated/en/manifests/shared-pages/guides/<page>.json` from `baselineRoot`, using existing safe receipt readers plus published receipt/snapshot/output validation. Never treat a source-stage receipt draft or unauthenticated cache manifest as the previous receipt. First activation has an empty recorded map.

Construct `new Map(previousReceipt.inputs.images.map(image => [image.source, image.sha256]))`. Pass it through the approved Fetch build context/runtime boundary to the existing `rewriteLinksAndImages({ ..., recorded })` call in `adapters/build-page.ts`. Keep the map page-scoped and reuse across both manuals/current-next so a mutable URL cannot acquire inconsistent accepted digests.

The WP5 core already selects the recorded digest and emits `IMAGE_SOURCE_CHANGED`. However, the Fetch adapter currently throws `Missing accepted image bytes` if observed bytes differ. Separate observation from accepted bytes: retain the observed response for the notice; obtain the old accepted bytes by the receipt's recorded object/base URL using a read-only adapter, verify SHA-256, and provide those bytes as `imageContents`. The existing upload stage then only sees content matching the selected digest. It can read/verify an existing object and must never overwrite it. Fake fetch/store adapters cover all tests; no real upload is performed.

- [ ] Add a two-run fixture: first receipt accepts A at URL U; second origin response is B at the same U. Expect the A digest/address and unchanged MDX, exactly one deduplicated typed notice, successful publication, and no upload of B. Verify both manuals/current-next and a repeated image occurrence.
- [ ] Test unchanged bytes, a genuinely new source URL, invalid previous receipt, missing/corrupt accepted object, and ordinary no-shared behavior. Apply R10 to unavailable-origin behavior.
- [ ] Carry `BuiltPage.notices` into `bundle.notices`, final `guides-shared-publication.json`, and the approved existing card formatter. Include page/source URL/recorded/observed digest and the `IMAGE_SOURCE_CHANGED` code. It is a notice, not `failures`; no failure status or cache suppression solely for that notice. Preserve unknown-anchor notices.

### BuiltPage.notes

`BuiltPage.notes` contains `MergeNote` objects (`code`, `message`, `fields`); the existing receipt schema requires `notes: string[]`. Serialize notes deterministically as English strings containing the code/message and sorted field names, deduplicated across the paired outputs. Do not change the receipt schema to object notes by accident. If the manuals yield distinct notes, keep both with manual context.

Pass the resulting strings to `receiptDraft`, replacing its unconditional `notes: []`. Final assembly already copies the draft before materializing navigation; assert it preserves notes through sealing, final receipt, cache and checkpoint. Tests use different current/next front matter and assert current wins plus one explanatory receipt note; identical front matter leaves `[]`. Existing page MDX stays unchanged.

## 6. Persistent aliases and conditional old-document reads

### Where aliases come from

Use stable `record_id`/`base_record_id` ownership. Collect only nonempty Feishu IDs from `doc_token`, `node_token`, `origin_node_token`, `obj_token`, plus retained `feishu_token` and existing `feishu_aliases`. Deduplicate and sort deterministically. Never record `base_<table>_<record>`, `shared-<page>`, a page-directory URL, or a token from another record as a Feishu alias.

For a new activation of a previously Feishu-owned record:

1. Read the last successful Feishu snapshot record from `preparation.previous_snapshot` before the Docs flip.
2. Join frozen legacy source-cache entries by `base_record_id`; explicitly exclude the new `source_kind: shared-page` record. Inspect all matching legacy entries and detect conflicting owners rather than using an ambiguous single `find` result.
3. Combine the four alias fields. Preserve the existing `feishu_token` choice (`doc_token || node_token || null`) for compatibility. Genuinely new pages get `null` and `[]`.

For existing active entries, the current Docs URL is already a Git page-directory URL and cannot recover the old IDs:

1. Start with the active entry's old token/aliases, then available same-record frozen Feishu source-cache evidence.
2. Read the prior receipt's pinned `inputs.dev.commit` snapshot if it still contains the Feishu record. For older activations, follow retained receipt/snapshot history on ancestors of the pinned dev commit to the last successful Feishu-owned record. Do not scan unrelated branches or infer from today's Base link.
3. Preserve the exact historical commit/file hash or authenticated source-cache identity used for each alias. Include the bounded evidence needed for offline bundle/checkpoint verification. Missing Git objects/history/cache is a reported gap, never a reason for a network fallback inside the publication validator.
4. Apply the owner's R8 ruling when evidence is insufficient. Preserve all known tokens; do not write fabricated completeness or mutate real dev by hand. A future successful Fetch may retry enrichment.

Update aliases before route preparation/body skipping when evidence is available at that boundary, then carry the authenticated enrichment into source generation, effective active state, offline table writers, final assembly and requested continuation. Persist changes only with a successful page checkpoint. Fallback pages retain exact baseline active entries.

### Consumers and authority

Under the R1 scope exception, extend `ActivePage` and `validateActiveState` with an optional legacy-compatible `feishu_aliases` input; newly written entries contain the array including non-null `feishu_token`. Validate token shapes, duplicates, cross-record collisions, null/new-page behavior and unknown fields. Old entries with no array continue to read.

Update `adapters/handoff/routing.ts` alias indexing; `sharedPageFetch.js:activationDraft`; `guides-shared-sources.js` referring-table selection and unknown-anchor notices; `larkDocWriter.js` body/shim/fallback resolution; and `sharedPagePublication.js` active provenance checks. Audit all `feishu_token === ...` consumers, including continuation, to ensure they use any alias while retaining the scalar field.

The old publication check `equal(old, new)` must become an explicitly bounded, evidenced alias-only enrichment check (R4): no change to page/record/token/anchors/activated_in, no dropping known aliases, no foreign owner, and no unverified additions. Bundle validation must authenticate evidence before final state is written. This is not permission to relax unrelated publication checks.

### Fetch old headings only when needed

Build current inbound references first, from `readCurrentSources(candidate)` and current navigation `placement_type: ref`, matching every recovered alias. Preserve all references for referring-table rerender selection. Filter only for deciding whether headings are needed: `references.some(reference => reference.anchor)`.

Only call `fetchOld` for first activation with such anchored references; share the existing one-read promise cache. With no anchors, skip the call entirely and publish an empty anchor map even if the old document is deleted. Existing active pages never refetch old headings; unknown later anchors remain top-of-page notices. If anchored references exist and current headings are unavailable/missing in either manual, retain the existing paired `ACTIVATE_CHECK_FAILED` fallback.

Five old-document-failure fixtures in `scripts/docs-workflow/guides-shared-sources.test.js` need real current anchored inbound links so their original fallback purpose survives:

1. `fallback derives retained baselines from the legacy source when snapshot output_paths are absent`.
2. `cold cache old-document failure preserves both manual baselines while a sibling succeeds` (only the failing page needs a read; the unlinked sibling does not).
3. `table cleanup conserves exact old fallback paths absent from current traversal and table artifact binds their bytes`.
4. `authenticated fallback preserves exactly the historical target set, including a legitimate one-target page`.
5. `failed transition retains exact baseline record and sidebar path under stable table rename` (put the anchor in the current graph, not only historical navigation).

Also change the separate successful-build test's unconditional `reads === 1` expectation to zero when unlinked; strengthen the direct `unlinked` activation case with a throwing fetch stub. Preserve replay cases that already supply current body/Base-ref anchors. Add explicit tests for deleted unlinked legacy docs, page-top-only links, every alias link form, repeated anchors, and existing-active no-read behavior.

## 7. Broken-link report

`canonicalLinkAuditor.js:buildCanonicalMap` already consumes `routingContext.aliasesByToken`, but that map currently depends on one active token or aliases still present in a snapshot/cache. Populate it from the authenticated full active alias set and ensure the audit receives the run-effective routing state after activation/enrichment. Inspect `lark/index.js` audit ordering/callers before changing it; do not suppress errors globally.

Test `docx/<obj_token>`, wiki and origin-node references to an active page with no old source body. They must render `./<page>` (or its known mapped anchor), and must not appear in `guides-broken-content-links.json` as missing canonical. Unknown destinations must still be reported. Include new activation, existing active state, fallback, and conflicting-alias cases. Keep canonical owner/publish-target validation intact.

## 8. Executable requirement coverage

Keep recursive `.test.ts`/`.test.tsx` discovery within shared-docs. Add an explicit repository-relative allowlist in `spec/coverage.ts` for exactly these shared-Fetch `.js` test files; do not recursively count all workflow/lark tests:

1. `scripts/docs-workflow/guides-shared-sources.test.js`
2. `scripts/docs-workflow/guides-shared-regeneration.test.js` (new focused replay tests)
3. `scripts/docs-workflow/replay-shared-pages.test.js`
4. `scripts/docs-workflow/fetch-publication-selection.test.js`
5. `packages/docs-tooling/src/lark/sharedPageRouting.test.js`
6. `packages/docs-tooling/src/lark/sharedImageUploader.test.js`
7. `packages/docs-tooling/src/lark/canonicalLinkAuditor.test.js`
8. `packages/docs-tooling/src/lark/incrementalSharedReceipts.test.js`

Resolve paths relative to the module/repository root, not the process CWD. Missing allowlisted files must fail discovery. Parse actual `node:test` declarations with the existing TypeScript AST approach; use literal bracketed IDs in executable test titles. Do not count comments, assertion strings, skipped tests/suites, or `test(..., {skip:true/todo:true}, ...)`; extend skip detection for the node:test options form. Test explicit inclusion, exclusion of unrelated `.js`, arbitrary CWD, missing file and skipped-test behavior in `spec/coverage.test.ts`.

Remove exactly these twelve IDs from `spec/pending.json` in WP9b-2, after tests have real assertions and the scan passes:

| IDs | Executable evidence |
|---|---|
| `9-1`, `ACTIVATE_CHECK_FAILED` | Current body/Base-ref anchor validation and paired fallback in source tests and full replay. |
| `9-2` | Real route selection/source skip/atomic activation tests in routing and replay. |
| `9-3`, `OWNERSHIP_REVERTED` | Existing revert/removal/demotion/unpublishable-record rejection tests. |
| `9-6` | Current Base navigation labels/order/channel and paired writer-output assertions. |
| `T06` | Replay's concrete Tabs/languages/link/anchor/image/edit-entry output assertions, plus required separate real site/browser evidence; do not label the default test a browser run. |
| `OWNERSHIP_PATH_MISMATCH`, `OWNERSHIP_CONFIG_MISSING` | Existing selected path/config failure and sibling/fallback tests. |
| `PUBLISH_IMAGE_UPLOAD_FAILED` | Immutable uploader/readback failures and before-seal whole-Guides failure. |
| `PUBLISH_REGEN_MISMATCH` | New independent clean-replay mismatch tests plus page-local fallback and checkpoint mutation rejection. |
| `IMAGE_SOURCE_CHANGED` | New two-run accepted-image notice/reuse test. |

The first ten are the card's existing Fetch coverage list; the last two are new WP9b behavior. `4-3` is already covered and stays so; `9-3` catalog synchronization belongs to WP9b-1 but its pending removal belongs to WP9b-2. Do not remove `T07`, `T08`, `T09`, `T10`, retirement, old-writer or other WP14/WP15 entries. Tagging a test is accounting, not proof that omitted acceptance cases have run.

## 9. Validation and byte-identity evidence

For each implementation task: write the failing test, run and record its failure, implement the smallest change, rerun the focused suite, then commit. No tests or implementation are added before the plan rulings.

### No Docs link is a page-directory URL

Use `replay-shared-pages.js`'s existing `--comparison-baseline-sha` facility with the exact pre-WP9b-2 upstream commit containing WP9b-1. Run two isolated lanes with identical fixed time, Base records, Feishu blocks, source cache, anchored refs, images and initial Git state. Exercise valid and malformed inactive shared configs and cold/warm source caches. Compare exact path sets and bytes for emitted content, sidebars, source files and published snapshots; require zero shared generation/image-store calls and no empty shared authority directory. Do not compare synthetic receipts against nonexistent ordinary receipts. No Docs links plus existing active entries is an ownership reversal and must still fail as before.

### Activated pages

After the required WP9b-1 Fetch, obtain retained source/table/checkpoint artifacts read-only. Preflight each checkpoint archive, record run/attempt/artifact identities and downloaded digests, authenticate master/dev/upstream/tool identities and all receipt inputs, and restore the exact generated state. Use a local bare Git remote with production push targets absent. Missing artifacts, objects, accepted image bytes, or inputs are evidence gaps; never substitute current inputs or fabricate a passing result.

Replay all retained successful shared pages through clean generation and the local checkpoint transaction. Compare all receipt-declared output paths byte-for-byte to retained post-WP9b-1 outputs and to the pre-WP9b-2 lane. Expect no MDX difference. Alias arrays, input/tool identities, notes and notices may change intentionally; report their exact metadata diffs separately. The only accepted MDX differences across the whole two-PR delivery are WP9b-1's six manual outputs and enumerated LF removals.

Preserve the evidence root and report the exact command, baseline/candidate SHA, artifact identity, verified input count, successful/fallback/mismatch counts, compared page/file count and every mismatch. Never replace real retained evidence with the synthetic replay report.

### Commands and gates

Run the selector before edits for every changed path, then for the complete committed diff:

```sh
pnpm test:for-change -- --base origin/master --head HEAD
pnpm test:shared-docs
pnpm typecheck
pnpm test:workflow-policy
pnpm test:replay:all
git diff --check
```

Run the full command union printed by the selector, including focused node tests, `test:guides-workflow`, workflow matrix and contract tests; the representative discovery query also selects `deploy/contracts/fetch-translation-workflow.test.mjs`, lark scraper/writer regressions, requested planning, source snapshot and incremental tests. Do not replace this union with only the shared-docs suite. Map each new helper/harness path in the machine/human matrices after R3; reuse the existing stable replay suite rather than adding a scheduled workflow or changing workflow permissions.

Before final handoff, perform the README's real-artifact replay/inventory/build gates in the exact isolated checkout and verify `apps/docs/node_modules/jiti` exists. Run English including Japanese and Chinese validation separately where required by the selected replay contract. Existing site/browser mode must use a retained successful local replay baseline; record any skipped mode honestly. Do not edit application/UI code to make evidence green.

After local validation, maintainer-run L4 artifacts remain an external merge gate under R7. Include the prescribed six PR sections: Summary, Requirements covered, Tests, Golden output changes, Deviations from the design, How to try it. All prose, code, comments, commits and PR discussion are English. PR descriptions use repository-relative commands and no local absolute paths or links to fork review comments; record accepted decisions directly.

## 10. Plan-stage checks and evidence gaps

Completed in the new task checkout before this plan was committed:

- `corepack enable` and `pnpm install --frozen-lockfile`: passed.
- `pnpm test:shared-docs`: 60 files passed; 764 tests passed, 4 skipped (768 total). This is unchanged-baseline evidence, not WP9b implementation evidence.
- `pnpm test:workflow-policy`: 118 passed, zero failed/skipped.
- `pnpm typecheck`: passed.
- Representative implementation-path selector query: passed, returned master ownership and the command union described above.
- Selector for the new plan path: failed with `Workflow test matrix has no entry`. R3 records the exact unresolved scope/matrix conflict. The complete plan-diff selector cannot be reported as passing until resolved.

Not run at plan stage: WP9b implementation tests, replay:all, real 15-page before/after generation, real retained-artifact replay/builds/browser checks, or maintainer Fetch. No output-comparison result is claimed. The user explicitly requires stopping at the plan draft PR, so these belong to the later authorized stages.

At handoff, report the draft PR, commit, clean/dirty worktree state, actual checks, and pending rulings. Keep the task worktree for those rulings. Do not begin WP9b-1, mark this draft ready, dispatch Fetch, or message maintainers while waiting.
