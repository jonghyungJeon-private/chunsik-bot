# Sprint 2j Implementation Plan — Intent / Execution Orchestrator (Application Layer)

- **Status:** ✅ APPROVED (Planning review, Round 2) — implemented in ADR-0031. Round-1
  Merge-Blocking changes (MB-1 Capability Selection, MB-2 ExecutionContext, MB-3 Cancellation
  Contract) were applied and Round-2 APPROVED with no further planning changes. CA-confirmed design
  directions kept verbatim: **stateless orchestrator · aggregate ownership retained · `executionPlanRef`
  correlation root · Ref-threading composition.** Implemented as `ExecutionOrchestrator` +
  `IntentResolver` (Application services, fake-manager tests); the resume entry is
  `resume(request, priorOutcome, cancelToken?)`. Non-blocking (deferred): Execution Hooks, pipeline
  visualization, and composition-root/Discord wiring.
- **Phase:** **Phase 2 — Application Layer.** Phase 1 (Capability Layer, CAP-001…009) is closed. This
  is the *first* Application-layer design: compose the completed capabilities into one safe execution
  flow. **No new capability.**
- **Date:** 2026-07-01 · **Base:** `main` @ `7f56e58` (CAP-001…009 merged).
- **Process:** V2 architecture-first, Step 1 (Implementation Plan). Plan → review → approval →
  implementation. Do not bypass the planning gate.

> **Framing.** The Execution Orchestrator **composes** capabilities; it does not *do* their work. Its
> **first responsibility is Capability Selection** — choosing *which* capability steps this intent
> needs — and only then does it run that **selected** pipeline, threading Refs and stopping at the
> right boundaries. It owns **no aggregate**, holds **no capability-internal responsibility**, and
> connects capabilities **by Ref**. It is the intra-task composition layer — **not** the deferred
> `Workflow` engine and **not** the Agent Runtime.

### Round-1 Merge-Blocking changes applied (for the reviewer)
- **MB-1 — Capability Selection (§0.A, §5, §6).** The pipeline is **dynamic, not fixed**: the
  orchestrator's first act is to select the ordered capability-step subset for the intent.
- **MB-2 — ExecutionContext (§7.1).** An Application-layer in-flight context (not an aggregate)
  shared across steps: `executionPlanRef`, `workspaceRef`, `projectId`, `requestedBy`, `logger`,
  `cancelToken?`, selected steps.
- **MB-3 — Cancellation Contract (§8.3).** `RUNNING → CANCELLED → TERMINAL`, cooperative, including
  user-cancel during the Approval halt — an **ExecutionOutcome-level** state, not aggregate state.
- **Non-blocking (deferred, NOT this sprint):** Event Bus · Parallel Capability Execution ·
  Telemetry/Metrics (§3).

---

## 0. Foundational design (the orchestrator questions — settle FIRST)

**A. What is the orchestrator's FIRST responsibility? — Capability Selection (MB-1).**
The chain is **not** a fixed Planning→CodeGen→Approval→Patch→Write→Command every time. Different
intents need different capabilities (a "run the tests" intent needs Planning + Command but no
CodeGen/Patch/Write; a read-only "analyze" intent needs none of Patch/Write/Command). So the
orchestrator's first act is:

```
Intent → Capability Selection → Execution Pipeline (the selected steps only)
```

**Capability Selection** maps the resolved `ExecutionRequest` (which carries `requiredCapabilities`
from the Intent Resolver) to an **ordered subset** of the canonical capability steps, always in
dependency order (Planning first; Approval before Patch/Write/Command; Patch before Write; etc.).
Planning's resulting `ExecutionPlan.steps` confirm/refine that selection. The Execution Pipeline then
runs **only the selected steps**.

> **Disambiguation (important):** orchestration-level **Capability Selection** = *which capability
> steps/managers run* for this execution. This is **distinct** from the existing
> `CapabilityRouter`/`ProviderSelector`, which picks *which AI provider serves a given capability*
> inside a manager (e.g. Claude vs Ollama for `CODE_IMPLEMENTATION`). The orchestrator does provider
> selection **never** — it only selects capability *steps*.

