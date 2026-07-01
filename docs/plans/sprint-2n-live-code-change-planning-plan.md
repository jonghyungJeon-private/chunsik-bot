# Sprint 2n Plan — Live Code Change Planning (intent → planning/approval halt)

- **Status:** ✅ APPROVED WITH CHANGES (Chief Architect Review, Round 1) — required changes applied
  below; implementing this scope next.
- **Base:** `main` @ `b25ce89` · **Validation runtime:** Node 22 (to be run at implementation time).
- **Directed by:** Chief Architect (this sprint's topic and required architecture questions are
  CA-assigned; see the CA direction message this plan answers).
- **Goal:** When a user asks to fix/change code ("이 버그 고쳐줘" / "이 부분 수정해줘" / "코드 바꿔줘"), 춘식봇
  recognizes it deterministically, builds an execution plan, and **halts at `AWAITING_APPROVAL`** —
  no patch, no workspace write, no command execution.
- **Phase:** Phase 2 — Product Construction (fourth runtime sprint, after 2k Conversation Runtime, 2l
  Live Test Execution, 2m Test Result Detail UX). **Not** a new capability/aggregate.
- **Process:** V2 architecture-first, step 1 (plan-only) → CA review next. No implementation, no
  branch, no commit, no PR in this step.

> **Framing.** Every piece this sprint needs already exists and was **built ahead of activation** in
> Sprint 2j/2k: `Capability.CODE_IMPLEMENTATION` and `IntentType.IMPLEMENT_CODE` are already defined
> (`domain/enums.ts:54,68`), `IntentResolver.EXECUTION_CAPABILITIES` already includes
> `CODE_IMPLEMENTATION` (`intent-resolver.ts:11`), `ConversationRuntime.needsWorkspace` already
> includes it (`conversation-runtime.ts:151`), and `ExecutionOrchestrator.selectStages` already has a
> full code-change pipeline (`execution-orchestrator.ts:160,164-168`). **Nothing has ever reached this
> path** because `IntentClassifier` never emits `IMPLEMENT_CODE` (only `REGISTER_PROJECT`, `RUN_TESTS`,
> `PROJECT_ANALYSIS`, `CHAT` — `intent-classifier.ts:16-63`). This sprint's job is narrower than it
> looks: turn the classifier on, and make sure the **existing** pipeline halts before mutation instead
> of running to completion.

---

## 1. Objective

Recognize a code-change request deterministically, route it through the existing
Intent Resolver → Execution Orchestrator chain, and stop at the Approval gate with a natural
"이 작업은 승인이 필요해요" reply — reusing existing pieces, adding no new capability/aggregate/contract
surface beyond one explicitly-justified, additive field (§5.2).

## 2. The central finding (read this before the design)

**Wiring `IMPLEMENT_CODE` straight through today's stack, unmodified, would not stop at approval — it
would run to completion, including a real file-system write.**

Trace:

1. `RiskPolicy.CAPABILITY_RISK[Capability.CODE_IMPLEMENTATION]` is `RiskLevel.MEDIUM`
   (`risk-policy.ts:25`).
2. `DeterministicPlanner.plan()` sets `overallRisk = risk.max(...capabilities.map(assessCapability))`
   → `MEDIUM` for a `CODE_IMPLEMENTATION`-only request (`deterministic-planner.ts:58-59`).
3. `ApprovalPolicy.evaluate()` calls `risk.requiresApproval(overallRisk)`, which is `true` **only**
   for `HIGH`/`CRITICAL` (`risk-policy.ts:66-68`, `approval-policy.ts:29-31`) — so for `MEDIUM` it
   returns `requiresApproval: false`.
4. `ApprovalManager.requestFor()` then creates the `ApprovalRequest` **already `APPROVED`** (auto,
   `decidedBy: 'system'`) whenever `!evaluation.requiresApproval` (`approval-manager.ts:28-32`).
5. `ExecutionOrchestrator.run()` only halts at `AWAITING_APPROVAL` when the approval status is
   `PENDING` (`execution-orchestrator.ts:251-254`). An auto-`APPROVED` request sails through the
   `if (status !== APPROVED) DENIED` check and proceeds straight into `runMutatingStages` — **`PATCH`
   then `WORKSPACE_WRITE`, a real file mutation** (`execution-orchestrator.ts:260-261, 336-365`).

So the Sprint's actual engineering problem is not "wire up a new intent" — the wiring already exists —
it is **"make the existing pipeline halt before mutation for this specific capability, without
changing what it does for anyone else."** §5 is built entirely around that constraint.

## 3. Scope (this sprint)

- Deterministic code-change intent recognition in `IntentClassifier` (§5.1).
- `IntentResolver` mapping `IMPLEMENT_CODE`/`CODE_IMPLEMENTATION` → `ExecutionRequest`, marking it to
  **defer AI Code Generation** this sprint (§5.2, §5.3).
- `RiskPolicy` change: `CODE_IMPLEMENTATION` baseline risk `MEDIUM → HIGH` (§5.4) — the one line that
  makes the Approval gate actually halt.
