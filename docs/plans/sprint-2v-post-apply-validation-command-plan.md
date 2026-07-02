# Sprint 2v Plan — Post-Apply Validation Command (WORKSPACE_APPLIED → explicit validation via CommandExecution)

- **Status:** ✅ APPROVED WITH CHANGES (Chief Architect Review) — the 7 required changes are applied below
  (both-test-and-typecheck → clarify; dangerous-fragment → unsupported; clarify/unsupported are RESPONDED not
  failed; preserve `postApplyValidationRef` only when a CommandExecution exists; commit/push wording on all
  terminal outcomes; latest-only ref; Sprint 2l flow untouched). No branch/commit/PR until implementation.
- **Base:** `main` @ `7ea52e0` · **Validation runtime:** Node 22 (to be run at implementation time).
- **Directed by:** Chief Architect (this sprint's topic and constraints are CA-assigned, not Claude-proposed).
- **Goal:** After Sprint 2u leaves a `WORKSPACE_APPLIED` apply anchor (real file mutation done, git/tests
  NOT run), a later turn with an **explicit validation command** ("테스트 돌려줘", "typecheck 해줘", …)
  runs **exactly one pre-approved validation command** (`pnpm test` or `pnpm typecheck`) through the
  existing **CommandExecution** capability (CAP-007), against **the workspace where the file was just
  modified** (`anchor.workspaceRef`), and shows the result. **No git, no commit/push, no additional file
  mutation, no rollback, no ExecutionOrchestrator change.**
- **Phase:** Phase 2 — Product Construction (twelfth runtime sprint, after 2k–2u). **Not** a new capability
  — reuses `CommandExecutionManager` (CAP-007, ADR-0028) exactly as built, the Sprint 2m/2n test-result
  rendering helpers (ADR-0033/0034), and the Sprint 2u `WORKSPACE_APPLIED` anchor + `workspaceChangeRef`.
- **Process:** V2 architecture-first, step 1 (plan-only).

> **Framing.** Every execution-side piece already exists and was verified by reading source (CA "do not
> guess"). `CommandExecutionManager.run(RunCommandInput)` is allow-list + dangerous-arg + risk + Ref-gated,
> delegates to the `CommandRunner` port (argv array, no shell, cwd = workspace root, timeout), and persists
> a `CommandExecution` aggregate — the sole command runner. `pnpm test`/`pnpm typecheck` are **MEDIUM** risk
> (`RiskPolicy.assessCommand`), so they need **no approval**. The Sprint 2u anchor already carries
> `workspaceRef` + `workspaceChangeRef`. So this sprint is composition: recover the `WORKSPACE_APPLIED`
> anchor → detect an explicit validation intent → map it to one fixed command → call
> `command.run({executionPlanRef, workspaceRef, workspaceChangeRef, command:'pnpm', args:['test'|'typecheck']})`
> → render the result. Proceeding with strict command-allowlist discipline: CommandExecution is the only
> thing that runs a command; WorkspaceWrite, Patch, Git, and CodeGeneration are untouched and uncalled.

---

## 1. Objective

`WORKSPACE_APPLIED` anchor (Sprint 2u) carries `executionPlanRef`, `workspaceRef`, `workspaceChangeRef`,
`targetFiles`, `approvalId`, `patchRef`. A later turn with an **explicit validation command** drives
`ConversationRuntime` to:
1. confirm the apply anchor is `WORKSPACE_APPLIED` (a real apply happened) and detect an explicit
   validation intent (§5.4) — a bare "좋아"/"오케이"/"확인"/"다음 단계 진행"/"계속 진행" never triggers;
2. map the phrase to **exactly one** allow-listed command — `테스트`/`test` → `pnpm test`,
   `typecheck`/`타입체크` → `pnpm typecheck`; **both requested or a bare `검증` → a clarification reply**
   (never a silent pick, CA #1/Q4/Q7); **a validation phrase carrying a dangerous/arbitrary command fragment
   → an "unsupported command" reply** (never a run, CA #2); the command + args are **derived, never taken
   from user text**;
3. run it via `command.run({ executionPlanRef: anchor.executionPlanRef, workspaceRef: anchor.workspaceRef,
   workspaceChangeRef: anchor.workspaceChangeRef, command: 'pnpm', args: [...] })` — CommandExecution's
   allow-list/dangerous-arg/risk gates apply; MEDIUM risk means **no approvalRef** (§5.3);
4. interpret the returned `CommandExecution`: `SUCCEEDED` → a "this-run" pass reply; `FAILED` → a
   validation-failure reply (the project's result, not a bot error); `TIMED_OUT` → a distinct timeout reply
   (reusing Sprint 2m framing); a throw / non-terminal → a command-unavailable reply;
5. **preserve `commandExecutionRef(execution)` on the anchor as `postApplyValidationRef`** (Q8) whenever a
   `CommandExecution` was produced (its status is embedded in the ref), keeping `status` = `WORKSPACE_APPLIED`
   — **no** `WORKSPACE_VALIDATED` state (a pass can go stale; VALIDATED would overstate durability);
6. render via `ResponseComposer`, always stating git **commands** were not run and commit/push were not
   performed; success uses "이번 실행 기준으로 통과했어요" — never "완전히 검증됐어요"/"배포 가능해요"/committed/
   pushed/deployed/clean tree.

If there is **no** `WORKSPACE_APPLIED` anchor, the post-apply path is not taken and the existing Sprint 2l
general Live Test Execution behavior is **unchanged** (Q5).

## 2. Central finding — CommandExecution is the built, gated, sole command runner; the anchor already carries what we need

**Verified against source (CA "do not guess"):**
- `CommandExecutionManager` (`command-execution-manager.ts:61-178`): `constructor(storage, runner, risk,
  allowedCommands = DEFAULT_ALLOWED_COMMANDS)`. `run(input: RunCommandInput): Promise<CommandExecution>`
  runs four deterministic gates **before** the runner: (1) allow-list (`DEFAULT_ALLOWED_COMMANDS =
  {'pnpm','npm','node'}`, `:17`), (2) dangerous-arg (`node -e/--eval/-p`, `:25-34`), (3) risk
  (`RiskPolicy.assessCommand`; CRITICAL → refuse, `:90-94`), (4) approval Ref-only (HIGH requires APPROVED
  plan-scoped ApprovalRef; MEDIUM/LOW run without, `:96-111`). It records PENDING→RUNNING, executes via
  `runner.run(command, args, {cwd: workspaceRef.rootPath, timeoutMs})` (`:146`), catches a runner throw into
  a FAILED result (`:147-150`), and persists a terminal `CommandExecution` (SUCCEEDED/FAILED/TIMED_OUT,
  `deriveStatus` `:37-40`). Also `get(id)`, `findByExecutionPlan(id)`, `findByWorkspaceChange(id)`.
- `RunCommandInput` (`command-execution.ts:70-80`): `{ executionPlanRef, approvalRef?, workspaceRef,
  workspaceChangeRef?, command, args, timeoutMs? }` — **already accepts `workspaceChangeRef`**, so a
  post-apply run can be tied to the applied change with no domain change.
- `CommandExecution` aggregate (`command-execution.ts:15-51`): `{ id, executionPlanRef, approvalRef?,
  workspaceRef, workspaceChangeRef?, command, args, commandHash, status, exitCode?, stdout, stderr,
  durationMs, riskLevel, createdAt, updatedAt }`. `stdout/stderr` are **already masked + size-capped by the
  runner adapter**. `CommandExecutionRef = {id, status}`; `commandExecutionRef(exec)` derives it (`:54-62`).
- `CommandExecutionStatus` (`enums.ts`): PENDING/RUNNING/SUCCEEDED/FAILED/TIMED_OUT.
- `RiskPolicy` (`risk-policy.ts:29,42-48,62-70`): `TEST_EXECUTION` capability = MEDIUM; `assessCommand('pnpm
  test' | 'pnpm typecheck')` = **MEDIUM** (no CRITICAL/HIGH pattern match); `requiresApproval` true only for
  HIGH/CRITICAL. → **validation needs no approval**.
- `CommandRunner` port (`command-runner.port.ts`): argv array only, no shell, required timeout, cwd =
  workspace root, minimal env by default, masked+capped output. Adapter-side (`command-local`); core stays
  `child_process`-free.
- **Current Sprint 2l flow** (`conversation-runtime.ts`): `IntentClassifier.detectTestRun`
  (`intent-classifier.ts:83-88`) maps `typecheck`/`타입체크`/`type check` → `'typecheck'`, and
  (`테스트`|`test`) + (`돌려`|`실행`|`run`|`해줘`) or `pnpm test` → `'test'` → `intent{capability:
  TEST_EXECUTION, raw.kind}`. `handleExecutionIntent` → `resolveExecutionWorkspace` opens the workspace
  **from the active project's rootPath** (`:1120-1139`, NOT an anchor) → `runResolvedExecution` →
  `intentResolver.resolve` derives the fixed command via `testCommandFor` (`intent-resolver.ts:63-67`:
  `raw.kind==='typecheck'` → `pnpm typecheck`, else `pnpm test`) → `orchestrator.run(request)` →
  `COMMAND_EXECUTION` stage calls `command.run` (**without** `workspaceChangeRef`, with the orchestrator's
  own `planRef`, `execution-orchestrator.ts:386-392`) → `refs.commandExecutionId` → `frameTestResult`
  (`:1246-1270`) reads the `CommandExecution` and renders `composeTestResult` / `composeTestTimedOut` /
  `composeCommandUnavailable`.
- **Rendering helpers already exist** (`response-composer.ts`): `TestResultDetail` (`:28-38`),
  `composeTestResult` (`:377-391`), `composeTestTimedOut` (`:400-410`), `composeCommandUnavailable`
  (`:426-428`), and the bounded-output helpers `summarizeOutput`/`renderExcerptBlock`/`formatCommand`/
  `formatDuration`/`clampToMessageBudget`. **None of the test-result methods mention git** — so post-apply
  copy needs new methods that reuse these helpers and add the git/commit framing.
- `CommandExecutionManager` is **already a registered provider** (`app.module.ts:222-224`), **already
  injected into `ExecutionOrchestrator`** as `command` (`:291/:300/:310`), and **already injected into
  `ConversationRuntime` as `commandExecutions`** (`:339`, used read-only by `frameTestResult`). Reuse — no
  new registration, import, or inject entry.

**Consequence: no new capability, port, aggregate, migration, or `ExecutionOrchestrator` change.** The only
wiring gaps are on `ConversationRuntime`: add a `command` dep (the same already-injected
`CommandExecutionManager`), add a `postApplyValidationRef?` field to `ApplyPreviewAnchor`, add the
validation-intent detector + one routing branch + one handler, and add post-apply `ResponseComposer` methods.

## 3. Scope (this sprint)

- **`ApplyPreviewAnchor` gains one optional field** `postApplyValidationRef?: CommandExecutionRef` (§5.1) —
  the last post-apply validation run, preserved on the `WORKSPACE_APPLIED` anchor. **No new anchor status**
  (CA Q8: `WORKSPACE_VALIDATED` is deliberately NOT added — a pass can later go stale; VALIDATED would
  overstate durability). `StatelessApplyPreviewFlow` needs no logic change (still maps to the existing inert
  `PENDING` case).
- **`ConversationRuntimeDeps` gains one dependency** (§5.2): `command: { run(input: RunCommandInput):
  Promise<CommandExecution> }` — the existing `CommandExecutionManager`, already injected as
  `commandExecutions`; `app.module.ts` passes `command: commandExecutions` (same instance, §5.6). The
  read-only `commandExecutions.get` dep is unchanged (used by Sprint 2l `frameTestResult`).
- **New explicit post-apply validation detection**, `ConversationRuntime.interpretPostApplyValidationIntent(
  text): 'test' | 'typecheck' | 'ambiguous' | 'unsupported' | null` (§5.4), distinct from
  APPROVE/APPLY/PATCH/FINAL_APPLY words. Bare "좋아"/"오케이"/"확인"/"다음 단계 진행"/"계속 진행" → `null`.
  **CA #1:** both test **and** typecheck requested → `'ambiguous'` (never a silent pick). **CA #2:** a
  validation phrase carrying a dangerous/arbitrary command fragment (a small deterministic denylist) →
  `'unsupported'` (never a run).
- **`handle()` routing** (§5.4): a new branch checked immediately **after** the `AWAITING_APPROVAL`
  interception, guarded on `applyAnchor?.status === 'WORKSPACE_APPLIED'` **and** a non-null validation
  intent. Validation phrases don't overlap FINAL_APPLY/PATCH/APPLY word-sets, so the existing 2u/2t/2s
  branches are untouched; anything else still falls through to the existing classify path (**CA #7:** Sprint
  2l semantics untouched — the detector is consulted only inside the `WORKSPACE_APPLIED` guard).
- **`handlePostApplyValidationTurn`** (§5.5): unsupported/ambiguous → a **RESPONDED** clarify/unsupported
  reply (**CA #3:** never `failComposed`; nothing runs; anchor unchanged; no ref set) → else guard → command
  selection → `command.run` (direct; **no ExecutionOrchestrator**) with `anchor.workspaceRef` +
  `anchor.workspaceChangeRef` → **CA #4:** a throw before an aggregate exists returns WITHOUT re-anchoring and
  WITHOUT setting `postApplyValidationRef` → else preserve `postApplyValidationRef` (latest only, keep
  `WORKSPACE_APPLIED`) → render.
- **New `ResponseComposer` methods** (§5.7, six): `composePostApplyValidationPassed`,
  `composePostApplyValidationFailed`, `composePostApplyValidationTimedOut`,
  `composePostApplyValidationClarify`, **`composePostApplyValidationUnsupported`** (CA #2, distinct from
  clarify), `composePostApplyValidationUnavailable` — reusing the existing bounded-output helpers, adding
  post-apply git/commit framing on **all terminal outcomes** (CA #5), forbidding overstatement.
- **Command allow-list discipline (CA Constraint 3 / #2):** only `pnpm test` / `pnpm typecheck`. The command
  is derived from the detected intent, never from user text. `CommandExecutionManager`'s own allow-list
  (`{'pnpm','npm','node'}`) is broader; Sprint 2v's runtime layer narrows further to exactly these two — it
  never constructs any other command on this path, and a message carrying an out-of-allowlist fragment is
  refused before any run (`'unsupported'`). **Do not run both** in one turn — both → clarify (CA #1/Q7).
- **Workspace source = `anchor.workspaceRef` (CA Q6):** the validation runs where the file was just modified.
  The post-apply path never re-resolves the workspace from the active project or the user's latest message.
- Tests for all of the above (§8), including the CA's 32 explicitly required test items.

## 4. Non-goals (explicit, per Chief Architect direction)

No implementation before plan approval · no branch/commit/PR beyond this plan-only step · `git status`/
`git diff`/`git add`/`git commit`/`git push` (or any git call) · deployment · `pnpm install`/`npm install` ·
`pnpm build` · `rm`/`cat`/`grep`/`curl`/arbitrary shell · `node arbitrary.js` · any user-supplied shell text
· command composition/chaining · **automatic validation immediately after apply** (the user must explicitly
ask) · AI deciding which validation to run · multi-command batch (running both test and typecheck) unless
explicitly scoped/approved · re-running CodeGeneration · regenerating PatchSet · `WorkspaceWrite` / any
further file mutation · rollback · `ExecutionOrchestrator` stage change or a new stage · `Core` contract
change · `CommandExecutionManager` behavior change · a new `WORKSPACE_VALIDATED` anchor state · a new
aggregate/port/repository/migration · claiming committed/pushed/tested-forever/verified/deployed/clean tree.

## 5. Design

### 5.1 `ApplyPreviewAnchor` — one new optional field, no new status

```ts
export interface ApplyPreviewAnchor {
  // ...existing fields (kind, status, executionPlanRef, workspaceRef, targetFiles, codeGenerationRef,
  //    codeProposalRef, instruction, projectId?, createdAt, approvalId?, approvedAt?, patchRef?,
  //    workspaceChangeRef?) ...
  /** The last post-apply validation run (Sprint 2v, ADR-0043) — set when a validation command produced a
   *  CommandExecution on a WORKSPACE_APPLIED anchor. Its embedded `status` distinguishes
   *  SUCCEEDED/FAILED/TIMED_OUT. Preserved for a future git/report sprint. `status` stays WORKSPACE_APPLIED
   *  — a passing run is "this-run only", NOT a durable VALIDATED state (CA Q8). */
  postApplyValidationRef?: CommandExecutionRef;
}
```
`WORKSPACE_APPLIED` remains the terminal apply status. `StatelessApplyPreviewFlow.anchor`'s status→TaskStatus
mapping only special-cases `AWAITING_APPROVAL`; `WORKSPACE_APPLIED` still falls to the inert case — no change
to that file.

### 5.2 `ConversationRuntimeDeps` — one new dependency (the already-injected CommandExecutionManager)

```ts
/** Reused for post-apply validation (Sprint 2v, ADR-0043) — the SAME already-registered
 *  CommandExecutionManager ExecutionOrchestrator depends on and the runtime already reads via
 *  `commandExecutions`. The ONLY thing that runs a command; allow-list/dangerous-arg/risk/Ref-gated. */
readonly command: { run(input: RunCommandInput): Promise<CommandExecution> };
```
The existing `readonly commandExecutions: { get(id): Promise<CommandExecution | null> }` is unchanged.
(`command` and `commandExecutions` are the same instance; kept as two typed deps so the read path and the
execute path stay explicit — mirrors how the orchestrator names it `command`.)

### 5.3 What is run, where, and why no approval (CA Constraints 1/3/4, Q3/Q6/Q7)

- **What:** exactly one of `{command:'pnpm', args:['test']}` or `{command:'pnpm', args:['typecheck']}` —
  derived from the detected intent (§5.4), **never** from user text. Runtime narrows to these two; it never
  builds git/install/build/arbitrary commands on this path.
- **Where (Q6):** `cwd = anchor.workspaceRef.rootPath` — the workspace the file was applied to.
  `anchor.workspaceChangeRef` is passed so the `CommandExecution` is tied to the applied change (Ledger:
  ExecutionPlan → Approval → PatchSet → WorkspaceChange → **CommandExecution**). The path never re-resolves
  the workspace from the active project or the message.
- **Why no approval (Q's implicit):** `pnpm test`/`pnpm typecheck` are MEDIUM (`RiskPolicy.assessCommand`),
  and `requiresApproval` is true only for HIGH/CRITICAL. So no `approvalRef` is supplied and none is needed —
  there is no second approval gate for validation. (If a future command were HIGH, `CommandExecutionManager`
  would refuse it without an APPROVED Ref — a built-in backstop.)
- **Direct call, not the orchestrator (Q3/Q12):** `ConversationRuntime` calls `command.run` directly (like
  Sprint 2q–2u call their capabilities directly). Going through the orchestrator would (a) manufacture a new
  `ExecutionPlan` instead of reusing `anchor.executionPlanRef`, and (b) be unable to pass
  `workspaceChangeRef` without an `ExecutionRequest`/orchestrator contract change (verified: the
  `COMMAND_EXECUTION` stage omits it, `execution-orchestrator.ts:386-392`). Direct call keeps the
  orchestrator **unchanged and uncalled** on this path and preserves the Ref-integrity chain.

### 5.4 `handle()` routing + explicit validation detection (CA Required Changes #1, #2, #7)

```ts
/** A small deterministic denylist of obvious command intent outside the allow-list (CA Required Change #2).
 *  NOT a shell parser — just enough to refuse a validation phrase that also carries a destructive/unrelated
 *  command fragment or a shell operator. Matches: rm -rf, git, curl, cat, grep, npm/pnpm install, pnpm
 *  build, node -e/--eval, and the operators ; && | > . */
const VALIDATION_DENY_FRAGMENT =
  /(\brm\s+-rf?\b|\bgit\b|\bcurl\b|\bcat\b|\bgrep\b|\b(?:npm|pnpm)\s+install\b|\bpnpm\s+build\b|\bnode\s+--?e(val)?\b|;|&&|\|\||\||>)/i;

/** Explicit post-apply validation intent (Sprint 2v, ADR-0043) — distinct from APPROVE/APPLY/PATCH/
 *  FINAL_APPLY words. A bare "좋아"/"오케이"/"확인"/"다음 단계 진행"/"계속 진행" never matches (CA Q4). The
 *  command is DERIVED from the matched kind, never from user text. Returns:
 *    'test' | 'typecheck'  → run exactly that one command
 *    'ambiguous'           → clarify (bare "검증", OR BOTH test and typecheck requested — CA #1)
 *    'unsupported'         → a validation phrase carrying a dangerous/arbitrary command fragment (CA #2)
 *    null                  → not a validation intent at all → fall through (Sprint 2l path / normal routing) */
static interpretPostApplyValidationIntent(
  text: string,
): 'test' | 'typecheck' | 'ambiguous' | 'unsupported' | null {
  const t = text.trim().toLowerCase();
  const mentionsTypecheck = /(typecheck|타입\s*체크|type\s*check)/i.test(t);
  const mentionsTest = /(테스트|\btest\b)/i.test(t);
  const actionVerb = /(돌려|실행|run|해줘|해\s*줘)/i.test(t);
  const wantsTest = (mentionsTest && actionVerb) || /\bpnpm\s+test\b/i.test(t);
  const wantsValidate = /(검증|validate)/i.test(t);
  // Gate first: with no validation token at all this is NOT our branch — a pure "git status 해줘" falls
  // through untouched (CA #7 / Q5 / test 20), it is never a validation "unsupported" reply.
  if (!mentionsTypecheck && !wantsTest && !wantsValidate) return null;
  // (CA #2) validation phrase + an obvious out-of-allowlist command fragment → unsupported, never a run.
  if (VALIDATION_DENY_FRAGMENT.test(t)) return 'unsupported';
  // (CA #1) BOTH test and typecheck requested → clarify; NEVER silently pick one.
  if (mentionsTypecheck && wantsTest) return 'ambiguous';
  if (mentionsTypecheck) return 'typecheck';
  if (wantsTest) return 'test';
  return 'ambiguous'; // "검증" alone
}
```
Routing — a new branch **immediately after** the `AWAITING_APPROVAL` interception (post-apply follow-ups get
first look; validation phrases don't collide with the 2u/2t/2s word-sets, so those branches are untouched):
```ts
if (applyAnchor?.status === 'AWAITING_APPROVAL') {           // Sprint 2s — unchanged, still first
  return this.handleApplyApprovalTurn(message, session, actor, applyAnchor);
}

// (Sprint 2v, ADR-0043) Explicit post-apply validation → run pnpm test / pnpm typecheck via
// CommandExecution against the workspace the file was applied to. ONLY on a WORKSPACE_APPLIED anchor;
// with no such anchor the message falls through to the existing Sprint 2l general test flow (CA #7 / Q5).
if (applyAnchor?.status === 'WORKSPACE_APPLIED') {
  const kind = ConversationRuntime.interpretPostApplyValidationIntent(message.text);
  if (kind) return this.handlePostApplyValidationTurn(message, session, applyAnchor, kind);
}

// (Sprint 2u) final-apply, (2t) patch-intent, (2s) apply-intent — unchanged ...
// ... fall through to classify → existing Sprint 2l TEST_EXECUTION path when no post-apply match.
```
At `WORKSPACE_APPLIED`, a final/patch/apply phrase still routes to `composeWorkspaceAlreadyApplied` (Sprint
2u, CA Round 1 #8) — unaffected, because those checks come after and validation phrases don't match them.
**Existing Sprint 2l semantics are untouched (CA #7):** the classifier/`IntentResolver`/orchestrator
`TEST_EXECUTION` path is unchanged; general test/typecheck with **no** `WORKSPACE_APPLIED` anchor never
enters the new direct-command branch (`interpretPostApplyValidationIntent` is only consulted inside the
`WORKSPACE_APPLIED` guard).

### 5.5 `handlePostApplyValidationTurn` — the main flow

```ts
private async handlePostApplyValidationTurn(
  message: InboundMessage,
  session: Session,
  anchor: ApplyPreviewAnchor,
  kind: 'test' | 'typecheck' | 'ambiguous' | 'unsupported',
): Promise<TurnResult> {
  // 1. (CA #2/#3) A validation phrase carrying a dangerous/arbitrary command fragment → a distinct
  //    "unsupported command" reply. This is a NORMAL turn (RESPONDED), not a failure; nothing runs, the
  //    anchor is NOT re-anchored, postApplyValidationRef is NOT set.
  if (kind === 'unsupported') {
    return this.respondComposed(message, session, this.deps.composer.composePostApplyValidationUnsupported(message.context));
  }

  // 2. (CA #1/#3) Ambiguous — bare "검증" OR both test+typecheck requested → ask which ONE to run. Also a
  //    NORMAL turn (RESPONDED), never failComposed; nothing runs, anchor unchanged, no ref set.
  if (kind === 'ambiguous') {
    return this.respondComposed(message, session, this.deps.composer.composePostApplyValidationClarify(message.context));
  }

  // 3. Anchor guard: WORKSPACE_APPLIED must carry the refs we need (defensive; set at apply time).
  if (!anchor.workspaceRef || !anchor.executionPlanRef) {
    return this.failComposed(message, session, this.deps.composer.composePostApplyValidationUnavailable(message.context));
  }

  // 4. Derive exactly one allow-listed command — NEVER from user text (CA Constraint 3 / #2).
  const args = kind === 'typecheck' ? ['typecheck'] : ['test'];

  // 5. Run it via CommandExecution — the ONLY command runner. cwd = the applied workspace (CA Q6); tied to
  //    the applied change via workspaceChangeRef (CA Q8). MEDIUM risk → no approvalRef needed (§5.3).
  //    (CA #4) On a throw BEFORE a CommandExecution exists, we return WITHOUT re-anchoring and WITHOUT
  //    setting postApplyValidationRef — there is no execution ref to preserve; the prior anchor is kept.
  let execution: CommandExecution;
  try {
    execution = await this.deps.command.run({
      executionPlanRef: anchor.executionPlanRef,
      workspaceRef: anchor.workspaceRef,
      ...(anchor.workspaceChangeRef ? { workspaceChangeRef: anchor.workspaceChangeRef } : {}),
      command: 'pnpm',
      args,
    });
  } catch {
    this.logPostApplyValidationFailed(session, anchor, 'command execution threw');
    // NO applyPreviewFlow.anchor call here (CA #4).
    return this.failComposed(message, session, this.deps.composer.composePostApplyValidationUnavailable(message.context));
  }

  // 6. (CA #4/#6) A CommandExecution now exists (SUCCEEDED/FAILED/TIMED_OUT). Preserve its ref on the
  //    anchor as postApplyValidationRef — LATEST ONLY (replaces any prior; no history on the anchor —
  //    CommandExecution storage owns history). status stays WORKSPACE_APPLIED (no WORKSPACE_VALIDATED).
  await this.deps.applyPreviewFlow.anchor(session, {
    ...anchor,
    postApplyValidationRef: commandExecutionRef(execution),
  });

  // 7. Render the result (CA Q9/Q10/Q11). Detail reuses the Sprint 2m/2n bounded-output helpers.
  const detail = ConversationRuntime.toTestResultDetail(execution); // existing static helper (ADR-0034)
  if (execution.status === CommandExecutionStatus.SUCCEEDED || execution.status === CommandExecutionStatus.FAILED) {
    const passed = execution.status === CommandExecutionStatus.SUCCEEDED;
    const reply = passed
      ? this.deps.composer.composePostApplyValidationPassed(message.context, detail)
      : this.deps.composer.composePostApplyValidationFailed(message.context, detail);
    // pass → RESPONDED; fail → the project's result (not a bot error), rendered but recorded as a normal turn
    return this.respondComposed(message, session, reply);
  }
  if (execution.status === CommandExecutionStatus.TIMED_OUT) {
    const reply = this.deps.composer.composePostApplyValidationTimedOut(message.context, detail);
    return this.failComposed(message, session, reply);
  }
  // Non-terminal / unexpected (defensive) — CommandExecution normally returns a terminal status.
  return this.failComposed(message, session, this.deps.composer.composePostApplyValidationUnavailable(message.context));
}
```
The failure-log helper (structured, no output/content):
```ts
private logPostApplyValidationFailed(session: Session, anchor: ApplyPreviewAnchor, reason: string): void {
  this.deps.logger.warn('post-apply validation failed', {
    reason,
    sessionId: session.id,
    executionPlanId: anchor.executionPlanRef.id,
    workspaceChangeId: anchor.workspaceChangeRef?.id,
  }); // deliberately NO stdout/stderr / file content
}
```
**No rollback, no WorkspaceWrite, no git on any branch** (CA Q10/Q11). `FAILED`/`TIMED_OUT` keep the
`WORKSPACE_APPLIED` anchor (step 6 re-anchors with the same status + the ref). **Clarify/unsupported are
`RESPONDED`, record the assistant reply, and never re-anchor** (CA #3). **A throw before an aggregate exists
never re-anchors and never sets `postApplyValidationRef`** (CA #4). The user may decide a later code-change
sprint.

### 5.6 `app.module.ts` — pass the already-injected CommandExecutionManager as `command`

The `ConversationRuntime` factory **already injects `CommandExecutionManager` as `commandExecutions`**
(`app.module.ts:339`). Sprint 2v adds one line to the deps object: `command: commandExecutions` (same
instance). **No new import, no new `inject` entry, no new provider.** (The read dep `commandExecutions`
stays for Sprint 2l `frameTestResult`.)

### 5.7 `ResponseComposer` — new post-apply methods (reuse bounded-output, add git framing)

All reuse the existing `summarizeOutput`/`renderExcerptBlock`/`formatCommand`/`formatDuration`/
`clampToMessageBudget` (CA Q9 "existing bounded behavior"). **CA Q9 forbidden across all:** committed /
pushed / deployed / 완전히 검증됐어요 / 배포 가능해요 / permanently verified / safe forever / clean tree.

```ts
/** Post-apply validation PASSED (Sprint 2v, ADR-0043). "This-run" phrasing only (CA Q9) — a pass can go
 *  stale. States git commands were not run and commit/push were not performed. Never
 *  committed/pushed/deployed/완전히 검증/배포 가능/clean tree. */
composePostApplyValidationPassed(context, detail: TestResultDetail): OutboundMessage {
  const label = detail.kind === 'typecheck' ? '타입체크' : '테스트';
  const summary = summarizeOutput(detail.stdout, detail.stderr);
  return { context, text: clampToMessageBudget([
    `이번 실행 기준으로 ${label}가 통과했어요. ✅`,
    `명령: ${formatCommand(detail)}`,
    `종료 코드: ${detail.exitCode ?? '-'}`,
    `실행 시간: ${formatDuration(detail.durationMs)}`,
    renderExcerptBlock(summary),
    'git 명령은 실행하지 않았어요. 커밋/푸시는 하지 않았어요.',
  ].join('\n')) };
}

/** Post-apply validation FAILED — the project's result, not a bot error (CA Q10). CA Required Change #5:
 *  states git commands were not run AND commit/push were not performed; may add that no rollback happened. */
composePostApplyValidationFailed(context, detail: TestResultDetail): OutboundMessage {
  const label = detail.kind === 'typecheck' ? '타입체크' : '테스트';
  const summary = summarizeOutput(detail.stdout, detail.stderr);
  return { context, text: clampToMessageBudget([
    `${label}에서 실패가 있었어요. ❌ (적용한 파일은 그대로 두었어요)`,
    `명령: ${formatCommand(detail)}`,
    `종료 코드: ${detail.exitCode ?? '-'}`,
    `실행 시간: ${formatDuration(detail.durationMs)}`,
    renderExcerptBlock(summary),
    'git 명령은 실행하지 않았어요. 커밋/푸시는 하지 않았어요.',
    '되돌리기(rollback)도 하지 않았어요.',
  ].join('\n')) };
}

/** Post-apply validation TIMED_OUT — distinct from failure (CA Q11), reuses Sprint 2m timeout framing.
 *  CA Required Change #5: states git commands were not run AND commit/push were not performed; may add that
 *  validation did not complete. */
composePostApplyValidationTimedOut(context, detail: TestResultDetail): OutboundMessage {
  const label = detail.kind === 'typecheck' ? '타입체크' : '테스트';
  return { context, text: clampToMessageBudget([
    `${label}가 제한 시간 안에 끝나지 않아 중단됐어요. (검증이 끝까지 완료되지 않았어요)`,
    `명령: ${formatCommand(detail)}`,
    `실행 시간: ${formatDuration(detail.durationMs)}`,
    'git 명령은 실행하지 않았어요. 커밋/푸시는 하지 않았어요.',
    '적용한 파일은 그대로 있어요.',
  ].join('\n')) };
}

/** Ambiguous validation — bare "검증", OR both test and typecheck requested (CA #1). Ask for exactly one.
 *  A NORMAL response (RESPONDED), never a failure (CA #3); no command runs. */
composePostApplyValidationClarify(context): OutboundMessage {
  return { context, text: '한 번에 하나만 검증할 수 있어요. "테스트" 또는 "타입체크" 중에 무엇을 실행할지 알려 주세요. (pnpm test / pnpm typecheck)' };
}

/** A validation phrase carried a command outside the allow-list (CA Required Change #2) — distinct from the
 *  ambiguous "검증" clarify. A NORMAL response (RESPONDED); no command runs. */
composePostApplyValidationUnsupported(context): OutboundMessage {
  return { context, text: '검증 명령은 pnpm test 또는 pnpm typecheck만 실행할 수 있어요. 다른 명령은 실행하지 않았어요.' };
}

/** Validation could not run at all (unexpected throw / non-terminal) — not a validation verdict. */
composePostApplyValidationUnavailable(context): OutboundMessage {
  return { context, text: '검증 명령을 실행할 수 없었어요. 잠시 후 다시 시도해 주세요. git 명령은 실행하지 않았어요. 커밋/푸시는 하지 않았어요.' };
}
```
`toTestResultDetail` (existing static, `conversation-runtime.ts:1225`) already sets `kind` from
`args.includes('typecheck')` and carries the masked/capped stdout/stderr — reused unchanged.

## 6. Required Architecture Questions — answers for CA review

**Q1. Current CommandExecution API?** Documented from source in §2: `CommandExecutionManager.run(
RunCommandInput)/get/findByExecutionPlan/findByWorkspaceChange`; `RunCommandInput {executionPlanRef,
approvalRef?, workspaceRef, workspaceChangeRef?, command, args, timeoutMs?}`; `CommandExecution` aggregate
(status PENDING/RUNNING/SUCCEEDED/FAILED/TIMED_OUT, masked/capped stdout/stderr, commandHash, exitCode?,
durationMs, riskLevel); `CommandExecutionRef {id,status}`; four gates (allow-list `{'pnpm','npm','node'}` +
dangerous-arg + risk + Ref-only approval) before the runner; default timeout `DEFAULT_COMMAND_TIMEOUT_MS =
120_000`; runner-throw caught into a FAILED record; persists to `storage.commandExecutions`.

**Q2. What happens today on "테스트 돌려줘"?** `IntentClassifier.detectTestRun` → `intent{TEST_EXECUTION,
raw.kind:'test'}`; approval **not** required (MEDIUM); workspace resolved **from the active project's
rootPath** (not an anchor); `intentResolver` derives `pnpm test` (typecheck → `pnpm typecheck`);
`orchestrator.run` → `COMMAND_EXECUTION` stage → `command.run` (no workspaceChangeRef) → `frameTestResult`
renders `composeTestResult`/`composeTestTimedOut`/`composeCommandUnavailable`. §2 cites lines.

**Q3. Reuse existing flow or add a post-apply flow?** Reuse the **CommandExecution capability** and the
**bounded-output rendering helpers**; add **only** minimal `WORKSPACE_APPLIED`-aware routing + a direct
`command.run` call + post-apply composer methods. Do **not** duplicate CommandExecution semantics, and do
**not** route post-apply validation through the orchestrator (it would remint the plan and can't carry
`workspaceChangeRef` — §5.3).

**Q4. Trigger? (APPROVED WITH CHANGE)** `interpretPostApplyValidationIntent` (§5.4): `typecheck`/`타입체크`/
`type check` → typecheck; (`테스트`|`test`)+action-verb or `pnpm test` → test; `검증`/`validate` alone →
ambiguous (clarify); **both test and typecheck → ambiguous (clarify), never a silent pick (CA #1)**; **a
validation phrase carrying a dangerous/arbitrary command fragment → unsupported, no run (CA #2)**.
"좋아"/"오케이"/"확인"/"다음 단계 진행"/"계속 진행" and any message with no validation token → null (fall
through). Phrase→command mapping is fixed; command args are derived, never user text.

**Q5. Does validation require WORKSPACE_APPLIED?** For the **post-apply** copy/flow: **yes** — the branch
only fires on a `WORKSPACE_APPLIED` anchor. With no such anchor, the message falls through to the existing
Sprint 2l general Live Test Execution path, **unchanged**. Post-apply wording is used only when
`WORKSPACE_APPLIED` exists.

**Q6. What workspace?** `anchor.workspaceRef` — the workspace where the file was just applied. The post-apply
path never re-resolves the workspace from the active project or the user's latest message.

**Q7. What command? (APPROVED WITH CHANGE)** `pnpm test` or `pnpm typecheck`, **one per turn** — mapped from
the detected kind (§5.4/§5.5). `검증` alone → clarify (no default run). **Both requested → clarify (CA #1)**,
never a silent pick. A dangerous/arbitrary fragment → unsupported (CA #2). Args derived, never user text.

**Q8. Anchor the result?** Preserve `commandExecutionRef(execution)` as `anchor.postApplyValidationRef`
(new optional field) whenever a `CommandExecution` was produced; the ref's `status` records the outcome.
**No** new aggregate. **No** `WORKSPACE_VALIDATED` state — a pass is "this-run" only; VALIDATED would
overstate durability (CA Q8). `status` stays `WORKSPACE_APPLIED`.

**Q9. Rendering?** `ResponseComposer` (§5.7) — reuses the existing bounded stdout/stderr excerpt behavior;
each reply states git **commands** were not run and commit/push were not performed; success is "이번 실행
기준으로 통과했어요". Forbidden: committed/pushed/deployed/완전히 검증됐어요/배포 가능해요/permanently
verified/clean tree.

**Q10. Validation fails?** No rollback, no WorkspaceWrite, no git; `composePostApplyValidationFailed` shows
the failure detail (the project's result); `WORKSPACE_APPLIED` anchor kept (re-anchored with the ref, same
status).

**Q11. Validation times out?** No rollback, no git; `composePostApplyValidationTimedOut` — distinct from a
failure verdict (no exit code), reusing Sprint 2m framing; `WORKSPACE_APPLIED` anchor kept.

**Q12. Does ExecutionOrchestrator change?** **No.** The handler calls `deps.command.run` directly (as
Sprint 2q–2u call their capabilities directly). No new `ExecutionStage`; the orchestrator is neither
changed nor called on this path.

**Q13. Prove no hidden side effects? (APPROVED WITH CHANGE)** Tests (§8): `command.run` called only for `pnpm
test`/`pnpm typecheck` on a valid `WORKSPACE_APPLIED` + explicit-validation turn (never on
ambiguous/unsupported/other paths); `workspaceWrite.apply` 0, `patch.generate` 0, `patch.get` 0,
`codeGeneration.generate` 0, git 0, `orchestrator.run`/`.resume` 0; no arbitrary shell; no automatic run
after apply; the command uses `anchor.workspaceRef` (asserted on `command.run` input), never a re-resolved
workspace. **Added per CA #13:** dangerous command fragments do NOT run (`command.run` 0); both test+typecheck
does NOT run (clarify); clarification does NOT set `postApplyValidationRef` and does NOT re-anchor; a
`command.run` throw does NOT set `postApplyValidationRef` and does NOT call `applyPreviewFlow.anchor`.

## 6a. Constraint 5 — validation artifacts / cache (CA-required discussion)

Sprint 2v calls **no** `WorkspaceWrite` and mutates **no** source file. However, `pnpm test`/`pnpm
typecheck` may, as a property of the existing CommandExecution runtime, write **tool/runtime artifacts**
inside the workspace — e.g. `tsc -b` incremental build info (`.tsbuildinfo`), `dist/` output, a Vitest
cache, or `node_modules/.cache`. Framing:
- These are **not** treated as workspace **source** mutation. **WorkspaceWrite remains the only source
  mutator** ([[workspace-write-mutation-boundary]]); Sprint 2v adds no file-write path of its own.
- The product **does not inspect the working tree, run git, or claim a clean tree** after validation — so it
  never asserts anything about whether artifacts were produced. The success/failure/timeout copy explicitly
  says git commands were not run and commit/push were not performed.
- Whether such artifacts appear is governed by the **existing** CommandExecution environment (the same one
  Sprint 2l already uses for `pnpm test`); Sprint 2v neither widens nor changes it. If a future sprint wants
  to run validation in an artifact-isolated way, that is a separate CommandExecution-environment concern with
  its own plan/CA review.
- Net: Sprint 2v's mutation surface is **zero source writes**; any tool artifact is pre-existing runtime
  behavior, not a Sprint 2v action, and is never surfaced as a product claim.

## 7. Case matrix

| Case | Detection | Result |
|---|---|---|
| 1. WORKSPACE_APPLIED + "테스트 돌려줘"/"테스트 실행해줘"/"pnpm test 실행해줘" | `test` | `command.run` `pnpm test` @ anchor.workspaceRef (+workspaceChangeRef); SUCCEEDED → `composePostApplyValidationPassed`; ref preserved (RESPONDED) |
| 2. WORKSPACE_APPLIED + "typecheck 해줘"/"타입체크 해줘"/"pnpm typecheck 실행해줘" | `typecheck` | `command.run` `pnpm typecheck`; render pass/fail/timeout |
| 3. WORKSPACE_APPLIED + "검증해줘" (no test/typecheck qualifier) | `ambiguous` | `composePostApplyValidationClarify` (**RESPONDED**), **no run**, anchor unchanged, no ref (CA #3) |
| 3b. WORKSPACE_APPLIED + "테스트랑 타입체크 해줘"/"pnpm test랑 pnpm typecheck 실행해줘" (both) | `ambiguous` (CA #1) | `composePostApplyValidationClarify` (**RESPONDED**), **no run**, no silent pick |
| 3c. WORKSPACE_APPLIED + "테스트 돌려줘 rm -rf /"/"…&& git status"/"pnpm test; git commit"/"typecheck 해줘 node -e …" | `unsupported` (CA #2) | `composePostApplyValidationUnsupported` (**RESPONDED**), **no run**, anchor unchanged, no ref |
| 4. WORKSPACE_APPLIED + "좋아"/"오케이"/"확인"/"다음 단계 진행"/"계속 진행" | null (no validation token) | fall through; no post-apply run |
| 4b. WORKSPACE_APPLIED + a pure "git status 해줘" (no validation token) | null (CA #7) | fall through to normal routing/classify; **not** routed through validation (test 20) |
| 5. Command `FAILED` (exit ≠ 0) | returned status | `composePostApplyValidationFailed` (git-not-run + commit/push-not-performed + no-rollback); WORKSPACE_APPLIED kept + ref preserved |
| 6. Command `TIMED_OUT` | returned status | `composePostApplyValidationTimedOut` (distinct; git-not-run + commit/push-not-performed + not-completed); WORKSPACE_APPLIED kept + ref preserved |
| 7. `command.run` throws / non-terminal | caught / defensive | `composePostApplyValidationUnavailable`; failure logged; **no re-anchor, no `postApplyValidationRef`** (CA #4) |
| 8. **No** WORKSPACE_APPLIED anchor + "테스트 돌려줘"/"typecheck 해줘" | not the post-apply branch | existing Sprint 2l flow (classify → orchestrator TEST_EXECUTION), **unchanged** (CA #7) |
| 9. WORKSPACE_APPLIED + "패치 적용해줘"/"적용해줘"/"패치 만들어줘" | final/patch/apply intent (Sprint 2u) | `composeWorkspaceAlreadyApplied` — unaffected by Sprint 2v |
| 10. `test` validation then a later "타입체크 해줘" | two separate turns | second run `pnpm typecheck`; `postApplyValidationRef` **replaced** by the latest ref (no history on anchor, CA #6) |

## 8. Required Tests (Node 22) — the CA's full 47-item list

**`conversation-runtime.test.ts`** — run + selection (1–4): 1. WORKSPACE_APPLIED + "테스트 돌려줘" →
`command.run` once with `pnpm test`. 2. + "pnpm test 실행해줘" → `pnpm test`. 3. + "typecheck 해줘" →
`pnpm typecheck`. 4. + "타입체크 해줘" → `pnpm typecheck`.

Clarify / negative / not-automatic (5–10): 5. "검증해줘" → `composePostApplyValidationClarify`, **no**
`command.run`. 6. "테스트랑 타입체크 해줘" → clarify, no `command.run` (CA #1). 7. "pnpm test랑 pnpm
typecheck 실행해줘" → clarify, no `command.run` (CA #1). 8. "좋아"/"오케이"/"확인" → no `command.run`.
9. "다음 단계 진행" → no `command.run`. 10. **not automatic** — a `handleWorkspaceApplyTurn` success (Sprint
2u) performs **zero** `command.run` (validation only on a later explicit turn).

Workspace source / Sprint 2l regression (11–15): 11. `command.run` input `workspaceRef` ===
`anchor.workspaceRef`. 12. `command.run` input `workspaceChangeRef` === `anchor.workspaceChangeRef` when
present (+ `executionPlanRef` === `anchor.executionPlanRef`). 13. with a WORKSPACE_APPLIED anchor the
workspace is **not** re-resolved (`workspace.open` not called on this path). 14. **no** WORKSPACE_APPLIED
anchor + "테스트 돌려줘" → existing Sprint 2l general path (classify → orchestrator; direct `command.run` 0).
15. **no** WORKSPACE_APPLIED anchor + "typecheck 해줘" → existing general path (CA #7).

Command surface / denylist (16–20, CA #2): 16. only `pnpm test`/`pnpm typecheck` ever reach `command.run`
(args asserted). 17. "테스트 돌려줘 rm -rf /" → unsupported, **no** `command.run`. 18. "테스트 돌려줘 &&
git status" → unsupported, no `command.run`. 19. "pnpm test; git commit" → unsupported, no `command.run`.
20. a git command request ("git commit 해줘", no validation token) is **not** routed through the validation
flow (`interpret… ` → null → fall through; no `command.run`).

Rendering (21–27): 21. SUCCEEDED → reply has command + bounded output + "이번 실행 기준으로 … 통과".
22. FAILED → reply has command + bounded output, framed as the project's result. 23. TIMED_OUT distinct from
FAILED (no exit-code verdict; timeout wording). 24. **passed** reply says git command not run **and**
commit/push not performed (CA #5). 25. **failed** reply says git command not run **and** commit/push not
performed (CA #5). 26. **timeout** reply says git command not run **and** commit/push not performed (CA #5).
27. no reply says deployed / permanently verified / clean tree / 완전히 검증 / 배포 가능 (forbidden scan).

No rollback / anchor kept (28–30): 28. FAILED → no `workspaceWrite.apply`, no git, no rollback. 29. FAILED
keeps `WORKSPACE_APPLIED` (status unchanged). 30. TIMED_OUT keeps `WORKSPACE_APPLIED`.

Throw → no ref / no re-anchor (31–32, CA #4): 31. `command.run` throws → `postApplyValidationRef` **not**
set. 32. `command.run` throws → `applyPreviewFlow.anchor` **not** called (prior anchor kept), reply
`composePostApplyValidationUnavailable`, failure logged.

Ref preservation / latest-only (33–36): 33. SUCCEEDED preserves `postApplyValidationRef =
commandExecutionRef(execution)` (status stays WORKSPACE_APPLIED). 34. FAILED preserves
`postApplyValidationRef`. 35. TIMED_OUT preserves `postApplyValidationRef`. 36. a **second** validation
**replaces** `postApplyValidationRef` with the latest ref (no history on the anchor, CA #6).

No new state / no side effects (37–45): 37. no new aggregate (structural). 38. no `WORKSPACE_VALIDATED`
status introduced. 39. no `workspaceWrite.apply`. 40. no `patch.generate`. 41. no `patch.get`. 42. no
`codeGeneration.generate`. 43. no git call. 44. no `orchestrator.run`/`.resume` on the post-apply path.
45. no shell command outside the allow-list reaches `command.run` (the fake asserts command+args).

**Also (CA #3 — clarify/unsupported are RESPONDED, not failures):** clarify and unsupported results have
`TurnResult.status === 'RESPONDED'`, record the assistant reply to memory, do **not** re-anchor, and do
**not** set `postApplyValidationRef`.

**`response-composer.test.ts`**: `composePostApplyValidationPassed` (this-run pass + command + bounded output
+ git-not-run **and** commit/push-not-performed; forbidden: committed/pushed/deployed/완전히 검증/배포 가능/
clean tree), `composePostApplyValidationFailed` (project-result framing + git-not-run + commit/push-not-
performed + no-rollback), `composePostApplyValidationTimedOut` (distinct from failed, no exit-code verdict, +
git-not-run + commit/push-not-performed), `composePostApplyValidationClarify` (asks for exactly one, runs
nothing), `composePostApplyValidationUnsupported` (pnpm test/typecheck only; distinct from clarify),
`composePostApplyValidationUnavailable` (not a verdict) — all six distinct.

**Node 22**: 46. `pnpm typecheck` green. 47. `pnpm test` green.

## 9. Architecture Impact / Reuse

- **Reuses, unchanged:** `CommandExecutionManager`/`CommandExecution`/`CommandExecutionRef`/
  `commandExecutionRef()` (CAP-007, ADR-0028 — zero changes; the sole command runner), the `CommandRunner`
  port + `command-local` adapter (zero changes), `RiskPolicy` (validation is MEDIUM → no approval), the
  Sprint 2m/2n bounded-output helpers + `TestResultDetail` + `toTestResultDetail` (reused), the Sprint 2u
  `WORKSPACE_APPLIED` anchor + `workspaceRef`/`workspaceChangeRef` (consumed), `StatelessApplyPreviewFlow`
  (no logic change), the Sprint 2l general test flow (untouched fall-through).
- **Changes:** `conversation-runtime.ts` (+`postApplyValidationRef?` on `ApplyPreviewAnchor`, +1
  `ConversationRuntimeDeps` dep `command`, +`VALIDATION_DENY_FRAGMENT` + `interpretPostApplyValidationIntent`,
  +1 routing branch, +`handlePostApplyValidationTurn` + `logPostApplyValidationFailed`),
  `response-composer.ts` (+**6** methods, reusing existing helpers), `app.module.ts` (+1 line: `command:
  commandExecutions` — reuse the already-injected instance, no new import/inject/provider).
- **No new** aggregate / repository / migration / capability / port / anchor status. **No** `Core` or
  `ExecutionOrchestrator` contract change; the orchestrator is not called on this path. Git and WorkspaceWrite
  untouched.
- **ADR-0043** (to be authored before implementation) must document, per CA-required content:
  - Sprint 2v is **explicit post-apply validation only**; validation is **not automatic** after WorkspaceWrite.
  - CommandExecution is the **only** command runner; allowed validation commands are **`pnpm test` and `pnpm
    typecheck`**; command + args are **derived, never copied from user text**; **one command per turn**.
  - **Requesting both test and typecheck → clarify** (never a silent pick); **`검증` alone → clarify**;
    **dangerous/arbitrary command fragments → unsupported/reject** (no run).
  - Post-apply validation uses **`anchor.workspaceRef`** and passes **`anchor.workspaceChangeRef`**.
  - The CommandExecution result is preserved as **`postApplyValidationRef`** (latest only; no history on the
    anchor — CommandExecution storage owns history); **`WORKSPACE_APPLIED` status stays unchanged**; **no
    `WORKSPACE_VALIDATED` state** — a validation pass is **point-in-time only**.
  - **Failure/timeout do not rollback**; git remains untouched; commit/push are not performed; WorkspaceWrite
    is not called.
  - **ExecutionOrchestrator is unchanged and uncalled** on the post-apply path.
  - **Existing Sprint 2l general test execution remains unchanged** when no `WORKSPACE_APPLIED` anchor exists.
  - Validation commands **may create tool/runtime artifacts, but the product makes no clean-tree claim** (§6a).

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| A non-validation phrase runs a command | High (safety) | `interpretPostApplyValidationIntent` matches only qualified validation tokens; bare 좋아/오케이/확인/다음 단계 진행/계속 진행 → null (§5.4) — tested (§8 8–9) |
| User text injects an arbitrary command | High (safety) | command+args derived from `kind`, never from text; a validation phrase carrying an out-of-allowlist fragment (`VALIDATION_DENY_FRAGMENT`: rm -rf/git/curl/cat/grep/install/build/node -e and `;`/`&&`/`\|`/`>`) → `unsupported`, no run (CA #2); runtime only ever passes `pnpm test`/`pnpm typecheck`; CommandExecution's own allow-list is a backstop (§5.4/§5.5) — tested (§8 16–20) |
| Both test+typecheck requested → silent pick hides part of the request | Med (Product) | both → `ambiguous` → clarify, never a silent choice (CA #1, §5.4) — tested (§8 6–7) |
| Clarify/unsupported reported as a failure turn | Low (Product) | both use `respondComposed` → `RESPONDED`, record memory, no re-anchor, no ref (CA #3, §5.5) — tested (§8 "Also") |
| Validation runs against the wrong workspace | Med | `anchor.workspaceRef` used, never re-resolved on this path (§5.3, CA Q6) — tested (§8 11–13) |
| Auto-running tests after apply | Med (Product) | No auto-run: validation only on a later explicit turn; apply success runs zero commands (§5.4) — tested (§8 10) |
| "적용했고 테스트 통과 = 배포 가능" overstatement | Med (Product) | "이번 실행 기준으로 통과"; git-not-run/commit-push-not-performed on all terminal outcomes; forbidden-word discipline (§5.7, CA Q9/#5) — tested (§8 24–27) |
| A failed/timed-out run implies rollback or git | Med | No rollback/git on any branch; anchor kept; distinct failure vs timeout copy (§5.5/§5.7, CA Q10/Q11) — tested (§8 28–30) |
| Ambiguous "검증" runs the wrong/expensive command | Low/Med | `검증` alone (or both requested) → clarify, runs nothing (§5.5, CA Q4/Q7/#1) — tested (§8 5–7) |
| Breaking the existing Sprint 2l flow | Med | Post-apply branch is gated on WORKSPACE_APPLIED + validation intent and placed so the fall-through classify path is unchanged (§5.4, CA Q5/#7) — tested (§8 14–15) |
| Test artifacts mistaken for source mutation | Low | WorkspaceWrite stays the only source mutator; no git/clean-tree claim; artifacts are pre-existing CommandExecution-env behavior (§6a, CA Constraint 5) |

## Next Step

Plan-only (this document). Per the approved sequence: (1) this plan → **Chief Architect Review**; (2) on
approval, author ADR-0043; (3) implement exactly this scope (§3/§5) on a `v2/<topic>` branch; (4) add/update
tests per §8; (5) validate on **Node 22**; (6) open a PR for Chief Architect Implementation Review. **Stop
here** — no implementation, branch, commit, or PR until the plan is approved.