**B. What is it, and what is it NOT?**
A **deterministic Application service** (`ARCHITECTURE.md`: "Application services — orchestration &
policy … deterministic plumbing is implemented", `[NOW]`) that selects and sequences the existing
capability managers for **one execution** anchored to **one `ExecutionPlan`**. It is **NOT** a
Capability (owns no aggregate), **NOT** the `Workflow` engine (inter-task, `[LATER]`/YAGNI — no
`workflowId`, no multi-task graph), and **NOT** the Agent Runtime (no plan-act loop, no tool calling,
no retry; `[LATER]`, `AgentProfile` seam).

**C. How does it compose without absorbing capability responsibility?**
It calls each manager's existing public method and passes the **Ref** the next manager needs. It never
re-implements planning, generation, diffing, approval logic, patching, writing, or command gating —
each capability keeps its own gates (Patch requires an APPROVED `ApprovalRef`; Command Execution runs
its allow-list/risk/approval gates). The orchestrator relies on those gates and reacts to outcomes.
**Capability managers still do not know each other; only the orchestrator composes them** (the CA's
independence rule — preserved).

**D. How does it own no aggregate — yet know where it is?** *(the key design insight, CA-confirmed)*
**It is stateless and derives progress from the existing aggregates.** Every downstream aggregate
already carries **`executionPlanRef`** (`CodeGeneration`, `ApprovalRequest`, `PatchSet`,
`WorkspaceChange`, `CommandExecution`), and each repository exposes a **`findByExecutionPlan`** finder.
So the `ExecutionPlan` is the **correlation root**: given a plan Ref, the orchestrator reconstructs
which steps have happened and with what status by reading the *capabilities'* aggregates — it persists
**nothing of its own**. No `ExecutionFlow` aggregate, no new table, no new repository.

**E. How does it handle the Approval halt without a Conversation Runtime? (CA-confirmed)**
When the plan's risk requires approval (decided by the existing `RiskPolicy`/`ApprovalPolicy`, not the
orchestrator), it calls `ApprovalManager.requestFor(plan)` to create a **PENDING** request, then
**halts** with outcome `AWAITING_APPROVAL`. **It never calls `ApprovalManager.decide`** — the human
decision arrives later from a future Conversation Runtime / Discord layer (out of scope). A **resume**
entry reads `ApprovalRef.status` and proceeds **only** if APPROVED; DENIED ⇒ stop. Resume *wiring* is
out of scope; only the *contract* is designed.

**F. Failure & cancellation rule (MB-3).**
**On any step's failure, a non-APPROVED gate, or a cancellation signal, stop — do not call the next
capability.** No compensation, no rollback, no retry. Cancellation differs from failure only in cause
(a user/caller signal vs. an error); both are cooperative, between-step stops with no rollback (§8).

**G. What does the Intent Resolver own?**
A thin Application service mapping a classified `Intent` (from the existing `IntentClassifier`) into an
`ExecutionRequest` (goal, projectId, **requiredCapabilities**, instruction, targetFiles?). It decides
*whether* an intent is an execution at all and *which capabilities* it requires (feeding MB-1's
selection). It classifies nothing (IntentClassifier's job) and plans nothing (Planning's job).

**H. Relationship to the existing `ChunsikCore` orchestrator?**
`ChunsikCore` (`orchestrator.ts`) is the **message/conversation** orchestrator (single-capability chat
/ analysis / registration); its work-path approval gate is today a deliberate `NotImplementedError`
seam. The **Execution Orchestrator** is the *multi-capability execution chain* that seam awaited.
Sprint 2j designs it + the Intent Resolver as **standalone Application services**; **wiring into
`ChunsikCore`/Discord is out of scope** (needs Conversation Runtime + approval UI + resume).

---

## 1. Objective

