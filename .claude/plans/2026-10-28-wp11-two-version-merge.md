# WP11 Two-Version Merge Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement the approved plan task by task. Do not begin implementation until the project owner posts rulings on this draft PR. Those comments are authoritative; record their decisions here with a new commit before writing the implementation. Do not rebase or force-push.

**Goal:** Build one shared MDX page from independently validated current and next versions, preserving existing single-version output bytes.

**Architecture:** Keep source reading, preprocessing and diagnostic attribution in adapters. Merge adapted, source-mapped Markdown with a pure block-alignment module before the existing MDX finalizer, then compile and check product names once per output manual. Keep the unchanged-page path free of merge serialization.

**Tech stack:** TypeScript, the existing markdown-it parser, md2md 1.3.0, Vitest, the existing MDX compiler, React rendering tests and local Git fixtures.

## Approved rulings — 2026-10-28

The owner approved implementation in PR #14, comment 6463394698. The following rulings supersede the original requests and conditional proposals below. The plan will be removed in a normal commit before readiness. Upstream master was fetched again and remains `19628451cda1c11e8eb1ca924eeff8ba5dc291d2`; no merge was necessary.

## Rulings on the plan (source of truth for WP11)

The plan is approved, with these rulings on R1–R7.

1. **R1 — whole-page channels: approved as proposed.** Validate both channel plans, but emit only the visible body: `next` for NEXT pages, `current` for RETIRE-IN-NEXT pages, keeping the existing page/sidebar channel metadata and the current-front-matter policy. Do not emit pairs on these pages. Standalone CLI channel propagation is not required now; keep the 12-page baseline unchanged and test whole-page metadata through the existing `fetchContext` seam.
2. **R2 — equality envelope: approved.** Strict body equality with the narrowly defined inter-block separators; front matter (current) and the canonical import union asserted separately; one note per manual when metadata differs.
3. **R3 — authored gates and code directives: approved.** Preserve their bytes inside indivisible blocks, never generate or interpret them for alignment, and apply the same channel semantics to both sides in projection tests. Treat upstream directives as compatibility behavior only; they are not an endorsed authoring pattern.
4. **R4 — duplicate heading IDs: approved.** Fail with `ADAPT_UNSUPPORTED_MARKUP` naming both origins and the repair (a `channel` transform or a heading change). No automatic suffixes or link rewriting.
5. **R5 — plan path: waived for this checkpoint.** As in WP10, remove `.claude/plans/` in a normal commit before marking the PR ready, so the final diff has no unmapped path. Do not edit the test matrix.
6. **R6 — literal tags in code: fail closed.** If a generated paired region would contain a fenced block with literal `<NextChannel` text (which the unchanged Fetch lint would reject), fail with `ADAPT_UNSUPPORTED_MARKUP` at that line, explaining the limitation. Document it in the shared-docs README. Do not change the lint or the resolver.
7. **R7 — unchanged path: approved as proposed.** Output bytes must be unchanged; call counts may drop. "Equal" means equal adapted channel content, not equal lock SHAs; characterize any case that becomes equal only after MDX patching.

Everything else in the plan is approved. Proceed with implementation, tests first, on this PR; mark it ready when done and stop.



## Review checkpoint and evidence

This commit contains a plan only. It does not implement WP11, change tests or remove pending requirement IDs. After approval, tests and implementation will use this same branch and PR. The completed PR will be marked ready, followed by a stop; no upstream PR will be opened.

Sources read:

