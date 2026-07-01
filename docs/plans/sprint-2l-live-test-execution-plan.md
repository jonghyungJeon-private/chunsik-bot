# Sprint 2l Plan — Live Test Execution (run-tests intent → Command Execution)

- **Status:** ✅ APPROVED WITH CHANGES (Planning review) — implemented in ADR-0033. CA changes
  applied: (1) risk wording — bounded/allow-listed but **not guaranteed non-mutating**, MEDIUM, no
  halt; (2) result read via existing `CommandExecutionManager.get` (no new repo/port, no orchestrator
  contract change); (3) `IntentType.RUN_TESTS`/`Capability.TEST_EXECUTION` confirmed present (reused);
  (4) classifier emits `raw.kind` only, resolver owns the fixed command; (5) workspace via
  `WorkspaceManager.open`, no runtime text; (6) exit≠0 that ran = test-failure result. Composers
  added: `composeTestResult`/`composeNeedsProject`/`composeWorkspaceUnavailable`/`composeCommandUnavailable`.
- **Goal:** When a user says "테스트 돌려줘", 춘식봇 runs the allow-listed test command in the **active
  project's** workspace and reports the result in natural language — Phase 2's **first live action**.
- **Phase:** Phase 2 — Product Construction (second runtime sprint). **Not** a new capability/aggregate.
- **Base:** `main` @ `80568a5` · **Validation runtime:** **Node 22**.
- **Process:** V2 architecture-first, step 1. Plan → CA review → approval → implementation.

> **Framing.** The whole execution pipeline (`ConversationRuntime → ExecutionOrchestrator →
> CommandExecution`) is already built but **unreachable**: the deterministic `IntentClassifier` emits
> no execution intent, so users can only chat/analyze. This sprint opens that path with the smallest,
> safest Product slice — running tests — **by wiring existing pieces, adding no new structure.**

---

## 1. Objective

Recognize test-run requests deterministically and execute an allow-listed test command in the active
project, reporting the outcome naturally. Example user messages:

```
테스트 돌려줘 · 테스트 실행해줘 · pnpm test 해줘 · typecheck 돌려줘 · 타입체크 해줘
```

Flow (all existing components; only classification + a little wiring are added):

```
User message
  → IntentClassifier            → Intent { type: RUN_TESTS, capability: TEST_EXECUTION, raw.kind: 'test'|'typecheck' }
  → ConversationRuntime          (resolves active-project WorkspaceRef via existing WorkspaceManager.open)
  → IntentResolver               → ExecutionRequest { requiredCapabilities:[TEST_EXECUTION], command, workspaceRef }
  → ExecutionOrchestrator.run    → Planning → (auto-approved) Approval → CommandExecution
  → ResponseComposer             → natural pass/fail reply
```

## 2. Scope (this sprint — plan-only defines it; implementation later)

- Add **`RUN_TESTS` recognition** to the deterministic `IntentClassifier` (same style as the existing
  REGISTER_PROJECT / PROJECT_ANALYSIS rules) → `IntentType.RUN_TESTS`, `Capability.TEST_EXECUTION`,
  `requiresWork: true`, with a normalized `raw.kind: 'typecheck' | 'test'`.
- Extend **`IntentResolver`** to build a `TEST_EXECUTION` `ExecutionRequest` and choose the command
  from `raw.kind` (see §5).
- **Active-project workspace supply:** `ConversationRuntime` resolves the active project's
  `WorkspaceRef` via the **existing** `WorkspaceManager.open(project)` and passes it into the resolver
  context / `ExecutionRequest.workspaceRef` (see §6, Q3).
- **Reuse** `ExecutionOrchestrator` (`TEST_EXECUTION`+command → `[PLANNING, APPROVAL,
  COMMAND_EXECUTION]`) and `CommandExecution` (existing allow-list `pnpm/npm/node`).
- **Result reporting** through `ResponseComposer` (new `composeTestResult`, and reuse/extend for the
  no-active-project + failure cases — see §4, §7, Q4).
- fake/integration-style tests (§8). Validation on **Node 22**.

## 3. Out of Scope (explicit)

