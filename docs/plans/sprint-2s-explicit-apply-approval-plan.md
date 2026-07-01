# Sprint 2s Plan — Explicit Preview Apply Approval (second gate, still no mutation)

- **Status:** ✅ APPROVED WITH CHANGES (Chief Architect Review, Round 1) — required changes applied
  below; implementing this scope next.
- **Base:** `main` @ `82fd242` · **Validation runtime:** Node 22 (to be run at implementation time).
- **Directed by:** Chief Architect (this sprint's topic is CA-assigned, not Claude-proposed).
- **Goal:** After a user has seen Sprint 2r's diff preview, recognize an **explicit** apply command
  ("적용해줘", "반영해줘", "이대로 진행해") and create a **second** `ApprovalRequest` — HIGH risk,
  clearly worded as "this approves file modification, not preview generation" — then halt at
  `AWAITING_APPROVAL`. No `WorkspaceWrite`, no `Patch`, no `CommandExecution`, no file/git mutation.
  Actual apply is Sprint 2t's job — this sprint must preserve, not destroy, the approved context that
  sprint will need.
- **Phase:** Phase 2 — Product Construction (ninth runtime sprint, after 2k–2r). **Not** a new
  capability in the CAP-00N sense — reuses `ApprovalRequest`/`ApprovalManager` (CAP-004), the
  `ExecutionRequest`/`ExecutionOutcome` refs Sprint 2n–2r already thread, and the exact Task-anchor
  pattern `StatelessApprovalFlow`/`StatelessScopeClarificationFlow` already established.
- **Process:** V2 architecture-first, step 1 (plan-only) → CA review Round 1 complete → applying
  required changes → implementation next. No implementation, no branch, no commit, no PR in this step.

> **Framing.** CA Round 1 confirmed both central findings from the original draft (§2/§3 below) and
> required ten changes, the two most consequential being: (1) an explicit apply phrase with **no**
> eligible anchor must be answered directly ("nothing to apply") rather than falling through and being
> reinterpreted as an ordinary new code-change request — those are different user intents and must never
> be conflated; and (2) **approving** the second gate must not clear the one place that remembers
> *what* was approved — `ApprovalRequest` itself carries no `workspaceRef`/`targetFiles`/
> `codeProposalRef`, so clearing the anchor on approve would silently make the approval undiscoverable
> to the future Apply sprint. Both are incorporated below as an explicit three-state anchor lifecycle.

---

## 1. Objective

`ConversationRuntime.runCodeGenerationPreview` (Sprint 2q/2r), on a successful diff preview, additionally
anchors a lightweight, **plan-less** Task recording an `ApplyPreviewAnchor` in status `ELIGIBLE`:
`{executionPlanRef, workspaceRef, targetFiles, codeGenerationRef, codeProposalRef, instruction}` —
"here is what was just previewed, in case the user asks to apply it." On a later turn:
- an **explicit** apply phrase with an `ELIGIBLE` anchor creates a second `ApprovalRequest` (HIGH risk)
  and re-anchors it as `AWAITING_APPROVAL`;
- an explicit apply phrase with **no** anchor (or a stale one) gets a direct "nothing to apply" reply —
  **never** reinterpreted as a new, unscoped code-change request;
- once `AWAITING_APPROVAL`, every turn is intercepted for a decision, exactly like the first approval;
- **approving** re-anchors as `APPROVED` (preserving every ref for a future Apply sprint) — it does
  **not** clear the anchor; denying/cancelling **does** clear it.

Nothing is patched, written, executed, or committed — this sprint's only new side effect is creating one
more `ApprovalRequest` row via the existing Approval capability.

## 2. Central finding #1 — the second approval must NOT be discoverable by the first approval's flow

**`StatelessApprovalFlow.findPending(session)` (`stateless-approval-flow.ts:34-40`) is:**
```ts
async findPending(session: Session): Promise<ApprovalRequest | null> {
  if (!session.activeTaskId) return null;
  const task = await this.store.tasks.get(session.activeTaskId);
  if (!task?.planId) return null;
  const requests = await this.store.approvals.findByExecutionPlan(task.planId);
  return requests.find((r) => r.status === ApprovalStatus.PENDING) ?? null;
}
```
It looks up **any** PENDING `ApprovalRequest` for the anchored Task's `planId` — it has no way to know
*which* approval it originally anchored for. If the apply-approval's anchor Task carried the same
`planId` as the original preview-approval's anchor Task (the same `executionPlanRef.id`, which the new
`ApprovalRequest` must still reference per Q8), **this existing flow would discover the second approval
as if it were its own** — because `ConversationRuntime.handle()` checks `approvalFlow.findPending()`
*first* (step (A), before anything this sprint adds). Its `approve` branch would then call
`reconstructResume(session, pending)`, which reads `task.metadata['conversationExecutionAnchor']` —
absent on the apply-anchor Task — return `null` — and fall into the "can't reconstruct — fail safe:
re-ask" branch. **The apply approval could never actually be decided**: every "승인" would loop back to
a generic "please clarify" prompt, and `approvals.decide` would never be called on it.

