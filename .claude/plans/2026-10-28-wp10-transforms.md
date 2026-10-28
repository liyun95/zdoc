# WP10 Transforms Implementation Plan

> Execution: after explicit plan approval, implement inline using tests first and the executing-plans workflow. No implementation changes before approval.

**Goal:** Apply atomic Cloud-only block, language, and code-line transforms while preserving existing output and accurate diagnostics.

**Architecture:** Pure validation, edit planning, product filtering, and provenance composition live in `core/transforms/`. Existing adapters supply filesystem inputs and orchestrate the unchanged md2md, WP4, WP5, and WP6 rules.

**Tech stack:** TypeScript, existing YAML parser, Markdown scanners, md2md public APIs, Vitest, pnpm, local Git fixtures.

## Starting point and boundaries

- Branch `wp10-transforms` starts at fetched `origin/master`, `c3260d68715b151102dfc64a88cbe1c60e137864`.
- Worktree: `.claude/worktrees/wp10-transforms`. Main checkout was clean; existing unrelated worktrees are preserved.
- Read the WP10 card first, then its listed PRD/design/walkthrough/implementation-guide sections, current shared-docs instructions, relevant implementation and tests, and repository operator guidance.
- No `.codegraph/` exists in this checkout.
- No production Fetch, real image-store upload, Base write, dev write, workflow changes, or changes under `lark/` or `scripts/docs-workflow/`.
- No edits to real shared-page configuration, requirements catalog, golden files, generated output, WP4/WP5/WP6 rules, or upstream Milvus content.
- Push only to `fork` (`liyun95/zdoc`), open a draft PR against that repository's `master`. No rebase or force-push.

## Decisions requested before implementation

1. **Product-target contradiction.** The card requires `<include target="zilliz.paas">` to appear only in BYOC, but the live Feishu implementation evaluates `targets.split('.').includes(tagTarget.trim())`. With active target `zilliz.paas`, it recognizes `zilliz` and `paas`, but not `zilliz.paas`. Both `categorize_node` and `__filter_content` use token membership. Proposal for approval: preserve token matching and additionally recognize the exact full active target in the new pure filter, so the card's dotted example works. This is an explicit compatibility extension, not exact parity. Keep parity tests for existing token cases, and separate tests documenting the approved dotted extension. Alternative: use strict existing semantics and correct the card/example. I will not choose between these without review.
2. **Nested-filter mismatch.** `categorize_node` uses a skip counter that decrements on any closing tag; a kept inner wrapper inside a skipped outer wrapper can end skipping early. The recursive Markdown filter does not have that behavior. Proposal: use a properly nested stack for inserted Markdown, matching recursive whole-region filtering; parity tests should distinguish the classifier limitation rather than codify its premature unskip. Malformed/unbalanced filter handling is unspecified: propose `TRANSFORM_CONTENT_MARKUP` with the content-file line and no partial output. Please approve this interpretation.
3. **Default-language removal ambiguity.** PRD scenario 4's error table says deleting a required *or default* language fails. Design 07 and current WP4 permit a missing default and select the first present language. Proposal: preserve WP4 fallback, but reject transforms that remove a required language from an originally multilingual group even when the result has only one fence. Use `TABS_REQUIRED_MISSING`. Please confirm whether removing a non-required default should instead fail.

The card explicitly defers local content images and two-version merging even though broader PRD examples allow those capabilities; those are documented WP10 exclusions, not proposed scope expansions.

## Integration and file responsibilities

