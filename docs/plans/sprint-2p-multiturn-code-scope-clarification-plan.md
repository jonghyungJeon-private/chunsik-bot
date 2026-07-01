# Sprint 2p Plan — Multi-turn Code Scope Clarification (recover a bare-path reply, no new aggregate)

- **Status:** ✅ APPROVED WITH CHANGES (Chief Architect Review, Round 1) — required changes applied
  below; implementing this scope next.
- **Base:** `main` @ `7df0256` · **Validation runtime:** Node 22 (to be run at implementation time).
- **Directed by:** Chief Architect (this sprint's topic is CA-assigned, not Claude-proposed).
- **Goal:** When a code-change request lacks a target file, Sprint 2o already asks for one and stops.
  This sprint makes the user's very next reply — even a bare file path with no verb — resume that
  same request, without inventing a new aggregate.
- **Phase:** Phase 2 — Product Construction (sixth runtime sprint, after 2k/2l/2m/2n/2o). **Not** a
  new capability. Extends the existing Task aggregate's established anchor role; no new aggregate.
- **Process:** V2 architecture-first, step 1 (plan-only) → CA review Round 1 complete → applying
  required changes → implementation next. No implementation, no branch, no commit, no PR in this step.

> **Framing.** Sprint 2o's own plan (§7) argued that multi-turn correlation was impossible without a
> new aggregate, because the only existing cross-turn mechanism (`ApprovalFlow`) derives its state
> from a `Task`/`ExecutionPlan`/`ApprovalRequest` chain that an insufficient-scope request never
> creates. This sprint's job is to check whether that's still true once we look one level deeper: the
> production `ApprovalFlow` implementation (`StatelessApprovalFlow`) doesn't actually *need* an
> `ExecutionPlan` to exist — it anchors its payload on **`Task.metadata`**, a field the `Task`
> aggregate already carries independent of planning. **The missing piece isn't a new aggregate; it's
> a `Task` created one step earlier than usual, holding a different kind of anchor — and CA Round 1
> requires that Task be unmistakably marked as an inert conversation anchor, never an execution task.**

---

## 1. Objective

Recover a code-change request across exactly one follow-up turn: if the user's very next message
(after being asked "which file?") resolves to a validated target file — with or without a "고쳐줘"-
style verb — resume the original request into Sprint 2n/2o's existing `planningOnly` → `Planning` →
`Approval` flow, **using the original message's summary, not the follow-up's**. If it doesn't resolve,
ask again once, then let the state lapse — this is an intentional Product trade-off (one follow-up
attempt only), not an oversight. No new aggregate, no new repository, no new migration, no new
capability, no `ExecutionPlan`/`ApprovalRequest` before scope is sufficient.

## 2. Critical Architecture Constraint — evaluating Options A–D (required before any design)

The direction lists four options and asks which is smallest/safest. Evaluated in order:

**Option D — a new Application-layer transient correlation model.** Rejected first, for the same
reason `StatelessApprovalFlow` was chosen over inventing anything new for approvals: a working,
established pattern for "anchor cross-turn state on an existing aggregate, point `Session.activeTaskId`
at it" **already exists and already ships in production** (ADR-0032). Building a second, parallel
mechanism when the first generalizes directly would be needless duplication.

**Option C — short-term memory only.** Rejected. Short-term memory (`MemoryRecord`, ADR-0017) is
free-text conversational context meant to be *read by an AI prompt*, not a structured store. Recovering
typed fields (`summary`, `rawKind`, `projectId`, `createdAt`) by writing them into a memory record and
parsing them back out is exactly the pattern ADR-0032 already named and forbade for the approval case:
*"Forbidden: ... recovering pending approval by parsing memory text."* The same reasoning applies here
even though ADR-0032's sentence was written about approvals specifically — the failure mode (fragile,
implicit, un-typed state hidden in prose) is the same.

**Option A — `Session.metadata`.** Rejected, on an explicit, load-bearing ADR-0032 invariant, not a
style preference: *"**Session must not store runtime snapshots.**"* / *"Forbidden: `Session.runtimeState`,
approval snapshot on `Session`, a `ConversationRuntimeState` repository..."* `Session.metadata` exists
as a field, but using it to hold this sprint's pending-clarification payload would be precisely the
kind of snapshot that invariant exists to prevent. Sprint 2o's plan already noted this constraint in
passing (§7); this sprint takes it as binding, not advisory.

**Option B — `Task.metadata` — selected, with a hard constraint on what the Task is allowed to be
(CA Round 1).** `Task` is **already** the accepted pending-work anchor for `ConversationRuntime`:
`StatelessApprovalFlow.anchor()` (`stateless-approval-flow.ts:42-72`) already creates a `Task` **purely
to hold an anchor payload in `Task.metadata`**, with no `ExecutionPlan` required to exist for the
*Task itself* to exist. Nothing about `Task` requires a plan — `Task.planId` is optional
(`domain/task.ts:31`, `planId?: Id`). This sprint creates a `Task` **one step earlier** — before any
`ExecutionPlan` exists — solely to hold `pending scope clarification` facts, using the exact same
`Session.activeTaskId` pointer mechanism ADR-0032 already established.