Design (plan-only) the **Application Layer's first composition**: an **Intent Resolver** (Intent →
`ExecutionRequest`) and an **Execution Orchestrator** whose first act is **Capability Selection** and
which then safely runs the selected capability pipeline for one `ExecutionPlan`:

```
User message
  → IntentClassifier (existing)          → Intent
  → Intent Resolver (new, this plan)     → ExecutionRequest (goal, requiredCapabilities, …)
  → Execution Orchestrator (new, this plan):
        ── Capability Selection ──        → ordered selected steps (subset of the chain)   [MB-1]
        ── build ExecutionContext ──      → {planRef, workspaceRef, projectId, logger, cancelToken?} [MB-2]
        ── Execution Pipeline (selected steps only, cancel-checked at each boundary) ──     [MB-3]
            Planning (CAP-003)             → ExecutionPlan / ExecutionPlanRef
            AI Code Generation (CAP-008/009) → CodeGeneration → CodeProposal(ProposedChange[])
            Workspace diff (CAP-001)       → WorkspaceDiff                       [for human review]
            Approval (CAP-004)             → ApprovalRequest (PENDING) ── HALT (AWAITING_APPROVAL) ──┐
            … resume once ApprovalRef.status == APPROVED (or CANCELLED) …                            │
            Patch (CAP-005)                → PatchSet     (requires APPROVED ApprovalRef)  ◄──────────┘
            Workspace Write (CAP-006)      → WorkspaceChange
            Command Execution (CAP-007)    → CommandExecution
  → terminal ExecutionOutcome (COMPLETED / AWAITING_APPROVAL / DENIED / STOPPED_ON_FAILURE / CANCELLED)
```

The deliverable is the **design + contracts** for these services, their **capability selection**,
**ExecutionContext**, and **halt/failure/cancellation** semantics — **not** their implementation.

## 2. Scope (this Sprint — plan-only)

- **Intent / Execution Orchestrator Planning document** (this file) covering: **Capability Selection**
  (MB-1), composition flow + Ref-threading, the stateless/derived progress model, **ExecutionContext**
  (MB-2), the Approval halt + resume contract, the failure + **Cancellation** semantics (MB-3), the
  Intent Resolver, proposed (non-binding) interface **sketches**, risks, and the validation strategy
  for the *future* implementation.
- **Chief Architect re-review request** (Round 2).

That is the entire Sprint 2j deliverable.

## 3. Out of Scope (explicit)

**Not this Sprint (concepts):** Conversation Runtime · Memory (beyond what capabilities already use) ·
Agent Runtime · Retry / self-repair · Tool Calling · Discord Integration / approval UI · Telemetry.

**Non-blocking — deferred to a future Sprint (CA Round-1):** ❌ **Event Bus** · ❌ **Parallel
Capability Execution** · ❌ **Telemetry / Metrics**. The orchestrator runs steps **sequentially**, with
**direct manager calls** (no event bus), this sprint.

**Not produced this Sprint (artifacts — planning gate):** ❌ code · ❌ tests · ❌ Port · ❌ Adapter ·
❌ Manager · ❌ Aggregate · ❌ Repository · ❌ Migration · ❌ PR · ❌ branch. Working-tree plan only.

**Excluded from the design itself (so implementation cannot creep):** a new aggregate/repository/
migration for orchestration state (stateless, derived); calling `ApprovalManager.decide`; resume/cancel
**wiring** (only the contracts are designed); `Workflow`/`workflowId`/multi-task graphs; retry/
compensation/rollback; changing any capability manager's contract.

## 4. Architecture Impact / Positioning

- **Pure Application-layer addition** (`packages/core/src/application`), `[NOW]`: deterministic
  selection + orchestration over existing managers + existing `RiskPolicy`/`ApprovalPolicy`.
- **No Core-contract change.** No new domain aggregate, no new port, no new repository, no migration.
  Reuses existing manager methods and the existing `findByExecutionPlan` finders.