- Two new `ResponseComposer` methods — `composeCodeChangeApprovalRequired` and
  `composePlanningOnlyApproved` — and two narrowly-scoped `ConversationRuntime` branches that select
  between them and the existing generic composer methods (§5.5, §5.6; **CA Round 1 required change** —
  the original plan's "zero changes" claim here did not survive review, see §9 in the prior draft).
  `composeNeedsProject`/`composeWorkspaceUnavailable` remain reused unchanged (§6 Q7).
- Tests for all of the above, plus a regression/proof suite asserting `codeGeneration.generate`,
  `workspace.diff`, `patch.generate`, `workspaceWrite.apply`, `command.run` are **never called** on
  this path, and that no `codeGenerationId`/`patchSetId`/`workspaceChangeId`/`commandExecutionId` ref
  is ever produced (§8, Q9).

## 4. Non-goals (explicit, per Chief Architect direction)

No implementation before approval · no branch/commit/PR beyond this plan-only step · no AI-generated
code **application** · no patch apply · no workspace write · no command execution · no retry · no
agent loop · no autonomous coding · no Discord button UI · no new aggregate/repository/migration/
capability · no `Core` contract change · no `ExecutionOrchestrator` contract change beyond the one
additive, non-breaking field justified in §5.2/Q3/Q8 · **and, by this plan's own design decision, no
live AI Code Generation call this sprint either** — see Q3.

## 5. Design

### 5.1 `IntentClassifier` — deterministic code-change detection

Same style/place as the existing `RUN_TESTS` rule (`intent-classifier.ts:32-44`) — inserted right
after it, before the `PROJECT_ANALYSIS` check, so it can't be shadowed by the broader
분석/구조 heuristic:

```ts
const codeChangeKind = IntentClassifier.detectCodeChange(text);
if (codeChangeKind) {
  return {
    type: IntentType.IMPLEMENT_CODE,
    capability: Capability.CODE_IMPLEMENTATION,
    confidence: 1,
    requiresWork: true,
    summary: text.slice(0, 200) || 'Change code',
    raw: { kind: codeChangeKind },
  };
}
```

```ts
/** Deterministic, conservative (KO + EN). Kind is a classification tag only — never an
 *  implementation instruction (Q2). */
private static detectCodeChange(text: string): 'fix' | 'change' | 'refactor' | undefined {
  if (/(리팩터|리팩토링|refactor)/i.test(text)) return 'refactor';
  const bugish = /(버그|bug|에러|오류|error)/i;
  const fixVerb = /(고쳐|고치|수정|fix)/i;
  if (bugish.test(text) && fixVerb.test(text)) return 'fix';
  const changeVerb = /(고쳐|고치|수정해|수정\s*해|바꿔|바꾸어|변경해|구현해|fix|change|modify|implement)/i;
  const codeish = /(코드|code|파일|file|부분|함수|function|버그|bug)/i;
  if (changeVerb.test(text) && codeish.test(text)) return 'change';
  return undefined;
}
```

Covers the CA's three example messages: "이 버그 고쳐줘" → `fix` (bug + fix-verb); "이 부분
수정해줘" → `change` (수정해 + 부분); "코드 바꿔줘" → `change` (바꿔 + 코드). Does not overlap
`detectTestRun`'s 테스트/typecheck keywords or `isProjectAnalysis`'s 분석/설명 verbs.

### 5.2 `ExecutionRequest`/`selectStages` — the one justified, additive contract touch

**Decision (Q3, Q8): this sprint does not call AI Code Generation at all.** The Sprint's own goal
diagram is `Planning → Risk/Approval → AWAITING_APPROVAL` — no Code Generation stage. Add one
optional field to `ExecutionRequest` (`execution-orchestrator.ts:79-93`):

```ts
export interface ExecutionRequest {
  // ...unchanged fields...
  /**
   * Request PLANNING + APPROVAL only this turn — skip CODE_GENERATION/WORKSPACE_DIFF/PATCH/
   * WORKSPACE_WRITE/COMMAND_EXECUTION (Sprint 2n, ADR-0035). Absent/false preserves today's full
   * pipeline exactly.
   *
   * SCOPE CONSTRAINT (CA Round 1): this is a narrow Application-layer execution mode for the first
   * live CODE_IMPLEMENTATION product slice — it is NOT a general stage-override system. It may be
   * set ONLY by `IntentResolver`, and only when `intent.capability === Capability.CODE_IMPLEMENTATION`
   * on this live code-change-planning path. It must never be set from user input, never by
   * `IntentClassifier`, and never generalized to an arbitrary capability or an external
   * caller-controlled stage override.
   */
  planningOnly?: boolean;
}
```

(Named `planningOnly`, not the plan's earlier working name `deferCodeGeneration` — CA Round 1 required
the rename: the flag doesn't just defer code generation, it prevents the whole
`CODE_GENERATION`/`WORKSPACE_DIFF`/`PATCH`/`WORKSPACE_WRITE`/`COMMAND_EXECUTION` group, and the name
must say so.)

`selectStages` (`execution-orchestrator.ts:158-171`) changes from one `needsCode` boolean to two:

```ts
export function selectStages(request: ExecutionRequest): ExecutionStage[] {
  const caps = new Set(request.requiredCapabilities);
  const needsCode = caps.has(Capability.CODE_IMPLEMENTATION);
  const needsCodeGeneration = needsCode && !request.planningOnly;
  const needsCommand = caps.has(Capability.TEST_EXECUTION) && request.command !== undefined;

  const stages: ExecutionStage[] = [ExecutionStage.PLANNING];
  if (needsCodeGeneration) stages.push(ExecutionStage.CODE_GENERATION, ExecutionStage.WORKSPACE_DIFF);
  if (needsCode || needsCommand) stages.push(ExecutionStage.APPROVAL);
  if (needsCodeGeneration) stages.push(ExecutionStage.PATCH, ExecutionStage.WORKSPACE_WRITE);
  if (needsCommand) stages.push(ExecutionStage.COMMAND_EXECUTION);
  return stages;
}
```

**Why this is safe to call "non-breaking," not just "additive":** every existing caller/test leaves
`planningOnly` unset, so `needsCodeGeneration === needsCode` exactly — identical to today's
behavior, byte-for-byte. This is verifiable directly: the existing `execution-orchestrator.test.ts`
test `'code-change intent → Planning → CodeGen → Diff → Approval → Patch → Write'`
(`execution-orchestrator.test.ts:244-253`, built on the `codeChange()` helper which never sets the new
field) requires **zero edits** and must still pass. Only Sprint 2n's new caller sets the flag.

Considered alternative (rejected): gate `needsCode` itself on `request.targetFiles !== undefined`
(symmetric with how `needsCommand` already gates on `request.command !== undefined`). Rejected because
the existing `codeChange()` test fixture has no `targetFiles` and asserts the **full** 6-stage
pipeline — that alternative would silently change the established, CA-reviewed (Sprint 2j) contract
for every `CODE_IMPLEMENTATION` caller, not just this sprint's new one. The additive boolean touches
nothing that already has coverage.

### 5.3 `IntentResolver` — set the flag for `IMPLEMENT_CODE`

`EXECUTION_CAPABILITIES` already includes `CODE_IMPLEMENTATION` (`intent-resolver.ts:11`) — no change
to `isExecution()`. In `resolve()` (`intent-resolver.ts:40-57`), add one conditional spread next to the
existing `TEST_EXECUTION`-only `command` derivation:

```ts
return {
  goal: intent.summary,
  instruction: intent.summary,
  requiredCapabilities: [intent.capability],
  requestedBy: context.requestedBy,
  ...(context.projectId ? { projectId: context.projectId } : {}),
  ...(context.workspaceRef ? { workspaceRef: context.workspaceRef } : {}),
  ...(context.targetFiles ? { targetFiles: context.targetFiles } : {}),
  ...(command ? { command } : {}),
  ...(intent.capability === Capability.CODE_IMPLEMENTATION ? { planningOnly: true } : {}),
};
```

`instruction`/`goal` are still populated from `intent.summary` (the user's restated request) — stored
on the `ExecutionPlan` for the human approving it to read, even though nothing consumes it as an AI
prompt this sprint. Forward-compatible with a later sprint turning `planningOnly` off.

### 5.4 `RiskPolicy` — the line that actually forces the halt

```ts
[Capability.CODE_IMPLEMENTATION]: RiskLevel.HIGH, // was RiskLevel.MEDIUM
```

This is a **policy** value, not a capability-ownership change — `RiskPolicy` is the shared,
capability-agnostic Application-layer service every plan already consults (ADR-0024/0025). Its only
consumer of this specific map entry is `DeterministicPlanner.assessCapability` (`deterministic-
planner.ts:58-59`) and `RiskPolicy.assessCapability` itself; `TEST_EXECUTION`'s `MEDIUM` (Sprint 2l,
still auto-approved, zero regression) is untouched. Effect: any plan requiring `CODE_IMPLEMENTATION`
now gets `overallRisk = HIGH` → `ApprovalPolicy.evaluate().requiresApproval = true` →
`ApprovalManager.requestFor()` creates a `PENDING` request → `ExecutionOrchestrator.run()` halts at the
`APPROVAL` stage and returns `AWAITING_APPROVAL` (`execution-orchestrator.ts:251-253`) — **before**
`PATCH`/`WORKSPACE_WRITE`/`COMMAND_EXECUTION`, which (per §5.2) are not even in `selectedStages` for
this request in the first place. Two independent, reinforcing guarantees, not one (§6 Q9).

**CA Round 1 documentation requirement:** because this is a *global* policy-map change (not scoped to
one caller the way `planningOnly` is), ADR-0035 must state the rationale explicitly, verbatim in
spirit: *"`CODE_IMPLEMENTATION` is `HIGH` by default because even suggest-only or planning-stage
code-change requests are precursors to mutation. `TEST_EXECUTION` remains `MEDIUM`."* Tests must pin
all three: `CODE_IMPLEMENTATION → HIGH`, `TEST_EXECUTION → MEDIUM` (unchanged), and at least one other
low-risk capability (e.g. `GENERAL_CHAT`) unchanged (§8).

**CA Round 1 requirement — stage selection is the proof, `RiskPolicy` alone is not:** the two
mechanisms are independent layers, and the no-mutation proof (Q9) must rest on stage selection
(§5.2), not on this risk value in isolation:

```text
Layer 1 (structural):  selectedStages excludes CODE_GENERATION / WORKSPACE_DIFF / PATCH /
                        WORKSPACE_WRITE / COMMAND_EXECUTION when planningOnly is set (§5.2).
Layer 2 (approval gate): CODE_IMPLEMENTATION risk HIGH → Approval PENDING → AWAITING_APPROVAL (§5.4).
Layer 3 (aggregate guard): PatchManager.generate / WorkspaceWriteManager.apply still throw without an
                        APPROVED ApprovalRef, even if some future change re-added those stages
                        (patch-manager.ts:32-36, workspace-write-manager.ts:45-47).
```

If Layer 2 alone regressed (e.g. someone later lowers the risk back to `MEDIUM`), Layer 1 still holds:
`planningOnly` requests never place `PATCH`/`WORKSPACE_WRITE`/`COMMAND_EXECUTION` in `selectedStages`
in the first place, independent of what the approval status turns out to be.

### 5.5 `ResponseComposer` — two new methods (CA Round 1 required change)

The original plan proposed reusing `composeApprovalRequired`/`composeExecutionResult('COMPLETED')`
unchanged. **CA Round 1 rejected that as too weak for Product UX** on two specific points, and
required two new, narrowly-scoped composer methods instead. Both follow ADR-0032 §10 (Runtime frames
facts, Composer owns all text) exactly like every existing method here — no new pattern.

```ts
/**
 * Code-change-specific "approval required" prompt (Live Code Change Planning, ADR-0035). More
 * specific than the generic composeApprovalRequired: names this as a code-change request and states
 * explicitly that no file is modified yet — a planningOnly halt never mutates.
 */
composeCodeChangeApprovalRequired(context: ConversationContext): OutboundMessage {
  return {
    context,
    text:
      '이 작업은 코드 변경으로 이어질 수 있어 승인이 필요해요.\n' +
      '이번 단계에서는 실제 파일을 수정하지 않고 계획/승인까지만 진행해요.\n' +
      '진행하려면 "승인", 그만두려면 "취소"라고 답해 주세요.',
  };
}

/**
 * Reply for "승인" on a planningOnly CODE_IMPLEMENTATION request (Live Code Change Planning,
 * ADR-0035). Must NEVER read as "the code was fixed" — nothing was generated, patched, or written
 * this sprint. Distinct from composeExecutionResult('COMPLETED'), which would falsely imply the
 * work happened.
 */
composePlanningOnlyApproved(context: ConversationContext): OutboundMessage {
  return {
    context,
    text:
      '승인은 확인했어요. 이번 단계에서는 코드 수정 전 계획까지만 진행했어요. ' +
      '실제 코드 제안/수정은 다음 단계에서 진행할 수 있어요.',
  };
}
```

Exact wording is CA-specified (Round 1 review); implementation may reformat line breaks to match this
file's existing multi-sentence style but must not change the meaning of any sentence.

### 5.6 `ConversationRuntime` — two minimal, narrowly-scoped branches (CA Round 1 required change)

The original plan claimed **zero** `ConversationRuntime` changes. CA Round 1 correctly identified the
gap this hid: §9 of the original plan already flagged that "승인" on a halted `planningOnly` request
would fall through to the existing generic `composeExecutionResult('COMPLETED')` — *"요청하신 작업을
완료했어요"* — which is false; nothing was fixed. CA Round 1 requires this fixed, in scope, not
deferred. Two branches, both selecting **which existing/new composer method applies** from facts the
runtime already has — the runtime still builds no text itself:

**(a) Initial halt reply** — `handleExecutionIntent` (`conversation-runtime.ts:299-303`), the
`AWAITING_APPROVAL` branch: pick the code-change-specific prompt when the halting capability is
`CODE_IMPLEMENTATION`, else keep today's generic prompt for every other capability (there are none yet,
but the branch must not assume there never will be):

