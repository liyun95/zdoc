# Analyzer filter onboarding implementation plan

> **For agentic workers:** Use `executing-plans` for inline execution, or `subagent-driven-development` if delegated execution is explicitly selected. Follow the review checkpoints below; steps use checkboxes for tracking.

**Goal:** Register Lowercase, ASCII folding, and Alphanumonly as shared Guides pages, producing six locally validated Guides/BYOC outputs before any production activation.

**Architecture:** Add three page configurations using the merged Milvus source. Reuse the existing variables, Tabs presentation, link resolution and generation pipeline. Preserve planning history in the fork draft; prepare a clean same-repository upstream branch containing only reviewed configuration changes so the existing bot can create initial locks.

**Tech stack:** YAML configuration, pnpm 10.33.0, existing TypeScript shared-docs CLI, Vitest, complete local Git history, and the existing shared-docs lock/validation workflows.

Status: plan prepared for review. No shared-docs configuration or publication state has been edited. Implementation follows the plan ruling.

## Fixed inputs and scope

| Input | Revision |
| --- | --- |
| zdoc master / tooling | `93967f19a131814f004735cdbdf3162eabf99e21` |
| zdoc dev / comparison input | `387e287244ccd586052bb3d7c22669f634e17cad` |
| Milvus v3.0.x / merged source | `7b8e6c91cbff9e9b455aa2f7a345f62d166a8cc2` ([upstream #3768](https://github.com/milvus-io/milvus-docs/pull/3768)) |
| Milvus preview / alignment counterpart | `5be941927dc2025d3452d10a1338c32377f91217` ([upstream #3769](https://github.com/milvus-io/milvus-docs/pull/3769)) |

The group tracks v3.0.x. Preview is not a second zdoc lock source. Existing 16 page configurations and their locks must remain byte-for-byte unchanged. The retained dev snapshot has 16 active pages, and the three new candidates remain canonical CURRENT records targeting both Cloud manuals. Snapshot evidence is not a live Base read.

Allowed upstream paths:

1. `shared-docs/guides/pages/lowercase-filter/page.yaml`
2. `shared-docs/guides/pages/ascii-folding-filter/page.yaml`
3. `shared-docs/guides/pages/alphanumonly-filter/page.yaml`
4. `shared-docs/guides/product-names.yaml`
5. `shared-docs/guides/links.yaml` only if local generation proves that a destination is missing; the expected change is no link-map edit.

The only extra fork-review file is this plan. No tooling, workflows, generated content, sidebars, source snapshots, navigation, variables, SDK examples, Cloud replacement files or new transforms are planned. Any unexpected need to extend that scope requires a separate ruling. No real dev Fetch, Translation, Base write, image upload or Feishu update is authorized.

## Findings to include in the ruling

- The existing lock workflow writes only on same-repository PR branches. A fork is suitable for plan/content review, but a zilliztech/zdoc branch is required for the real onboarding PR. Current account permission is ADMIN; this does not itself authorize pushing that branch before the concrete publication commands are reviewed.
- Alphanumonly retains intentional sample data and its expected token list. A probe using the actual product-name scanner and merged source reports nine hits with current rules, one hit with only the input allowed, and zero with the exact input and exact expected output allowed. A control sentence containing Milvus still fails. Approve both narrow phrases below; allowing only the input, as the original task card proposed, is insufficient.
- The five potential configuration paths are covered by the live test matrix and owned by master. This temporary fork-only plan path is not mapped: including it in `test:for-change` reports an unmapped path. Do not claim the plan-only diff passes that gate, add a production matrix exception for disposable review material, or silently waive a real configuration-path gap. The final clean upstream diff excludes this plan and must pass the complete selector, including bot-created lock paths.

## Task 1: Prepare immutable local inputs

- [ ] Recheck origin/master and origin/dev. If either changes, record the new pins and inspect changes relevant to shared configuration and the three dev pages before continuing. Never overwrite the user's main checkout.
- [ ] Install the pinned workspace in this exact worktree:

```bash
corepack enable
pnpm install --frozen-lockfile
```

- [ ] Create a separate complete-history Milvus clone; do not use the earlier shallow research clone for generation:

```bash
ONBOARD_EVIDENCE="$(cd .. && pwd)/analyzer-filters-onboarding-evidence-20261030"
git clone --filter=blob:none --single-branch --branch v3.0.x --no-tags --sparse https://github.com/milvus-io/milvus-docs.git "$ONBOARD_EVIDENCE/milvus-full"
git -C "$ONBOARD_EVIDENCE/milvus-full" sparse-checkout set site/en
test "$(git -C "$ONBOARD_EVIDENCE/milvus-full" rev-parse --is-shallow-repository)" = false
test "$(git -C "$ONBOARD_EVIDENCE/milvus-full" rev-parse refs/heads/v3.0.x)" = 7b8e6c91cbff9e9b455aa2f7a345f62d166a8cc2
```

If the tracking head has advanced, inspect the new source before updating the pin; do not force-move a checked-out branch. Reads of historical locks must succeed through complete ancestry.

- [ ] Materialize the pinned dev input without a publication remote:

```bash
mkdir "$ONBOARD_EVIDENCE/dev-input"
git archive 387e287244ccd586052bb3d7c22669f634e17cad content/en/guides content/en/byoc packages/docs-tooling/src/lark/meta/snapshots/guides-uat-last-success.json | tar -x -C "$ONBOARD_EVIDENCE/dev-input"
mkdir -p "$ONBOARD_EVIDENCE/baseline" "$ONBOARD_EVIDENCE/candidate"
cp -R shared-docs/guides "$ONBOARD_EVIDENCE/baseline/guides"
```

Retain an input manifest with source/tooling/dev SHAs and SHA-256 hashes of every original lock and both group configurations. The baseline and candidate builds must use the same source checkout, dev input and tooling commit.

## Task 2: Generate the 16-page baseline

- [ ] Run the official whole-group command before changing configuration:

```bash
pnpm docs-tooling shared-docs build --shared-docs "$ONBOARD_EVIDENCE/baseline/guides" --repo "$ONBOARD_EVIDENCE/milvus-full" --dev "$ONBOARD_EVIDENCE/dev-input" --out "$ONBOARD_EVIDENCE/baseline-output" > "$ONBOARD_EVIDENCE/baseline-build.log" 2>&1
```

Expect 32 successful outputs, two manuals for each existing page, and no planned missing locks. This CLI may read public source images; it never uploads them. Preserve the image manifest and compare it later. A baseline failure is not a new-page regression: investigate and document its exact input and diagnostic before altering any configuration.

## Task 3: Add only the three registrations

- [ ] Run the matrix before editing:

```bash
pnpm test:for-change -- shared-docs/guides/pages/lowercase-filter/page.yaml shared-docs/guides/pages/ascii-folding-filter/page.yaml shared-docs/guides/pages/alphanumonly-filter/page.yaml shared-docs/guides/product-names.yaml
```

- [ ] Create the three files with this exact common structure:

```python
from pathlib import Path
for slug in ('lowercase-filter', 'ascii-folding-filter', 'alphanumonly-filter'):
    page = Path('shared-docs/guides/pages') / slug / 'page.yaml'
    page.parent.mkdir(parents=True, exist_ok=False)
    page.write_text(f'''schema_version: 1
source:
  file: site/en/userGuide/schema/analyzer/filter/{slug}.md
publish:
  - manual: guides
    path: tutorials/development/analyzer/analyzer-filters/{slug}
  - manual: guides-byoc
    path: tutorials/development/analyzer/analyzer-filters/{slug}
''')
```

No metadata override is needed initially. Check generated metadata against the pinned dev pages: no beta, version, BYOC or NEXT tags should be introduced. Title/description changes from using Milvus source must be explained separately from code changes.

- [ ] Extend the existing `allow` array in `shared-docs/guides/product-names.yaml` by exactly these two entries, preserving the current check list and two existing allows:

```yaml
  - 'Milvus 2.0 @ Scale! #AI #Vector_Databasé'
  - "['Milvus', '2', '0', 'Scale', 'AI', 'Vector']"
```

The quotes preserve the hash characters and full literal expected output. Never add bare Milvus, root, localhost or a broad substring. Do not change the sample or expected tokens to evade the scanner. Re-run the real scanner with a negative control and retain its result.

## Task 4: Generate candidate locks and all 19 pages locally

- [ ] Copy the candidate group to evidence scratch and generate missing locks there only:

```bash
cp -R shared-docs/guides "$ONBOARD_EVIDENCE/candidate/guides"
pnpm docs-tooling shared-docs lock --shared-docs "$ONBOARD_EVIDENCE/candidate/guides" --repo "$ONBOARD_EVIDENCE/milvus-full"
pnpm docs-tooling shared-docs build --shared-docs "$ONBOARD_EVIDENCE/candidate/guides" --repo "$ONBOARD_EVIDENCE/milvus-full" --dev "$ONBOARD_EVIDENCE/dev-input" --out "$ONBOARD_EVIDENCE/candidate-output" > "$ONBOARD_EVIDENCE/candidate-build.log" 2>&1
```

Expect exactly three new scratch locks, each with current = next = merged v3.0.x source SHA. Existing lock bytes must match the baseline. Expect 38 outputs, 32 unchanged and six newly generated. Local lock files do not enter the implementation commit.

- [ ] Compare every baseline MDX and `images.json` byte-for-byte with the corresponding candidate output. Abort the candidate if any of the original 32 MDX files changes. Preserve hashes and a list of the six added paths.
- [ ] For each added output, assert exactly three Tabs groups, eight unique languages per group (24 TabItems), and a separate expected-output block. Check all eight input strings, authentication corrections, no unresolved variables or shared markers, and no NextChannel pair with equal locks. The existing MDX compilation path must succeed; counting fences alone is insufficient.
- [ ] Check `./analyzer-overview#example-use` against the existing Guides and BYOC target heading and confirm Standard Tokenizer resolves to the shared target. Keep the ASCII folding Wikipedia URL. The target slug fallback and shared-page resolver already cover these links; do not add redundant mappings. Only if actual generation reports LINK_UNRESOLVED may `links.yaml` receive the exact verified destination, followed by matrix selection and whole-group regeneration.
- [ ] Compare all six new outputs with their current dev counterparts, preserving a per-page difference report. Expected differences: source-owned prose/title/description, source markup converted to Cloud MDX, variable expansion, completed eight-language examples, explicit C#/NodeJS/Rust corrections and C++ imports, and removal of the obsolete Milvus heading suffix. Explain every other semantic difference. Preserve input, expected tokens, path/slug and no-tag behavior.

## Task 5: Validate and review the configuration diff

- [ ] Execute the selector union in the exact implementation checkout:

```bash
pnpm test:shared-docs
pnpm typecheck
pnpm test:workflow-matrix
git diff --check
```

The configuration-only selector does not require full Docusaurus site builds or production replay. The full shared-docs generation/MDX checks above are required. Never describe source-scanner, unit or MDX checks as a full site build, live SDK run, or activation test. If scope changes into publication tooling, stop and re-evaluate the matrix and real-artifact requirements.

- [ ] Review the exact final diff, the 32 unchanged outputs, six new outputs, exact sample allows, links, metadata, all-page diagnostics and unchanged historical locks. Keep the evidence root. Do not modify tests to mirror these reversible registration files or weaken existing checks.
- [ ] Commit only the three page configurations and two exact allow entries, plus a conditional justified link-map change. Preserve plan/implementation history on the fork draft. An implementation push or PR update requires the driver's concrete-command approval unless already granted for that exact action.

## Task 6: Prepare a clean same-repository onboarding PR

- [ ] After implementation review, create a fresh branch from latest upstream master containing only the approved configuration diff. Re-run the full selector on the clean committed diff:

```bash
pnpm test:for-change -- --base origin/master --head HEAD
```

If upstream moved, review the candidate against the new source/tooling/dev inputs before transferring verification claims. Do not rebase or force-push the review branch.

- [ ] Show the exact upstream push/create commands and English body. The driver creates the upstream PR unless they explicitly delegate it. Use a zilliztech/zdoc branch so the existing lock writer can add three locks and dispatch validation; a fork upstream PR cannot complete this workflow. Expect one human configuration commit followed by the bot's lock commit, rather than promising one total commit after onboarding.
- [ ] Authenticate the bot's exact pushed SHA, exactly three new lock paths, unchanged existing locks, and the dispatched shared-docs-validate child selected by request ID and exact head. Read its all-page result; ordinary unit CI is not a substitute. Re-run the selector with any bot-created paths. A successful config PR is not production activation.

## Activation handoff, outside implementation scope

After the onboarding PR merges, prepare the separate three-record switch sheet using a fresh Base read. Freeze the old documents but retain them until the first successful activation Fetch. The expected record IDs from the retained snapshot are `recvlPvtPoZNRE`, `recvlPvwdnURsZ`, and `recvlPvxLc6exY`; confirm them live before proposing any write. The future Docs targets are the corresponding page directories under `https://github.com/zilliztech/zdoc/tree/master/shared-docs/guides/pages/`.

No Base write, manual Fetch, Translation, upload, external maintainer message or merge is included in this plan. Activation acceptance later requires six published pages, correct source receipts, the three new active entries (16 to 19 only if no other activation occurred), and subsequent Guides/BYOC production rendering checks.

## Plan-stage evidence already collected

- Latest source refs and both Milvus merge commits were read back. The local worktree starts at the pinned master commit and was clean before this plan.
- `corepack enable` and `pnpm install --frozen-lockfile` completed in this worktree with pnpm 10.33.0.
- Configuration-path selector passed and returned `test:shared-docs`, `typecheck`, `test:workflow-matrix`, and `git diff --check`. The fork-only plan-path gap is recorded above, not counted as a passing selector run.
- Baseline `pnpm test:shared-docs`: 60 files passed; 771 tests passed, four skipped. `pnpm typecheck` passed. `pnpm test:workflow-matrix`: 18 passed, zero skipped.
- The actual scanner probe confirmed the exact two-phrase requirement. Existing Cloud Guides/BYOC files retain FALSE beta/version tags and an `example-use` target heading.
- No candidate registrations, lock generation, whole-group candidate build, Docusaurus build or activation has been performed. Baseline test results do not establish candidate acceptance.
