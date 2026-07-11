# Sprint 4c — Gate 5 Workspace-Apply Boundary — Internal QA Completion Record

Independent, adversarial QA. All facts below were re-derived by reading the code
and running the tests; no prior summary was trusted.

- **GATE5_INTERNAL_QA_STATUS = PASS**
- **GATE5_FINAL_E2E = PASS**

---

## REVIEWED_HEAD
- `1e740a4a37660b1b4d035885863bb992060dddf7` (confirmed via `git rev-parse HEAD`)
- Branch: `v2/sprint-4c-gate5-internal-qa`
- Base: `e6e1b93bb4406dab02eb6cba1d0556329b002def` is a linear ancestor; exactly
  ONE commit sits on top of it (`1e740a4` — "test(gate5): workspace-apply
  boundary Internal QA (Sprint 4c Gate 5, test-only)").

## NODE_VERSION
- `v22.22.1` (via `nvm use 22`). Validation runtime = Node 22 (not .nvmrc's 18).

## TEST_COMMANDS (exact)
1. `pnpm typecheck`
2. `pnpm test`  (full suite; produced full detailed output, not RTK-filtered)
3. `npx vitest run packages/workspace-local/src/gate5-apply-e2e.test.ts packages/core/src/application/conversation-runtime.test.ts -t "Gate 5" --reporter=verbose`
   - plain invocation was condensed by the RTK hook to `PASS (6) FAIL (0)`; re-ran
     the same command under `rtk proxy` to capture the six verbose test names.
4. Independent probe (throwaway, deleted after):
   `rtk proxy npx vitest run packages/workspace-local/src/gate5-probe.qa.test.ts --reporter=verbose`

## PASS_FAIL_COUNTS
- **Typecheck:** exit 0, no errors.
- **Full suite (`pnpm test`):** exit 0 — **Test Files 56 passed (56); Tests 1229 passed (1229)**; 0 failed.
- **Focused Gate 5:** exit 0 — **2 files, 6 passed, 437 skipped (443)**; 0 failed. The six:
  - runtime: `apply approval (PATCH_READY) + final-apply → exactly ONE WorkspaceWrite of the single gate5 update op; command/git 0; WORKSPACE_APPLIED`
  - runtime: `apply requested BEFORE apply-approval (ELIGIBLE / AWAITING_APPROVAL) → zero WorkspaceWrite`
  - runtime: `a distinct plan/preview approval boundary never writes: "승인" with no apply context → zero WorkspaceWrite`
  - e2e: `single update op → byte-exact, file-only mutation; then a one-file rollback restores the exact baseline`
  - e2e: `re-applying the same op is deterministic (idempotent bytes) and never escapes the file`
  - e2e: `the disposable repo is neither the product repo nor the UAT sandbox`

## CHANGED_FILES (diff vs e6e1b93; classification)
Exactly 3 files, all additions (+459), single commit:
- `docs/plans/sprint-4c-gate5-workspace-apply-boundary-validation-plan.md` — **DOC** (+297)
- `packages/core/src/application/conversation-runtime.test.ts` — **TEST/HARNESS** (+52; new `describe('Gate 5 — workspace-apply boundary state machine …')` block, reusing the existing `makeDeps` harness + real `ConversationRuntime`)
- `packages/workspace-local/src/gate5-apply-e2e.test.ts` — **TEST** (+110; new real-fs E2E)
- **PRODUCTION: NONE.** Explicitly confirmed unchanged vs e6e1b93:
  `packages/core/src/application/conversation-runtime.ts`, `intent-classifier.ts`,
  `workspace-write-manager.ts`, `packages/workspace-local/src/index.ts`.
- Fixture `gate5/apply-smoke.txt` is **not tracked** anywhere in the product tree (created only inside per-test temp dirs).

## STATE_MACHINE_TRACE (real `ConversationRuntime`, fake ports; counts are the passing assertions)
Same user message `패치 적용해줘` used for the apply cases; only the anchor state differs — a genuine gating contrast, not a rigged counter. `ConversationRuntime` is the real production class; the port fakes increment counters, so each count is a real runtime decision.
- **preview/plan approval** (`승인`, `applyAnchor: null`): **WorkspaceWrite == 0**
- **apply-before-approval, ELIGIBLE anchor**: **WorkspaceWrite == 0**
- **apply-before-approval, AWAITING_APPROVAL anchor**: **WorkspaceWrite == 0**
- **apply approval, PATCH_READY anchor + final-apply**: **WorkspaceWrite == 1**
  - **PatchSet handed to the writer:** `operations.length == 1`; `operations[0].operation == 'update'`; `operations[0].path == 'gate5/apply-smoke.txt'`
  - `commandRun == 0` (command executor + test runner both go through `command.run`)
  - `gitStatus + gitDiff == 0` (no git read on the apply path)
  - resulting anchor `status == 'WORKSPACE_APPLIED'`; `workspaceChangeRef.status == APPLIED`

## E2E_TRACE (real `LocalWorkspaceWriter` on a real, disposable git repo)
`LocalWorkspaceWriter.applyOperation` is genuinely real (verified by reading `packages/workspace-local/src/index.ts`): reads current bytes, applies the unified diff via `applyPatch`, returns `failed` on non-clean apply, atomic temp-write + rename, **node:fs only — no git, no child_process**.
- Baseline: `git status --porcelain == []`; file bytes == `gate5 apply smoke\nmarker: PENDING\n`.
- Apply result: `status == 'applied'`, `operation == 'update'`, `path == 'gate5/apply-smoke.txt'`.
- **Applied bytes (byte-exact):** `gate5 apply smoke\nmarker: quoky-gate5-workspace-apply\n`.
- **File-only:** status has exactly one line matching `/^M\s+gate5\/apply-smoke\.txt$/` (no adds/deletes/renames).
- **HEAD before == HEAD after apply** (writer performed no git).
- **Rollback** (`git checkout -- gate5/apply-smoke.txt`): status `== []`; **HEAD unchanged**; file bytes restored to the exact baseline.
- Idempotency: a second identical apply → `status == 'failed'` (context `marker: PENDING` gone), file byte-identical, still one changed path — never corrupted/partial.
- Location safety: rootPath under OS `tmpdir()`, contains `quoky-gate5-`, and does **not** contain `chunsik-bot-2` or `quoky-uat-sandbox`.

## PORT_INVOCATION_COUNTS (apply path)
- **WorkspaceWrite (`workspaceWrite.apply`) == 1**
- **Command executor / test runner (`command.run`) == 0**
- **Git read ports (`git.status` + `git.diff`) == 0**
- **Git mutation ports:** proven **0** by the E2E (HEAD identical before apply, after apply, and after rollback → no commit) and by code inspection (`LocalWorkspaceWriter` has no git/child_process path at all). See DISCREPANCIES #1 for the (benign) fact that the runtime state-machine block does not *explicitly* assert the mutation-port counters.

## ROLLBACK_EVIDENCE
- Baseline content restored byte-exact: **YES** (`readFileSync == BASELINE`).
- HEAD unchanged: **YES** (baseline == post-apply == post-rollback SHA).
- Working tree clean after rollback: **YES** (`git status --porcelain == []`).

## INDEPENDENT_PROBE
Wrote a throwaway `packages/workspace-local/src/gate5-probe.qa.test.ts` that builds its own ephemeral git repo + its own `createTwoFilesPatch` diff and drives the REAL `LocalWorkspaceWriter` (imported from `./index`). Deleted afterward; `git status` shows **no probe residue**.
- Result after correcting a bug in MY OWN probe regex: **3 passed (3), exit 0**.
- Probe #1 (positive): applied bytes byte-exact `= APPLIED` and `!= BASELINE`; exactly one modified path; HEAD unchanged; rollback restores baseline byte-exact + HEAD unchanged.
- Probe #2 (falsify): a wrong-context diff → writer `status == 'failed'`, file byte-identical, status clean.
- Probe #3 (falsify): an unrelated operator-written file stays a separate untracked entry; the writer added nothing beyond its one target (status == exactly 2 entries: 1 tracked-modified + my 1 untracked).

## FALSIFICATION_ATTEMPTS (and outcomes)
1. **Silent no-op writer?** Asserted applied bytes `!= BASELINE`. → Held: a real change occurred.
2. **Wrong-content / partial write?** Applied a diff whose context text does not match the file. → Writer returned `failed` and left the file byte-identical (no partial write, no corruption). Matches the reviewed E2E's idempotency test.
3. **Hidden extra writes?** Added an unrelated file myself and confirmed the writer contributed exactly one changed path and nothing else. → Held.
4. **Assertion genuinely tied to real output?** My first probe expected a leading-space porcelain line (`" M …"`); the helper `.trim()`s output so the real line is `"M …"`. The probe *failed on my own wrong expectation* (received `"M gate5/apply-smoke.txt"`) — demonstrating the assertion reflects real git output, not a canned string. Corrected regex → pass.
5. **Rigged runtime counter?** The apply-approval (→1) vs apply-before-approval (→0) tests use the identical message and differ only by anchor state, and run the real `ConversationRuntime`; the write fires only for PATCH_READY. → The boundary is real, not hard-coded.
6. **Production code smuggled in / fixture committed?** `git diff --name-only` vs base = 3 files (doc + 2 tests); named production files unchanged; `apply-smoke.txt` not tracked. → Held.

## DISCREPANCIES
1. **Minor (not a correctness hole):** the runtime state-machine Gate 5 block asserts `commandRun == 0` and `gitStatus + gitDiff == 0`, but does not *explicitly* assert the individual git **mutation**-port counters (`gitCommit` / `gitPush` / `gitSyncMain` / `gitDeleteBranch` == 0). This is a redundancy gap only: git-mutation absence on the apply path is proven independently and more strongly by the real-fs E2E (HEAD identical before apply, after apply, and after rollback ⇒ no commit) and by code inspection (`LocalWorkspaceWriter` uses `node:fs` exclusively — no git, no `child_process`). Commit/push are separate later CA-gated slices (2y/2z/3a) and are out of Gate 5 scope. No change recommended for Gate 5 (production is frozen); optional hardening for a future test-only pass would be to add the four `== 0` assertions.
- Otherwise: **none.** No production change; suite green; all CA §5/§7 assertions verified under independent execution.

## VERDICT
- **GATE5_INTERNAL_QA = PASS** — real `ConversationRuntime` state machine + real `LocalWorkspaceWriter` E2E both green; every §5/§7 assertion (WorkspaceWrite 0/0/1, single `update` op on `gate5/apply-smoke.txt`, command/git-read 0, byte-exact APPLIED, file-only, WORKSPACE_APPLIED, rollback restores baseline with HEAD unchanged) independently confirmed; zero production files changed.
- **GATE5_FINAL_E2E = PASS** — the disposable real-fs repo E2E and my independent probe both demonstrate the exact single-file `update` apply, byte-exact content, file-only mutation, no-git-by-writer, and clean baseline rollback.