- **Intra-task only.** Composes one `Plan`'s selected capabilities (`Plan` = intra-task, `[NOW]`). Not
  `Workflow` (`[LATER]`), no `workflowId`/engine. Not the Agent Runtime (single forward pass, no
  loop/retry; `AgentProfile` stays `[RESERVE]`).
- **Owns no aggregate.** Derives from capabilities' aggregates via Refs; returns a **transient**
  `ExecutionOutcome` value object (never persisted). `ExecutionContext` (MB-2) is likewise transient.
- **Boundary preserved.** Imports only application services + domain types + the `Logger` port — no
  concrete provider/adapter, no `child_process`/HTTP, no branching on provider id. **Capability
  managers remain mutually unaware; only the orchestrator composes them.**

## 5. Capability Selection + Composition Flow & Ref-threading (MB-1)

**Step 0 — Capability Selection.** From `ExecutionRequest.requiredCapabilities` (Intent Resolver) +,
once Planning runs, `ExecutionPlan.steps`, select the **ordered subset** of the canonical steps below.
Unselected steps are skipped; selected steps always run in the dependency order shown. (Examples:
analyze-only → {Planning}; run-tests → {Planning, Command}; code-change → the full chain.)

**Steps 1-7 — Execution Pipeline (selected steps only).** Each step calls one existing manager and
threads the Ref the next consumer needs (verified against current code):

| # | Step (capability) | Manager call (existing) | Consumes (Ref/value) | Produces |
|---|---|---|---|---|
| 1 | Planning (CAP-003) | `PlanningManager.plan(PlanningRequest)` / `.planRef(...)` | goal, projectId?, requiredCapabilities? | `ExecutionPlan` (+ `ExecutionPlanRef`, `overallRisk`) |
| 2 | AI Code Generation (CAP-008/009) | `CodeGenerationManager.generate(GenerateCodeInput)` | `executionPlanRef`, instruction, (read-only) workspaceRef?/contextFiles? | `CodeGeneration` → `CodeProposalRef` → `CodeProposal(ProposedChange[])` |
| 3 | Workspace diff (CAP-001) | `WorkspaceManager` diff (read-only, ADR-0022) | `ProposedChange[]`, `WorkspaceRef` | `WorkspaceDiff` (for human review + Patch input) |
| 4 | Approval (CAP-004) | `ApprovalManager.requestFor(ExecutionPlan, requestedBy)` | `ExecutionPlan` | `ApprovalRequest` (PENDING) → `ApprovalRef` (plan-scoped) |
| — | **HALT** | — | — | outcome `AWAITING_APPROVAL`; decision/cancel happen elsewhere |
| — | **resume** | read `ApprovalRef.status` | `ApprovalRef` | proceed iff `APPROVED`; `DENIED`/cancelled ⇒ stop |
| 5 | Patch (CAP-005) | `PatchManager.generate(PatchGenerationInput)` | `executionPlanRef`, **APPROVED** `approvalRef`, `ProposedChange[]`, `WorkspaceDiff` | `PatchSet` (+ `PatchSetRef`) |
| 6 | Workspace Write (CAP-006) | `WorkspaceWriteManager.apply(ApplyInput)` | `PatchSet`, `approvalRef`, `workspaceRef` | `WorkspaceChange` (+ `WorkspaceChangeRef`) |
| 7 | Command Execution (CAP-007) | `CommandExecutionManager.run(RunCommandInput)` | `executionPlanRef`, `approvalRef?` (HIGH), `workspaceRef`, `workspaceChangeRef?`, command/args | `CommandExecution` |

Notes that keep the orchestrator "compose-only":
- **`ApprovalRef` is plan-scoped** (carries `executionPlanRef`) — Patch/Write/Command verify referential
  integrity *themselves*. The orchestrator passes the Ref; it does not re-check the gate.
- **Conditional approval.** Whether step 4 halts is decided by `RiskPolicy`/`ApprovalPolicy` from
  `plan.overallRisk` (as `ChunsikCore` already does). LOW/MEDIUM may skip the halt; HIGH/CRITICAL must
  halt. The orchestrator branches on the policy result; it does not define risk.