**Resolution (mirrors `StatelessScopeClarificationFlow`'s already-proven fix for the identical shape of
problem, ADR-0037; CA Round 1: confirmed, approved without change): the apply-anchor Task's `planId`
field is always left `undefined`.** `StatelessApprovalFlow.findPending`'s very first guard
(`if (!task?.planId) return null`) then skips it unconditionally — it never even reaches the
`findByExecutionPlan` call. The new `ApprovalRequest` itself still carries the real `executionPlanRef`
(that's a field *on the approval*, not on the Task that anchors it); only the anchoring Task's own
`planId` is intentionally absent, exactly like `StatelessScopeClarificationFlow`'s anchor Task already
is. A brand-new third flow (§5.1) — not a reuse of `StatelessApprovalFlow` — owns finding/anchoring/
clearing this Task, discriminated the same way scope-clarification is: `!task.planId` **and** an
explicit `kind` metadata discriminator.

## 3. Central finding #2 — there is no live `ExecutionPlan` to hand to `ApprovalManager.requestFor`

`ExecutionPlan` (`execution-plan.ts:37-52`) is explicitly documented as **"In-memory only in CAP-003 —
persistence begins with Approval."** There is no `ExecutionPlanRepository`/`storage.executionPlans` — it
is a pure, ephemeral value produced once by `PlanningManager.plan()` and never stored. By the time a
user says "적용해줘" (turns after the plan was produced, after approval #1, after CodeGeneration, after
the diff preview), **the full `ExecutionPlan` object is long gone** — only its lightweight
`ExecutionPlanRef` (`{id, goal}`) survives, carried through `ExecutionOutcome.refs`/the anchored
`ExecutionRequest`. `ApprovalManager.requestFor(plan: ExecutionPlan, requestedBy)` needs the *full* plan
(it reads `plan.overallRisk` via `ApprovalPolicy.evaluate`) — it cannot be called with only a ref.

**Resolution (CA Round 1: confirmed, approved with constraints — §6 Q4/Required Change #4): `ApprovalManager`
gains one small, additive method, `requestForRisk`, for exactly this case — a mutation-step approval
with a known, fixed risk level and no live plan to re-evaluate. It is narrowly constrained: always
creates `PENDING` (never auto-approves), never calls `ApprovalPolicy`, and accepts only a risk level the
caller already knows is required:**
```ts
/**
 * Create a PENDING ApprovalRequest when there is no live ExecutionPlan to re-evaluate (ADR-0024: the
 * plan is in-memory only and does not survive past its originating turn) — e.g. a later, explicit
 * approval for a mutation step derived from an already-approved plan (Sprint 2s, ADR-0040). The risk
 * level is supplied directly by the caller, which already knows it must require approval; this
 * deliberately bypasses ApprovalPolicy's plan-based evaluation and NEVER auto-approves — it does not
 * replace requestFor(plan) for the normal planning-approval path.
 */
async requestForRisk(input: {
  executionPlanRef: ExecutionPlanRef;
  riskLevel: RiskLevel;
  reason: string;
  requestedBy: string;
}): Promise<ApprovalRequest> {
  const ts = now();
  const request: ApprovalRequest = {
    id: newId(),
    executionPlanRef: input.executionPlanRef,
    status: ApprovalStatus.PENDING, // unconditional — this method never auto-approves
    riskLevel: input.riskLevel,
    reason: input.reason,
    requestedBy: input.requestedBy,
    createdAt: ts,
    updatedAt: ts,
  };
  return this.storage.approvals.save(request);
}
```
This is the **one deviation from Sprint 2q/2r's "zero Capability-layer changes" precedent** — flagged
explicitly because it is the only change in this plan that touches a class other than
`ConversationRuntime`/`ResponseComposer`. It is additive (existing `requestFor`/`decide`/`get`/
`isApproved` are untouched, zero behavior change for any existing caller), stays entirely inside
`ApprovalManager` — the aggregate's sole owner (CAP-004, ADR-0025's Aggregate Ownership Rule). This
sprint's only caller always passes `RiskLevel.HIGH` (§6 Q12); `requestForRisk` itself does not
special-case that — it is a general "known risk, no plan" constructor whose caller is responsible for
using it correctly, matching CA's explicit instruction not to create any auto-approval path inside it.

## 4. Scope (this sprint)

- **`ApprovalManager.requestForRisk`** (§3) — one new additive method: always `PENDING`, never calls
  `ApprovalPolicy`, never auto-approves.
- **New `ApplyPreviewFlow` interface + `ApplyPreviewAnchor` type** (renamed from the original draft's
  `PendingApplyPreview` per CA Round 1 Required Change #3 — a "Pending…" name became misleading once the
  anchor can reach an `APPROVED` state), exported from `conversation-runtime.ts` alongside
  `ApprovalFlow`/`ScopeClarificationFlow` (§5.1). The anchor carries an explicit
  `status: 'ELIGIBLE' | 'AWAITING_APPROVAL' | 'APPROVED'` (CA Round 1 Required Change #2). New
  production implementation `StatelessApplyPreviewFlow` (new file, mirrors
  `StatelessScopeClarificationFlow`) (§5.2).
- **`ConversationRuntimeDeps`** gains one new dependency, `applyPreviewFlow: ApplyPreviewFlow`, and the
  existing `approvals` dependency's declared type gains `requestForRisk` + `get` (§5.3) — both satisfied
  by already-registered instances; `app.module.ts` needs only to construct+pass the new flow (§5.6), no
  new provider.
- **`runCodeGenerationPreview`**'s success branch anchors an `ELIGIBLE` `ApplyPreviewAnchor` right after
  composing the diff-preview reply (§5.4).
- **`ConversationRuntime.handle()`** gains one new routing step, checked after `scopeClarificationFlow`
  and before intent classification (§5.5, CA Round 1 Required Changes #1/#9/#10):
  - anchor status `AWAITING_APPROVAL` → **always** intercepts (any message) → `handleApplyApprovalTurn`;
  - explicit apply phrase + anchor status `ELIGIBLE` → `handleApplyIntentTurn` (creates approval #2);
  - explicit apply phrase + anchor status `APPROVED` → `handleApplyAlreadyApprovedTurn` (no new
    approval, no re-ask loop);
  - explicit apply phrase + **no** anchor (or a stale/cleared one) →
    `handleApplyPreviewUnavailableTurn` — **never** falls through to normal classification;
  - anything else (no apply phrase, anchor not `AWAITING_APPROVAL`) → falls through untouched — the
    soft-hook property (§6 Q6/Required Change #9) still holds for ordinary conversation.
- **New static keyword check**, `ConversationRuntime.interpretApplyIntent(text)`, using a dedicated
  `APPLY_WORDS` list **distinct from** `APPROVE_WORDS` — "좋아"/"오케이"/"확인"/"괜찮네" must never
  trigger apply (§5.5, Critical Product Rule).
- **Four new `ResponseComposer` methods**: `composeApplyApprovalRequested` (now names 승인/거절/취소 all
  three, CA Round 1 Required Change #6), `composeApplyPreviewUnavailable`, `composeApplyApprovalRecorded`
  (strengthened wording, CA Round 1 Required Change #7). Deny/cancel on the apply gate reuse the existing
  `composeExecutionResult('DENIED'|'CANCELLED')` — no new wording needed there.
- Tests for all of the above (§8), including the CA's 48 explicitly required test items.

## 5. Design

### 5.1 `ApplyPreviewFlow` interface + `ApplyPreviewAnchor` (new, exported from `conversation-runtime.ts`)

```ts
/** The three states one apply-preview anchor moves through (CA Round 1 Required Change #2). Never
 *  regresses; deny/cancel clears the anchor entirely instead of introducing a fourth "rejected" state. */
export type ApplyPreviewAnchorStatus = 'ELIGIBLE' | 'AWAITING_APPROVAL' | 'APPROVED';

/**
 * Anchored fact set for "a diff preview was shown; the user may explicitly ask to apply it" (Sprint
 * 2s, ADR-0040). `kind` proves this Task's metadata is an apply-preview anchor, never an approval
 * anchor (`planId` present) or a scope-clarification anchor (different discriminator) — mirrors
 * PendingScopeClarification's pattern exactly. Renamed from an earlier `PendingApplyPreview` (CA Round
 * 1 Required Change #3) — "Pending" was misleading once the anchor can reach `APPROVED`.
 */
export interface ApplyPreviewAnchor {
  kind: 'code-preview-apply';
  status: ApplyPreviewAnchorStatus;
  executionPlanRef: ExecutionPlanRef;
  workspaceRef: WorkspaceRef;
  targetFiles: string[];
  codeGenerationRef: CodeGenerationRef;
  codeProposalRef: CodeProposalRef;
  /** The original request's instruction — restated in the apply-approval's `reason`, never re-derived
   *  from chat history (Q1). */
  instruction: string;
  /** The active project at anchor time — re-checked at recovery time (mirrors Sprint 2p's Q5 pattern). */
  projectId?: Id;
  createdAt: IsoTimestamp;
  /** Set once `status` moves to `AWAITING_APPROVAL` or beyond; absent while `ELIGIBLE`. */
  approvalId?: Id;
  /** Set once `status` becomes `APPROVED`. */
  approvedAt?: IsoTimestamp;
}

export interface ApplyPreviewFlow {
  /** Derive the session's apply-preview anchor, if any and still valid (project unchanged) — CA Round 1
   *  Required Change #3: named `findAnchor`, not `findPending`, since a returned anchor is not always
   *  "pending" anything (it may be `ELIGIBLE` or already `APPROVED`). Callers branch on `.status`. */
  findAnchor(session: Session): Promise<ApplyPreviewAnchor | null>;
  /** Anchor (or re-anchor, on every status transition) the apply-preview fact set. Always creates a
   *  fresh Task and re-points `session.activeTaskId` — same shape as the other two flows. */
  anchor(session: Session, anchor: ApplyPreviewAnchor): Promise<void>;
  /** Consume/clear the anchor — called only on deny/cancel (CA Round 1 Required Change #2: approving
   *  must NOT clear it). A no-op unless `session.activeTaskId` still points at THIS flow's own anchor. */
  clear(session: Session): Promise<void>;
}
```

### 5.2 `StatelessApplyPreviewFlow` (new file, mirrors `StatelessScopeClarificationFlow`)

```ts
const ANCHOR_KEY = 'conversationApplyPreviewAnchor';
const ANCHOR_DISCRIMINATOR = 'code-preview-apply' as const;

export class StatelessApplyPreviewFlow implements ApplyPreviewFlow {
  constructor(private readonly store: ApplyPreviewFlowStore) {}

  private async anchorTask(session: Session): Promise<{ task: Task; anchor: ApplyPreviewAnchor } | null> {
    if (!session.activeTaskId) return null;
    const task = await this.store.tasks.get(session.activeTaskId);
    if (!task || task.planId) return null; // an approval-anchor Task always has planId; ours never does
    const anchor = task.metadata?.[ANCHOR_KEY] as ApplyPreviewAnchor | undefined;
    if (anchor?.kind !== ANCHOR_DISCRIMINATOR) return null; // explicit discriminator, not just !planId
    return { task, anchor };
  }

  async findAnchor(session: Session): Promise<ApplyPreviewAnchor | null> {
    const found = await this.anchorTask(session);
    if (!found) return null;
    // Q7: active project changed since anchor time — none of the three states remain valid against a
    // workspace validated for a different project. Safe to auto-clear.
    if (found.anchor.projectId !== session.activeProjectId) {
      await this.clear(session);
      return null;
    }
    return found.anchor;
  }

  async anchor(session: Session, anchor: ApplyPreviewAnchor): Promise<void> {
    const ts = now();
    const task: Task = {
      id: newId(),
      title: 'code-change apply approval',
      description: anchor.instruction,
      // An inert conversation anchor, never advanced through the real work pipeline (mirrors
      // ScopeClarificationFlow's Task) — WAITING_APPROVAL only while a real ApprovalRequest is PENDING.
      status: anchor.status === 'AWAITING_APPROVAL' ? TaskStatus.WAITING_APPROVAL : TaskStatus.PENDING,
      intent: {
        type: IntentType.IMPLEMENT_CODE,
        capability: Capability.CODE_IMPLEMENTATION,
        confidence: 1,
        requiresWork: true,
        summary: anchor.instruction,
      },
      riskLevel: RiskLevel.HIGH,
      context: session.context,
      ...(session.actorId ? { actorId: session.actorId } : {}),
      sessionId: session.id,
      ...(anchor.projectId ? { projectId: anchor.projectId } : {}),
      createdAt: ts,
      updatedAt: ts,
      metadata: { [ANCHOR_KEY]: anchor },
    };
    await this.store.tasks.save(task);
    await this.store.sessions.save({ ...session, activeTaskId: task.id, lastActivityAt: ts });
  }

  async clear(session: Session): Promise<void> {
    const found = await this.anchorTask(session);
    if (!found) return;
    await this.store.sessions.save({ ...session, activeTaskId: undefined, lastActivityAt: now() });
  }
}
```
`ApplyPreviewFlowStore` is the same narrow `{sessions: {save}, tasks: {get, save}}` shape
`ScopeClarificationFlowStore` already declares — satisfied by the same `storage.sessions`/`storage.tasks`
already passed into the other two flows in `app.module.ts`. No new storage port, no new repository.

### 5.3 `ConversationRuntimeDeps` — one new dependency, one widened existing one

```ts
readonly applyPreviewFlow: ApplyPreviewFlow;
readonly approvals: {
  decide(approvalId: Id, decision: ApprovalDecision): Promise<ApprovalRequest>;
  /** Reused for the ambiguous-retry prompt on the apply gate (§5.5) — `ApprovalManager.get` already
   *  exists (approval-manager.ts:62-64); this is a type-only widening, not a new method. */
  get(approvalId: Id): Promise<ApprovalRequest | null>;
  /** Reused for the second (apply) approval (Sprint 2s, ADR-0040) — not a new capability/port; the
   *  same already-registered ApprovalManager instance already implements this (§3). */
  requestForRisk(input: {
    executionPlanRef: ExecutionPlanRef;
    riskLevel: RiskLevel;
    reason: string;
    requestedBy: string;
  }): Promise<ApprovalRequest>;
};
```

### 5.4 `runCodeGenerationPreview` — anchor an `ELIGIBLE` preview right after a successful diff reply

Today (Sprint 2r, `conversation-runtime.ts:503-505`):
```ts
const diffPreview = toCodeDiffPreview(diff, outOfScopeWarnings);
const reply = this.deps.composer.composeCodeDiffPreview(message.context, diffPreview);
return this.respondComposed(message, session, reply, outcome);
```
Changes to:
```ts
const diffPreview = toCodeDiffPreview(diff, outOfScopeWarnings);
const reply = this.deps.composer.composeCodeDiffPreview(message.context, diffPreview);
// Sprint 2s (ADR-0040): remember what was just previewed, in case the user explicitly asks to apply
// it on a later turn. A plan-less Task anchor — never discoverable by approvalFlow (§2).
await this.deps.applyPreviewFlow.anchor(session, {
  kind: 'code-preview-apply',
  status: 'ELIGIBLE',
  executionPlanRef: planRef,
  workspaceRef: request.workspaceRef,
  targetFiles,
  codeGenerationRef: codeGenerationRef(generation),
  codeProposalRef: codeProposalRef(proposal),
  instruction: request.instruction,
  ...(session.activeProjectId ? { projectId: session.activeProjectId } : {}),
  createdAt: now(),
});
return this.respondComposed(message, session, reply, outcome);
```
Every field is already in scope at this point in the method (§ADR-0038/0039, unchanged) — `planRef`,
`request.workspaceRef`, `targetFiles`, `generation`, `proposal`, `request.instruction`. **No failure path
anchors anything** — only the single successful-diff-preview return point does. `codeGenerationRef`/
`codeProposalRef` are the existing pure derivation functions from `domain/code-generation.ts`, imported,
not reimplemented.

### 5.5 `ConversationRuntime.handle()` — routing + three new turn handlers

**CA Round 1 Required Changes #1/#9/#10 fully restructure the routing** from the original draft. Today,
step (A2) is scope-clarification, then classification begins. Insert (A3) between them:
```ts
// (A3) Apply-preview routing (ADR-0040) — checked after approvalFlow/scopeClarificationFlow so neither
// is ever pre-empted.
const applyAnchor = await this.deps.applyPreviewFlow.findAnchor(session);

// A real second ApprovalRequest is pending decision — intercepts EVERY turn, exactly like the first
// approval does (CA Round 1 Required Change #10), regardless of whether the message is an apply phrase.
if (applyAnchor?.status === 'AWAITING_APPROVAL') {
  return this.handleApplyApprovalTurn(message, session, actor, applyAnchor);
}

if (ConversationRuntime.interpretApplyIntent(message.text)) {
  if (applyAnchor?.status === 'ELIGIBLE') {
    return this.handleApplyIntentTurn(message, session, actor, applyAnchor); // creates approval #2
  }
  if (applyAnchor?.status === 'APPROVED') {
    return this.handleApplyAlreadyApprovedTurn(message, session); // don't re-ask, don't re-approve
  }
  // No anchor at all (or a stale one, already auto-cleared by findAnchor). CA Round 1 Required Change
  // #1: an explicit apply phrase must NEVER be reinterpreted as a new, unscoped code-change request.
  return this.handleApplyPreviewUnavailableTurn(message, session);
}
// Anything else: fall through untouched — an ELIGIBLE/APPROVED anchor is an optional follow-up
// opportunity, never a hard gate ordinary conversation must route around (CA Round 1 Required Change #9).
```

**Explicit apply-word detection — deliberately not `interpretDecision`/`APPROVE_WORDS` (Critical Product
Rule):**
```ts
/** Explicit apply-only phrases (ADR-0040) — "좋아"/"오케이"/"확인"/"괜찮네" must NEVER match; those stay
 *  in APPROVE_WORDS for the ordinary approval flow, but are insufficient to authorize file modification. */
const APPLY_WORDS = ['적용', '반영', '이대로 진행'];

static interpretApplyIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  return APPLY_WORDS.some((w) => t.includes(w));
}
```
"적용" matches "적용해줘"/"이 diff 적용해줘"; "반영" matches "반영해줘"; the multi-word phrase
**"이대로 진행"** matches "이대로 진행해" without matching a bare "진행" (already one of `APPROVE_WORDS`,
used for the *first* approval's "proceed" wording) so the two word-sets stay non-overlapping by
construction, not by coincidence.

**`handleApplyPreviewUnavailableTurn`** (CA Round 1 Required Change #1 — new; no anchor at all):
```ts
private async handleApplyPreviewUnavailableTurn(message: InboundMessage, session: Session): Promise<TurnResult> {
  const reply = this.deps.composer.composeApplyPreviewUnavailable(message.context);
  await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
  return this.responded(session, reply); // never reaches the classifier or the Orchestrator
}
```

**`handleApplyAlreadyApprovedTurn`** (CA Round 1 Required Change #2's routing table — `APPROVED` +
another explicit apply phrase must not re-ask or create a duplicate approval):
```ts
private async handleApplyAlreadyApprovedTurn(message: InboundMessage, session: Session): Promise<TurnResult> {
  const reply = this.deps.composer.composeApplyApprovalRecorded(message.context);
  await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
  return this.responded(session, reply);
}
```

**`handleApplyIntentTurn`** (creates the second approval):
```ts
private async handleApplyIntentTurn(
  message: InboundMessage,
  session: Session,
  actor: Actor,
  anchor: ApplyPreviewAnchor,
): Promise<TurnResult> {
  if (!anchor.workspaceRef || !anchor.targetFiles.length || !anchor.codeProposalRef) {
    // Defensive — the anchor is always written complete (§5.4), but never trust it blindly.
    const reply = this.deps.composer.composeApplyPreviewUnavailable(message.context);
    return this.failComposed(message, session, reply);
  }
  const approval = await this.deps.approvals.requestForRisk({
    executionPlanRef: anchor.executionPlanRef,
    riskLevel: RiskLevel.HIGH, // Q12 — apply approval is unconditionally HIGH, never auto-approved
    // CA Round 1 Required Change #5 — enough machine-readable context for future recovery/audit, since
    // ApprovalRequest itself carries no metadata field.
    reason:
      `Apply AI code proposal ${anchor.codeProposalRef.id} from generation ${anchor.codeGenerationRef.id} ` +
      `to ${anchor.targetFiles.join(', ')}`,
    requestedBy: actor.id,
  });
  await this.deps.applyPreviewFlow.anchor(session, { ...anchor, status: 'AWAITING_APPROVAL', approvalId: approval.id });
  const reply = this.deps.composer.composeApplyApprovalRequested(message.context, anchor.targetFiles);
  await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
  return { status: 'AWAITING_APPROVAL', reply, sessionId: session.id };
}
```

**`handleApplyApprovalTurn`** (decides the already-created second approval — reuses the *same*
`interpretDecision`/`APPROVE_WORDS`/`DENY_WORDS`/`CANCEL_WORDS` the first approval uses; only the
*creation* trigger needed a distinct word-set, not the decision itself, §6 Q6). **CA Round 1 Required
Change #2 — approving re-anchors as `APPROVED` instead of clearing:**
```ts
private async handleApplyApprovalTurn(
  message: InboundMessage,
  session: Session,
  actor: Actor,
  anchor: ApplyPreviewAnchor,
): Promise<TurnResult> {
  const decision = ConversationRuntime.interpretDecision(message.text);
  if (decision === 'ambiguous') {
    const fresh = await this.deps.approvals.get(anchor.approvalId!);
    const reply = fresh
      ? this.deps.composer.composeApprovalNotice(message.context, fresh)
      : this.deps.composer.composeApplyPreviewUnavailable(message.context); // pathological — see §9
    await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
    return { status: 'AWAITING_APPROVAL', reply, sessionId: session.id };
  }
  const approved = decision === 'approve';
  await this.deps.approvals.decide(anchor.approvalId!, this.decisionOf(anchor.approvalId!, actor.id, approved));

  if (!approved) {
    // deny / cancel — nothing left to preserve; clear the anchor (CA Round 1 Required Change #2).
    await this.deps.applyPreviewFlow.clear(session);
    const replyStatus: ExecutionReplyStatus = decision === 'deny' ? 'DENIED' : 'CANCELLED';
    const reply = this.deps.composer.composeExecutionResult(message.context, replyStatus);
    await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
    return { status: decision === 'deny' ? 'DENIED' : 'CANCELLED', reply, sessionId: session.id };
  }

  // approve — Sprint 2s stops here (§ Non-goals), but the approved context MUST survive for a future
  // Apply sprint. Re-anchor (never clear): every ref this anchor carries is exactly what that future
  // sprint will need (§6 Q8). No Patch/WorkspaceWrite/CommandExecution/git call.
  await this.deps.applyPreviewFlow.anchor(session, { ...anchor, status: 'APPROVED', approvedAt: now() });
  const reply = this.deps.composer.composeApplyApprovalRecorded(message.context);
  await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
  return { status: 'RESPONDED', reply, sessionId: session.id };
}
```
`approvals.get` (§5.3) is the one spot needing a fresh *read* of the just-created approval, to render the
existing generic `composeApprovalNotice` ambiguous-retry prompt with accurate `riskLevel`/`reason` text —
`ApprovalManager.get` already exists (`approval-manager.ts:62-64`); this is a type-only widening of the
`approvals` dependency, not a new method, unlike `requestForRisk` (§3).

### 5.6 `app.module.ts`

Construct `StatelessApplyPreviewFlow` next to the other two flows (same `storage.sessions`/`storage.
tasks`, no new dependency) and pass it as `applyPreviewFlow` in the `ConversationRuntime` deps object.
**No new provider registration** — `ApprovalManager`, already injected, already gains `requestForRisk`
as a new method on the existing class (§3); the factory's `inject` array is unchanged.

### 5.7 `ResponseComposer` — three new methods (wording strengthened per CA Round 1)

```ts
/** The second approval exists to authorize FILE MODIFICATION — distinct from the first approval
 *  (which only authorized generating a preview). Must say so explicitly (Q3), mention that actual apply
 *  will re-validate/re-diff against the latest file content (Q9), and name all three decision words
 *  (CA Round 1 Required Change #6 — not just "승인"/"취소"). */
composeApplyApprovalRequested(context: ConversationContext, targetFiles: string[]): OutboundMessage {
  return {
    context,
    text:
      `AI가 준비한 코드 변경을 실제 파일(${targetFiles.join(', ')})에 적용하려면 별도 승인이 필요해요.\n` +
      '이 승인은 미리보기 생성이 아니라 실제 파일 수정을 위한 것이에요. 아직 파일은 수정되지 않았어요.\n' +
      '실제 적용 시에는 최신 파일 내용으로 다시 확인해요.\n' +
      '진행하려면 "승인", 거절하려면 "거절", 그만두려면 "취소"라고 답해 주세요.',
  };
}

/** Explicit apply intent detected, but no eligible preview/refs to apply (Q6). Never creates an
 *  approval. */
composeApplyPreviewUnavailable(context: ConversationContext): OutboundMessage {
  return {
    context,
    text: '적용할 수 있는 코드 변경 미리보기가 없어요. 먼저 코드 변경을 요청하고 미리보기를 확인해 주세요.',
  };
}

/** The apply approval was recorded (or was already approved and the user asked again) — Sprint 2s does
 *  not implement the apply step itself. CA Round 1 Required Change #7: must not read as if the task is
 *  complete — never "적용 완료"/"반영 완료"/"수정했어요". */
composeApplyApprovalRecorded(context: ConversationContext): OutboundMessage {
  return {
    context,
    text: '적용 승인만 기록했어요.\n아직 실제 파일 적용은 수행하지 않았어요.\n파일은 수정되지 않았어요.',
  };
}
```
Deny/cancel reuse the existing `composeExecutionResult(context, 'DENIED' | 'CANCELLED')` — its wording
("승인이 거절되어 작업을 진행하지 않았어요." / "작업을 취소했어요.") is already generic and accurate for
this case; no new method.

## 6. Required Architecture Questions — CA decisions

**Q1. How does the system know there is a preview available to apply?**
**APPROVED WITH CHANGE.** `Session.activeTaskId → (plan-less) Task.metadata['conversationApplyPreviewAnchor']`
— no free-form chat-history search. The anchor now carries an explicit lifecycle `status` (§5.1), not
just presence/absence.

**Q2. Does the diff preview need to be persisted?**
**APPROVED.** No. The anchor stores only `{executionPlanRef, workspaceRef, targetFiles,
codeGenerationRef, codeProposalRef, instruction, approvalId?, approvedAt?}` — the diff itself is
recomputable on demand (Sprint 2r's `workspace.diff`) whenever a future Apply sprint needs to re-validate.

**Q3. What exactly is being approved in Approval #2?**
**APPROVED WITH CHANGE.** `composeApplyApprovalRequested` states explicitly: applying AI's proposal to
the named target file(s) — never "generate preview"/"run tests"/"commit"/"push". The `ApprovalRequest.
reason` field (machine-facing) now also includes `codeProposalRef.id`/`codeGenerationRef.id` for
auditability (CA Round 1 Required Change #5), not just the target file names.

**Q4. Who owns this apply approval flow?**
**APPROVED.** `ConversationRuntime` composes it, exactly as it already composes `CodeGenerationManager`
(Sprint 2q) and `WorkspaceManager.diff` (Sprint 2r) outside the Orchestrator. `ApprovalManager` (CAP-004)
still owns the `ApprovalRequest` aggregate exclusively — `requestForRisk` (§3) is a new *entry point* on
that same owner, not a new owner. No new capability. `ApplyPreviewFlow` is an Application-layer stateless
flow, structurally identical to `StatelessScopeClarificationFlow`.

**Q5. Does `ExecutionOrchestrator` change?**
**APPROVED.** No. Nothing in this sprint calls `deps.orchestrator.run`/`.resume`. No new `ExecutionStage`.

**Q6. How is ambiguity handled?**
**APPROVED WITH CHANGE.**
- "좋아"/"오케이"/"확인"/"괜찮네" after a preview → `interpretApplyIntent` does not match → falls through
  untouched (no approval, no reply about apply at all).
- An explicit apply phrase with **no** anchor (or a stale/cleared one) →
  `handleApplyPreviewUnavailableTurn` — **never** falls through to normal classification (CA Round 1
  Required Change #1 — this is the corrected behavior; the original draft's "falls through" answer here
  was rejected).
- An explicit apply phrase with an anchor whose refs are incomplete (defensive-only — §5.5 guard) →
  same `composeApplyPreviewUnavailable`, no approval created.
- Ordinary, non-apply chat while an `ELIGIBLE`/`APPROVED` anchor exists → falls through normally,
  unaffected (CA Round 1 Required Change #9 — the soft-hook property).
- Any message at all while `AWAITING_APPROVAL` → intercepted for a decision (CA Round 1 Required
  Change #10) — ambiguous replies get the existing generic re-ask prompt, never the classifier.

**Q7. How is staleness handled?**
**APPROVED.** Same session + the session's *current* `activeTaskId` only. No time-based expiry, no broad
history search. A project mismatch auto-clears the anchor regardless of which of the three states it was
in (§5.2's `findAnchor`).

**Q8. How is target scope preserved?**
**APPROVED WITH CHANGE.** The anchor (§5.1) carries `executionPlanRef`, `workspaceRef`, `targetFiles`,
and both `codeGenerationRef`/`codeProposalRef` through **all three** states, including `APPROVED` — CA
Round 1 Required Change #2 corrected the original draft, which cleared the anchor on approve and would
have made the approved context unrecoverable (`ApprovalRequest` itself carries none of these fields).
The created `ApprovalRequest.executionPlanRef` is the same ref threaded since Sprint 2n.

**Q9. What if workspace current content changed after preview?**
**APPROVED.** Sprint 2s does not apply anything, so it cannot go stale mid-apply.
`composeApplyApprovalRequested`'s wording explicitly says actual apply will re-check the latest file
content — a promise a future Apply sprint must keep (e.g. by re-running Sprint 2r's `workspace.diff`
immediately before any `Patch`/`WorkspaceWrite`), not something this sprint attempts to solve.

**Q10. Where is user-facing text composed?**
**APPROVED.** `ResponseComposer` (§5.7) — all three new methods, plus reuse of the existing generic
`composeApprovalNotice`/`composeExecutionResult`. `ConversationRuntime` passes only the anchored facts —
never composes text of its own.

**Q11. How do we prove no mutation?**
**APPROVED.** Test proof required (§8): `workspaceWrite.apply`/`patch.generate`/`patch.apply`/
`command.run` call counts stay `0` across the full anchor → apply-intent → approve/deny/cancel sequence.
Structurally: `ConversationRuntimeDeps` has no `workspaceWrite`/`patch`/`command` dependency at all
reachable from any of the four new turn handlers — they only ever call `this.deps.approvals`/
`this.deps.applyPreviewFlow`/`this.deps.composer`/`this.deps.memory`. No git operation is invoked
anywhere in this path. No `ExecutionOrchestrator` call anywhere in this path either.

**Q12. Does Apply approval use HIGH risk?**
**APPROVED.** Yes, unconditionally (§5.5's `handleApplyIntentTurn`) — `requestForRisk` is called with
`riskLevel: RiskLevel.HIGH` directly; there is no auto-approve branch for this sprint's only caller.

## 7. Case matrix

| Case | Detection | Result |
|---|---|---|
| 1. "적용해줘" with an `ELIGIBLE` anchor | apply words match, `status === 'ELIGIBLE'` | second `ApprovalRequest` created (HIGH), anchor → `AWAITING_APPROVAL`, `composeApplyApprovalRequested` |
| 2. "반영해줘" / "이대로 진행해" (same conditions) | same | same as case 1 |
| 3. "좋아" / "오케이" / "확인" / "괜찮네" with an `ELIGIBLE`/`APPROVED` anchor | apply words don't match | falls through untouched — no approval, no apply-specific reply |
| 4. Ordinary chat ("오늘 뭐 할까?") with an `ELIGIBLE` anchor | apply words don't match | falls through untouched — classifier runs normally |
| 5. Explicit apply phrase, no anchor at all | `findAnchor` → `null` | `handleApplyPreviewUnavailableTurn` — **not** normal classification |
| 6. Explicit apply phrase, anchor auto-cleared (project switch) | `findAnchor` auto-clears | same as case 5 |
| 7. Explicit apply phrase, anchor present but a required ref is missing (defensive) | anchor exists, refs incomplete | `composeApplyPreviewUnavailable`, no approval |
| 8. "승인" while `AWAITING_APPROVAL` | any message intercepted, decision = approve | `approvals.decide` (approved), anchor **re-anchored as `APPROVED`** (not cleared), `composeApplyApprovalRecorded`, `RESPONDED` |
| 9. "거절"/"취소" while `AWAITING_APPROVAL` | decision = deny/cancel | `approvals.decide` (rejected), anchor **cleared**, `composeExecutionResult`, `DENIED`/`CANCELLED` |
| 10. Ambiguous reply while `AWAITING_APPROVAL` | decision = ambiguous | `composeApprovalNotice`, `AWAITING_APPROVAL`, anchor untouched |
| 11. Explicit apply phrase while anchor is `APPROVED` | apply words match, `status === 'APPROVED'` | `composeApplyApprovalRecorded` again — **no** new approval, **no** re-ask loop |
| 12. First approval (Sprint 2n) still pending | `approvalFlow.findPending` wins (checked first) | unaffected — apply routing never runs |
| 13. Scope clarification (Sprint 2p) still pending | `scopeClarificationFlow.findPending` wins (checked second) | unaffected — apply routing never runs |

## 8. Required Tests (Node 22) — mapped to the CA's 48-item list

**`conversation-runtime.test.ts`**:
1–3. Explicit "적용해줘" / "반영해줘" / "이대로 진행해" with an `ELIGIBLE` anchor each create a second
   `ApprovalRequest` and return `AWAITING_APPROVAL`.
4. Ambiguous "좋아" with an `ELIGIBLE` anchor does not create an apply approval (`requestForRisk` call
   count `0`) and falls through to normal handling.
5. "오케이"/"확인"/"괜찮네" with an `ELIGIBLE` anchor do not create an apply approval.
6. Ordinary non-apply chat ("오늘 뭐 할까?") with an `ELIGIBLE` anchor falls through normally — classifier
   runs, `requestForRisk` call count `0` (CA Round 1 Required Change #9 — not just the "좋아" case).
7–9. Explicit "적용해줘" / "반영해줘" / "이대로 진행해" with **no** anchor each return
   `composeApplyPreviewUnavailable` (CA Round 1 Required Change #1).
10. The no-anchor explicit-apply path calls neither the classifier nor the Orchestrator
   (`calls.classify === 0`, `calls.run === 0`/`calls.resume === 0` beyond whatever the fixture already
   performed to reach this state).
11. Apply intent with a missing `codeProposalRef` on the anchor does not create an approval.
12. Apply intent with a missing `workspaceRef` on the anchor does not create an approval.
13. Apply intent with empty `targetFiles` on the anchor does not create an approval.
14. The apply-approval request's wording clearly states file modification, distinct from the first
    approval's wording.
15. The apply-approval request's wording states this is not preview generation.
16. The apply-approval request's wording mentions revalidation/re-diff before actual apply.
17. The apply-approval request's wording names all three decision words (승인/거절/취소).
18. The apply approval is created with `riskLevel: HIGH` (assert `requestForRisk`'s input).
19. `requestForRisk`'s input carries the anchor's `executionPlanRef`.
20. `requestForRisk`'s `reason` includes the target file names.
21. `requestForRisk`'s `reason` includes `codeProposalRef.id` and `codeGenerationRef.id`.
22. After creating the approval, the anchor's status is `AWAITING_APPROVAL` and carries the new
    `approvalId`.
23. The anchor (at every stage) carries `executionPlanRef`/`workspaceRef`/`targetFiles`/
    `codeGenerationRef`/`codeProposalRef` matching what was previewed.
24. Approve on the apply gate calls `approvals.decide` exactly once.
25. Approve on the apply gate makes zero `WorkspaceWrite`/`Patch`/`CommandExecution`/git calls.
26. Approve on the apply gate re-anchors with `status: 'APPROVED'` (does **not** clear).
27. The `APPROVED` anchor still carries `workspaceRef`/`targetFiles`/`codeGenerationRef`/
    `codeProposalRef` (CA Round 1 Required Change #2/#8 — the core regression this round guards against).
28. Deny on the apply gate clears the anchor (a subsequent `findAnchor` returns `null`).
29. Cancel on the apply gate clears the anchor.
30. Ambiguous reply while `AWAITING_APPROVAL` returns `composeApprovalNotice`, `AWAITING_APPROVAL`, and
    never reaches the classifier.
31. The first approval (Sprint 2n) pending takes priority — apply routing never runs while
    `approvalFlow.findPending` returns non-null.
32. A pending scope clarification (Sprint 2p) takes priority over apply routing.
33. A stale/project-mismatched anchor does not create an approval and does not resurface on a later turn
    (auto-cleared by `findAnchor`).
37–41. `StatelessApplyPreviewFlow` unit tests (mirroring `stateless-scope-clarification-flow.test.ts`'s
    shape): `anchor` then `findAnchor` round-trips; `findAnchor` returns `null` when
    `session.activeTaskId` points at an approval anchor (`planId` present) or a scope-clarification
    anchor (wrong discriminator); `clear` is a no-op unless the session still points at our own anchor;
    a project mismatch auto-clears.
42–46. No `workspaceWrite.apply` / `patch.generate`/`patch.apply` / `command.run` / git operation /
    `ExecutionOrchestrator.run`/`.resume` call anywhere across the full anchor → intent → decide
    sequence.

**`approval-manager.test.ts`** (new cases):
34. `ApprovalManager.requestForRisk` creates a `PENDING`, `HIGH`-risk request with the given
    `executionPlanRef`/`reason`/`requestedBy`.
35. `requestForRisk` never calls `ApprovalPolicy.evaluate` (spy/assert the policy fake sees zero calls).
36. `requestFor`'s existing behavior is unchanged — existing test cases keep passing unmodified.

**Node 22**:
47. `pnpm typecheck` green.
48. `pnpm test` green.

## 9. Architecture Impact / Reuse

- **Reuses, unchanged:** `ApprovalRequest`/`ApprovalStatus` (CAP-004), `ExecutionRequest`/
  `ExecutionOutcome`/`ExecutionOrchestrator` (zero changes), `CodeGeneration`/`CodeProposal`/their `Ref`
  derivation functions (CAP-008, zero changes), `WorkspaceManager.diff` (CAP-001, zero changes — not
  called again this sprint), `ConversationRuntime.interpretDecision`/`APPROVE_WORDS`/`DENY_WORDS`/
  `CANCEL_WORDS`/`decisionOf` (reused as-is for deciding the *already-created* apply approval, §5.5),
  `composeApprovalNotice`/`composeExecutionResult` (Sprint 2k/2n, reused for ambiguous/deny/cancel).
- **One additive method on an existing Capability class:** `ApprovalManager.requestForRisk` (§3) — the
  single deviation from Sprint 2q/2r's "zero Capability-layer changes" precedent, justified by
  `ExecutionPlan`'s documented non-persistence (ADR-0024), narrowly constrained per CA Round 1 (always
  `PENDING`, never calls `ApprovalPolicy`). `requestFor`/`decide`/`get`/`isApproved` are untouched.
- **One new production flow, mirroring an exact existing pattern:** `StatelessApplyPreviewFlow`
  (§5.1/5.2) — structurally identical to `StatelessScopeClarificationFlow`, same store shape, same
  discriminator technique, same "plan-less Task, never discoverable by `StatelessApprovalFlow`"
  guarantee proven in §2. Its anchor carries an explicit three-state lifecycle (CA Round 1 Required
  Change #2/#3), unlike the other two flows' single-shot anchors.
- **Changes:** `conversation-runtime.ts` (+1 new exported interface `ApplyPreviewFlow`, +1 new exported
  type `ApplyPreviewAnchor` + `ApplyPreviewAnchorStatus`, +1 new `ConversationRuntimeDeps` field, +1
  widened existing field (`approvals.requestForRisk`/`.get`), +1 new routing step in `handle()`, +4 new
  private turn handlers, +1 new static helper `interpretApplyIntent` + `APPLY_WORDS` constant, +1 new
  anchor call inside `runCodeGenerationPreview`), `response-composer.ts` (+3 methods, no new DTO),
  `approval-manager.ts` (+1 additive method, §3), a new file `stateless-apply-preview-flow.ts` (mirrors
  the existing scope-clarification file), `app.module.ts` (+1 flow construction + DI passthrough, no new
  provider).
- **No new** aggregate / repository / migration / capability / port. **No** `Core` or
  `ExecutionOrchestrator` contract change (§6 Q5).
- **ADR-0040** (to be authored before implementation) must document, per CA Round 1: the two central
  findings (§2/§3) and their resolutions; the plan-less-Task collision-avoidance guarantee; the explicit
  three-state anchor lifecycle (`ELIGIBLE → AWAITING_APPROVAL → APPROVED`, deny/cancel clears instead of
  a fourth state); that approving **preserves** the anchor for a future Apply sprint rather than clearing
  it; `requestForRisk`'s narrow justification and constraints (always `PENDING`, never calls
  `ApprovalPolicy`, additive, does not replace `requestFor(plan)`); the `APPLY_WORDS`-vs-`APPROVE_WORDS`
  non-overlap by construction; HIGH risk unconditional; the diff itself is never persisted; no mutation
  anywhere in this sprint; Preview→Apply itself remains deferred to a future sprint.

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| The second approval collides with `StatelessApprovalFlow.findPending`'s plan-scoped lookup | High if unaddressed | Resolved by construction (§2) — the apply-anchor Task never carries `planId`; tested (§8 items 31-32) |
| No live `ExecutionPlan` object exists to re-evaluate risk via the existing `requestFor` | High if unaddressed | `requestForRisk` (§3) — additive, narrowly scoped, never auto-approves; tested (§8 items 34-36) |
| "좋아"/"오케이" accidentally triggers file-modification approval | High (safety) if unaddressed | Dedicated `APPLY_WORDS`, never reusing `APPROVE_WORDS`, by construction (§5.5); tested (§8 items 4-5) |
| An explicit apply phrase with no preview gets silently reinterpreted as a new code-change request | High (product) if unaddressed | Corrected in this round (§6 Q6, CA Round 1 Required Change #1) — direct "nothing to apply" reply, never falls through; tested (§8 items 7-10) |
| Approving clears the only record of what was approved, making it unrecoverable for a future Apply sprint | High (product) if unaddressed | Corrected in this round (§5.5/§6 Q8, CA Round 1 Required Change #2) — approve re-anchors as `APPROVED` instead of clearing; tested (§8 items 26-27) |
| Apply-preview anchor becomes a de-facto hard gate that blocks unrelated conversation | Med (UX) | Only `AWAITING_APPROVAL` intercepts every turn; `ELIGIBLE`/`APPROVED` only react to explicit apply phrases, everything else falls through (§5.5, §6 Q6/Q9); tested (§8 item 6) |
| A stray, never-decided apply-approval Task accumulates | Low | Same accepted "inert historical record" pattern already noted for approval/scope-clarification anchors (ADR-0032/0037) |
| Reviewers expect this sprint to also generate a `PatchSet` | Low | Explicitly out of scope (§ Non-goals, CA's own initial recommendation) — deferred to Sprint 2t |

## Non-goals (explicit, per Chief Architect direction)

No implementation before plan approval · no branch/commit/PR beyond this plan-only step · actual
`WorkspaceWrite` apply · filesystem mutation · git mutation · `CommandExecution` · test execution after
apply · `Patch` application · autonomous agent loop · retry loop · multi-file selection · directory/
module scope · semantic repository search · repository indexing · AI target-file guessing · new-file
creation/`changeKind: 'add'` support · provider-specific apply behavior · `ExecutionOrchestrator` stage
change · `Core` contract change · treating the first (preview) approval as permission to mutate files ·
generating a `PatchSet` in this sprint (deferred to Sprint 2t, per CA's own initial recommendation).

## Next Step

**Plan changes applied — CA Round 1 requirements incorporated above.** Per the approved implementation
sequence: (1) plan changes applied (this document); (2) author ADR-0040 next; (3) implement exactly this
scope (§4/§5) on a `v2/<topic>` branch; (4) add/update tests per §8; (5) validate on **Node 22**;
(6) open a PR for Chief Architect Implementation Review. No commit/PR has been made yet — proceeding to
ADR-0040 + implementation now.