**CA Round 1 hard constraint on this Task's role:**
> The Task created by `ScopeClarificationFlow` is **not** an execution task. It is a **conversation
> anchor task** — an inert holder of `PendingScopeClarification` facts. It must never enter Planning,
> `ExecutionOrchestrator`, `Patch`, `WorkspaceWrite`, or `CommandExecution` by itself, and it is never
> transitioned past `TaskStatus.PENDING`. This is stated explicitly here, in the code (§5.1's doc
> comments), and must be restated in ADR-0037 verbatim in spirit.

**CA Round 1 hard constraint on distinguishing the two anchor kinds:** `planId` absence/presence alone
was judged **too implicit** — a future feature could create some other plan-less `Task` for an
unrelated reason and be silently misread as a scope-clarification anchor. §5.1 adds an explicit
**discriminator field** inside the metadata payload itself (`kind: 'code-scope-clarification'`),
checked by `findPending` **in addition to** `!task.planId`, never as a substitute for it.

**Why this doesn't collide with the approval-anchor's use of the same pointer:** a session has exactly
one `activeTaskId` at a time. The two anchor *kinds* are now distinguished on **two independent
signals** — `planId` absence (structural) and the metadata discriminator (explicit) — either alone
would suffice, and requiring both is stricter than either. A session is never in both states at once
(§5.2 details the ordering, which CA Round 1 requires be preserved exactly).

## 3. Scope (this sprint)

