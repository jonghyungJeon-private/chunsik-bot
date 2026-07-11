# Sprint 4c — Gate 5 Workspace-Apply Boundary — Internal QA Completion Record

Independent, adversarial QA. All facts below were re-derived by reading the code
and running the tests; no prior summary was trusted.

- **GATE5_INTERNAL_QA_STATUS = PASS**
- **GATE5_FINAL_INTEGRATED_E2E = PASS**

> **Rerun context.** This record was updated after the CA required (PR #47,
> CHANGES_REQUIRED) a single **connected** integrated E2E — the previous head
> (`1e740a4`) proved only two *halves* separately (a `ConversationRuntime` state
> machine over a recording `workspaceApply` fake, and a standalone
> `LocalWorkspaceWriter` real-fs E2E). The new head adds
> `packages/workspace-local/src/gate5-integrated-e2e.test.ts`, which drives ONE
> real chain end to end. The head/integrated-E2E sections below are current;
> earlier-pass context is preserved in the APPENDIX.

---

## REVIEWED_HEAD
- `da95a3229c45a9a94233dc62228cc2125739f3df` (= `da95a32`; **confirmed** via
  `git rev-parse HEAD`).
- Branch: `v2/sprint-4c-gate5-internal-qa`.
- Base `e6e1b93bb4406dab02eb6cba1d0556329b002def` is a linear ancestor; exactly
  THREE commits sit on top of it, all test/doc-only:
  - `1e740a4` — test(gate5): workspace-apply boundary Internal QA (first pass).
  - `a817b04` — test(gate5): assert git-mutation ports == 0 + preserve QA record
    (resolves the prior pass's DISCREPANCY #1).
  - `da95a32` — test(gate5): connected integrated E2E
    (ConversationRuntime → WorkspaceWriteManager → LocalWorkspaceWriter).

## NODE_VERSION
- `v22.22.1` (via `nvm use 22`). Validation runtime = Node 22 (not .nvmrc's 18).

## TEST_COMMANDS (exact)
1. `pnpm typecheck`
2. `rtk proxy pnpm test` (full suite; raw, un-RTK-filtered counts)
3. `npx vitest run packages/workspace-local/src/gate5-integrated-e2e.test.ts packages/workspace-local/src/gate5-apply-e2e.test.ts packages/core/src/application/conversation-runtime.test.ts -t "Gate 5" --reporter=verbose`
   - plain invocation was condensed by the RTK hook to `PASS (9) FAIL (0)`; re-ran
     the same command under `rtk proxy` to capture the nine verbose test names.
4. Independent probe (throwaway, deleted after):
   `rtk proxy npx vitest run packages/workspace-local/src/gate5-probe.qa.test.ts --reporter=verbose`

## PASS_FAIL_COUNTS
- **Typecheck:** exit 0, no errors (`tsc -b tsconfig.build.json`).
- **Full suite (`pnpm test`):** exit 0 — **Test Files 57 passed (57); Tests 1232 passed (1232)**; 0 failed.
- **Focused Gate 5:** exit 0 — **3 files, 9 passed, 437 skipped (446)**; 0 failed. The nine:
  - runtime: `apply approval (PATCH_READY) + final-apply → exactly ONE WorkspaceWrite of the single gate5 update op; command/git 0; WORKSPACE_APPLIED`
  - runtime: `apply requested BEFORE apply-approval (ELIGIBLE / AWAITING_APPROVAL) → zero WorkspaceWrite`
  - runtime: `a distinct plan/preview approval boundary never writes: "승인" with no apply context → zero WorkspaceWrite`
  - apply-e2e: `single update op → byte-exact, file-only mutation; then a one-file rollback restores the exact baseline`
  - apply-e2e: `re-applying the same op is deterministic (idempotent bytes) and never escapes the file`
  - apply-e2e: `the disposable repo is neither the product repo nor the UAT sandbox`
  - **integrated-e2e: `apply requested BEFORE approval (ELIGIBLE anchor) → no write reaches the real fs`**
  - **integrated-e2e: `PATCH_READY apply → real single-`update` mutation (byte-exact, file-only), then a one-file rollback restores baseline`**
  - **integrated-e2e: `the disposable repo is neither the product repo nor the UAT sandbox`**

## CHANGED_FILES (diff vs e6e1b93; classification)
`git diff --name-status e6e1b93..HEAD` → exactly 5 files. `git diff --name-only … | grep -vE '\.test\.ts$|^docs/plans/'` → **empty** (all changes are `*.test.ts` or `docs/plans/*`):
- `A docs/plans/sprint-4c-gate5-internal-qa-record.md` — **DOC** (this record)
- `A docs/plans/sprint-4c-gate5-workspace-apply-boundary-validation-plan.md` — **DOC**
- `M packages/core/src/application/conversation-runtime.test.ts` — **TEST/HARNESS** (Gate 5 state-machine block, real `ConversationRuntime` + recording ports; now also asserts git-mutation counters == 0)
- `A packages/workspace-local/src/gate5-apply-e2e.test.ts` — **TEST** (standalone real-fs writer E2E)
- `A packages/workspace-local/src/gate5-integrated-e2e.test.ts` — **TEST** (the NEW connected E2E)
- **PRODUCTION: NONE.** Explicitly confirmed unchanged vs e6e1b93 (empty
  `git diff --stat` for each):
  `packages/core/src/application/conversation-runtime.ts`,
  `packages/core/src/application/workspace-write-manager.ts`,
  `packages/workspace-local/src/index.ts`,
  `packages/core/src/application/intent-classifier.ts`.
- Fixture `gate5/apply-smoke.txt` is **not tracked** anywhere in the product tree
  (created only inside per-test OS temp dirs).

## INTEGRATED_E2E_TRACE — the ONE connected chain (`gate5-integrated-e2e.test.ts`)
Verified GENUINELY CONNECTED and REAL by reading the test AND the production it
drives, then running it, then falsifying it independently (see INDEPENDENT_PROBE):

Chain: **REAL `ConversationRuntime.handle('패치 적용해줘')` → REAL
`WorkspaceWriteManager.apply(...)` → REAL `LocalWorkspaceWriter.applyOperation(...)`
→ a real, disposable ephemeral git repo.**

- `deps.workspaceWrite` = `new WorkspaceWriteManager(memoryStorage(), new LocalWorkspaceWriter())`
  — a REAL manager over a real writer and an in-memory `StorageProvider`, **not a
  recording fake.** The runtime is `new ConversationRuntime(deps).handle(...)` — the
  real production class.
- `vi.spyOn(manager, 'apply')` and `vi.spyOn(writer, 'applyOperation')` carry **no**
  `.mockImplementation`/`.mockReturnValue`/`.mockResolvedValue` → default spy
  behaviour = **call through**. Confirmed by reading production:
  `WorkspaceWriteManager.apply` calls `this.writer.applyOperation(...)` per op
  (workspace-write-manager.ts:93); `LocalWorkspaceWriter.applyOperation` reads
  current bytes, `applyPatch`es the unified diff, and atomically temp-writes +
  renames via `node:fs` only — **no git, no `child_process`** (index.ts:416–447).
- **`WorkspaceWriteManager.apply` invoked == 1.**
- **`LocalWorkspaceWriter.applyOperation` invoked == 1.**
- **Op shape** (`opSpy.mock.calls[0]`): `operation == 'update'`,
  `path == 'gate5/apply-smoke.txt'`, and `passedRef.rootPath ==` the ephemeral repo.
- **PatchSet:** `operations.length == 1`, the single op is the `update` above
  (the corrected single-`update` fixture, `marker: PENDING` → `marker: quoky-gate5-workspace-apply`).
- **`WorkspaceChange`** (`await applySpy.mock.results[0].value`): `status == APPLIED`
  (the REAL manager's return value, not a stubbed literal).
- **Re-anchor:** `recorded.reanchor.status == 'WORKSPACE_APPLIED'`, and
  `recorded.reanchor.workspaceChangeRef.status == APPLIED`.
- **Applied bytes (read from real fs via `readFileSync`):**
  `gate5 apply smoke\nmarker: quoky-gate5-workspace-apply\n` (byte-exact APPLIED).
- **File-only:** `git status --porcelain` (harness) has exactly ONE line, matching
  `/^M\s+gate5\/apply-smoke\.txt$/` — nothing added/deleted/renamed.
- **HEAD before == HEAD after** apply (bot committed nothing).
- **Rollback** (`git checkout -- gate5/apply-smoke.txt`, harness-side only):
  status `== []`; HEAD unchanged; bytes restored to the exact baseline
  `gate5 apply smoke\nmarker: PENDING\n`.
- **Before-approval (ELIGIBLE anchor, same message):** `apply == 0`,
  `applyOperation == 0`, no re-anchor, real fs still `BASELINE`, status `== []`,
  HEAD unchanged, `result.status == 'RESPONDED'` (apply-unavailable reply).
- **Location safety:** rootPath under OS `tmpdir()`, contains `quoky-gate5-int-`,
  and does **not** contain `chunsik-bot-2` or `quoky-uat-sandbox`.

## PORT_INVOCATION_COUNTS (integrated test — `expectNoBotSideEffects`)
The BOT ports are `never()` spies that BOTH throw if invoked AND are asserted
`== 0`; the HARNESS git (init/config/add/commit/status/rev-parse/checkout) is a
SEPARATE `execFileSync` helper, isolated via `GIT_CONFIG_GLOBAL=/dev/null` +
`GIT_CONFIG_SYSTEM=/dev/null` — never the bot's ports.
- **WorkspaceWriteManager.apply == 1**
- **LocalWorkspaceWriter.applyOperation == 1**
- **command runner (`command.run`) == 0**
- **git READ (`git.status` + `git.diff` + `git.info`) == 0**
- **git MUTATION (`git.commitFiles` + `git.pushApprovedCommit` + `git.syncMain` + `git.deleteMergedLocalBranch`) == 0**
- **hosting (`repositoryHosting.createPullRequest`) == 0**
- The `conversation-runtime.test.ts` state-machine block ALSO asserts the git
  mutation counters explicitly (`gitCommit + gitPush + gitSyncMain +
  gitDeleteBranch + hostingCreatePR == 0`, line ~6674) — the prior pass's
  DISCREPANCY #1 is now closed.

## STATE_MACHINE (before-approval vs apply counts)
Same user message `패치 적용해줘` for the apply cases; only the anchor state differs —
a genuine gating contrast on the real `ConversationRuntime`, not a rigged counter.
- **plan/preview approval** (`승인`, no apply anchor): **WorkspaceWrite == 0**
- **apply-before-approval, ELIGIBLE anchor**: **WorkspaceWrite == 0** (integrated + runtime)
- **apply-before-approval, AWAITING_APPROVAL anchor**: **WorkspaceWrite == 0**
- **apply approval, PATCH_READY anchor + final-apply**: **WorkspaceWrite == 1** →
  single `update` on `gate5/apply-smoke.txt` → `WORKSPACE_APPLIED` re-anchor.

## INDEPENDENT_PROBE
Wrote a throwaway `packages/workspace-local/src/gate5-probe.qa.test.ts` that builds
its **own** ephemeral git repo, its **own** `createTwoFilesPatch` diff and its **own**
`ConversationRuntimeDeps`, then constructs the SAME real chain (real
`ConversationRuntime` + real `WorkspaceWriteManager` + real `LocalWorkspaceWriter`,
`PATCH_READY` anchor pointing at my repo) with my own assertions. **3 passed (3),
exit 0** (after I corrected ONE wrong assertion in MY OWN probe — see below).
Deleted afterward; `git status` shows **no probe residue**.
- **Probe #1 (positive real chain):** `manager.apply == 1`, `writer.applyOperation == 1`,
  file bytes byte-exact `= APPLIED`, exactly one modified path
  (`M gate5/apply-smoke.txt`), HEAD unchanged, every bot port `== 0`, rollback
  restores `BASELINE` byte-exact with HEAD unchanged.
- **Probe #2 (mock-masquerade falsification — the decisive one):** replaced the writer
  with `vi.spyOn(writer,'applyOperation').mockResolvedValue({status:'applied', …})`
  — a recording fake that CLAIMS success without touching the fs. The count/status/
  re-anchor gates ALL still passed (`apply == 1`, `applyOperation == 1`,
  `reanchor == WORKSPACE_APPLIED`) — **yet the real fs stayed `PENDING` and status was
  clean.** This proves the integrated test's `readFileSync == APPLIED` byte assertion
  is LOAD-BEARING and cannot be satisfied by a mock; the pass genuinely requires the
  real writer to have run.
- **Probe #3 (stale-diff falsification):** corrupted the fixture so the `BASELINE→APPLIED`
  diff no longer applies. The writer WAS invoked once but returned `status == 'failed'`;
  **no `WORKSPACE_APPLIED` re-anchor**; the file was left untouched; the runtime returned
  `result.status == 'FAILED'` (safe-failure via `failComposed`).

## FALSIFICATION_ATTEMPTS (and outcomes)
1. **Mock masquerade (recording fake replaces real writer)?** → CAUGHT. See probe #2:
   the real-fs byte assertion fails under a fake, so the integrated test cannot pass by
   cheating. HELD.
2. **Spies secretly replacing behaviour?** Read the reviewed file: neither `vi.spyOn`
   carries a mock implementation → both call through. Confirmed empirically (real bytes
   change) in probe #1. HELD.
3. **"APPLIED" sourced from a fake, not the real manager?** The `WorkspaceChange` is read
   from `applySpy.mock.results[0].value` (the REAL manager's return) AND the file bytes
   are read from the real fs — both are real, cross-checked. HELD.
4. **Stale/partial write?** Probe #3 + the standalone idempotency test: a non-clean diff →
   `failed`, file byte-identical, no re-anchor, `TurnResult FAILED`. No corruption. HELD.
5. **Rigged runtime counter?** Apply cases share the identical message and differ only by
   anchor state on the real `ConversationRuntime`; the write fires only for `PATCH_READY`.
   HELD.
6. **Production smuggled in / fixture committed?** `git diff --name-only` vs base = 5 files
   (2 docs + 3 tests); the four named production files are byte-identical; `apply-smoke.txt`
   is not tracked. HELD.
7. **Assertion tied to canned string, not real git?** Harness `git()` `.trim()`s output, so
   the real porcelain line is `M gate5/apply-smoke.txt` (leading space stripped) — the regex
   matches real output. HELD.

## DISCREPANCIES
1. **Prior DISCREPANCY #1 — RESOLVED.** The earlier pass noted the runtime state-machine
   block did not explicitly assert git-mutation counters. Commit `a817b04` added
   `gitCommit + gitPush + gitSyncMain + gitDeleteBranch + hostingCreatePR == 0`, and the
   new integrated test's `expectNoBotSideEffects` asserts each mutation port `== 0`
   individually. Closed.
2. **Observation (not a code defect):** a stale-diff apply returns `TurnResult.status ==
   'FAILED'` (not `'RESPONDED'`). This is correct, safe behaviour (`failComposed`); my
   probe's initial expectation was wrong and I fixed MY probe, not the code.
3. Otherwise: **none.** Zero production files changed; full suite green; every CA-mandated
   assertion verified under independent execution.

## CA-MANDATED ASSERTIONS — verification status (all HELD)
- WorkspaceWriteManager.apply == 1 — HELD
- LocalWorkspaceWriter.applyOperation == 1 — HELD
- command == 0 ; test runner (== command.run) == 0 — HELD
- git read == 0 ; git mutation == 0 — HELD
- apply result → WORKSPACE_APPLIED re-anchor ; WorkspaceChange.status == APPLIED — HELD
- PatchSet ops == 1 & operation == update & path == gate5/apply-smoke.txt — HELD
- only target file modified ; applied bytes exact ; rollback bytes exact — HELD
- tree clean after rollback ; HEAD unchanged (before == after == post-rollback) — HELD
- apply-BEFORE-approval → zero writes (manager + writer both 0, fs untouched) — HELD

## VERDICT
- **GATE5_INTERNAL_QA = PASS** — the single connected integrated E2E is genuinely real
  (real runtime → real manager → real writer → real fs; spies call through; byte assertion
  proven load-bearing by an independent mock-masquerade falsification); every CA-mandated
  assertion holds under independent execution; typecheck + full suite (57 files / 1232 tests)
  green; zero production files changed.
- **GATE5_FINAL_INTEGRATED_E2E = PASS** — one `ConversationRuntime.handle('패치 적용해줘')`
  turn drives the whole real chain to a byte-exact, file-only single-`update` apply with a
  `WORKSPACE_APPLIED` re-anchor and no bot git/command/hosting side effect; a harness-side
  one-file rollback restores the exact baseline with HEAD unchanged. Independently reproduced.

---

## APPENDIX — prior QA-pass context (head `1e740a4`, preserved)
The first pass (head `1e740a4`) validated the boundary as TWO separate halves and
returned `GATE5_INTERNAL_QA=PASS` / `GATE5_FINAL_E2E=PASS`:
- **Half A — runtime state machine** (`conversation-runtime.test.ts`): real
  `ConversationRuntime` over recording ports; WorkspaceWrite 0/0/0/1 across
  plan-approval / ELIGIBLE / AWAITING_APPROVAL / PATCH_READY; single `update` op on
  `gate5/apply-smoke.txt`; command/git-read 0; `WORKSPACE_APPLIED` re-anchor.
- **Half B — real-fs writer E2E** (`gate5-apply-e2e.test.ts`): real
  `LocalWorkspaceWriter` on a disposable git repo; byte-exact `update`, file-only,
  no-git-by-writer, idempotent re-apply, clean one-file rollback, sandbox-location safety.
- That pass logged DISCREPANCY #1 (runtime block lacked explicit git-mutation
  counters) — since RESOLVED by `a817b04`.
- The CA (PR #47) then required a SINGLE connected chain rather than two halves;
  `da95a32` added `gate5-integrated-e2e.test.ts`, which this rerun verifies above.