## 6. Orchestrator Responsibility & Boundaries

- **In:** (1) **select** the capability steps for the intent (MB-1); (2) build the `ExecutionContext`
  (MB-2); (3) for each selected step, check cancellation (MB-3), call the capability with the right
  Ref, inspect the outcome; (4) halt at the Approval gate; (5) stop on failure/denial/cancel; (6)
  return a terminal `ExecutionOutcome`. Derive progress from existing aggregates — owns no state.
- **Out:** planning, generation, diffing, approval *decisioning*, patch building, file writing, command
  gating; provider selection; persistence of any orchestration state; retry; conversation/Discord;
  memory.
- **Single responsibility:** *select and advance one execution along the chosen capability steps,
  safely, and stop at the right boundaries.*

## 7. State model — ExecutionContext (MB-2) + derived progress

### 7.1 ExecutionContext (Application-layer context — NOT an aggregate)
A transient object created at run/resume start and threaded through the selected steps. It carries the
ambient inputs the steps share; it is **never persisted**, has **no storage identity**, and is **not a
domain aggregate** — it is purely an Application Layer context.

```
ExecutionContext (transient, per invocation)
- executionPlanRef        // set after Planning; the correlation root
- workspaceRef            // resolved working directory for FS/command steps
- projectId?              // active project
- requestedBy             // actor/principal id (for ApprovalManager.requestFor)
- selectedSteps           // the ordered capability steps chosen in §5 step 0
- logger                  // Logger port
- cancelToken?            // cooperative cancellation signal (MB-3)
```

Because the orchestrator is **stateless**, the context is **rebuilt on each entry** (run or resume)
from the `ExecutionRequest` + derived aggregate state — it is not a stash that survives across the
Approval halt. The produced Refs (codeProposalRef/approvalRef/patchSetRef/workspaceChangeRef) are
threaded step-to-step and surfaced in the `ExecutionOutcome`.

### 7.2 Derived progress (stateless)
No `ExecutionFlow` aggregate. Given an `ExecutionPlanRef`, the orchestrator reconstructs progress by
reading the capabilities' aggregates keyed on `executionPlanRef` (existing finders) and computes the
next selected step. Re-entrancy is free: calling run/resume twice for the same plan converges.

## 8. Failure, Approval & Cancellation semantics