Code change · patch generation · workspace write · AI code-generation live execution · Agent Runtime
· tool-calling loop · retry/reflection · Discord button/UI · telemetry · **new aggregate / repository
/ migration / capability** · Core-contract change · **`ExecutionOrchestrator` contract change**.

## 4. Risk Policy

Test execution is a **non-mutating** command run. Assessed against the existing `RiskPolicy`:

| Command | `RiskPolicy.assessCommand` | Approval? |
|---|---|---|
| `pnpm test` | **MEDIUM** (no CRITICAL/HIGH pattern matches) | No (`requiresApproval(MEDIUM)=false`) |
| `pnpm typecheck` | **MEDIUM** | No |

- Neither matches a destructive/CRITICAL pattern (`rm -rf`, `git push --force`, `drop table`, …) nor a
  HIGH pattern (`git commit/push`, `npm publish`, `deploy`, …) — so **no approval halt** this sprint.
- The `APPROVAL` stage still runs in the pipeline but **auto-APPROVES** (MEDIUM), so
  `CommandExecution` receives an APPROVED, plan-scoped `ApprovalRef` and runs directly. **No change to
  `RiskPolicy`/`ApprovalManager`.** Live approval-halt remains a later sprint's concern.

## 5. Command Selection Rule

Deterministic, allow-list-bounded. The **classifier** normalizes the *kind*; the **resolver** maps
kind → the concrete allow-listed command (Q2):

```
message contains  typecheck / 타입체크 / 타입 체크   → raw.kind = 'typecheck' → command 'pnpm', args ['typecheck']
otherwise (test / 테스트 / 테스트 실행 / 돌려줘)      → raw.kind = 'test'      → command 'pnpm', args ['test']
```

**Forbidden:** running a user-supplied command verbatim · free-form shell strings · arbitrary command
synthesis · bypassing the `CommandExecution` allow-list. Only the two fixed `pnpm` commands above are
ever produced; they are re-checked by the existing allow-list + dangerous-arg + risk gates.

## 6. Workspace Requirement & no-active-project UX

- **Active project required.** The command runs in the active project's workspace. `ConversationRuntime`
  reads `session.activeProjectId`, loads the `Project`, and resolves a `WorkspaceRef` via the existing
  `WorkspaceManager.open(project)` (reusing existing workspace resolution — no new mechanism).
- **No active project:** do **not** run any command. Reply naturally, e.g. "먼저 분석/실행할 프로젝트를
  등록해 주세요." This reply is produced by `ResponseComposer` (a small `composeNeedsProject`, or the
  existing analysis-not-ready path), **never** hardcoded in the runtime (ADR-0032 boundary).

## 7. Failure UX (no technical detail leaked)

Every case replies in natural language via `ResponseComposer` (ADR-0015 style); the runtime builds no
text itself:

| Case | Detection | Reply (natural) |
|---|---|---|
| No active project | `session.activeProjectId` absent | "먼저 프로젝트를 등록해 주세요." (no command run) |
| Workspace open fails | `WorkspaceManager.open` throws | "프로젝트 작업 공간을 열 수 없었어요." (no command run) |
| Command timeout | `CommandExecution.status = TIMED_OUT` | "테스트가 시간 내에 끝나지 않았어요." |
| Command allow-list refusal | orchestrator step throws (gate) | "그 작업은 실행할 수 없어요." (should not occur — commands are fixed) |
| Tests ran but **failed** (exit≠0) | `CommandExecution` ran, `exitCode ≠ 0` | **natural test-failure result** (see Q5) — not a system error |
| Tests passed (exit 0) | `CommandExecution.status = SUCCEEDED` | "테스트가 모두 통과했어요." |

## 8. Validation Strategy (tests to write at implementation — Node 22, fakes)

1. "테스트 돌려줘" → `RUN_TESTS` / `TEST_EXECUTION` intent.
2. "pnpm test 해줘" → resolver command = `pnpm test`.
3. "typecheck 돌려줘" → resolver command = `pnpm typecheck`.
4. No active project → **no** `ExecutionOrchestrator.run`; natural guidance reply.
5. Active project present → `ExecutionOrchestrator.run` invoked with the resolved `workspaceRef`.
6. Command success (exit 0) → natural success reply.
7. Command failure (exit≠0, ran) → natural **test-failure** reply (not "system error"); no stack trace.
8. Only allow-listed `pnpm` commands are produced (never a free-form/user string).
9. No new aggregate/repository/migration/capability; no Core/Orchestrator contract change.
10. Node 22 `pnpm typecheck` + `pnpm test` green.