- `core/types.ts`: typed transform operation, target, content, position, channel; replace opaque `unknown[]`.
- `core/config.ts`: validate transform field names/types/combinations with YAML source positions and existing error codes. Unknown actions/fields use configuration errors; semantic combinations use transform errors.
- New `core/transforms/types.ts`, `validate.ts`, `plan.ts`, `apply.ts`, `filter.ts`, `provenance.ts`, `index.ts`: pure records and functions for validation, immutable edit planning, deterministic application, inserted-content filtering, and source mapping. Final split can remain smaller where these responsibilities fit naturally.
- `commands/build.ts` / `readSharedDocs`: read referenced Cloud files using realpath containment checks and pass text plus repository-relative identity to adapters. Reject absolute paths, traversal, missing/nonregular files, and symlink escapes as `TRANSFORM_CONTENT_NOT_FOUND`; do not throw an unlocated generic filesystem error for these cases. Require a file in the page directory, not an arbitrary descendant. No filesystem operations in core.
- `adapters/inspect-page.ts`: accept prepared content inputs, Tabs rules, target manual, and channel availability via its input type; return transformed content and provenance with each inspected channel.
- `adapters/build-page.ts`: supply those inputs, orchestrate manual-specific insertion filtering, remove both WP10 refusal branches, compose diagnostic locations, and include used content files in WP6's `ProductNameSource[]` as `content-file`.
- `testing/transforms*.test.ts`, `testing/build/` additions, `fixtures/errors/` additions, test-only OpenAI fixtures: requirements and error coverage. Keep subprocess-file timeouts at 120 seconds.
- `spec/pending.json`: remove only `4-1`–`4-6`, `T04`, and the 16 covered transform/line errors after their assertions pass.
- Shared-docs `README.md`: supported transforms, failure atomicity, file restrictions, filtering decision, channels/WP11 boundary, diagnostic origins, and runnable examples.

No additional production-file scope is currently requested. If source-map or inspect-command wiring proves to require a file outside the card's allowlist, stop and request that exact scope before editing it.

## inspectPage execution order and atomicity

For each locked channel, parse original marker-bearing Markdown, then call `inventoryBlocks`. Select unqualified rules plus that channel's rules. Resolve every target against the original inventory and fences; never against partially edited text. Validate all rules and conflicts before returning any transformed content.

Plan half-open edits against original offsets and apply them in a single pass. Same-boundary additions carry their configuration index and retain list order. Preserve marker boundaries during planning; then strip markers, then invoke `md2md.preprocess` on the complete transformed page with Cloud variables and locked fragments. Any failure rejects the entire page, including otherwise valid transforms. Build remains all-or-nothing for output writes.

Product filtering differs by manual, so transformed inspections for Guides/BYOC must use their respective active target. Share original Git reads and prepared immutable files; do not reuse one manual's filtered body for another. Preserve the existing two-inspection/no-transform fast path and bytes when there are no transforms. Current/next comparison and the existing WP11 failure stay unchanged.

Channel availability comes from the selected Fetch target or existing offline Guides snapshot record, not merely the presence of two lock SHAs. A NEXT-only page rejects `channel: current`. Validate values and availability before rendering; unqualified rules count in both channels' conflict checks. Isolated inspect callers without publication context need an explicit availability input for that check; do not fabricate NEXT state.

## Target resolution, language handling, and WP4

- Normalize both target and fence language through the loaded Tabs rules (`value` and `aliases`), including `cpp`/`c++` and `curl`/`bash`.
- Inventory positions have mixed conventions: `startLine` is the zero-based first body index; the inclusive last body index is `endLine - 2`. Cover markers at file start/end, blank padding, CRLF, and list-indented fences.
- Block operations use full named-block bounds. Language operations use the selected original fence. Language content must contain exactly one fence of the normalized target language, without a switcher; full code-group replacement must contain its complete Milvus structure.
- Match code-line windows only inside the original target fence. Strip per-line leading indentation and trailing whitespace for comparison, preserve internal whitespace/comments, and require exactly one match of 1–5 lines. Remove only the YAML block scalar's final line break before validation; do not parse code comments as YAML comments.
- Dedent replacement lines by their common leading whitespace, then prefix the original first target line's exact indentation bytes. Preserve relative indentation and Tabs. Do not create extra blank lines on replace/remove.
- Reject overlapping block/language/line edits per channel, duplicate targets other than allowed ordered additions, and edits of newly inserted blocks/languages/lines (`TRANSFORM_ON_INSERTED`).
- **Verified WP4 behavior:** `codeGroupAt` reads switcher structure, then collects following fences. `renderTabs` derives languages, labels, ordering, and aliases from those fences and Tabs rules, not switcher text. An existing switcher need not have its labels edited after adding/removing a fence.
- **Single-fence promotion:** WP4 discovers Tabs only through a `multipleCode` wrapper. When adding a second language to an originally single-fence named group, the transform stage must emit an empty structural `<div class="multipleCode"></div>` before the fences. WP4 can then render both without any WP4 rule change. Test the actual adapter output, including Zilliz CLI label/order. Preserve list indentation. A single remaining fence renders as ordinary code through the existing group renderer.

