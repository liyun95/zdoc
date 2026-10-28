# WP10 Transforms Implementation Plan

Status: awaiting owner review. No implementation or tests have been written.

**Goal:** Implement validated block, language, and code-line transforms in the shared-docs build pipeline, preserve accurate source diagnostics, and prove that the five existing pages retain identical output bytes.

**Architecture:** Compile transforms into an immutable edit plan against each channel's original, marker-bearing source. Apply the plan before marker removal and whole-page preprocessing. Carry source provenance through preprocessing, inserted-content filtering, and the existing links, site adaptation, and product-name stages.

**Stack:** TypeScript, Vitest, js-yaml, the existing Markdown scanners, and pinned `@zilliz/mdtomd@1.3.0`.

Implementation will proceed inline, tests first, only after this plan and the decisions below are approved.

## Starting state and sources

- Ran `git fetch origin master` in the main checkout. The baseline is `c3260d68715b151102dfc64a88cbe1c60e137864`.
- Branch `wp10-transforms` and its worktree already existed at exactly that baseline. The owner authorized reusing them while preserving the existing plan.
- Worktree: `/Users/liyun/zdoc/.claude/worktrees/wp10-transforms`.
- Preserved `.claude/plans/2026-10-28-wp10-transforms.md`; its SHA-256 before this review plan was written is `661669d41ebd947505444822ff697fd5e704bcbf7f2636b579b1a059500cc5f5`.
- Read the [WP10 card](https://github.com/liyun95/milvus-zilliz-docs-design/blob/aecfa5ef57885c43f28e2e52ee2b9375153e2d3d/docs/implementation/tasks/WP10-zdoc-transforms.md) first, then its listed design sections. The design repository's observed `main` is `aecfa5ef57885c43f28e2e52ee2b9375153e2d3d`.
- Read root `AGENTS.md`, `README.md`, the ownership contract and test matrix, and `packages/docs-tooling/src/shared-docs/AGENTS.md`. There is no `.codegraph/` in this worktree.
- Read relevant implementation and tests, including the existing Feishu filter methods without changing them. The card's historical `lark/larkDocWriter.js` path is now `packages/docs-tooling/src/lark/larkDocWriter.js`.

## Decisions required before implementation

These are findings and proposals for review, not decisions already made.

1. **Product-filter semantics conflict.** The card requires `<include target="zilliz.paas">` to appear only in BYOC and asks for the existing Feishu semantics. Both legacy methods instead use `targets.split('.').includes(tagTarget)`: for `zilliz.paas`, `paas` and `zilliz` match, but `zilliz.paas` does not. In addition, `categorize_node` uses a skip-depth counter whose nested behavior can differ from the recursive Markdown filter. Proposed resolution: keep the legacy component targets, additionally accept an exact full target, and evaluate well-nested standalone tags with a proper stack. Differential tests would pin agreement with `__filter_content` for the legacy supported cases and explicitly document the full-target extension and any nested mismatch. No legacy code would change. Owner approval is needed for this scoped divergence. Malformed/unbalanced standalone tags also lack a specified failure code; proposed code: `TRANSFORM_CONTENT_MARKUP` at the content-file line.

2. **Repeated `add` versus duplicate-target conflicts.** PRD scenario 4 and design 02 explicitly permit multiple additions at the same position in list order, but also prohibit multiple transforms on the same target; design 02 additionally prohibits overlapping line selections. Proposed resolution: allow repeated zero-width additions at the same boundary in list order, while rejecting repeated replace/remove, intersecting consuming edits, and parent/child overlap. Please confirm whether the repeated-add exception also covers identical code-line anchors, or only block-adjacent additions. The implementation will not silently choose the exception's scope.

3. **Deleting required/default languages.** PRD/design 02 say removal of a required or default language fails. Design 07 and current WP4 enforce required languages only while the result is multi-language and use the first configured available language when the default is absent. Thus removing Python from Python+Java currently leaves a legal standalone Java fence, whereas removing it from Python+Java+shell fails. Proposed resolution: preserve WP4 unchanged and use a remaining multi-language group for the card's `TABS_REQUIRED_MISSING` test. If removal must fail even after reducing to one language, that requires an expressly approved transform-only precondition. The result of removing the last language also needs a ruling; proposed behavior is to remove the now-empty code group, not leave an empty switcher.

4. **T04's real-language fixture is incomplete.** The retained `fixtures/pilots/openai/.../openai.md` has only Python credential/function examples. The PRD also demonstrates Java, while the card asks for replace/add in every language using this retained input. Proposed resolution: retain a real Python assertion fixture copied with only named markers added, and add clearly labeled synthetic multi-language credential cases, including the PRD's Java form and alias coverage. These must not be represented as C3-aligned real inputs or golden outputs. Alternatively, supply an approved pinned multi-language source. Do not claim T04 complete until the owner accepts the evidence definition.

5. **Public `inspect` command scope.** `commands/inspect.ts` currently calls `inspectPage` without content files, Tabs rules, a manual, or Base release-channel context. It is outside the card's allowed paths. Proposed scope: WP10 enables transforms through `shared-docs build`; retain explicit source-inspection behavior for the existing CLI, with the new transform context passed by `buildPage`. Document that distinction. If the CLI must show transformed output too, approve a separate expansion to `commands/inspect.ts` and specify its manual/channel inputs before it is changed.

Other documented scope differences: PRD scenario 4 permits page-directory images, but this card explicitly defers them; channel merging/promotion remains WP11/WP13; scenario 4's general statement that absent source languages never appear conflicts with its explicit language-add example. The plan follows neither ambiguous statement implicitly: language addition and local-image rejection are requested WP10 behaviors, and these differences will be recorded in the PR.

No change to `lark/`, `scripts/docs-workflow/`, or `.github/workflows/` is currently necessary. If implementation or the selected checks reveal that one is necessary, stop and explain the reason before editing it.

## Files and responsibilities

All paths below are repository-relative. Existing WP4/WP5/WP6 rule modules remain unchanged.

| File or directory | Responsibility |
| --- | --- |
| `packages/docs-tooling/src/shared-docs/core/types.ts` | Typed operation, target and content unions; shared transform context and diagnostic provenance types as needed |
| `packages/docs-tooling/src/shared-docs/core/config.ts` | Validate transform fields and legal combinations using the existing YAML document positions |
| `packages/docs-tooling/src/shared-docs/core/transforms/types.ts` | Immutable source spans, edit plans, supplied content-file data and pure execution results |
| `packages/docs-tooling/src/shared-docs/core/transforms/validate.ts` | Block/language resolution, aliases, content shape, channel applicability and conflicts |
| `packages/docs-tooling/src/shared-docs/core/transforms/lines.ts` | Exact line matching, common-indent removal and preserved source indentation |
| `packages/docs-tooling/src/shared-docs/core/transforms/apply.ts` | Stable edits against original offsets, marker-aware ranges and deterministic insert order |
| `packages/docs-tooling/src/shared-docs/core/transforms/filter.ts` | Approved include/exclude semantics, restricted to inserted content |
| `packages/docs-tooling/src/shared-docs/core/transforms/provenance.ts` | Pure provenance composition for edits, stripping and expansion; diagnostic remapping |
| `packages/docs-tooling/src/shared-docs/core/transforms/index.ts` | Small validation/planning/application interface |
| `packages/docs-tooling/src/shared-docs/adapters/inspect-page.ts` | Integrate transforms, validate both channels before applying, invoke md2md and attach provenance |
| `packages/docs-tooling/src/shared-docs/adapters/build-page.ts` | Supply build context, use manual-specific transformed inputs, remap downstream diagnostics and supply WP6 sources |
| `packages/docs-tooling/src/shared-docs/commands/build.ts` | Extend `readSharedDocs` to load and confine referenced Cloud content files |
| `packages/docs-tooling/src/shared-docs/testing/transforms/` | Focused schema, edit, filter, provenance, pipeline, receipt and OpenAI tests; reproducible demo |
| `packages/docs-tooling/src/shared-docs/fixtures/transforms/` | New synthetic and explicitly attributed assertion fixtures |
| `packages/docs-tooling/src/shared-docs/fixtures/errors/` | Sixteen transform/line failure fixtures with exact file and line expectations |
| `packages/docs-tooling/src/shared-docs/spec/pending.json` | Remove only the fully tested WP10 IDs |
| `packages/docs-tooling/src/shared-docs/README.md` | Author-facing transform syntax, diagnostics, limitations and demo |

The current build test asserting unconditional WP10 rejection must become a schema-invalid-transform test; retain its atomic-output assertions. Other existing test changes stay inside `testing/`.

## Pipeline and atomicity

For build calls, `inspectPage` receives already-read content files, Tabs rules, and release-channel availability from `buildPage`; pure core code receives no filesystem path resolver, Git client, network client, or legacy writer.

1. Parse all configuration and lock data. Load each locked source and run `parseBlocks` then `inventoryBlocks` on the original marker-bearing text.
2. Validate and compile the entire transform list separately for `current` and `next`. Unqualified rules participate in both; explicitly qualified rules participate only in their channel. Validate explicit channel availability using the retained Base record or existing `FetchBuildContext`, never a live Base query. `NEXT` forbids `channel: current`; the existing `RETIRE-IN-NEXT` availability is the inverse.
3. Resolve all block, fence, line, content and overlap checks before applying any edit in either channel. A valid rule followed by an invalid rule returns only errors, with no partially transformed page and no link/image stage.
4. Apply successful plans to the marker-bearing source, remove surviving named-block markers, and invoke `md2md.preprocess` on the complete page with the Cloud variable table and the locked fragment snapshot.
5. Filter only inserted-origin regions (including their fragment expansions) separately for `guides` / `zilliz.saas` and `guides-byoc` / `zilliz.paas`. This follows design 02's expand-then-filter order. Source-origin regions are not product-filtered. Carry each manual's source map with its text.
6. Pass each final manual/channel input through the current link/image preparation and rewriting, adaptation, MDX compilation and WP6 product-name checks. Retain existing shared reader and image-download caches; different manual content is naturally a distinct preparation key.
7. Compare current/next final MDX per manual exactly as today. Different bytes still produce the existing `two-version merging requires WP11` failure. The command's existing staged write remains all-or-nothing.

For absent or empty `transforms`, use the existing build path and calls unchanged. This is reinforced by regression tests and actual baseline/candidate builds, not assumed from branching alone.

## Target selection and execution details

- Use the existing `inventoryBlocks`, `fencesIn` and `codeGroupAt` behavior, including list-contained fences. Do not replace them with a new top-level-only regex scanner.
- The parser's mixed coordinates are explicit: for `startLine = s`, `endLine = e`, the opening marker index is `s - 1`, the content is zero-based half-open `[s, e - 1)`, and the closing marker index is `e - 1`. Whole-block replacement keeps the marker envelope until the strip stage; removal consumes the envelope. Test file-start/file-end blocks, adjacent blocks, terminal newline and list indentation.
- Normalize both `target.language` and source/content fence languages through the supplied `cloud-sdk-tabs.yaml` aliases; e.g. `cpp` and `c++`, `curl` and `bash` designate the same language. No hard-coded alias table.
- Language content must contain exactly one fence of the requested canonical language, with no switcher or unrelated prose. A whole-group replacement supplies the complete group, including the switcher for multiple languages.
- Match `target.lines` only within the original selected fence body. Remove each line's leading spaces/Tabs and trailing whitespace for comparison, preserving internal characters and comment spacing. Require exactly one contiguous match of at most five lines.
- Remove YAML block-scalar terminal line endings before matching/writing; do not strip inline `#` or `//` code comments. Reject internal blank lines, triple backticks and named-block markers in both line fields. Validate the five-line limit on the selector, not by silently truncating it.
- Remove the exact common whitespace prefix of new lines, prepend the target first line's exact indentation, and preserve relative indentation. Tests assert 8/12 spaces and literal Tab bytes, including fences indented within list items.
- Plan edits against original coordinates and emit once in document order, using the rule index to break insertion ties. Do not modify the text and then relocate later rules. Limit whitespace cleanup to changed boundaries; never normalize the whole document.
- Detect attempts to target a language or code region introduced by another rule as `TRANSFORM_ON_INSERTED`. Original-source matching remains authoritative regardless of rule order. Conflicts are checked per channel and according to decision 2.

## WP4 interaction: verified behavior

`core/blocks.ts:codeGroupAt` uses the `multipleCode` wrapper to recognize the switcher boundary, then consumes contiguous fences. It does not use switcher labels to decide which languages exist. `core/site/tabs.ts:renderTabs` reads those fences, canonicalizes aliases, and follows the configured language order and labels.

Consequences:

- Adding `shell` to an existing group only needs a new fence within that group. WP4 supplies the `Zilliz CLI` label and ordering; stale switcher labels do not need rewriting.
- Adding a second language to a standalone named fence needs a minimal balanced `multipleCode` wrapper generated by the transform layer. Without it, current WP4 treats adjacent standalone fences independently. This is intermediate Milvus-style markup, not hand-authored Cloud `<Tabs>`.
- Preserve list indentation on that generated wrapper and inserted fences. Bind generated wrapper provenance to the responsible transform so a resulting group error has an actionable location.
- Test reversed/stale switcher labels, canonical aliases, single-to-multi, multi-to-single, required-language removal and default behavior under decision 3. No WP4 ordering, label or required-language rule changes.

## Source-line mapping

`originalPageLine` only compensates for removed markers. It cannot identify inserted files or account for edits, multiline variables and expanded fragments. A constant line offset or final-text search is insufficient.

Proposed representation: a mapped document containing text plus ordered source spans, with a derived one-based line table. Each span carries `{kind, file, line, transformIndex?}` and an inserted-origin flag. Variable spans additionally carry the variable key. Preserve finer offsets on lines that contain more than one origin.

1. Seed original Markdown spans with its repository-relative Milvus path and original line numbers, before parsing/stripping.
2. Unchanged slices retain their identities. Content-file insertions use that file's path and actual lines. Inline `content.lines` maps to `yamlLine(pageYaml, ['transforms', index, 'content', 'lines'])`, with the rule index retained for context. Synthetic separators and switchers map to the responsible rule or anchor, never an invented Milvus line.
3. Apply the same edit and marker-removal ranges to text and provenance. Do not derive marker removal from arbitrary matching comment text inside fences.
4. `md2md@1.3.0` returns dependencies but no output map. Keep one authoritative whole-page preprocessing result, including its limits and diagnostics. Build a pure provenance trace from the known validated variable/fragment token substitutions and snapshot texts, recursively carrying fragment file/line identities and inherited inserted-origin flags. Compare the traced text byte-for-byte with md2md's output before accepting the map. Do not replace md2md rendering or import its private implementation. A trace mismatch is an explicit internal build failure, never a guessed location.
5. Preprocess errors on the combined page use the pre-expansion map; errors already naming a fragment retain that fragment's original line. Fragment expansions retain their own locations while remembering whether they came from an inserted region.
6. Filter deletions update the map with the text. Link rewrites preserve line count; use reference offsets when an error needs the origin of a particular URL on a mixed-origin line. Compose WP4's existing `provenance.outputLines` with the mapped input. `toMdx` already maps compilation errors back to its adaptation input; `buildPage` maps that result to the original file.
7. Supply WP6 with actually used content-file entries of kind `content-file`, fragments, variables and source. Preserve source line positions when masking removed/filtered regions, so deleted Milvus prose cannot be falsely reported as the origin of a surviving content-file occurrence. Inline content has a synthetic entry mapped back to its YAML item. Keep WP6's matching/allow rules unchanged.

Tests must cover repeated identical text in two files, errors before/inside/after an insertion, multiple fragments on one line, nested/repeated fragments, multiline variables, markers inside literal code, list Tabs, both channels and both manuals. Check exact code/file/line, not just failure or a substring of the message.

## Content-file I/O and error choices

`readSharedDocs` loads only referenced Cloud content files for the selected page set. Resolve the page directory and candidate with `realpath`; reject absolute paths, traversal, directories, missing files and symlink escapes before reading. A file must remain within its page directory. Errors point at the referring YAML field. Pure core functions receive immutable text and source identity.

Reject named-block markers and handwritten `Tabs`, `TabItem`, or `Admonition` in content files using `TRANSFORM_CONTENT_MARKUP`. Preserve permitted Milvus-style alerts and let the current adapter convert them.

| Situation | Proposed existing code and location |
| --- | --- |
| Image referenced from Cloud content using a page-relative/local path | `IMAGE_NOT_IN_COMMIT`, at the content-file reference line; message explicitly says page-directory image assets are deferred and an external URL is required. Do not try resolving it against the Milvus page directory, even if an unrelated same-named image exists there. |
| Duplicate canonical source language when a language/line transform requires a unique target | `ADAPT_UNSUPPORTED_MARKUP`, at the second source fence, with block/language and transform context. WP4 already uses this code for duplicate group languages. Do not call it missing or select the first fence. |
| Adding a language already present exactly once | `TRANSFORM_LANGUAGE_EXISTS`, at `target.language` in YAML |
| Missing block / missing language for replace or remove | `TRANSFORM_TARGET_NOT_FOUND` / `TRANSFORM_LANGUAGE_ABSENT`, respectively, at the target field |
| Content path escapes, is missing or cannot designate an allowed file | `TRANSFORM_CONTENT_NOT_FOUND`, at `content.file` in YAML |

External HTTP(S) images use the existing WP5 stage. Tests use fake fetchers or local fixture HTTP servers and never the real image store. Original Milvus relative images retain current behavior; fragment images retain their existing WP5 handling.

## Tests-first implementation sequence

Each task starts by adding failing tests, running the narrow file, and confirming the failure is the intended unsupported behavior. Implement only enough to pass, then run related regressions. No test/code work starts until approval.

### 1. Freeze before-output evidence

- Install pinned dependencies in this exact worktree with `corepack enable` and `pnpm install --frozen-lockfile`.
- Capture the baseline described below before any code edit. Keep its evidence outside tracked production content.
- Record tool versions, exact source/config/dev identities, inputs and complete output hashes.

### 2. Schema and error fixtures

- Add `testing/transforms/config.test.ts` and `errors.test.ts` before implementing schema validation.
- Cover the nine operation/target combinations, required/forbidden content and position, unknown fields/operations, aliases at execution, and invalid channels. Use existing `CONFIG_FIELD_MISSING` / `CONFIG_FIELD_UNKNOWN` for generic schema errors; use the sixteen specific codes for their specified transform failures.
- Add one executable failure fixture per code below under `fixtures/errors/`, asserting YAML or source/content file and line as appropriate.
- Run `pnpm vitest run packages/docs-tooling/src/shared-docs/testing/transforms/config.test.ts packages/docs-tooling/src/shared-docs/testing/transforms/errors.test.ts`.

Required codes: `TRANSFORM_TARGET_NOT_FOUND`, `TRANSFORM_TARGET_KIND`, `TRANSFORM_LANGUAGE_EXISTS`, `TRANSFORM_LANGUAGE_ABSENT`, `TRANSFORM_POSITION_MISSING`, `TRANSFORM_POSITION_UNEXPECTED`, `TRANSFORM_CONTENT_UNEXPECTED`, `TRANSFORM_CONTENT_NOT_FOUND`, `TRANSFORM_CONTENT_MARKUP`, `TRANSFORM_CONFLICT`, `TRANSFORM_ON_INSERTED`, `TRANSFORM_CHANNEL_INVALID`, `LINE_NOT_FOUND`, `LINE_AMBIGUOUS`, `LINE_TOO_MANY`, `LINE_INVALID`.

### 3. Pure planning and application

- Add `testing/transforms/execute.test.ts` with successful block/language/line add/replace/remove; original-coordinate planning; adjacency and list-order assertions; per-channel overlap; aliases and duplicate canonical languages.
- Add the one-valid-plus-one-invalid case: no transformed output and no preprocessing or downstream call. Check source and supplied content remain unchanged.
- Test spaces/Tabs, multiline selectors, trailing YAML newline, comments, first/last block, single/list fences and single-to-multi Tabs wrapper.
- Implement the pure transform modules, then run the focused tests and `testing/blocks.test.ts` / `testing/site/adapt.test.ts`.

### 4. Content loading, filtering and provenance

- Add `testing/transforms/content.test.ts`, `filter.test.ts` and `provenance.test.ts` before adapter integration.
- Exercise realpath escapes, symlinks escaping the page directory, missing/non-file content, forbidden markup and local images.
- Compare approved legacy filter cases using existing writer methods from tests only; do not instantiate network-enabled clients or import legacy code into core. Include nested include/exclude cases for both manuals and source-origin tags left untouched.
- Exercise mapped link, image, Tabs, variable, fragment and product-name errors, including the same spelling in removed source and live Cloud content.
- Implement the map and `readSharedDocs` loading, then verify core-boundary tests still forbid I/O/Git/network/legacy imports in core.

### 5. Build integration, OpenAI and receipt evidence

- Add `testing/transforms/build.test.ts`: Cloud variable values; fragment expansion; alert conversion; mapped `.md` links; BYOC-only inserted content; canonical Tabs ordering/labels; required language failure; empty output on any failed page.
- Verify explicit current/next selection, unqualified participation in both, invalid availability, and unchanged WP11 failure when final versions differ.
- Add `testing/transforms/openai.test.ts` and new assertion fixtures under the approved T04 evidence definition. Include altered upstream selector, missing/ambiguous/too-long lines, parent-language conflict, add/replace indentation and no extra blank lines.
- For `4-6`, generate Milvus output through the same pinned md2md entry/configuration with Cloud transforms absent and present; compare bytes and assert the source checkout remains unchanged.
- Add `testing/transforms/receipt.test.ts` using a synthetic committed page and content file with the existing receipt-generation path. Assert `inputs.zdoc.files` contains the content file's exact path, size and SHA-256. The live source adapter inventories the entire `shared-docs/guides` tree, so no Fetch change is expected. Report a failed assertion as an evidence/scope gap instead of editing Fetch.
- Create `testing/transforms/demo.ts` to generate isolated source/config/dev inputs and run the real `shared-docs build` CLI for one block replacement plus one code-line replacement. A deliberate bad selector must print `LINE_NOT_FOUND` at the YAML item and write no page output.

### 6. Documentation, accounting and acceptance

- Document transforms and approved resolutions in the package README.
- Remove exactly `4-1` through `4-6`, `T04`, and the sixteen listed error codes from `pending.json` when their assertion tests are complete; keep all other work packages' pending entries. Keep `spec/requirements.json` and `fixtures/golden/` untouched.
- Run the final selector against every changed path and, after commit, the complete PR diff: `pnpm test:for-change -- --base origin/master --head HEAD`.
- Run the returned command union, then the additional required gates and real-input comparison below.

## Proving the five existing pages are byte-identical

This is a comparison of two actual generators using the same inputs, not a snapshot update or a comparison against the current Feishu page body.

| Page | Both locked Milvus commits |
| --- | --- |
| `delete-entities` | `3e6b7499cbfcb6b5a365fb1f084a74836f625fc2` |
| `alter-collection-field` | `e510bc82f633015f48145a8335cd8eba9fe47821` |
| `use-array-of-structs` | `e510bc82f633015f48145a8335cd8eba9fe47821` |
| `use-string-field` | `e510bc82f633015f48145a8335cd8eba9fe47821` |
| `view-collections` | `e510bc82f633015f48145a8335cd8eba9fe47821` |

All five publish to Guides and BYOC: expect exactly ten MDX files plus `images.json`.

1. Pin baseline tooling `c3260d68715b151102dfc64a88cbe1c60e137864` and preserve that commit's complete `shared-docs/guides` tree, including all five locks. Never refresh their locks to branch HEAD.
2. Use a local milvus-docs repository with a pinned `v3.0.x` ref containing the two commits. Verify each commit's ancestry and record its full SHA; read committed bytes rather than dirty checkout content.
3. Pin one compatible local dev snapshot/retained artifact containing the five existing page paths and Guides snapshot. Both tool versions use that exact same dev input. Reading this snapshot is not a production Fetch or a write to dev.
4. Before edits, run the real CLI with those inputs and a fresh empty output directory:

   ```sh
   pnpm docs-tooling shared-docs build --shared-docs "$WP10_SHARED" --repo "$WP10_MILVUS" --dev "$WP10_DEV" --out "$WP10_EVIDENCE/before"
   ```

5. After implementation, run the same command and same frozen inputs with `--out "$WP10_EVIDENCE/after"`. Capture exit status and logs for each run. If an input uses external images, record and reuse exact downloaded bytes through the supported injected fetcher, retaining a separate real-CLI run; disclose any such controlled replay rather than allowing network drift to masquerade as a code change.
6. Compare sorted relative file inventories and raw bytes for every file; run `diff -ru "$WP10_EVIDENCE/before" "$WP10_EVIDENCE/after"` and generate SHA-256 manifests. No whitespace normalization, metadata stripping or allowed MDX differences. Report ten of ten identical MDX files and an identical image manifest only if proven.
7. Preserve baseline/candidate tooling identities, source/config/dev manifests, logs, file counts and comparison results. A failed baseline or missing dev/image input is an unresolved evidence gap, not a successful no-change claim.

The before evidence can be produced from the current unmodified worktree. Any later baseline rerun uses a separate detached worktree below `.claude/worktrees/`, never a reset/rebase of the PR branch. Existing approved golden fixtures are not modified and the OpenAI assertion fixtures do not become goldens.

## Verification, safety and delivery

The planned implementation paths map to `shared-docs`, owned by `master`. The selector was run successfully and returned:

```sh
pnpm test:shared-docs
pnpm typecheck
pnpm test:workflow-matrix
git diff --check
```

Also run `pnpm test:replay:shared-pages` (card), `pnpm test:workflow-policy` and `pnpm test:rest-publication-contract` (repository instructions). Subprocess tests use 120-second file-level test and hook timeouts. Do not report these checks as passed until actually run in this checkout.

The local review-plan path is not mapped by `test:for-change`. It is an uncommitted planning artifact, not part of the implementation PR. The implementation paths have no current matrix gap. If a newly needed code path is unmapped, stop and report it because the matrix implementation lives in the prohibited workflow area.

Publication evidence stays local: use the shared-pages harness's synthetic fixtures/local bare remote and the repository's retained-artifact replay procedure where publication regression evidence is required. Preflight real archives before restoring them, retain exact generated state and artifact identities, and perform required inventories/builds in the exact replay checkout. Never substitute a synthetic replay for retained-artifact evidence or assert that real evidence exists before locating it. Do not dispatch Fetch, publish Translation, upload to a real image store, or modify Feishu Base.

After tests and evidence:

- Review changed paths and `git diff --check`; record `git status` and worktree state. Preserve both local plan files and unrelated worktrees.
- Commit only authorized implementation/test/documentation files with English conventional commit messages. Never rebase or force-push.
- Verify `fork` is `git@github.com:liyun95/zdoc.git`; push `wp10-transforms` there.
- Open a draft PR against **`liyun95/zdoc:master`** and attach it to this chat. Do not open an upstream PR.
- Use the implementation guide's six English PR sections: Summary; Requirements covered; Tests; Golden output changes; Deviations from the design; How to try it.
- The PR contains no local paths. Its reproduction starts with `gh pr checkout <actual-number> -R liyun95/zdoc`, includes the equivalent fork-ref checkout and frozen install, then the synthetic transform demo and deliberate failure. Include the exact byte-comparison method/results and every approved decision or unresolved evidence gap.

## Review gate

Await owner approval of this plan and rulings on decisions 1–5 before writing implementation code or tests. In particular, do not silently pick filter semantics, conflict exceptions, language-removal behavior or a meaning of complete T04 coverage.