## 9. Architecture Questions — decisions (aligned to CA recommendations)

- **Q1 — new enum?** **No.** Reuse existing `IntentType.RUN_TESTS` + `Capability.TEST_EXECUTION`
  (both already defined). No new capability/enum.
- **Q2 — who decides the command?** The **`IntentClassifier` judges intent only** and attaches a
  normalized `raw.kind: 'typecheck' | 'test'` (a classification detail, not a command). The
  **`IntentResolver` decides the concrete allow-listed command** from `raw.kind` (§5). Keeps the
  classifier command-free and the command choice deterministic + centralized in the resolver.
- **Q3 — active project → WorkspaceRef?** The **runtime** supplies it: it knows
  `session.activeProjectId`, loads the `Project`, and calls the **existing `WorkspaceManager.open`**
  (reused workspace resolution), passing the `WorkspaceRef` in the resolver context /
  `ExecutionRequest.workspaceRef`. The orchestrator/command flow is reused unchanged (it consumes a
  ref; it does not resolve workspaces).
- **Q4 — how does ResponseComposer phrase the result?** Add **`ResponseComposer.composeTestResult(
  context, { kind, passed, exitCode? })`** (and a small `composeNeedsProject`). The runtime derives
  `passed`/`exitCode` by reading the produced `CommandExecution` (via `refs.commandExecutionId`) and
  hands facts to the composer — the runtime writes **no** text.
- **Q5 — is a failing test an execution failure or a result?** A **result.** If the command **ran**
  (a `CommandExecution` exists with a real `exitCode`) but exit ≠ 0, report a natural **test-failure
  result** ("테스트가 실패했어요 …"), not a system error. Only a command that **could not run**
  (`TIMED_OUT` / gate refusal / spawn failure — no clean exit) is a system-failure message. This is
  achieved in the **runtime's result mapping** (reading `CommandExecution`) — **no
  `ExecutionOrchestrator` contract change**; the orchestrator's own status is not reinterpreted, the
  runtime chooses the user-facing framing for a TEST_EXECUTION turn.

## 10. Architecture Impact / Reuse

- **Reuses** `IntentClassifier`, `IntentResolver`, `ConversationRuntime`, `ExecutionOrchestrator`
  (`selectStages` already handles `TEST_EXECUTION`+command), `WorkspaceManager.open`,
  `CommandExecution` (allow-list), `ResponseComposer`, `RiskPolicy`/`ApprovalManager`.
- **Adds** only: classifier `RUN_TESTS` rule (+`raw.kind`), resolver command mapping, runtime
  workspace resolution + TEST_EXECUTION result framing, and `ResponseComposer.composeTestResult` /
  `composeNeedsProject`. **No new aggregate/port/repository/migration/capability**, no Core or
  orchestrator-contract change.
- Proposed **ADR-0033** (authored at implementation): Live Test Execution — the first live execution
  slice; deterministic run-tests intent; command-selection rule; workspace-from-active-project;
  test-result-as-result UX; strict reuse.

## 11. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Command injection / arbitrary command | **High** | Only two fixed `pnpm` commands are ever produced (§5); re-checked by the existing allow-list + dangerous-arg + risk gates; never run a user string |
| Failing tests read as a scary "system error" | Med (Product) | Q5: exit≠0 that *ran* → natural test-failure result, not a crash message |
| Running with no/ambiguous workspace | Med | Require active project; else guidance reply, no command run (§6) |
| Scope creep into code-change execution | Med | Out of scope (§3): no patch/write/AI-codegen this sprint |
| Over-eager classification (false RUN_TESTS) | Low-Med | Conservative deterministic keywords; ambiguous → stays CHAT |

## Next Step
Stop here — **plan-only**. On approval I will author ADR-0033 and implement only this scope on a
`v2/<topic>` branch with fake/integration tests, validate on **Node 22**, and open a PR for
implementation review. **No code/branch/commit/PR until then.**