## Diagnostic line-number map

Use an ordered span map internally and project it to one origin record per output line: `{ kind, file, line, transformIndex? }`. Each retained original line keeps its Milvus file and original one-based line. Each inserted file line keeps its Cloud file and line before filtering. Each inline-content span points to the corresponding transform's `content.lines` YAML scalar item, using the YAML parser's ranges. Synthetic structural lines point to the transform item that created them.

Apply the exact same edit/strip/filter operations to text and origins. This replaces marker-count-only `originalPageLine` mapping for transformed content; an insertion must never shift a later diagnostic onto the wrong source file.

md2md's current public preprocess result contains dependencies and content, **but no output source map**. Plan a provenance-only expansion trace over the supplied variables and immutable fragment snapshot, using the installed engine's expansion grammar; the real whole-page md2md output remains authoritative. Compose origins through nested fragment/variable replacements, including multiline values and repeated identical lines. Assert that traced text equals actual preprocessing bytes before using the trace; do not use fuzzy text alignment or silently fall back to guessed lines. Add contract tests for escaped/literal tokens, nested fragments, multiline values, repeated text, and errors inside included fragments. If exact tracing cannot be implemented using the allowed files/public behavior, report the concrete API/scope gap before proceeding.

WP5 rewrites destinations without adding physical lines; assert that invariant in mapping tests. WP4 already returns output-to-input provenance and `toMdx` maps compile errors back to WP4 input lines. Remap their input-line diagnostics through the inspection map in `build-page.ts`. Keep diagnostics already located in fragments/config/rules unchanged. WP6 receives the actually used content-file sources; inline code origins must be remapped to the YAML item rather than reported as a standalone synthetic file. Test unresolved links, Tabs, MDX, and product-name errors in inserted content plus original errors after insertions.

## Proposed existing error codes

- **Page-directory image:** `IMAGE_NOT_IN_COMMIT`, located at the Cloud file's image line (or inline YAML origin), with a message explicitly saying page-local transform images are unsupported in WP10 and suggesting an external URL. Never resolve such a relative reference against the Milvus source directory. External URLs continue through WP5. This code is a deliberate reuse to review, since its catalog wording describes an absent repository image rather than this deferred input category.
- **Duplicate language in one original code group:** `ADAPT_UNSUPPORTED_MARKUP`, located at the second conflicting fence after alias normalization. This is already WP4's duplicate-language error. Reject both language-level and line-level targeting before selecting any fence; do not use `LINE_AMBIGUOUS` for a duplicate fence or add a new code.
- Missing block: `TRANSFORM_TARGET_NOT_FOUND`; absent language for replace/remove: `TRANSFORM_LANGUAGE_ABSENT`; add existing language: `TRANSFORM_LANGUAGE_EXISTS`. Test each separately.

## Tests-first implementation sequence