### 8.1 Failure
If a selected step's manager records a failed/!success outcome, the orchestrator **stops immediately**
and returns `STOPPED_ON_FAILURE` naming the step. **It does not call the next capability.** No retry,
no rollback (audit remains in each capability's aggregate).

### 8.2 Approval
Risk-required approval ⇒ create PENDING request and return `AWAITING_APPROVAL` (halt). Resume proceeds
only on APPROVED; DENIED ⇒ `DENIED` (stop). The orchestrator never decides.

### 8.3 Cancellation Contract (MB-3)
Cancellation exists even though retry does not. It is an **ExecutionOutcome-level Application state, not
an aggregate status**.

```
RUNNING ──(cancelToken signalled)──▶ CANCELLED ──▶ TERMINAL
   │
   └──(also reachable from AWAITING_APPROVAL: a user cancel during the approval wait)
```

- **Cooperative, between-steps.** The orchestrator checks `ExecutionContext.cancelToken` at each step
  boundary. If signalled, it **stops — does not call the next capability** (same discipline as failure)
  — and returns `CANCELLED` naming the last step.
- **Cancel during the Approval halt.** A user cancel while `AWAITING_APPROVAL` means a subsequent
  `resume` returns `CANCELLED` and **never proceeds to Patch**. (The orchestrator does not mutate the
  PENDING `ApprovalRequest` — it owns no aggregate; whether the future Conversation layer marks the
  request is its concern.)
- **No compensation/rollback.** Cancellation prevents *further* steps only; already-applied
  `WorkspaceChange`/`CommandExecution` remain as the audit trail (consistent with no-retry/no-rollback).
- **Application-layer only.** `CANCELLED` lives on `ExecutionOutcome`; no capability aggregate gains a
  "cancelled" status from the orchestrator.
- **Wiring deferred.** The *mechanism* (cancelToken in the context, checked at boundaries) is defined
  now; *who* signals it (a Discord cancel action) is out of scope, like resume wiring.

### 8.4 No silent stops
Every stop (failure/denied/cancelled/halt) names the step and reason in the returned `ExecutionOutcome`
+ a `logger` line.

## 9. Intent Resolver (design)

`IntentResolver.resolve(Intent, context) → ExecutionRequest | null`. Returns `null` for plain
chat/analysis intents (those stay on `ChunsikCore`'s fast path). For an execution intent it produces an
`ExecutionRequest` (goal, projectId, **requiredCapabilities**, instruction, targetFiles?) — feeding
MB-1's Capability Selection. It classifies nothing (reuses `IntentClassifier`) and plans nothing.

## 10. Proposed shapes (DESIGN SKETCHES ONLY — not implemented this Sprint)

> Illustrative, to make the contracts concrete for review. Final names/shapes settle at implementation,
> post-approval. **No file is created from these in Sprint 2j.**

- `IntentResolver.resolve(intent, context): ExecutionRequest | null`.
- `ExecutionRequest { goal; projectId?; requiredCapabilities; instruction; targetFiles?; workspaceRef? }`.
- `ExecutionOrchestrator.run(request: ExecutionRequest, cancelToken?): Promise<ExecutionOutcome>` —
  select → build context → run selected pipeline → halt or finish.
- `ExecutionOrchestrator.resume(planRef: ExecutionPlanRef, cancelToken?): Promise<ExecutionOutcome>` —
  continue a halted flow once approved (or return CANCELLED).
- `ExecutionContext` — as §7.1 (transient Application context, not an aggregate).
- `ExecutionOutcome` (read-model): `{ planRef, status: COMPLETED | AWAITING_APPROVAL | DENIED |
  STOPPED_ON_FAILURE | CANCELLED, lastStep, selectedSteps, refs: { codeProposalRef?, approvalRef?,
  patchSetRef?, workspaceChangeRef?, commandExecutionId? }, stoppedReason? }`.
- `ExecutionStep` enum naming the chain steps; `CapabilitySelection` is the first stage producing
  `selectedSteps`.

These reuse existing inputs (`PlanningRequest`, `GenerateCodeInput`, `PatchGenerationInput`,
`ApplyInput`, `RunCommandInput`) and existing Refs — **no new domain aggregate**.

## 11. ADR Impact

- **Proposed ADR-0031 — Execution Orchestrator (Application-layer capability composition).** Authored
  *at implementation time* (post-approval), recording: **Capability Selection as the first
  responsibility** (MB-1); the stateless, aggregate-free orchestrator; intra-task composition (not
  `Workflow`/Agent Runtime); Ref-threading + `executionPlanRef` correlation root; **ExecutionContext**
  as Application-layer context (MB-2); the Approval halt/resume contract; the stop-on-failure (no-retry)
  rule + the **Cancellation contract** (MB-3); the Intent Resolver; the relationship to `ChunsikCore`
  (wiring deferred); and the deferral of Event Bus / Parallel Execution / Telemetry.
- **Relates:** ADR-0024 (Planning), ADR-0025 (Approval + Aggregate Ownership), ADR-0026 (Patch),
  ADR-0027 (Workspace Write), ADR-0028 (Command Execution), ADR-0029 (AI Code Generation), ADR-0013
  (YAGNI on `Workflow`/seams). **Supersedes nothing.**

## 12. Risks

| Risk | Severity | Mitigation (design) |
|---|---|---|
| Orchestrator drifts into a `Workflow` engine / Agent Runtime | **High** | Single forward pass, intra-task, no `workflowId`, no loop/retry; §0.B boundary in ADR-0031 |
| Capability Selection re-implements Planning (decides the plan, not just the step set) | **High** | Selection only chooses the *ordered step subset*; Planning still authors `ExecutionPlan.steps`, which refine the selection (§5 step 0) |
| Capability Selection confused with provider selection | Med | Explicit disambiguation (§0.A): step-selection ≠ `CapabilityRouter`/`ProviderSelector` |
| Orchestrator absorbs capability-internal logic / re-checks gates | High | Compose-only: call existing managers, pass Refs, react to outcomes; managers keep their own gates; managers stay mutually unaware |
| Introducing orchestration **state** (new aggregate/table) | Med-High | Stateless/derived via `findByExecutionPlan`; `ExecutionContext`/`ExecutionOutcome` are transient |
| ExecutionContext mistaken for an aggregate / persisted | Med | §7.1: transient, no identity, rebuilt per invocation, never persisted |
| Cancellation expected to roll back applied changes | Med | §8.3: cooperative, between-steps, **no compensation**; prevents further steps only; audit remains |
| Approval gate bypass / auto-approve | **High** | Never calls `decide`; resume proceeds only on APPROVED; cancel during halt ⇒ CANCELLED; downstream keep their own approval checks |

## 13. Validation strategy (for the FUTURE implementation — not run this Sprint)

When implemented (post-approval), tests with **fake/stub capability managers** would prove:
**Capability Selection** picks the right ordered subset per intent (analyze-only / run-tests /
code-change) and the pipeline runs **only** those steps; the happy chain threads the right Refs and
returns `COMPLETED`; a HIGH-risk plan halts at `AWAITING_APPROVAL` and does **not** call Patch; resume
on APPROVED proceeds, on DENIED stops; a failed step returns `STOPPED_ON_FAILURE` without calling the
next manager; a **cancelToken** signalled between steps (and during the approval halt) returns
`CANCELLED` without calling the next manager and **without rollback**; the orchestrator **persists
nothing of its own** and **imports no capability-internal type beyond the public manager contracts**;
progress is correctly derived from aggregate state; `ExecutionContext`/`ExecutionOutcome` are transient.
`pnpm typecheck` exit 0; full regression (CAP-001…009) stays green. *(No tests written in Sprint 2j.)*

## 14. Chief Architect Decision Questions (Round 2)

**CA-confirmed in Round 1 (kept as designed):** stateless/derived progress · aggregate ownership
retained (no `ExecutionFlow`) · `executionPlanRef` correlation root · Ref-threading · Approval
PENDING-halt + resume-contract · no retry. **Round-1 MB-1/2/3 are now reflected (§0.A/§5, §7.1, §8.3).**

Remaining confirmations for Round 2:
1. **Capability Selection placement (MB-1).** Selection driven by `ExecutionRequest.requiredCapabilities`
   then refined by `ExecutionPlan.steps` after Planning runs — acceptable? (vs. selecting purely from
   the plan, or purely from the resolver.)
2. **ExecutionContext fields (MB-2).** The §7.1 field set (`executionPlanRef`, `workspaceRef`,
   `projectId`, `requestedBy`, `selectedSteps`, `logger`, `cancelToken?`) — complete and correctly
   scoped as a transient, rebuilt-per-invocation context (not persisted)?
3. **Cancellation contract (MB-3).** Cooperative between-step + during-approval-halt cancel, `CANCELLED`
   on `ExecutionOutcome`, **no compensation** — confirm semantics and that wiring (who signals) is
   deferred?
4. **Intent Resolver** as a new thin Application service (vs. extending `IntentClassifier`)?
5. **`ChunsikCore` relationship** — standalone now, wiring deferred — confirm the boundary?

## Next Step
Stop here and wait for **Chief Architect Round-2 review**. On approval I will author ADR-0031 and
implement only the approved composition (Capability Selection + Execution Orchestrator + Intent
Resolver + ExecutionContext + Cancellation, as Application services) with fake-manager tests, then
validate. **No code/test/branch/PR until then** — this Sprint produces only this plan.