- [WP11 task card](https://github.com/liyun95/milvus-zilliz-docs-design/blob/58d62d6f1990b443dce40bb0347ead0b0531c353/docs/implementation/tasks/WP11-zdoc-two-version-merge.md).
- At that design revision: PRD scenario 6, including errors and tradeoffs; design 04 sections on two-version merging and whole-page channels; design 02's two-pass/channel section; design 09's `MERGE_NESTED_CHANNEL` entry; WP10's insertion, provenance and plan-review decisions; implementation guide sections 2.4 and 5.
- [Merged WP10 PR #900](https://github.com/zilliztech/zdoc/pull/900), its description, and the current implementation and tests.
- Repository `AGENTS.md`, `README.md`, the code-to-test matrix and `packages/docs-tooling/src/shared-docs/AGENTS.md`.
- The current static resolver, runtime component, Fetch lint and relevant translation tests, read-only.

Base: `origin/master` at `19628451cda1c11e8eb1ca924eeff8ba5dc291d2`. The branch is `wp11-two-version-merge`, in its own worktree under `.claude/worktrees/`. The fork's previous master was an ancestor 15 commits behind; it was fast-forwarded to this exact base so the draft diff contains only this plan.

Current findings:

- `adapters/build-page.ts` runs link/image rewriting, `adaptPage`, `toMdx` and `checkProductNames` separately for each channel/manual, then rejects unequal MDX.
- `adapters/inspect-page.ts` validates both original-source transform plans before applying them. It preprocesses a normal page and, when transformed provenance is present, a carrier page. `buildPage` repeats that inspection for each manual.
- `core/site/index.ts` already emits component imports and explicit heading IDs, deduplicating IDs within one version only. It returns output-to-input line mappings.
- `adapters/mdx.ts` patches Markdown and compiles MDX. Its public `AdaptedPage` mapping can carry a merged virtual input without editing this adapter.
- The actual master group has 12 pages and 24 publish targets. Every lock has equal current/next commits. Equal locks alone are not a safe optimization: a channel-specific Cloud rule can still produce different output.

## Rulings requested before implementation

These are contradictions or unresolved contracts, not decisions made by this plan. The proposals below are conditional on the PR rulings.

### R1. Whole-page channels versus the existing Fetch lint

The card requires both a diverged page with its whole-page channel preserved and compatibility with the existing NextChannel lint. However, `packages/docs-tooling/src/lark/larkDocWriter.js::__validate_next_channel_tags` (currently around line 1353) rejects *any* such tags on `next` and `retire-in-next` pages. Its tests explicitly require those rejections. Keeping generated pairs on those pages and passing that lint with the real channel are incompatible.

Proposed resolution: still validate both channel plans, but emit only the visible version for a whole-page gate: next body for NEXT, current body for RETIRE-IN-NEXT, preserving the existing page/sidebar channel metadata. Apply the current-front-matter policy separately. This departs from the card's apparent request to retain both bodies on every page and needs approval. The alternative is retaining pairs and explicitly accepting a shared-output exception to the existing lint; that must not be presented as passing it. No change to Fetch or the lint is proposed.

The standalone build currently uses snapshot `release_channel` for transform availability but passes only `fetchContext`'s channel into `adaptPage`. Consequently, preserving an already supplied Fetch channel and adding snapshot channel emission to the standalone CLI are different changes. Proposed scope: preserve Fetch metadata and test it through the existing `fetchContext` seam; do not silently change the 12-page CLI baseline. Confirm whether standalone channel propagation is required now.

### R2. Exact two-view equality versus shared metadata and imports

Literal equality to each complete independently generated MDX file is impossible when front matter differs: the card also requires current front matter in both views. Similarly, an import used only by next must remain in the merged module, so the current view has an extra import relative to standalone current output. A NextChannel resolver does not remove imports.

Proposed resolution: require exact body equality apart from the narrowly defined block separators below; assert current front matter and the canonical import union separately. For a full-document comparison, construct each expected document with that explicit shared envelope. Never silently strip all front matter/imports or describe this as equality to unmodified standalone next bytes. Record which metadata fields differ in one note per manual. Approve this envelope rule before writing equality assertions.

### R3. Authored gates and code directives versus raw-output equality

The production resolver removes authored `include` contents and resolves channel comment directives inside fences. For example, a standalone fence containing `# next-channel-next-line` followed by `staged()` loses both lines in the current view. Comparing that view to the *raw* standalone fence cannot pass using only blank-line normalization. The PRD also forbids channel markers in shared upstream source, while the card asks what happens if source or content contains directives.

Proposed resolution: WP11 does not generate, interpret for alignment, or rewrite code directives. Preserve their bytes within the indivisible code block/group. For projection tests, apply the same channel semantics to the standalone expected body and the merged body. Test Cloud directives and upstream directive pass-through as compatibility behavior, without endorsing new upstream channel authoring. Keep fenced literal `<NextChannel>` examples literal. This clarification needs approval; it must not be hidden in a whitespace normalizer.

### R4. Duplicate heading anchors versus preservation of both views

Independent adaptation can produce the same explicit ID for different headings, such as `## A B` and `## A-B`. A moved heading emitted once in each exclusive region can also duplicate an ID. Renaming a next ID would break byte equality and can require rewriting links; sharing differing headings would change visible text.

Proposed bounded policy: accept distinct anchors unchanged; detect duplicate IDs across the complete emitted page and fail with existing `ADAPT_UNSUPPORTED_MARKUP`, both conflicting origins and repair guidance. Do not invent a new error catalog entry or silently rename IDs. This means some moved headings cannot be merged even though moved paragraphs can. If reviewers prefer deterministic next suffixes and local-link rewriting, explicitly approve the corresponding equality exception and link scope first. The deferred NEXT heading/TOC timing issue and promotion-time anchor migration remain out of WP11.

### R5. Plan location versus test-matrix scope

The required plan under `.claude/` is not mapped by `pnpm test:for-change`: the exact path in this PR produces `Workflow test matrix has no entry for: .claude/plans/2026-10-28-wp11-two-version-merge.md`. The proposed implementation paths all map to `shared-docs` and master ownership.

Root instructions require closing matrix gaps, but modifying `scripts/docs-workflow/test-matrix.json` is forbidden by this task. Requested ruling: authorize a narrowly scoped matrix entry plus its human-readable counterpart, or explicitly waive mapping for this plan-only document. This PR must report the selector failure until resolved. No matrix file will be changed without authorization.

### R6. Existing markup and the limits of the lint/projection contract

The Fetch tag lint scans raw text, including fenced examples, while the static resolver excludes fences from JSX tag interpretation. Thus a literal tag example inside a generated code-region wrapper can look nested to the lint, although it is not nested JSX. The static resolver also uses a fixed triple-fence regexp rather than a full Markdown parser. There is no scoped permission to fix either implementation.

Proposed policy: retain literal code bytes, cover the supported fence grammar with the real resolver, and report an unsupported case if the unchanged lint/resolver cannot satisfy the two-view contract. Do not encode or delete literal examples to make tests pass. Reviewers should confirm whether such inputs should fail or remain a documented existing limitation. `MERGE_NESTED_CHANNEL` remains reserved for an actual authored gate in a generated gated region, not text in code.

### R7. Meaning of the unchanged fast path

The card requires the same path/output when the versions agree, but also asks to remove duplicate preprocessing and compile/check the merged page only once. Literal preservation of the old call graph would violate those requirements. Proposed interpretation: preserve all generated bytes and the existing single-page finalizer, while intentionally reducing invocation counts. Equality means equal adapted channel content after transforms/filtering, not merely equal source SHAs. Characterize any case where different adapted inputs become equal only after MDX patching; do not silently claim it is covered by a pre-finalizer string comparison.

## Planned file boundaries

All paths below are relative to `packages/docs-tooling/src/shared-docs/`, except this plan. No dependency addition or shared-type ownership change is planned.

| File | Responsibility |
| --- | --- |
| `core/merge/types.ts` | Merge-local input, block, origin, note and result types. |
| `core/merge/segment.ts` | Parser-based source spans, container coalescing and exact separator ownership. |
| `core/merge/align.ts` | Deterministic block LCS and unmatched runs. |
| `core/merge/index.ts` | Fast path, envelope assembly, paired wrappers, nested-gate and anchor checks. |
| `adapters/inspect-page.ts` | Separate per-channel transform/preprocess preparation from per-manual product filtering; keep public inspect source-only. |
| `adapters/build-page.ts` | Merge after site adaptation, compose provenance, finalize once, aggregate image data and notes. Add `BuiltPage.notes` here. |
| `core/transforms/index.ts` | Fix dedent's initial prefix to use the first nonblank line. |
| `core/transforms/provenance.ts` | Only if necessary, expose the existing mapping/filter data required for shared preparation; preserve carrier failure checks. |
| `commands/build.ts` | Include notes in the JSON summary without modifying MDX or `images.json` on equal-version builds. |
| `testing/merge/*.test.ts`, `testing/merge/render.test.tsx`, `testing/merge/demo.ts` | Segmentation, alignment, projection, rendering, integration and reproducible demo. |
| `testing/transforms/{engine,build}.test.ts`, `testing/build/build.test.ts` | Dedent, preprocessing parity/call counts, replacement of obsolete unequal-output failure assertions and error attribution regressions. |
| `fixtures/merge/delete-entities/` and `fixtures/errors/merge-nested-channel/` | Clearly labeled assertion fixtures and exact source-location error cases; no goldens. |
| `spec/pending.json`, `README.md` | Remove approved covered IDs and document this package's merge behavior and its limits. |

Read-only integrations: `core/site/`, `core/product-names/`, `adapters/mdx.ts`, the static resolver, runtime components, Fetch lint, translation protection and existing replay harness. If these cannot support an approved requirement, stop and request the needed scope instead of editing them. No changes to `spec/requirements.json`, `fixtures/golden/`, real `shared-docs/` inputs, `lark/`, `scripts/docs-workflow/`, `.github/workflows/`, `apps/docs/` or `packages/docs-ui/`.

## Merge placement and data flow

For each page:

1. Read and validate both locked sources. Validate both transform plans against their own original inventories before applying either. Preserve one diagnostic per failing channel, including an unqualified selector that fails only on next.
2. Apply transforms and strip markers once per channel. Preprocess each channel once as a preparation phase. With transformed provenance, this phase still has the existing normal invocation and carrier invocation: four md2md preprocess calls for two channels, rather than eight for two manuals. Untransformed pages retain two calls. The carrier's decoded-byte equality and failure behavior remain mandatory.
3. For each manual, derive a fresh filtered view of that preparation using the existing filter semantics; do not mutate shared prepared lines or source registries. Keep available-channel validation per target, including inconsistent target channels as a negative case.
4. Retain per-channel link/image rewriting, product-source collection and `adaptPage`. Adaptation produces Cloud-specific headings, Tabs, alerts, front matter and imports. Keeping these stages before merge makes block identity correspond to emitted content and preserves WP10's locations.
5. Pass the two successful adapted results, composed origins and shared envelope inputs to pure `core/merge`. Exact equal adapted content returns the current adapted bytes without segmentation or serialization. Do not shortcut on lock equality. Merge differing bodies under the approved whole-page and anchor policies.
6. Call the existing `toMdx` once per manual, preserving its Fetch front-matter option. Call `checkProductNames` once on the final merged MDX with source evidence from both channels. Union imports in the existing `Admonition`, `Tabs`, `TabItem` order, based on components retained in the result. `NextChannel` is globally registered and gets no import. Do not emit ESM imports inside wrappers.
7. Merge images, accepted image bytes and notices through the existing deterministic manifest logic. Preserve the paired-read/image-change checks, including next-only images. Only successful full-page results reach the existing atomic output writer.

Why not merge final MDX: the current finalizer would already have compiled and scanned each channel, imports could be duplicated inside gated regions, and source spans would have been patched. Why not merge raw Milvus input: transforms, product filtering and site adaptation change block contents and boundaries; the result could gate an entire source group whose rendered content is identical.

### Diagnostic mapping without modifying the MDX adapter

Build a virtual pre-adaptation input by concatenating the current and next input-line arrays. Keep a parallel registry from each virtual line to its original channel, source/content/YAML file and line. Translate each retained adapted output-line reference into that virtual input; generated imports and wrapper lines map to `null`. The merged `AdaptedPage` can then use the existing `toMdx` contract. Map its reported virtual line back through the registry in `build-page.ts`; never report an invented content-file location for a generated wrapper.

A common block retains origins for both channels. Source diagnostics that apply to both versions expand into separate current/next errors rather than losing channel identity. The one product-name scan uses the final MDX hits plus a channel-indexed source registry to avoid attributing a current-only hit to next just because the spelling appears elsewhere. Preserve the existing test where only a shared variable fails on next while source and fragment text fail on current. Carrier/multiline-expansion limitations remain exactly as documented in WP10.

For `MERGE_NESTED_CHANNEL`, find the actual authored opening tag in a changed block before wrapping and compose its adapted line with WP10's original content-file map. Report that tag's file/line and channel with guidance to use a channel transform. A handwritten gate in an LCS-matched block remains byte-for-byte unchanged. A one-sided generated region counts as a gated region too; nesting is not allowed merely because the other side is empty.

## Segmentation, alignment and emission

### Parser-based blocks

Use existing markdown-it with source maps. Remove the recognized generated front-matter/import envelope from block comparison without serializing the rest of the page. Keep exact source slices and a line/offset map; do not render tokens back to Markdown and do not split on blank lines.

- A top-level heading, paragraph, complete ordered/unordered list, complete table, blockquote/admonition, fence and HTML block is one unit. List nesting, item spacing and fenced examples inside a list remain within that list.
- A balanced `<Tabs>...</Tabs>` is one unit, including every TabItem, fence and internal blank line. A one-language change therefore pairs the entire group. A balanced `<Admonition>...</Admonition>` is similarly indivisible.
- Markdown-it alone stops some HTML blocks at blank lines. Coalesce token spans using balanced container boundaries, ignoring tag-looking text inside parser-identified literal code, inline code and comments. Do not treat a partial opening HTML token as a complete Tabs block. Preserve nested supported containers as part of the outer unit.
- Treat a balanced authored NextChannel region as indivisible. For inline authored tags, the surrounding paragraph is the unit. Record actual gate-token spans separately for nested-gate detection.
- Capture reference definitions through parser rule source positions, including definitions that do not produce ordinary block tokens. Retain opaque HTML/comment source spans. Require complete coverage of all non-separator bytes; never silently drop syntax that the tokenizer does not recognize. Unsupported or ambiguous grouping fails with a located existing adaptation diagnostic.

Each block carries `kind`, its exact text slice, source spans and channel origins. Separators are separate records containing only parser-confirmed inter-block blank lines. Internal blank lines stay inside their block, including list looseness and code spacing.

### Stable longest-common-subsequence alignment

Block equality is exact `kind` plus exact block bytes, not semantic HTML equivalence, trimmed text or a hash alone. Run a suffix dynamic-programming LCS, with memory/time proportional to the product of the block counts. Reconstruct from the start: match equal blocks whenever they participate in the optimal solution; for equal-length unmatched alternatives, consume current first. The test suite fixes this tie-break, including repeated identical paragraphs.

Between successive common blocks, collect the maximal unmatched current run and next run. Emit current in one exclude wrapper, then next in one include wrapper; omit an empty side. Emit common blocks once, retaining current spelling. No inline diff, sentence splitting or code-language splitting occurs.

Moves are deletion plus insertion when not selected by the LCS. Example, where A/B/C are complete distinct paragraphs:

```text
current: A B C
next:    B A C
output:  exclude(A), shared(B), include(A), shared(C)
```

Both projections recover their original order. Never force a moved block into a single shared location that changes either sequence. For repeated blocks, deterministic matching is essential; include empty documents, all-replaced documents and multiple moves in tests. Heading moves additionally obey R4.

### Wrapper and separator grammar

Each generated opening and closing tag occupies its own line, at top level, with one empty line between the tag and the first/last content line. Use exactly `action="exclude"` or `action="include"`, double quotes, no additional attributes and no self-closing forms:

```mdx
<NextChannel action="exclude">

Old paragraph.

</NextChannel>

<NextChannel action="include">

New paragraph.

</NextChannel>
```

Preserve each block's interior bytes. Reuse or synthesize only inter-block separation. This prevents list continuation across a wrapper and allows Markdown inside JSX containers to parse normally. Non-ASCII text, trailing spaces for hard breaks, CRLF/LF behavior, code indentation and terminal-newline differences get explicit assertions.

### The actual lint contract

Fetch calls `__validate_next_channel_tags` and `__validate_channel_code_directives` from `larkDocWriter.js::__write_page`, currently around lines 1513-1514. The tests live in `larkDocWriter.next-channel.test.js`. Tag rules require balanced tags, the exact action-only attribute grammar, no nesting and a CURRENT page. Code directives have a separate five-comment-style grammar and reject nested, unmatched or mismatched regions.

Tests under `testing/merge/` will invoke these existing methods with generated examples, without touching their source or invoking Fetch/network operations. Regular CURRENT-page output must pass both. Single-channel pages and literal tag examples need the R1/R6 rulings; do not test them under a fabricated `current` channel to conceal failures. `core/` imports no Lark code.

## Exact two-view oracle

Use three separate assertions, so a normalization cannot hide a merge defect:

1. **Structural reconstruction:** using the merge's generated-region manifest, remove only generated gates and compare retained block slices/order with the appropriate adapted input. Authored gates and code directives remain byte-exact at this layer. Assert that generated gates do not split a block and that no non-separator byte is lost or duplicated.
2. **Channel projection:** current projection must use the production `resolveNextChannelCurrentView` from `apps/docs/plugins/next-channel-view.js`. Next projection is a test-only independent walker that unwraps include, drops exclude, preserves literal code tags and resolves existing directive lines for next using the established five styles. Pin it against hand-written expected cases and runtime rendering, not merely against the merge implementation. For inputs containing authored gates/directives, project the standalone expected input as well, subject to R3.
3. **Envelope:** require the exact current front matter plus the expected canonical, deduplicated component imports. Compare all front-matter fields; sort changed field paths deterministically and issue one note when they differ. A title/description change cannot be disguised as whitespace. This is the explicit R2 exception to full standalone-document equality.

Define normalization `N` on a parsed projected body as an ordered sequence of `(block kind, exact block bytes)`. Discard only runs of empty lines that the parser/source-span map identifies as being *between* complete top-level blocks, plus empty edge padding introduced by generated tags. Treat blank lines inside any block as content. A newline terminating a nonblank line, a spaces-only line, trailing spaces, indentation, inline spacing, punctuation, HTML attributes and a code-fence body are never normalized. Preserve whether the last source line was terminated unless it is solely generated boundary padding. The implementation must track boundary bytes explicitly if a parser node span excludes a terminal newline.

Subject to R1-R3, require:

```text
N(currentView(mergedBody)) == N(currentView(standaloneCurrentBody))
N(nextView(mergedBody))    == N(nextView(standaloneNextBody))
mergedFrontMatter        == standaloneCurrentFrontMatter
mergedImports            == canonicalUnion(required retained components)
```

For ordinary inputs without authored gates/directives, the standalone projection is the identity. If neither metadata nor imports differ, the complete projected MDX differs from its standalone version only at the specified separators. Never use global `trim()`, `\s+` replacement or blank-line removal over the whole document as an oracle. Add negative tests that mutate a code blank line, a list blank line, two trailing spaces, a literal tag and a heading ID; each must fail equality.

Use fixed-seed generated sequences of valid blocks and a batch of adversarial deterministic cases. For each pair assert repeatable merge output, both projections and unchanged input objects. Cover insertion/deletion, replacement, adjacent runs, repeated blocks, moves, front-matter-only changes, component-only changes, equal SHAs with channel-specific transforms and different SHAs with identical rendered bodies. Keep seeds and the minimized failing fixture in test output.

## Heading anchors and rendering

Keep unchanged headings and distinct renamed headings at their independently adapted IDs. In paired regions, the old heading keeps its old ID and the new heading keeps its new ID. Inspect the full assembled heading set, including headings nested in alerts and authored channel regions. Check duplicate IDs and local links under the approved R4 policy; do not silently append suffixes.

Use the real NextChannel component in tests with the deployment-channel hook mocked to current/next. Compile/evaluate merged MDX and assert rendered lists contain the expected list items, alerts contain their expected content, and Tabs preserve all language panes and code. Use existing Docusaurus theme components where the test harness supports them; any test substitutes must be explicitly identified and must not be claimed as full site/browser coverage. Verify each channel hides the opposite sentinel and that current server rendering contains no next-only sentinel.

The unchanged component's default/prerender channel is current. The existing TOC behavior and deferred issue #864 are not fixed here. Compilation plus DOM/SSR assertions establish block rendering, not the deferred scroll timing contract.

Translation remains out of scope. Root README's block-level gating section states that JSX tags are protected and translation checks gate/action parity. Existing `scripts/translation/validate-translation-file.test.js` accepts retained gates and rejects dropped/flipped gates; run it read-only and cite its actual results. Whole-page routing/translation propagation stays in the existing pipeline. Removing `6-7`/`T13` from pending per the card closes this work package's contribution, not promotion cleanup or a new all-locale publication claim: filtering was WP10; promotion is WP13.

## Tests-first implementation sequence after rulings

Every implementation task starts by adding concrete failing tests, running that focused file and retaining the failure, then making the minimum production change and rerunning it. Keep incremental commits on this PR. File-level subprocess tests use `vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })`.

### Task 1. Characterize the current boundary and fix preprocessing follow-ups

- [ ] Add `testing/merge/unchanged.test.ts`: same source/lock and separately different commits with the same content return the current single-version bytes, no generated wrappers and no notes. Include equal SHAs with a next-only transform as a required diverged counterexample.
- [ ] Add a leading-blank-line content-file case in `testing/transforms/engine.test.ts`: input `\n    first\n      second` must preserve its leading blank and relative indentation while dropping the common four-space indent. All-blank input stays safe. Set dedent's initial prefix from `lines.find(line => line.trim()) ?? ''` and keep the existing common-prefix reduction.
- [ ] Add preprocessing spies in `testing/transforms/build.test.ts`, asserting two normal calls plus two carrier calls for two transformed channels and two manuals, with unchanged Guides/BYOC filtered bytes. Keep normal/carrier mismatch and carrier-failure tests green.
- [ ] Refactor `inspect-page.ts` preparation/filtering and `build-page.ts` callers without changing public `commands/inspect.ts`. Test per-manual view isolation and both-channel validation before images.
- [ ] Run `pnpm vitest run packages/docs-tooling/src/shared-docs/testing/transforms packages/docs-tooling/src/shared-docs/testing/build packages/docs-tooling/src/shared-docs/testing/inspect.test.ts` and commit the validated follow-up.

### Task 2. Implement pure segmentation and deterministic alignment

- [ ] Add `testing/merge/segment.test.ts` with whole lists, tables, alerts, Tabs with internal blank lines, nested fences, HTML/comments, reference definitions and literal tags. Assert exact span coverage and original byte slices.
- [ ] Add `testing/merge/align.test.ts` for the explicit A/B/C move, repeated equal blocks, additions/deletions, ties and all-replaced/empty sides. Assert the exact aligned indices and maximal unmatched runs.
- [ ] Implement `core/merge/{types,segment,align}.ts` using the rules above. Add no filesystem, process, network or adapter imports.
- [ ] Run `pnpm vitest run packages/docs-tooling/src/shared-docs/testing/merge/segment.test.ts packages/docs-tooling/src/shared-docs/testing/merge/align.test.ts packages/docs-tooling/src/shared-docs/testing/core-boundary.test.ts` and commit.

### Task 3. Add wrapper emission, view properties and merge diagnostics

- [ ] Add literal `[6-1]`, `[6-2]`, `[6-4]` and `[MERGE_NESTED_CHANNEL]` tests in `testing/merge/merge.test.ts` and `testing/merge/views.test.ts`; adjust pending entries together with real coverage so the ledger remains honest.
- [ ] Add the unchanged authored-gate success case, a gate moved into an unmatched run, a next-only insertion containing a gate, and a gate inside a code example. Assert content-file line attribution and no partial output on actual nesting.
- [ ] Add heading collision and directive cases exactly as ruled; add the strict normalization negative tests before implementing the oracle.
- [ ] Implement `core/merge/index.ts`, preserve the equal-input fast path, and check generated CURRENT-page outputs against the unchanged Fetch lint from tests.
- [ ] Run `pnpm vitest run packages/docs-tooling/src/shared-docs/testing/merge packages/docs-tooling/src/shared-docs/spec/coverage.test.ts` and commit.

### Task 4. Integrate finalization, metadata notes and channel diagnostics

- [ ] Add `[6-3]` cases: an unqualified rule fails only on next, both fail once each, and final product errors preserve channel/file attribution. Add failure atomicity assertions and once-per-manual compile/check spies.
- [ ] Add `[6-6]` cases for title/description differences and identical metadata. Assert exact current envelope, one deterministic note listing changed fields, and summary output. Define merge-local notes as `{ code: 'MERGE_FRONT_MATTER_CURRENT', fields: string[], message: string }`; these are nonfatal notes, not a new requirement error code. Add `notes` to `BuiltPage` in `build-page.ts` and summary entries in `commands/build.ts`.
- [ ] Add `[6-5]` fixtures through `fetchContext` for NEXT and RETIRE-IN-NEXT, including diverged bodies and channel/sidebar metadata. Implement only the approved R1 policy.
- [ ] Replace the old WP11-failure assertion in `testing/transforms/build.test.ts` with successful projection assertions, retaining its public inspect check. Keep all existing build/product-name/image tests.
- [ ] Integrate `build-page.ts` with one `toMdx` and one product-name check per manual, composite provenance, canonical imports and existing image aggregation. Feed notes to CLI output only; Fetch receipt notes remain WP9b.
- [ ] Run `pnpm vitest run packages/docs-tooling/src/shared-docs/testing/merge packages/docs-tooling/src/shared-docs/testing/build packages/docs-tooling/src/shared-docs/testing/transforms packages/docs-tooling/src/shared-docs/testing/product-names` and commit.

### Task 5. Render, demonstrate and document

- [ ] Add `[6-7][T13]` rendering cases for lists, alerts and Tabs in both channels and a next-only transform on unchanged locks. Add an import used only by next and assert one shared declaration, outside gates.
- [ ] Copy the pinned Delete Entities original into `fixtures/merge/delete-entities/`, recording upstream commit and raw hash. Derive a clearly labeled synthetic next snapshot by changing one paragraph, adding a parameter explanation and changing one code example. Keep all pilot and golden files unchanged.
- [ ] Add `testing/merge/demo.ts` to create committed local source versions, minimal local dev inputs and copied group configuration, invoke the real `shared-docs build` CLI, then preserve merged MDX and both projected views. No credentials, uploads or Base writes. Tests assert the exact sentinels and restoration results.
- [ ] Update the package README with approved merge rules, notes, errors, directives, anchor limits, preprocessing behavior and the demo command. Remove exactly `6-1` through `6-7`, `T13` and `MERGE_NESTED_CHANNEL` from pending once their literal tests exist, documenting cross-package limits. Never edit `requirements.json`.
- [ ] Run `pnpm test:shared-docs` and commit the validated demo and documentation.

## Proving the 12 existing pages are byte-identical

This proof is required before readiness and has not been run at this plan checkpoint. It is separate from semantic/projection tests: **no normalization is allowed here**.

1. Preserve a clean baseline checkout at the exact base SHA above, under `.claude/worktrees/`. Install the pinned lockfile in each checkout. Record Node/pnpm/md2md versions and both tooling SHAs.
2. Export `shared-docs/guides/` from that baseline unchanged into a shared immutable input directory; hash every input file and record its Git tree. Assert exactly 12 pages, 24 publish targets and equal lock pairs. Preserve the actual spelling `decay-ranker-oveview`.
3. Use one complete local Milvus `v3.0.x` history, recording its exact tip and verifying every lock commit is present and reachable. The current locks use `3e6b7499cbfcb6b5a365fb1f084a74836f625fc2`, `e510bc82f633015f48145a8335cd8eba9fe47821` and `32f3fc864d5ebf3b4407d924b6cd0ec16dfc274e`. Do not repin locks to the tip or replace real sources with the synthetic demo.
4. Authenticate one retained dev content/Guides-snapshot input at a recorded commit, using available Git objects or retained artifacts read-only. Both builds consume the identical snapshot. No Fetch workflow is dispatched and no real dev branch is updated. If retained input is unavailable or lacks any of the 12 pages, report the exact gap; do not fabricate navigation or describe a smaller comparison as the 12-page proof.
5. Run the same command in baseline and implementation checkouts, varying only the fresh output directory. The environment variables below name prepared evidence inputs, not live services:

   ```sh
   pnpm docs-tooling shared-docs build \
     --shared-docs "$WP11_GROUP_INPUT" --repo "$WP11_MILVUS_REPO" \
     --dev "$WP11_DEV_SNAPSHOT" --out "$WP11_OUTPUT"
   ```

6. Require both exit codes to be zero. Compare complete relative file sets and each raw file, including all 24 MDX outputs and `images.json`; any additional emitted files also join the comparison. No golden updates, line-ending conversions or whitespace cleanup. Retain logs, input hashes and sorted per-file output SHA-256 manifests.

   ```python
   from pathlib import Path
   import hashlib, sys

   before, after = map(Path, sys.argv[1:3])
   paths = lambda root: {p.relative_to(root) for p in root.rglob('*') if p.is_file()}
   assert paths(before) == paths(after)
   assert sum(p.suffix == '.mdx' for p in paths(before)) == 24
   assert Path('images.json') in paths(before)
   for path in sorted(paths(before), key=str):
       a, b = (before / path).read_bytes(), (after / path).read_bytes()
       assert a == b, str(path)
       print(hashlib.sha256(a).hexdigest(), path)
   ```

7. Re-hash inputs and check both worktrees to prove the comparison did not mutate them. Report page/output counts, total bytes, zero differences, input identities and aggregate manifest hash in the PR. CLI summary text may gain notes; distinguish it from generated files. If external images occur, retain/pin downloaded bytes or use the existing injected fetcher with those same authenticated bytes in both lanes; never upload to the image store.

## Validation and handoff

Before each edit run `pnpm test:for-change -- <every proposed repository-relative path>`. At final handoff also run `pnpm test:for-change -- --base origin/master --head HEAD`; use the complete command union and resolve R5 explicitly. New merge/tests/fixtures currently select:

```sh
pnpm test:shared-docs
pnpm typecheck
pnpm test:workflow-matrix
git diff --check
```

Additional required implementation checks:

```sh
pnpm test:replay:shared-pages
pnpm test:workflow-policy
pnpm test:rest-publication-contract
node --test apps/docs/plugins/next-channel-view.test.js
node packages/docs-tooling/src/lark/larkDocWriter.next-channel.test.js
node --test scripts/translation/protectedContent.test.js scripts/translation/validate-translation-file.test.js
```

The shared-pages replay must remain hermetic, using its local bare remote and fake image store. Preserve its report/evidence root and counts; do not label it a new production or retained-artifact replay. WP11 does not alter Fetch/publication behavior. If implementation discovers a required publication change, stop for scope approval and then follow the root runbook's retained-checkpoint preflight, exact-state restoration, inventories/builds and isolated-remote evidence procedure. Never use real `origin` as a replay remote.

Plan-checkpoint checks already run on unmodified base code:

| Command | Result |
| --- | --- |
| `corepack enable` and `pnpm install --frozen-lockfile` | Passed, pnpm 10.33.0. |
| `pnpm test:shared-docs` | 51 files passed; 614 tests passed, four existing opt-in HTTP image tests skipped. |
| `pnpm typecheck` | Passed. |
| `pnpm test:workflow-matrix` | 16 passed. |
| Selector for proposed shared-docs implementation paths | Passed; all master-owned; command union above. |
| Selector including this plan path | Failed with the unmapped plan path; R5 is unresolved. |
| Two-version tests, 12-page before/after proof, final replay and broader implementation checks | Not run; implementation awaits PR rulings. |

Before readiness, write the PR in the implementation guide's six sections, explicitly identify skipped checks and evidence gaps, and begin “How to try it” with `gh pr checkout` for this fork PR. Include a Git alternative and the synthetic two-version build demo with expected paired output and projection files. Use repository-relative commands and no local machine paths. Record approved decisions directly, without links to fork comments. Keep the diff within the approved paths, report final Git/worktree status, mark the same fork PR ready and stop.