- A new, small Application-layer collaborator — **`ScopeClarificationFlow`** (interface, defined
  alongside `ApprovalFlow` in `conversation-runtime.ts`) and its production implementation
  **`StatelessScopeClarificationFlow`** (new file `stateless-scope-clarification-flow.ts`, mirroring
  `stateless-approval-flow.ts`'s shape) — `findPending`/`anchor`/`clear`, all operating on the existing
  `Task`/`Session` aggregates only, with an explicit metadata discriminator and a **safe `clear`** that
  never touches `activeTaskId` unless it still points at this flow's own anchor (§5.1, CA Round 1
  Required Changes #2–#4).
- `ConversationRuntime.handle()` gains one new check, immediately after the existing
  `approvalFlow.findPending` check and before `classifier.classify` (§5.2) — this exact ordering is a
  CA Round 1 hard requirement (Required Change #5), not just a suggestion.
- `ConversationRuntime.handleExecutionIntent`'s existing Sprint 2o scope-gate gains **one call**: when
  it finds no validated target for a fresh `CODE_IMPLEMENTATION` request — and only after an active
  project exists and the workspace opened successfully (CA Round 1 Required Change #10) — it now also
  calls `scopeClarificationFlow.anchor(...)` before replying with clarification (§5.3).
- A small internal refactor (no interface/contract change): the "resolve workspace" and "resolve →
  run → frame halt reply" segments of `handleExecutionIntent` are extracted into two private helpers
  so the new recovery path can reuse them instead of duplicating them (§5.4).
- **One new `ResponseComposer` method** — `composeScopeClarificationCancelled` — added per CA Round 1
  Required Change #8, replacing the earlier plan's proposal to reuse the generic
  `composeExecutionResult('CANCELLED')` (whose "작업을 취소했어요" wording could be misread as cancelling
  an in-flight execution that never existed). `composeTargetScopeClarification` (Sprint 2o) is still
  reused verbatim for both the fresh-request and the retry-failure case.
- `app.module.ts` DI wiring: instantiate `StatelessScopeClarificationFlow` the same way
  `StatelessApprovalFlow` is instantiated today, and inject it into `ConversationRuntimeDeps`.
- Tests for all of the above (§9), including the CA's 31 explicitly required test items.

## 4. Non-goals (explicit, per Chief Architect direction)

No implementation before plan approval · no branch/commit/PR beyond this plan-only step · no AI Code
Generation · no `ProviderSelector` call · no Claude/Ollama/Codex invocation · no semantic search · no
repository indexing · no AI target-file guessing · no directory scope · no module/area text as
sufficient target · no multi-file target selection · no patch generation · no `WorkspaceWrite` · no
command execution · no autonomous agent loop · no retry loop · no Discord button UI · no `Core` or
`ExecutionOrchestrator` contract change · no general-purpose execution-stage override system. **No new
aggregate/repository/migration/capability/port** (§2 — this is the sprint's central constraint, not a
generic non-goal). `planningOnly` and `CODE_IMPLEMENTATION`'s `HIGH` risk (ADR-0035/0036) are
untouched. **Unbounded clarification retry is explicitly out of scope** — this sprint supports exactly
one follow-up attempt; a future plan would be required to go further (CA Round 1 Required Change #7).

## 5. Design

### 5.1 `ScopeClarificationFlow` — interface + production implementation

Defined in `conversation-runtime.ts`, next to `ApprovalFlow`:

```ts
/**
 * Minimal, non-secret facts needed to recover a code-change request on the next turn (Sprint 2p,
 * ADR-0037). Never the generated code, a patch, a diff, or provider output — there is none yet.
 *
 * `kind` here is an ANCHOR DISCRIMINATOR, not the classifier's intent tag — deliberately named and
 * typed differently from `rawKind` below so the two are never confused (CA Round 1).
 */
export interface PendingScopeClarification {
  /** Proves this Task's metadata is a scope-clarification anchor, not merely a plan-less Task for
   *  some unrelated reason (`!task.planId` alone was judged too implicit — CA Round 1). */
  kind: 'code-scope-clarification';
  /** The original intent's restated summary — becomes the recovered request's goal/instruction. Must
   *  be the FIRST message's summary, never overwritten by the follow-up reply's text. */
  summary: string;
  /** The classifier's raw.kind tag ('fix' | 'change' | 'refactor'), if present. Named `rawKind` — not
   *  `kind` — specifically to avoid colliding with the discriminator above (CA Round 1). */
  rawKind?: string;
  /** The active project at anchor time — re-checked at recovery time (Q5). */
  projectId?: Id;
  /** Stored for observability/future policy only — NOT consulted for expiration in Sprint 2p. The
   *  invalidation rule is next-turn-only consumption (Q4), not a TTL (CA Round 1). */
  createdAt: IsoTimestamp;
}

/**
 * Cross-turn scope-clarification mechanics (ADR-0037), confined behind one collaborator exactly
 * like ApprovalFlow — so the runtime stays stateless and the correlation source is wired once.
 */
export interface ScopeClarificationFlow {
  /** Derive the session's pending clarification, if any and still valid (Q5: project unchanged). */
  findPending(session: Session): Promise<PendingScopeClarification | null>;
  /** Anchor a fresh insufficient-scope request so the next turn can recover it. Callers must only
   *  invoke this after confirming an active project exists, the workspace opened successfully, and
   *  no target validated (CA Round 1 Required Change #10 — enforced at the one call site, §5.3). */
  anchor(session: Session, pending: PendingScopeClarification): Promise<void>;
  /** Consume/clear the anchor — called unconditionally once a pending clarification is checked
   *  (next-turn-only semantics, Q4). Safe: a no-op unless `session.activeTaskId` still points at
   *  THIS flow's own anchor Task (CA Round 1 Required Change #4 — never clears an approval anchor). */
  clear(session: Session): Promise<void>;
}
```

Production implementation, `stateless-scope-clarification-flow.ts` (new file):

```ts
export interface ScopeClarificationFlowStore {
  readonly sessions: { save(session: Session): Promise<Session> };
  readonly tasks: { get(id: Id): Promise<Task | null>; save(task: Task): Promise<Task> };
}

const ANCHOR_KEY = 'conversationScopeClarificationAnchor';
const ANCHOR_DISCRIMINATOR = 'code-scope-clarification' as const;

/**
 * The production ScopeClarificationFlow (Sprint 2p, ADR-0037). The Task it creates is an INERT
 * CONVERSATION ANCHOR TASK — never an execution task. It must never enter Planning,
 * ExecutionOrchestrator, Patch, WorkspaceWrite, or CommandExecution by itself; it exists solely to
 * hold PendingScopeClarification facts across exactly one follow-up turn, and is never transitioned
 * past TaskStatus.PENDING.
 */
export class StatelessScopeClarificationFlow implements ScopeClarificationFlow {
  constructor(private readonly store: ScopeClarificationFlowStore) {}

  /**
   * The anchor Task for this session, ONLY if it is genuinely a scope-clarification anchor — never
   * an approval anchor (planId present) and never a plan-less Task lacking our discriminator. Both
   * `findPending` and `clear` route through this so "is this our anchor?" is answered exactly once.
   */
  private async anchorTask(session: Session): Promise<{ task: Task; pending: PendingScopeClarification } | null> {
    if (!session.activeTaskId) return null;
    const task = await this.store.tasks.get(session.activeTaskId);
    if (!task || task.planId) return null; // an approval-anchor Task always has planId; ours never does
    const pending = task.metadata?.[ANCHOR_KEY] as PendingScopeClarification | undefined;
    if (pending?.kind !== ANCHOR_DISCRIMINATOR) return null; // explicit discriminator, not just !planId
    return { task, pending };
  }

  async findPending(session: Session): Promise<PendingScopeClarification | null> {
    const found = await this.anchorTask(session);
    if (!found) return null;
    // Q5: active project changed since anchor time — the anchor no longer applies to the workspace
    // it was validated against. Safe to auto-clear: anchorTask() already proved this IS our anchor.
    if (found.pending.projectId !== session.activeProjectId) {
      await this.clear(session);
      return null;
    }
    return found.pending;
  }

  async anchor(session: Session, pending: PendingScopeClarification): Promise<void> {
    const ts = now();
    const task: Task = {
      id: newId(),
      title: 'code-change scope clarification',
      description: pending.summary,
      status: TaskStatus.PENDING, // never advanced — this Task never enters the work-turn pipeline
      intent: {
        type: IntentType.IMPLEMENT_CODE,
        capability: Capability.CODE_IMPLEMENTATION,
        confidence: 1,
        requiresWork: true,
        summary: pending.summary,
        ...(pending.rawKind ? { raw: { kind: pending.rawKind } } : {}),
      },
      riskLevel: RiskLevel.HIGH,
      context: session.context,
      ...(session.actorId ? { actorId: session.actorId } : {}),
      sessionId: session.id,
      ...(pending.projectId ? { projectId: pending.projectId } : {}),
      createdAt: ts,
      updatedAt: ts,
      metadata: { [ANCHOR_KEY]: pending },
    };
    await this.store.tasks.save(task);
    await this.store.sessions.save({ ...session, activeTaskId: task.id, lastActivityAt: ts });
  }

  async clear(session: Session): Promise<void> {
    // CA Round 1, Required Change #4: never clear activeTaskId unless it still points at OUR anchor —
    // an approval anchor (or anything else) sharing the same pointer slot must be left untouched.
    const found = await this.anchorTask(session);
    if (!found) return;
    await this.store.sessions.save({ ...session, activeTaskId: undefined, lastActivityAt: now() });
  }
}
```

The anchor `Task` is never transitioned past `PENDING` and is never picked up by `handleWorkTurn`'s
Task pipeline (that pipeline is only ever entered directly by `handleWorkTurn` itself, which builds its
own Task via `tasks.createTask` — it never scans for orphaned `PENDING` tasks). Once consumed, the
anchor `Task` is left as an inert historical record — **the same already-accepted pattern
`StatelessApprovalFlow`'s own anchor `Task`s already leave behind today** (ADR-0032 shipped this;
Sprint 2p introduces no new category of "orphaned Task" concern).

### 5.2 `ConversationRuntime.handle()` — one new check, ordering is a hard requirement

Inserted immediately after the existing approval check (`conversation-runtime.ts:182-186`), before the
classifier runs — **CA Round 1 Required Change #5: this exact ordering (approval check first, scope
check second, classifier third) must be preserved; approval-pending sessions must never be routed into
scope-clarification handling**:

```ts
const pending = await this.deps.approvalFlow.findPending(session);
if (pending) {
  return this.handleApprovalTurn(message, session, actor, pending);
}

// ADR-0037: check for a pending code-change scope clarification BEFORE normal classification —
// a bare file-path reply must not need to re-trigger the fix/change/refactor classifier keywords.
// Ordering is load-bearing: approvalFlow is checked first, so an approval-anchored session (planId
// present) is never routed here.
const pendingScope = await this.deps.scopeClarificationFlow.findPending(session);
if (pendingScope) {
  return this.handleScopeClarificationTurn(message, session, actor, pendingScope);
}

const intent = await this.deps.classifier.classify(message);
```

These two checks can never both fire for the same turn: `session.activeTaskId` points at exactly one
`Task`, and `StatelessScopeClarificationFlow.anchorTask` requires **both** `!task.planId` **and** the
metadata discriminator — an approval-anchored Task (always has `planId`) fails the first check
immediately, before the discriminator is even consulted. `IntentClassifier` is untouched — it is
simply never consulted for a message that answers a pending clarification (Q6).

### 5.3 `handleExecutionIntent`'s existing Sprint 2o gate — one added call, tightly scoped

The only change to already-shipped code (`conversation-runtime.ts:303-324`): when no candidate
validates for a **fresh** `CODE_IMPLEMENTATION` request, anchor before replying. **CA Round 1 Required
Change #10 — this call site is the ONLY place `anchor` is ever invoked, and only fires when all of the
following already hold** (all four are structurally guaranteed by this method's existing control flow,
not merely convention): `intent.capability === Capability.CODE_IMPLEMENTATION` (this whole block is
already gated on it), an active project exists and the workspace opened successfully (both already
required to reach this line — the method returns earlier via `composeNeedsProject`/
`composeWorkspaceUnavailable` otherwise), and no candidate validated (`!targetFiles`, checked
immediately before):

```ts
if (!targetFiles) {
  await this.deps.scopeClarificationFlow.anchor(session, {
    kind: 'code-scope-clarification',
    summary: intent.summary,
    ...(typeof intent.raw?.kind === 'string' ? { rawKind: intent.raw.kind } : {}),
    ...(session.activeProjectId ? { projectId: session.activeProjectId } : {}),
    createdAt: now(),
  });
  return this.respondComposed(
    message,
    session,
    this.deps.composer.composeTargetScopeClarification(message.context),
  );
}
```

Everything else in `handleExecutionIntent` is unchanged — the reply text, the status, the
`orchestrator.run` non-invocation, all identical to Sprint 2o. `TEST_EXECUTION`/`PROJECT_ANALYSIS`/
`CHAT` never reach this line at all (the block is `CODE_IMPLEMENTATION`-gated), so `anchor` is
structurally unreachable for them — no runtime check needed to enforce that, only a regression test
(§9 item 16).

### 5.4 Shared extraction (internal refactor, no contract change)

To avoid duplicating "open the workspace" and "resolve → run → frame the halt reply" between
`handleExecutionIntent` and the new recovery path, two private helpers are extracted from
`handleExecutionIntent`'s existing body — pure refactor, no behavior change to any existing caller:

```ts
/** Resolve the active project's workspace for a needsWorkspace capability, or an early-return reply. */
private async resolveExecutionWorkspace(
  message: InboundMessage, session: Session, capability: Capability,
): Promise<{ workspaceRef?: WorkspaceRef } | TurnResult> { /* today's conversation-runtime.ts:287-301, unchanged body */ }

/** Resolve → run → frame the halt/complete/fail reply. Shared tail for a ready ExecutionRequest. */
private async runResolvedExecution(
  message: InboundMessage, session: Session, actor: Actor, intent: Intent,
  workspaceRef: WorkspaceRef | undefined, targetFiles: string[] | undefined,
): Promise<TurnResult> { /* today's conversation-runtime.ts:326-348+, unchanged body */ }
```

`handleExecutionIntent` becomes: resolve workspace → Sprint 2o's scope-gate (now anchoring on failure,
§5.3) → `runResolvedExecution`. The new `handleScopeClarificationTurn` becomes: clear the anchor →
handle cancel → resolve workspace (same helper) → validate the message against the workspace (Sprint
2o's exact extraction/exact-match logic, reused directly — not reimplemented) → on success, rebuild the
`Intent` from `pending` **using `pending.summary` — the ORIGINAL first message, never the follow-up's
text (CA Round 1 Required Change #9)** — and call `runResolvedExecution`; on failure, reply with
`composeTargetScopeClarification` again:

```ts
private async handleScopeClarificationTurn(
  message: InboundMessage, session: Session, actor: Actor, pending: PendingScopeClarification,
): Promise<TurnResult> {
  await this.deps.scopeClarificationFlow.clear(session); // next-turn-only: consumed either way

  if (CANCEL_WORDS.some((w) => message.text.trim() === w || message.text.includes(w))) {
    const reply = this.deps.composer.composeScopeClarificationCancelled(message.context);
    await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
    return { status: 'CANCELLED', reply, sessionId: session.id };
  }

  const ws = await this.resolveExecutionWorkspace(message, session, Capability.CODE_IMPLEMENTATION);
  if ('status' in ws) return ws; // no active project / workspace unavailable — same replies as fresh

  // CA Round 1 Required Change #9: goal/instruction MUST come from the original request (pending.summary),
  // never from this follow-up message's text.
  const recovered: Intent = {
    type: IntentType.IMPLEMENT_CODE,
    capability: Capability.CODE_IMPLEMENTATION,
    confidence: 1,
    requiresWork: true,
    summary: pending.summary,
    ...(pending.rawKind ? { raw: { kind: pending.rawKind } } : {}),
  };

  const candidates = extractTargetPathCandidates(message.text).slice(0, MAX_TARGET_CANDIDATES);
  for (const candidate of candidates) {
    const hits = await this.deps.workspace.list(ws.workspaceRef!, candidate);
    const matched = hits.find((hit) => normalizeRelativePath(hit) === normalizeRelativePath(candidate));
    if (matched) {
      return this.runResolvedExecution(message, session, actor, recovered, ws.workspaceRef, [matched]);
    }
  }

  const reply = this.deps.composer.composeTargetScopeClarification(message.context);
  await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
  return this.respondComposed(message, session, reply); // Case 3 — no re-anchor (next-turn-only)
}
```

Case 3 deliberately does **not** call `scopeClarificationFlow.anchor` again — the anchor was already
cleared at the top of this method, and this sprint's chosen invalidation rule (Q4) is exactly one
follow-up attempt, not an unbounded retry loop (CA Round 1 Required Change #7 — an explicit Product
trade-off, documented here and in ADR-0037, not an accidental gap).

### 5.5 `ResponseComposer` — one new method (CA Round 1 required change)

```ts
/**
 * Reply for "취소" while a code-change scope clarification is pending (Sprint 2p, ADR-0037). No
 * ExecutionPlan/ApprovalRequest/Patch ever existed for this request — the wording must not imply an
 * execution or plan was cancelled, only that the request itself was dropped. Replaces the earlier
 * plan's proposal to reuse composeExecutionResult('CANCELLED') ("작업을 취소했어요"), whose wording
 * could be misread as cancelling in-flight work that never existed (CA Round 1).
 */
composeScopeClarificationCancelled(context: ConversationContext): OutboundMessage {
  return {
    context,
    text: '코드 변경 요청을 취소했어요. 다시 필요하시면 파일 경로와 함께 새로 요청해 주세요.',
  };
}
```

## 6. Required Architecture Questions — CA decisions

**Q1. Where should pending scope clarification state live?**
**APPROVED WITH CONDITIONS.** `Task.metadata`, via `ScopeClarificationFlow`/
`StatelessScopeClarificationFlow`. Not Session metadata, not short-term memory parsing, not a new
aggregate/repository/migration (§2). Condition: the Task must be documented as an inert conversation
anchor task (§2, §5.1 — done).

**Q2. Is the state persisted or derivable? ADR-0032 compliance?**
**APPROVED.** Persisted on the existing `Task` aggregate; `ConversationRuntime` never directly reads/
writes `storage.tasks`/`storage.sessions` — `ScopeClarificationFlow` owns anchoring/derivation, exactly
like `ApprovalFlow` does for approvals. `Session` stores only the `activeTaskId` pointer, never a
snapshot.

**Q3. What exact data is stored?**
**APPROVED WITH FIELD NAME CHANGE.** `{ kind: 'code-scope-clarification', summary, rawKind?, projectId?,
createdAt }` — an explicit anchor discriminator (`kind`), the original summary, the classifier's raw
kind renamed `rawKind` to avoid colliding with the discriminator, the anchor-time project, and a
timestamp. Never generated code, a patch, a diff, provider output, workspace content, or a command
result — none of that exists at this point in the flow.

**Q4. How is stale clarification handled?**
**APPROVED.** Next-turn-only: `clear` is called unconditionally on the first follow-up check; an
invalid reply does **not** re-anchor. `createdAt` is stored but explicitly **not** used for TTL in
Sprint 2p (§5.1's doc comment states this directly, to be restated in ADR-0037 so it is never mistaken
for expiration logic later).

**Q5. What happens if the active project changes between turns?**
**APPROVED WITH SAFE CLEAR REQUIREMENT.** If the project changed, the anchor is ignored/cleared and the
message proceeds as an ordinary fresh turn (§5.1 `findPending`). The clear this triggers goes through
the same `anchorTask`-gated `clear()` as every other clear call — it only ever clears `activeTaskId` if
it still points at *this flow's own* anchor, never an approval anchor or anything else (§5.1 Required
Change #4).

**Q6. How is the file-path reply recognized?**
**APPROVED.** `ConversationRuntime.handle()` checks `scopeClarificationFlow.findPending` before calling
`classifier.classify` at all (§5.2). No new intent; the classifier never needs to (and does not)
classify a bare file path as a code-change request.

**Q7. How is target path validation reused from Sprint 2o?**
**APPROVED.** Directly — `extractTargetPathCandidates` → `WorkspaceManager.list` → exact-match-via-
`normalizeRelativePath`, unchanged from Sprint 2o, called from the new recovery path instead of (or in
addition to) the fresh-request path. No new path/security model; the Workspace boundary remains
authoritative.

**Q8. How does the resumed request enter the existing `planningOnly` flow?**
**APPROVED.** A validated candidate causes `handleScopeClarificationTurn` to rebuild an `Intent` from
`pending` and call the shared `runResolvedExecution` helper (§5.4) — the identical path a fresh,
immediately-sufficient request already uses. `IntentResolver.resolve()` still sets `planningOnly: true`
unconditionally for `CODE_IMPLEMENTATION`; `RiskPolicy`'s `HIGH` still forces the `Approval` halt. No
`ExecutionOrchestrator` contract change.

**Q9. How do we prove no `ExecutionPlan`/`ApprovalRequest` exists before scope is sufficient?**
**APPROVED.** Tests must show: the initial missing-scope turn anchors and calls `orchestrator.run`
zero times; a second-turn invalid-path reply also calls it zero times (and clears the anchor); a
second-turn valid-path reply calls it exactly once, with `targetFiles` populated from the validated
Workspace hit and `planningOnly: true` on the resulting request (§9).

**Q10. How do we avoid hardcoded user-facing text in Runtime? Cancel wording?**
**APPROVED WITH CANCEL CHECK.** `Runtime` never builds text — it only selects between existing
`ResponseComposer` methods, plus the one new method this round added specifically because the earlier
reused wording risked implying an execution existed (§5.5). A test asserts the cancel reply text does
not claim a plan/patch/execution was created (§9).

## 7. Case matrix (mapped to the CA's four expected-behavior cases)

| Case | Turn | Detection | Result |
|---|---|---|---|
| 1. Missing target | 1st | `detectCodeChange` fires, no path candidate validates, project+workspace already confirmed | `scopeClarificationFlow.anchor` + `composeTargetScopeClarification`; `orchestrator.run` never called |
| 2. Bare path reply | 2nd | `scopeClarificationFlow.findPending` non-null, candidate validates | anchor cleared, intent recovered **using the original summary**, `runResolvedExecution` → `planningOnly` `AWAITING_APPROVAL`, exactly Sprint 2o's sufficient-scope reply |
| 3. Invalid path reply | 2nd | pending found, no candidate validates | anchor cleared (not re-anchored), `composeTargetScopeClarification` again; `orchestrator.run` never called |
| 4. Cancel | 2nd | pending found, message matches `CANCEL_WORDS` | anchor cleared, **`composeScopeClarificationCancelled`** (new); `orchestrator.run` never called |
| (new) Project changed | 2nd | pending found but `projectId` mismatch | `findPending` safely auto-clears (only if it's still our anchor), returns null — message handled as an ordinary fresh turn |
| (new) 3rd message after a failed retry | 3rd | no pending (cleared at turn 2) | ordinary classification — a bare path alone falls to `CHAT`; a full restated request re-enters Sprint 2o's fresh gate |
| (new) Approval pending, unrelated to scope | any | `approvalFlow.findPending` fires first | `handleApprovalTurn` — scope-clarification code is never reached, never clears the approval anchor |

## 8. Validation Strategy (tests to add/change at implementation — Node 22)

**`stateless-scope-clarification-flow.test.ts`** (new file, mirrors `stateless-approval-flow.test.ts`):
1. `anchor` creates a `Task` with no `planId`.
2. The anchor stores discriminator `kind: 'code-scope-clarification'`.
3. The anchor stores the original `summary`.
4. The anchor stores `rawKind` in a field distinct from the discriminator `kind`.
5. `anchor` sets `session.activeTaskId`.
6. `findPending` returns the anchor for a plan-less Task carrying a valid discriminator.
7. `findPending` returns `null` when `activeTaskId` is absent.
8. `findPending` returns `null` when the pointed-at Task has a `planId` (approval anchor).
9. `findPending` returns `null` when the metadata discriminator is missing or has a different value.
10. A `projectId` mismatch clears the anchor **only if** `activeTaskId` still points at our anchor.
11. `clear` does **not** clear an approval anchor (Task with `planId` at the pointer).
12. `clear` resets `activeTaskId` for a genuine scope anchor.

**`conversation-runtime.test.ts`**:
13. Fresh `CODE_IMPLEMENTATION` request with no path, active project present, workspace opens →
    `scopeClarificationFlow.anchor` called once, `calls.run === 0` (Case 1).
14. No active project → `anchor` is **not** called (Required Change #10).
15. Workspace-open failure → `anchor` is **not** called (Required Change #10).
16. `TEST_EXECUTION`/`PROJECT_ANALYSIS`/`CHAT` never call `anchor` (Required Change #10).
17. Next turn, bare path only (no verb), matching pending anchor, validating `workspace.list` →
    `orchestrator.run` called once; recovers the request.
18. The recovered request's `goal`/`instruction` equals the **original first message's** summary, not
    the second message's text (Required Change #9).
19. The recovered request's `targetFiles` equals the Workspace-returned hit.
20. The recovered request has `planningOnly: true`.
21. The turn's outcome is `AWAITING_APPROVAL`.
22. `IntentClassifier.classify` is never called for this turn (a spy/counter proves it — Q6).
23. Next turn, an invalid/unvalidated bare path → `composeTargetScopeClarification` again,
    `calls.run === 0`, anchor cleared (Case 3).
24. A third message, sent after the Case-3 turn already consumed the anchor, is **not** recovered even
    if it is itself a bare valid path (next-turn-only, Required Change #7).
25. Next turn, "취소" while pending → `composeScopeClarificationCancelled` reply,
    `calls.run === 0`, anchor cleared (Case 4).
26. The cancel reply's text does not claim a plan/patch/execution was created (Required Change #8).
27. An `activeTaskId` pointing at an approval-anchored Task (`planId` present) is never routed into
    `handleScopeClarificationTurn`, and `scopeClarificationFlow.clear`/`anchor` is never called for it
    (Required Change #5).
28. The existing approval-anchor is not cleared by anything in the scope-clarification path.
29. All existing approval-turn tests (`'next turn "승인"'`, etc.) still pass unmodified.

**`response-composer.test.ts`** (new case):
30. `composeScopeClarificationCancelled` — text does not contain wording implying an execution/plan
    was cancelled; states the request itself was dropped.

31. `pnpm typecheck` + `pnpm test` green on **Node 22**.

This list maps directly onto the CA Round 1 "Required Tests" enumeration (31 items in the review);
every item there is covered by one of the 31 grouped cases above.

## 9. Architecture Impact / Reuse

- **Reuses, unchanged:** `Task`/`Session` aggregates (existing `metadata`/`activeTaskId` fields, no
  schema change), `target-scope.ts` (Sprint 2o, ADR-0036, zero-diff), `IntentResolver.resolve()`,
  `ExecutionOrchestrator`/`selectStages`/`RiskPolicy`/`planningOnly` (ADR-0035/0036, all untouched),
  `ResponseComposer`'s existing `composeTargetScopeClarification` (no change), `IntentClassifier`
  (never consulted for a clarification-answering turn; unchanged for every other turn).
- **Changes:** new file `stateless-scope-clarification-flow.ts` (mirrors `stateless-approval-flow.ts`),
  `conversation-runtime.ts` (+1 new interface/type with an explicit discriminator, +1 top-level check,
  +1 new private method, a refactor-only extraction of two existing private helpers, +1 anchor call in
  the existing Sprint 2o gate), `response-composer.ts` (+1 new method, §5.5), `app.module.ts` (+1 DI
  wiring entry, same shape as `StatelessApprovalFlow`'s).
- **No new** aggregate / repository / migration / capability / port (§2). **No** `Core` or
  `ExecutionOrchestrator` contract change.
- **ADR-0037** (authored before implementation) must include, per CA Round 1:
  1. Sprint 2p is multi-turn scope clarification, not code generation.
  2. `Task` is reused as an **inert conversation anchor** — never enters Planning/Orchestrator/Patch/
     WorkspaceWrite/CommandExecution by itself, never advances past `TaskStatus.PENDING`.
  3. No new aggregate/repository/migration/capability/port.
  4. `Session` stores only the `activeTaskId` pointer; `Session.metadata` is not used; short-term
     memory is not parsed for structured state.
  5. The scope anchor is distinguished from the approval anchor by **both** `planId` absence **and**
     an explicit metadata discriminator (`kind: 'code-scope-clarification'`) — not by `planId` alone.
  6. The anchor stores `summary`, `rawKind`, `projectId`, `createdAt` — named distinctly from the
     discriminator `kind` to avoid field-name collision.
  7. `createdAt` is observability/future-policy only, **not** a TTL in Sprint 2p.
  8. Invalidation is next-turn-only: consumed on the first follow-up check regardless of outcome; an
     invalid reply does not re-anchor. Unbounded retry is an explicit, documented Product trade-off,
     not an oversight — a future plan is required to extend it.
  9. Project-change auto-clears the anchor.
  10. `clear` only clears `activeTaskId` if it still points at the scope-clarification anchor — it must
      never clear an approval anchor sharing the same pointer slot.
  11. A bare path reply bypasses `IntentClassifier` only when a pending scope clarification exists.
  12. A recovered request enters the existing `planningOnly` flow unchanged, using the **original**
      request's summary, never the follow-up message's text.
  13. No AI Code Generation / Patch / WorkspaceWrite / CommandExecution.
  14. `ConversationRuntime` frames facts only; `ResponseComposer` owns all text.

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| A future feature misreads a plan-less Task as a scope-clarification anchor | Low | Explicit metadata discriminator required in addition to `!planId` (§5.1, CA Round 1 Required Change #2) |
| `clear()` accidentally wipes an approval anchor sharing the same `activeTaskId` slot | Low | `clear()` routes through the same `anchorTask()` gate as `findPending` — a no-op unless it's genuinely our anchor (§5.1, Required Change #4); tested explicitly (§8 items 10-11, 27-28) |
| Orphaned `PENDING` anchor Tasks accumulate over time | Low | Identical, already-accepted pattern to `StatelessApprovalFlow`'s own orphaned `WAITING_APPROVAL` Tasks (ADR-0032); not a new category of concern |
| Users expect indefinite retries, not "one more try" | Med (Product) | Documented as an explicit, intentional trade-off (§1, §5.4, ADR-0037 item 8) rather than left implicit; `composeTargetScopeClarification`'s wording already says "다시 요청해 주세요" so behavior matches what's said |
| Recovered request accidentally uses the follow-up message's text instead of the original | Low | `pending.summary` is the only source for the recovered `Intent.summary` (§5.4); pinned by a dedicated test (§8 item 18) |
| Cancel wording implies an execution/plan was cancelled | Low | Resolved this round with a dedicated `composeScopeClarificationCancelled` method (§5.5); tested (§8 item 26) |
| Refactor of `handleExecutionIntent` accidentally changes existing Sprint 2n/2o behavior | Low | Extraction is behavior-preserving by construction (§5.4); Sprint 2n/2o's existing test suite must pass unmodified except for the one added anchor-call assertion (§8 item 13) |

## Next Step

**Plan changes applied — CA Round 1 requirements incorporated above.** Per the approved implementation
sequence: (1) plan changes applied (this document); (2) author ADR-0037 next; (3) implement exactly
this scope (§3/§5) on a `v2/<topic>` branch; (4) add/update tests per §8; (5) validate on **Node 22**;
(6) open a PR for Chief Architect Implementation Review. No commit/PR has been made yet — proceeding
to ADR-0037 + implementation now.