```ts
if (outcome.status === ('AWAITING_APPROVAL' as ExecutionOutcomeStatus)) {
  await this.deps.approvalFlow.anchor(session, request, outcome);
  const reply =
    intent.capability === Capability.CODE_IMPLEMENTATION
      ? this.deps.composer.composeCodeChangeApprovalRequired(message.context)
      : this.deps.composer.composeApprovalRequired(message.context);
  await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
  return { status: 'AWAITING_APPROVAL', reply, sessionId: session.id, executionOutcome: outcome };
}
```

**(b) "승인" resume reply** — `handleApprovalTurn`'s `approve` branch (`conversation-runtime.ts:241-
254`): after `orchestrator.resume(...)`, if the reconstructed request was `planningOnly` (true for
every `CODE_IMPLEMENTATION` request this sprint, since nothing else sets it — §5.2 scope constraint),
use the planning-only-approved reply instead of the generic completed/denied/cancelled mapping:

```ts
const outcome = await this.deps.orchestrator.resume(ctx.request, ctx.prior);
if (ctx.request.planningOnly) {
  const reply = this.deps.composer.composePlanningOnlyApproved(message.context);
  await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
  return { status: 'RESPONDED', reply, sessionId: session.id, executionOutcome: outcome };
}
return this.replyForOutcome(message.context, session, outcome);
```

("취소"/"거절" are unaffected — that branch (`conversation-runtime.ts:256-262`) already replies with
`composeExecutionResult('DENIED'|'CANCELLED')`, which never claims completion; CA Round 1 test #26
regression-guards this stays true.)

**Why this stays "minimal" and not a slippery slope:** both branches key off facts the runtime already
holds (`intent.capability`, `ctx.request.planningOnly`) — no new state, no new persistence, no new
aggregate. They are the *only* two places `AWAITING_APPROVAL`/resume text is chosen, and both still
delegate 100% of the actual wording to `ResponseComposer`, preserving ADR-0032 §10.

## 6. Required Architecture Questions — answers

**Q1. Which existing IntentType/Capability should represent code-change requests?**
`IntentType.IMPLEMENT_CODE` + `Capability.CODE_IMPLEMENTATION` — both already defined
(`domain/enums.ts:54,68`) and already load-bearing in `IntentResolver`, `RiskPolicy`,
`ConversationRuntime.needsWorkspace`, and `ExecutionOrchestrator.selectStages`. No new enum.

**Q2. Should classifier emit `raw.kind` or `raw.action` for code-change requests?**
`raw.kind: 'fix' | 'change' | 'refactor'` — a classification tag only, same shape/spirit as
`RUN_TESTS`'s `raw.kind: 'typecheck' | 'test'` (ADR-0033 precedent). The classifier never emits an
implementation instruction; `intent.summary` (the restated user text) is the only thing carried
forward, and this sprint doesn't even consume it as an AI prompt (§5.3).

**Q3. Should Sprint 2n stop at `AWAITING_APPROVAL`, or allow an AI Code Generation proposal?**
**CA decision: stop at `AWAITING_APPROVAL` — no AI Code Generation call this sprint.** Confirmed in
Round 1 review: "live AI code generation is a bigger Product decision and should not be smuggled into
a planning sprint." Approved this sprint: `Planning → Approval → AWAITING_APPROVAL`. Explicitly **not**
approved this sprint: `CodeGenerationManager.generate`, any `ProviderSelector`/Claude/Ollama/Codex
invocation, `WorkspaceDiff`, `Patch`, `WorkspaceWrite`, `CommandExecution`. Deferred to a future sprint
behind the `planningOnly` flag, which flips with a one-line change once that sprint decides how
`targetFiles` gets populated and reviewed.

**Q4. How is the active project/workspace resolved?**
Identically to Sprint 2l: `ConversationRuntime` reads `session.activeProjectId`, loads the `Project`,
calls the existing `WorkspaceManager.open(project)` (`conversation-runtime.ts:277-286`). Already wired
because `needsWorkspace` already includes `CODE_IMPLEMENTATION` — zero new mechanism.

**Q5. What exact risk/approval policy forces halt?**
`RiskPolicy.CAPABILITY_RISK[CODE_IMPLEMENTATION]: MEDIUM → HIGH` (§5.4) — **approved with a
documentation requirement**: ADR-0035 must state this is a global policy-map change and record the
rationale (§5.4). Reinforced structurally by §5.2's stage-selection change, which removes
`PATCH`/`WORKSPACE_WRITE` from `selectedStages` entirely for a `planningOnly` request — CA Round 1
was explicit that **the no-mutation proof must rest on stage selection, not on this risk value alone**
(§5.4's three-layer breakdown; Q9).

**Q6. What should the user see when approval is required?**
**CA decision: approved with change.** The original plan proposed reusing the generic
`composeApprovalRequired` unchanged; CA Round 1 required a code-change-specific message instead — the
new `ResponseComposer.composeCodeChangeApprovalRequired` (§5.5), which states (a) approval is
required, (b) this is a code-change-related request, (c) this stage does not modify files, (d) how to
reply (승인/취소). Selected by `ConversationRuntime` based on `intent.capability` (§5.6a); text owned
entirely by `ResponseComposer`.

**Q7. What happens if no active project exists?**
The existing `ResponseComposer.composeNeedsProject` (`response-composer.ts:236-241`), via the existing
`needsWorkspace`-gated branch in `handleExecutionIntent` (`conversation-runtime.ts:274-277`). No
command/plan is ever created in this case — the branch returns before `intentResolver.resolve` is
even called. Zero new code. **CA: approved as-is.**

**Q8. What existing orchestrator stages are selected, and which must be prevented?**
**CA decision: approved with the `planningOnly` rename.** Selected: `PLANNING`, `APPROVAL`. Prevented
(not present in `selectedStages` at all, for a `planningOnly: true` request): `CODE_GENERATION`,
`WORKSPACE_DIFF`, `PATCH`, `WORKSPACE_WRITE`, `COMMAND_EXECUTION`. See §5.2's `selectStages` diff. For
any future, non-`planningOnly` `CODE_IMPLEMENTATION` caller, the existing full 6-stage pipeline must
remain byte-for-byte unchanged — enforced by the required regression test (§8 items 11-12).

**Q9. How do we prove no file mutation occurs?**
Three layers (§5.4), plus the aggregate-level checks CA Round 1 added on top of the original two:
1. **Structural (stage selection):** `runMutatingStages` (`execution-orchestrator.ts:322-392`) only
   calls `deps.patch.generate` / `deps.workspaceWrite.apply` / `deps.command.run` inside
   `if (selectedStages.includes(STAGE))` guards. With `PATCH`/`WORKSPACE_WRITE`/`COMMAND_EXECUTION`
   absent from `selectedStages` (§5.2/Q8), those calls are unreachable code for this request — not
   merely denied at runtime. **This is the layer the no-mutation proof must rest on (CA Round 1).**
2. **Defense in depth (aggregate-level guard):** even if a future change re-added those stages,
   `PatchManager.generate` and `WorkspaceWriteManager.apply` both throw synchronously unless
   `approvalRef.status === ApprovalStatus.APPROVED` (`patch-manager.ts:32-36`,
   `workspace-write-manager.ts:45-47`) — and this request's approval is guaranteed `PENDING` (§5.4).
3. **Test proof — call counts (§8):** a new orchestrator test asserts call-count `0` on
   `deps.codeGeneration.generate`, `deps.workspace.diff`, `deps.patch.generate`,
   `deps.workspaceWrite.apply`, `deps.command.run` for a `planningOnly` request that halts at
   `AWAITING_APPROVAL`. The only filesystem-touching call that *does* run is the existing, read-only
   `WorkspaceManager.open` (`workspace-manager.ts:33-40`, "Open a **read-only** workspace") — identical
   to what Sprint 2l already exercises for `TEST_EXECUTION`.
4. **Test proof — absent refs (CA Round 1 addition):** the same outcome's `refs` must contain only
   `executionPlanRef` + `approvalRef` — `refs.codeGenerationId`, `refs.patchSetId`,
   `refs.workspaceChangeId`, `refs.commandExecutionId` must all be `undefined`. Call-count-zero and
   ref-absence are two different assertions on the same fact and CA required both.

## 7. Case matrix

| Case | Detection | Reply |
|---|---|---|
| No active project | `session.activeProjectId` absent | `composeNeedsProject` (existing, unchanged) |
| Workspace open fails | `WorkspaceManager.open` throws | `composeWorkspaceUnavailable` (existing, unchanged) |
| Active project + workspace OK | — | `ExecutionOrchestrator.run` → `PLANNING` → `APPROVAL` (`PENDING`, HIGH risk) → `AWAITING_APPROVAL` → **`composeCodeChangeApprovalRequired`** (new, §5.5) + `approvalFlow.anchor` |
| Planning itself fails | orchestrator `PLANNING` throws | `composeExecutionResult('STOPPED_ON_FAILURE')` (existing, generic) |
| User says "승인" | next turn, pending approval derived, `ctx.request.planningOnly` true | `approvals.decide` → `orchestrator.resume` → **`composePlanningOnlyApproved`** (new, §5.6b) — never the generic "완료했어요" |
| User says "거절"/"취소" | next turn, pending approval derived | existing `composeExecutionResult('DENIED'\|'CANCELLED')` — unaffected, still accurate (never claimed completion) |

## 8. Validation Strategy (tests to add/change at implementation — Node 22)

**`risk-policy.test.ts`** (`risk-policy.test.ts:10`): update the existing assertion —
`rp.assessCapability(Capability.CODE_IMPLEMENTATION)` now `RiskLevel.HIGH`, not `MEDIUM`. Comment
updated to explain why (approval-gated by design, ADR-0035).

**`deterministic-planner.test.ts`** (`deterministic-planner.test.ts:40-47`): update
`'derives overallRisk + approvalRequired from RiskPolicy'` — `[GENERAL_CHAT, CODE_IMPLEMENTATION]` now
yields `overallRisk: HIGH` (`max(LOW, HIGH)`) and `approvalRequired: true`. This is the intended
behavior change this sprint makes, asserted directly.

**`execution-orchestrator.test.ts`**:
1. `selectStages` — new case: `{ ...codeChange(), planningOnly: true }` →
   `[PLANNING, APPROVAL]` exactly (no `CODE_GENERATION`/`WORKSPACE_DIFF`/`PATCH`/`WORKSPACE_WRITE`).
2. Existing case `'code-change intent → Planning → CodeGen → Diff → Approval → Patch → Write'`
   (line 244) — **unchanged, must still pass** (proves the new field is additive, not a behavior
   change for existing callers).
3. `ExecutionOrchestrator.run` — new case: `{ ...codeChange(), planningOnly: true }` with a
   `HIGH`-risk plan / `PENDING` approval fake → outcome `AWAITING_APPROVAL`, `lastStage: APPROVAL`,
   `refs` contains only `executionPlanRef` + `approvalRef` (no `codeGenerationId`/`patchSetId`/
   `workspaceChangeId`).
4. Same case — spy/count `deps.codeGeneration.generate`, `deps.workspace.diff`, `deps.patch.generate`,
   `deps.workspaceWrite.apply`, `deps.command.run` all called `0` times (Q9 proof).

**`intent-classifier.test.ts`** (new cases):
5. "이 버그 고쳐줘" → `IMPLEMENT_CODE` / `CODE_IMPLEMENTATION`, `raw.kind: 'fix'`.
6. "이 부분 수정해줘" → `IMPLEMENT_CODE`, `raw.kind: 'change'`.
7. "코드 바꿔줘" → `IMPLEMENT_CODE`, `raw.kind: 'change'`.
8. "이 함수 리팩터링 해줘" → `IMPLEMENT_CODE`, `raw.kind: 'refactor'`.
9. Regression: "테스트 돌려줘" still → `RUN_TESTS` (not shadowed by the new rule); "이 프로젝트 구조
   설명해줘" still → `PROJECT_ANALYSIS`.

**`intent-resolver.test.ts`** (existing test at line 17 already exercises
`CODE_IMPLEMENTATION`/`IMPLEMENT_CODE` — add assertions):
10. `req?.planningOnly` is `true` for a `CODE_IMPLEMENTATION` intent.
11. `req?.planningOnly` is **not** set (undefined/false) for a `TEST_EXECUTION` intent — proves the
    flag stays scoped to `CODE_IMPLEMENTATION` only (§5.2 scope constraint).

**`response-composer.test.ts`** (new cases):
12. `composeCodeChangeApprovalRequired` — text mentions approval, code-change context, and that no
    file is modified yet; mentions 승인/취소.
13. `composePlanningOnlyApproved` — text does **not** contain "완료" and does not imply code was
    fixed; states planning-only progress and that the next step is a later stage.

**`conversation-runtime.test.ts`** (existing tests at lines 222-235 continue to pass unmodified — they
mock `orchestrator.run`/`resume` directly and don't exercise real `RiskPolicy`/`selectStages`; new
cases required by CA Round 1):
14. No active project + code-change intent → `composeNeedsProject`, `orchestrator.run` **not** called.
15. Active project + code-change intent → `AWAITING_APPROVAL`, reply text comes from
    `composeCodeChangeApprovalRequired` (not the generic `composeApprovalRequired`), `approvalFlow.anchor`
    called once.
16. Next turn "승인" on a `planningOnly` pending approval → `approvals.decide` called, `orchestrator.resume`
    called, reply text comes from `composePlanningOnlyApproved` — **does not** equal
    `composeExecutionResult('COMPLETED')`'s text.
17. Next turn "취소"/"거절" on the same pending approval → unaffected, still `DENIED`/`CANCELLED`,
    `orchestrator.resume` **not** called (regression guard, CA Round 1 test #26).

18. `pnpm typecheck` + `pnpm test` green on **Node 22**.

This list maps directly onto the CA Round 1 "Required Tests" enumeration (28 items in the review) —
every item there is covered by one of the 18 grouped cases above; nothing in the CA's list is skipped.

## 9. Explicitly out of scope for this plan (deferred, not designed here)

CA Round 1 pulled the "승인" resume-UX question into this sprint's scope (§5.6b) — it is **no longer**
deferred. What remains genuinely out of scope:

- Turning `planningOnly` off (i.e., wiring real AI Code Generation pre-approval) — Q3's
  deferred decision.
- `targetFiles` population for a code-change intent (needed before AI Code Generation can run
  meaningfully) — not designed here.
- Any UI/UX beyond the two new `ResponseComposer` text methods (no Discord buttons, no rich embeds —
  explicit non-goal, §4).

## 10. Architecture Impact / Reuse

- **Reuses, unchanged:** `domain/enums.ts` (`IMPLEMENT_CODE`/`CODE_IMPLEMENTATION`, pre-existing),
  `WorkspaceManager.open`, `ApprovalManager`, `ApprovalPolicy`, `PatchManager`, `WorkspaceWriteManager`,
  `CommandExecutionManager` (none of the last three are ever called on this path),
  `CodeGenerationManager` (not called this sprint), all DI wiring in `app.module.ts` (no new
  providers), the entire deny/cancel reply path (`conversation-runtime.ts:256-262`, untouched).
- **Changes:** `intent-classifier.ts` (+1 detection rule), `intent-resolver.ts` (+1 conditional field),
  `execution-orchestrator.ts` (+1 optional `ExecutionRequest` field, `selectStages` split into
  `needsCode`/`needsCodeGeneration`), `risk-policy.ts` (1 map value, `MEDIUM → HIGH`),
  `response-composer.ts` (+2 new methods, §5.5), `conversation-runtime.ts` (2 narrowly-scoped branches,
  §5.6 — CA Round 1 required change; the original plan's "zero edits" claim did not survive review).
- **No new** aggregate / repository / migration / capability / port. **No** `Core` contract change.
  The one `ExecutionOrchestrator` contract touch is additive/non-breaking and justified in §5.2/Q3/Q8.
- **ADR-0035** (authored before implementation) must include, per CA Round 1:
  1. Sprint 2n is live code-change **planning**, not live code-change **execution**.
  2. Deterministic `IMPLEMENT_CODE` intent activation; classifier emits `raw.kind` only.
  3. `CODE_IMPLEMENTATION` risk is `HIGH`; `TEST_EXECUTION` remains `MEDIUM` — with the rationale from
     §5.4 stated verbatim.
  4. `planningOnly` is a narrow Application-layer execution mode for the first live
     `CODE_IMPLEMENTATION` product slice, not a general stage-override system (§5.2 scope constraint).
  5. `planningOnly` `selectedStages` are `PLANNING + APPROVAL` only; no AI Code Generation,
     `WorkspaceDiff`, `Patch`, `WorkspaceWrite`, or `CommandExecution` this sprint.
  6. The approval prompt is code-change-planning-specific; approval resume does not claim code was
     completed (§5.5, §5.6).
  7. `ConversationRuntime` frames facts only; `ResponseComposer` owns all text (restated, unchanged
     invariant — ADR-0032 §10).
  8. No new aggregate/repository/migration/capability/port.

## 11. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Classifier false-positive (casual chat mentioning "고쳐줘"/"바꿔줘" misread as a code-change request) | Med (Product) | Conservative deterministic keyword pairing (bug+fix-verb, or change-verb+code-ish noun); worst case is an unnecessary approval prompt the user dismisses with "취소" — no safety impact (§8 item 9 regression-guards against shadowing existing intents) |
| `RiskPolicy` bump silently changes behavior for some other, not-yet-existing `CODE_IMPLEMENTATION` caller | Low | Only consumer today is this sprint's new path; `TEST_EXECUTION` (`MEDIUM`) is untouched; grep-verified single point of use (`deterministic-planner.ts`); pinned by dedicated tests (§8) |
| `selectStages` change regresses the existing full code-change pipeline for a future non-`planningOnly` caller | Low | Existing test at `execution-orchestrator.test.ts:244` is required to still pass unmodified; new field defaults to "off," proven equivalent by construction (§5.2); CA Round 1 made this a hard gate ("이 테스트가 없으면 이 변경은 승인할 수 없습니다") |
| `planningOnly` scope creep — reused as a general stage-override for some other capability later | Med (Architecture) | Scope constraint stated explicitly on the field's own doc comment and in ADR-0035 (§5.2); the only place that ever sets it is `IntentResolver.resolve()`'s `CODE_IMPLEMENTATION`-specific branch |
| The two new `ConversationRuntime` branches (§5.6) drift into building text themselves over time | Low | Both branches only *select* which `ResponseComposer` method to call; code review at PR time should reject any inline Korean string literal in `conversation-runtime.ts` |

## CA Round 1 — summary of applied changes

1. `deferCodeGeneration` → **`planningOnly`**, with an explicit narrow-scope constraint documented on
   the field and in ADR-0035 (§5.2).
2. `planningOnly` set only by `IntentResolver`, only for `CODE_IMPLEMENTATION` — confirmed already true
   by construction, now stated as a hard constraint (§5.2, §5.3).
3. "승인" resume UX pulled into scope: new `ResponseComposer.composePlanningOnlyApproved` +
   `ConversationRuntime` branch, so approval-resume never claims completion (§5.5, §5.6b).
4. Approval prompt made code-change-specific: new `ResponseComposer.composeCodeChangeApprovalRequired`
   + `ConversationRuntime` branch (§5.5, §5.6a).
5. `RiskPolicy` change approved; ADR-0035 must document it as a global policy change with rationale,
   and tests must pin `CODE_IMPLEMENTATION`/`TEST_EXECUTION`/one other capability (§5.4, §8).
6. Stage-selection change approved; the existing full-pipeline regression test is a hard gate, not
   optional (§5.2, §8 items 1-2).
7. No-mutation proof re-anchored on stage selection (Layer 1) as the primary guarantee, with
   `RiskPolicy` (Layer 2) and the aggregate-level `APPROVED`-required guards (Layer 3) as reinforcing,
   not primary, safeguards (§5.4, §6 Q9).

## Next Step

**Plan changes applied — CA Round 1 requirements incorporated above.** Per the approved implementation
sequence: (1) plan changes applied (this document); (2) author ADR-0035 next; (3) implement exactly
this scope (§3/§5) on a `v2/<topic>` branch; (4) add/update tests per §8; (5) validate on **Node 22**;
(6) open a PR for Chief Architect Implementation Review. No commit/PR has been made yet — proceeding
to ADR-0035 + implementation now.