1. [ ] Install the pinned toolchain/dependencies in this exact worktree. Capture untouched baseline builds before implementation.
2. [ ] Add failing schema/error fixtures for all 16 transform/line codes; assert code, file, one-based line, page, channel. Run focused tests and record expected failures. Implement typed parsing and semantic validation, then rerun.
3. [ ] Add failing pure-engine tests for all nine operation/target combinations, original-coordinate conflicts, ordered adds, aliases/duplicates, inserted-content retargeting, first/last blocks, list fences, whitespace/comment matching, indentation, empty-line rules, and channel separation. Implement minimal edit planning/application, rerun.
4. [ ] Add failing filesystem/integration tests for file containment/symlinks, forbidden markers/components, local-image rejection, external-image preparation with fake transport, and approved filter semantics. Implement command/adapters integration and the provenance trace, rerun.
5. [ ] Add failing end-to-end tests for `4-1`–`4-6`: no partial build output, invalid target kinds, indentation, shell/Python Tabs behavior, Cloud variables/fragments/admonitions/links/manual filtering, and unchanged Milvus-side preprocessing with/without Cloud transforms.
6. [ ] Copy OpenAI input into a new test fixture, add test-only named markers, assert credential replacements and additions for every available language. Cover T04 missing/ambiguous/too-long/overlap/upstream-changed target cases without creating golden files.
7. [ ] Add a content file to a synthetic page, exercise the existing input-record builder read-only/offline, and assert its path/hash appears under `inputs.zdoc.files`. If absent, report the gap without changing Fetch. Test code may invoke existing lark-side helpers for comparison; core never imports them.
8. [ ] Update documentation and pending coverage, run all required checks, compare real five-page outputs, review the complete diff, commit in English, push to fork, and create the draft PR.

## Five-page byte-identity proof

Freeze master configuration from the starting commit, not a later moving branch. The five current page IDs are `alter-collection-field`, `delete-entities`, `use-array-of-structs`, `use-string-field`, and `view-collections`.

Use the same clean local Milvus repository, pinned `v3.0.x` branch tip, every exact lock SHA, offline dev snapshot with the existing five destinations/navigation/Base records, dependency versions, and image bytes in both lanes. Existing locks include `e510bc82f633015f48145a8335cd8eba9fe47821` and `3e6b7499cbfcb6b5a365fb1f084a74836f625fc2`. The locally observed Milvus `v3.0.x` tip is `899cd35f375528ac9a06408d0d4a33fc3392ce72`; record final consumed identities rather than treating this observation as a verified baseline.

Before code changes, run `pnpm docs-tooling shared-docs build --shared-docs <frozen-master-group> --repo <pinned-milvus-repository> --dev <offline-dev-snapshot> --out <before>` and preserve logs. After implementation, run the exact command with only code/output lane changed. If a second baseline code checkout is needed, create it only under `.claude/worktrees/` at the exact starting SHA.

Enumerate all output-relative paths; compare path sets, sizes, SHA256, and actual file bytes (including `images.json`), then require `diff -r --no-dereference <before> <after>` to exit 0. Expected MDX count is ten, because all five pages publish to both manuals; report actual counts and mismatches explicitly. Preserve input manifest, commands, before/after hash manifests, and diff exit status in an evidence root. Do not regenerate expected outputs from modified code or edit golden files to make comparison pass. Missing snapshots/images/commits are evidence gaps to report, never a reason to run production Fetch or write Base.

## Validation and handoff

The pre-edit selector maps all proposed production/test/docs paths to master ownership and returns:

```sh
pnpm test:shared-docs
pnpm typecheck
pnpm test:workflow-matrix
git diff --check
```

Run focused Vitest cases first, then this union, `pnpm test:replay:shared-pages`, and the complete-diff selector `pnpm test:for-change -- --base origin/master --head HEAD`. Query every actual new path before editing; stop for an unmapped path because matrix edits are outside the allowed workflow-tooling scope. Use existing safe replay tooling/local bare remotes, preserve evidence, and inspect retained artifacts before any claim about real publication compatibility. The hermetic replay is not a substitute for required retained-artifact evidence. Report missing real replay prerequisites rather than starting a production writer.

Draft PR title: `feat(shared-docs): apply Cloud content transforms`. Use the six required English sections: Summary, Requirements covered, Tests, Golden output changes (None), Deviations from the design (approved decisions explicitly recorded), How to try it. The last section starts with `gh pr checkout <number> -R liyun95/zdoc`, provides equivalent Git instructions, installation, and a self-contained synthetic block replacement plus code-line replacement build, expected output, and deliberate failing target. All PR commands use repository-relative paths or create temporary directories themselves; no local absolute paths anywhere in the description.

Final handoff reports PR URL, commit, checks with actual results, five-page file counts/digest comparison, replay identities/counts, outstanding evidence gaps, and `git status`/task-worktree state. Keep the PR branch/worktree available for review.
