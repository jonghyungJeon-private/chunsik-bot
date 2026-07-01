# Sprint 2q Plan — AI Code Generation Preview (proposal text only, no Patch/Write)

- **Status:** ✅ APPROVED WITH CHANGES (Chief Architect Review, Round 1) — required changes applied
  below; implementing this scope next.
- **Base:** `main` @ `38aec78` · **Validation runtime:** Node 22 (to be run at implementation time).
- **Directed by:** Chief Architect (this sprint's topic is CA-assigned, not Claude-proposed).
- **Goal:** After a user approves a `planningOnly` code-change request, run the existing AI Code
  Generation capability once, in preview mode, and show the proposed change as text — never apply it.
  No `Patch`, no `WorkspaceWrite`, no `CommandExecution`, no file mutation.
- **Phase:** Phase 2 — Product Construction (seventh runtime sprint, after 2k/2l/2m/2n/2o/2p). **Not**
  a new capability. Reuses CAP-008 (AI Code Generation) exactly as already built; no new aggregate.
- **Process:** V2 architecture-first, step 1 (plan-only) → CA review Round 1 complete → applying
  required changes → implementation next. No implementation, no branch, no commit, no PR in this step.

> **Framing.** This is the decision Sprint 2n's own plan explicitly deferred (§ Q3: *"Whether AI Code
> Generation is allowed must be decided in the plan... deferred to a future sprint"*). Every other
> piece is already built and already CA-approved: `CodeGenerationManager` (CAP-008, ADR-0029) has
> shipped, unused, since before Sprint 2n even started. The only question this sprint answers is
> **how** a preview step is wired in — and the answer that avoids the most risk is to keep
> `ExecutionOrchestrator` completely out of it, with the AI's untrusted output kept on a short,
> explicit leash: validated `targetFiles` only, guards before every call, and failure reported
> honestly as `FAILED`, never dressed up as a normal reply.

---

## 1. Objective

When a `planningOnly` `CODE_IMPLEMENTATION` request is approved and `ExecutionOrchestrator.resume()`
completes (today: silently, doing nothing — ADR-0035/2n), `ConversationRuntime` additionally calls the
existing `CodeGenerationManager.generate()` once — but **only** if `executionPlanRef`, `workspaceRef`,
and a non-empty `targetFiles` are all present — renders the resulting proposal as bounded, backtick-safe
preview text, and replies with it. The proposal is **never** turned into a diff-against-workspace, a
`PatchSet`, or a filesystem write — this sprint stops at "here is what the AI would change." Any part
of the proposal outside the validated target file is dropped from the rendered content and never
presented as if it were a successful, actionable preview.

## 2. The central architecture decision (Q4) — Orchestrator untouched, Runtime composes directly

**Decision: do not touch `ExecutionOrchestrator` at all. `ConversationRuntime` calls
`CodeGenerationManager.generate()`/`getProposal()` directly, after `orchestrator.resume()` returns.**
**CA Round 1: approved without change.**

Why this, and not a new Orchestrator stage:

- `ExecutionOrchestrator.run()`'s stage order is a single, fixed abstraction: when `CODE_GENERATION`
  is selected, it always runs **before** `APPROVAL` (`execution-orchestrator.ts:217-252` — pre-approval
  authoring, so a human can review the diff before approving). Sprint 2q's whole point is the
  opposite: generate **after** approval, as a preview, with no diff/patch/write ever following it.
  Bolting a second, differently-ordered `CODE_GENERATION`-like stage onto `resume()` specifically
  would mean `selectedStages` no longer has one consistent meaning across `run()`/`resume()`.
- `ConversationRuntime` is **already** an Application-layer composer of capability managers, not only
  through the Orchestrator — it already reads `CommandExecutionManager` directly
  (`commandExecutions.get`, `frameTestResult`) to frame a result the Orchestrator's outcome alone
  doesn't carry. Calling `CodeGenerationManager.generate()`/`getProposal()` directly is the same shape
  of composition, once more.
- This keeps the claim in §9/Q10 as strong as possible: **`ExecutionOrchestrator` is not invoked for
  this step at all** — not "invoked but structurally blocked," which is the (already strong) guarantee
  Sprint 2n/2o/2p relied on.
- Zero change to `ExecutionRequest`, `selectStages`, `run()`, or `resume()`. Zero risk to the
  extensively-tested existing pipeline (Sprint 2j/2n/2o/2p).

**Considered and rejected:** a new `ExecutionStage` (e.g. `CODE_GENERATION_PREVIEW`) selected only when
`planningOnly` and reached only from `resume()`. Rejected because it requires `resume()`-specific
branching that has no equivalent in `run()`. CA confirmed: *"이걸 Orchestrator stage로 억지로 넣으면
`selectedStages`의 의미가 run/resume 사이에서 달라집니다."*

## 3. Scope (this sprint)

- `ConversationRuntimeDeps` gains one new narrow dependency, `codeGeneration: { generate, getProposal
  }` (§5.1).
- `ConversationRuntime.handleApprovalTurn`'s `approve` branch: when `ctx.request.planningOnly` and the
  resume outcome is `COMPLETED`, call a new private `runCodeGenerationPreview` (§5.2). **CA Round 1:**
  every guard (`executionPlanRef`, `workspaceRef`, non-empty `targetFiles`) is checked explicitly
  **before** calling `generate()` — none of these may be inferred, defaulted, or skipped.
- `runCodeGenerationPreview` calls `CodeGenerationManager.generate()` with `executionPlanRef`,
  `instruction`, `workspaceRef`, `targetFiles` — all already present on the reconstructed
  `ExecutionRequest` (§5.2/Q5/Q6) — reads the resulting `CodeProposal`, and **filters it against the
  already-validated `targetFiles` using the same exact-match normalization Sprint 2o/2p already use**
  (§5.3 — CA Round 1 required change: raw `Set.has` string comparison was rejected as weaker than the
  established path discipline). If **no** proposed change survives filtering, the turn is **not**
  presented as a successful preview (§5.3, CA Round 1 required change).
- Three new `ResponseComposer` methods — `composeCodeGenerationPreview`, `composeCodeGenerationPreviewFailed`,
  and `composeCodeGenerationPreviewNoValidChange` — plus one new Application-layer DTO,
  `CodeChangePreview` (§5.4). Rendering is backtick-safe and bounds both per-file excerpts and the
  out-of-scope warning list (CA Round 1 required changes).
- **Preview failure (including the no-valid-change case) reports `RuntimeTurnStatus.FAILED`**, not
  `RESPONDED` — a genuinely failed attempt to produce a usable preview must not look like an ordinary
  successful reply at the Runtime-status level (CA Round 1 required change). A successful preview's
  `TurnResult` carries `executionOutcome: outcome`, matching every other successful execution-outcome
  reply in this file (CA Round 1 required change).
- `app.module.ts`: add `CodeGenerationManager` to the existing `ConversationRuntime` factory's
  `inject` array and pass it through as `codeGeneration` — the provider already exists (§5.5).
- Tests for all of the above (§8), including the CA's 31 explicitly required test items.

## 4. Non-goals (explicit, per Chief Architect direction)

No implementation before plan approval · no branch/commit/PR beyond this plan-only step · no `Patch`
generation · no `PatchSet` application · no `WorkspaceWrite` · no file mutation · no git mutation · no
command execution · no test execution after generation · no retry loop · no autonomous agent loop · no
directory scope · no module scope as sufficient target · no semantic repository search · no repository
indexing · no AI target-file guessing · no multi-file selection · no Discord button UI · no
`ExecutionOrchestrator` contract change (§2) · no general-purpose execution-stage override system · no
`Core` contract change. `planningOnly`'s meaning is **not** changed (§6 Q3) — no rename.

## 5. Design

### 5.1 `ConversationRuntimeDeps` — one new narrow dependency

```ts
readonly codeGeneration: {
  generate(input: GenerateCodeInput): Promise<CodeGeneration>;
  getProposal(generation: CodeGeneration): Promise<CodeProposal | null>;
};
```

Structurally identical to the subset `ExecutionOrchestratorDeps.codeGeneration` already declares
(`execution-orchestrator.ts:147-151`) — satisfied by the same `CodeGenerationManager` instance,
already registered as a DI provider (`app.module.ts:233-239`). No new provider, no new capability.

### 5.2 `handleApprovalTurn` — one new branch, all required guards explicit

Today (`conversation-runtime.ts`, the `decision === 'approve'` branch):

```ts
const outcome = await this.deps.orchestrator.resume(ctx.request, ctx.prior);
if (ctx.request.planningOnly) {
  const reply = this.deps.composer.composePlanningOnlyApproved(message.context);
  await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
  return { status: 'RESPONDED', reply, sessionId: session.id, executionOutcome: outcome };
}
return this.replyForOutcome(message.context, session, outcome);
```

Changes to:

```ts
const outcome = await this.deps.orchestrator.resume(ctx.request, ctx.prior);
if (ctx.request.planningOnly) {
  if (outcome.status !== ('COMPLETED' as ExecutionOutcomeStatus)) {
    // Resume itself didn't complete cleanly (rare — e.g. the approval re-fetch failed). Fall back
    // to the existing generic outcome handling; never attempt a preview without a clean resume.
    return this.replyForOutcome(message.context, session, outcome);
  }
  return this.runCodeGenerationPreview(message, session, ctx.request, outcome);
}
return this.replyForOutcome(message.context, session, outcome);
```

**CA Round 1 correction (Required Change #9):** `composePlanningOnlyApproved` is **not** reached from
this updated code — the `outcome.status !== COMPLETED` branch calls `replyForOutcome`, not
`composePlanningOnlyApproved`. The corrected claim (restated in §9) is: `composePlanningOnlyApproved`
is retained for compatibility and its existing tests, but after this sprint it is no longer reached
from any production code path for an approved `planningOnly` `CODE_IMPLEMENTATION` request. It is
**not deleted** — deletion is not required and is explicitly out of scope this sprint.

```ts
/**
 * After a planningOnly CODE_IMPLEMENTATION approval resumes cleanly, run AI Code Generation once,
 * in preview mode, and render the result. Never calls ExecutionOrchestrator, Patch, WorkspaceWrite,
 * or CommandExecution — this method's only side effect is at most one CodeGenerationManager.generate()
 * call (which itself never touches the filesystem, CAP-008/ADR-0029).
 *
 * CA Round 1: executionPlanRef, workspaceRef, and a non-empty targetFiles must ALL be present before
 * generate() is ever called — targetFiles is the only allowed scope source; there is no AI
 * target-file guessing in this sprint.
 */
private async runCodeGenerationPreview(
  message: InboundMessage,
  session: Session,
  request: ExecutionRequest,
  outcome: ExecutionOutcome,
): Promise<TurnResult> {
  const planRef = outcome.refs.executionPlanRef;
  const targetFiles = request.targetFiles;
  if (!planRef || !request.workspaceRef || !targetFiles?.length) {
    return this.failComposed(
      message, session, this.deps.composer.composeCodeGenerationPreviewFailed(message.context), outcome,
    );
  }

  let generation: CodeGeneration;
  try {
    generation = await this.deps.codeGeneration.generate({
      executionPlanRef: planRef,
      capability: Capability.CODE_IMPLEMENTATION,
      instruction: request.instruction,
      workspaceRef: request.workspaceRef,
      targetFiles,
    });
  } catch {
    return this.failComposed(
      message, session, this.deps.composer.composeCodeGenerationPreviewFailed(message.context), outcome,
    );
  }
  if (generation.status !== CodeGenerationStatus.SUCCEEDED) {
    return this.failComposed(
      message, session, this.deps.composer.composeCodeGenerationPreviewFailed(message.context), outcome,
    );
  }

  const proposal = await this.deps.codeGeneration.getProposal(generation);
  if (!proposal) {
    return this.failComposed(
      message, session, this.deps.composer.composeCodeGenerationPreviewFailed(message.context), outcome,
    );
  }

  const preview = ConversationRuntime.toCodeChangePreview(proposal.proposal, targetFiles);
  if (preview.changes.length === 0) {
    // CA Round 1: every proposed path was outside the validated targetFiles — never present this as
    // a successful code-change proposal.
    return this.failComposed(
      message,
      session,
      this.deps.composer.composeCodeGenerationPreviewNoValidChange(message.context, preview.outOfScopeWarnings),
      outcome,
    );
  }

  const reply = this.deps.composer.composeCodeGenerationPreview(message.context, preview);
  return this.respondComposed(message, session, reply, outcome);
}
```

`request`/`outcome` here are exactly `ctx.request`/the just-returned `resume()` outcome — `request.
instruction`, `.workspaceRef`, `.targetFiles` are all already present on the reconstructed
`ExecutionRequest` (they were part of the original `ExecutionRequest` object `StatelessApprovalFlow`
anchored on `Task.metadata` at halt time, ADR-0032/0035 — **zero new plumbing**, answering Q6 directly).

**CA Round 1 (Required Change #7/#8):** `respondComposed` and `failComposed` both gain (or already
have, for `failComposed`) an optional `outcome` parameter, so every branch above — success and every
failure variant — carries `executionOutcome: outcome` on its `TurnResult`, and every failure variant
reports `RuntimeTurnStatus.FAILED` (via `failComposed`), never `RESPONDED`:

```ts
private async respondComposed(
  message: InboundMessage,
  session: Session,
  reply: OutboundMessage,
  outcome?: ExecutionOutcome, // new, optional — additive; every existing 3-arg call site is unaffected
): Promise<TurnResult> {
  await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
  return { status: 'RESPONDED', reply, sessionId: session.id, ...(outcome ? { executionOutcome: outcome } : {}) };
}
```

(`failComposed` already accepts an optional `outcome` param today — unchanged, just used consistently
here.) Note the success/failure branches above call `respondComposed`/`failComposed` **exactly once**
each, with no separate manual `memory.recordAssistant` call before them — avoiding the exact
double-record class of bug fixed in Sprint 2p's implementation review.

### 5.3 Filtering AI output against the already-validated `targetFiles` (normalized exact-match)

Nothing structurally stops the AI's returned `ProposedChange[]` from naming a path outside the one
`targetFiles` entry Sprint 2o/2p validated against the real workspace. **CA Round 1 (Required Change
#4): comparison must use the same `normalizeRelativePath` exact-match discipline Sprint 2o/2p already
established — not a raw string `Set.has` — and the rendered path must be the validated `targetFiles`
value, never the AI's raw (possibly differently-formatted) path string:**

```ts
/** Split a proposal into in-scope changes (path normalizes to a validated targetFiles entry) and
 *  everything else, reported as a warning and never rendered as content (Sprint 2q, ADR-0038). */
private static toCodeChangePreview(proposal: ProposedChange[], targetFiles: string[]): CodeChangePreview {
  const normalizedTargets = new Map(targetFiles.map((p) => [normalizeRelativePath(p), p]));
  const changes: CodeChangePreview['changes'] = [];
  const outOfScopeWarnings: string[] = [];
  for (const change of proposal) {
    const validatedPath = normalizedTargets.get(normalizeRelativePath(change.path));
    if (!validatedPath) {
      outOfScopeWarnings.push(change.path);
      continue;
    }
    changes.push({
      path: validatedPath, // the validated targetFiles value — never the AI's raw path (CA Round 1)
      kind: change.delete ? 'delete' : 'update',
      ...(change.delete ? {} : { excerpt: change.newContent }),
    });
  }
  return { changes, outOfScopeWarnings };
}
```

`normalizeRelativePath` is the exact function Sprint 2o/2p already export from `target-scope.ts` —
reused directly, not reimplemented. This is a pure, deterministic, no-I/O function — the same
"generator output is not trusted; validated ground truth is" posture Sprint 2o established for
user-supplied text (there: regex-extracted candidates vs. `WorkspaceManager.list`; here: AI-authored
paths vs. the already-validated `targetFiles`).

**CA Round 1 (Required Change #5):** if `changes.length === 0` after filtering — every proposed path
was out of scope — the turn must **not** present a successful-preview reply. `runCodeGenerationPreview`
(§5.2) routes this case to the new `composeCodeGenerationPreviewNoValidChange`, via `failComposed`
(`RuntimeTurnStatus.FAILED`), not `composeCodeGenerationPreview`.

### 5.4 `ResponseComposer` — one new DTO, three new methods, bounded + backtick-safe rendering

```ts
/** Display-relevant shape of an AI code-change proposal (Sprint 2q, ADR-0038). Application-layer,
 *  not domain, not persisted — deliberately narrower than CodeProposal (no id/Ref/providerId). */
export interface CodeChangePreview {
  changes: Array<{ path: string; kind: 'update' | 'delete'; excerpt?: string }>;
  /** Paths the AI proposed touching OUTSIDE the validated targetFiles — never rendered as content. */
  outOfScopeWarnings: string[];
}
```

```ts
/** Per-file excerpt cap before the overall message clamp applies (mirrors ADR-0034's pattern). */
const MAX_PREVIEW_EXCERPT_CHARS = 800;
/** Bound on how many out-of-scope paths are listed before truncating (CA Round 1). */
const MAX_OUT_OF_SCOPE_WARNING_PATHS = 5;

/** A fence guaranteed longer than any backtick run already inside `excerpt` (CA Round 1) — untrusted
 *  AI content can never break the surrounding message's Markdown structure. */
function fenceFor(excerpt: string): string {
  const longestRun = Math.max(2, ...(excerpt.match(/`+/g) ?? ['']).map((r) => r.length));
  return '`'.repeat(longestRun + 1);
}

/** Bounded, comma-joined out-of-scope path list with a "외 N개" suffix when truncated (CA Round 1). */
function renderOutOfScopeWarning(paths: string[]): string | undefined {
  if (!paths.length) return undefined;
  const shown = paths.slice(0, MAX_OUT_OF_SCOPE_WARNING_PATHS);
  const suffix = paths.length > shown.length ? ` 외 ${paths.length - shown.length}개` : '';
  return `참고: ${shown.join(', ')}${suffix}에도 변경을 제안했지만, 확인된 대상 파일이 아니라서 보여드리지 않았어요.`;
}
```

```ts
/**
 * A successful AI code-change proposal preview (Sprint 2q, ADR-0038). CA Round 1: must repeat, not
 * merely mention once, that nothing was applied — and must never use wording that could be read as
 * "적용했어요"/"수정했어요"/"반영했어요"/"변경 완료".
 */
composeCodeGenerationPreview(context: ConversationContext, preview: CodeChangePreview): OutboundMessage {
  const lines = [
    '코드 변경 제안이 준비됐어요. 아직 실제로 적용되지 않았어요. 파일은 수정되지 않았어요.',
    ...preview.changes.map((c) => {
      if (c.kind === 'delete') return `- ${c.path} (삭제 제안 — 아직 적용되지 않음)`;
      const excerpt = (c.excerpt ?? '').slice(0, MAX_PREVIEW_EXCERPT_CHARS);
      const fence = fenceFor(excerpt);
      return `- ${c.path}\n${fence}\n${excerpt}\n${fence}`;
    }),
  ];
  const warning = renderOutOfScopeWarning(preview.outOfScopeWarnings);
  if (warning) lines.push(warning);
  lines.push('이 제안을 실제로 적용하는 기능은 아직 지원하지 않아요.');
  return { context, text: clampToMessageBudget(lines.join('\n')) }; // reuses the existing helper (ADR-0034)
}

/** CA-specified wording verbatim. */
composeCodeGenerationPreviewFailed(context: ConversationContext): OutboundMessage {
  return { context, text: '코드 변경 제안을 생성하지 못했어요.\n파일은 수정되지 않았어요.' };
}

/**
 * Every proposed path was outside the validated targetFiles (Sprint 2q, ADR-0038 — CA Round 1
 * Required Change #5). Distinct from composeCodeGenerationPreviewFailed: generation itself
 * succeeded, but nothing it proposed matched the confirmed target — a different, more precise claim.
 */
composeCodeGenerationPreviewNoValidChange(context: ConversationContext, outOfScopeWarnings: string[]): OutboundMessage {
  const lines = ['AI가 제안한 변경이 확인된 대상 파일과 일치하지 않아 보여드릴 수 없어요.', '파일은 수정되지 않았어요.'];
  const warning = renderOutOfScopeWarning(outOfScopeWarnings);
  if (warning) lines.push(warning);
  return { context, text: clampToMessageBudget(lines.join('\n')) };
}
```

`clampToMessageBudget`/`MAX_MESSAGE_CHARS` are the exact same helpers Sprint 2m already defined in this
file (`response-composer.ts`) — reused directly, not duplicated.

### 5.5 `app.module.ts` — one DI wiring addition

The `ConversationRuntime` factory (`app.module.ts:~280-397`) gains `codeGeneration: CodeGenerationManager`
in its `inject` array and passes `codeGeneration` through in the constructed deps object — the provider
already exists (`app.module.ts:233-239`, already injected into `ExecutionOrchestrator` today). No new
provider registration.

## 6. Required Architecture Questions — CA decisions

**Q1. What existing capability/manager owns AI CodeGeneration today?**
**APPROVED.** `CodeGenerationManager` (CAP-008, ADR-0029) — reused as-is. Zero changes to this class
unless implementation discovers a hard blocker (none anticipated).

**Q2. How does `ConversationRuntime` resume from approved `planningOnly` into CodeGeneration preview?**
**APPROVED WITH GUARDS.** `handleApprovalTurn`'s `approve` branch calls `runCodeGenerationPreview`
only after: approval decision accepted, `orchestrator.resume` completed, `request.planningOnly` true,
`outcome.status === COMPLETED`, `executionPlanRef` exists, `workspaceRef` exists, `targetFiles` exists
and is non-empty. Every guard is an explicit check in §5.2 — none is inferred or implicit.

**Q3. Is `planningOnly` still the right flag name?**
**APPROVED — no rename.** Scoped to the Orchestrator: `ExecutionOrchestrator` selects
`PLANNING`+`APPROVAL` only for it, unchanged. Sprint 2q's preview step is a `ConversationRuntime`-level
addition entirely outside the flag's scope of meaning.

**Q4. Orchestrator stage or Runtime composition?**
**APPROVED.** Runtime composition (§2). No `CODE_GENERATION_PREVIEW` stage, no resume-only stage
override, no `ExecutionOrchestrator` contract change.

**Q5. What exact input does CodeGeneration receive?**
**APPROVED WITH REQUIRED GUARDS.** `executionPlanRef`, `capability: CODE_IMPLEMENTATION`, `instruction`
(the original request's summary), `workspaceRef`, `targetFiles` — and nothing else: no chat history, no
arbitrary context files, no directory/module scope, no AI-guessed files. Missing
`executionPlanRef`/`workspaceRef`/non-empty `targetFiles` → `generate()` is never called (§5.2).

**Q6. How is `targetFiles` preserved through approval resume?**
**APPROVED.** Confirmed: `StatelessApprovalFlow` already anchors the full `ExecutionRequest` (§Q6 in
the original plan) — no new plumbing. Tests must prove `ctx.request.targetFiles` survives
halt/resume unchanged (§8).

**Q7. How is provider independence preserved?**
**APPROVED.** `ConversationRuntime` calls `CodeGenerationManager`, never a concrete provider.
`ResponseComposer` never surfaces a provider id in the preview text.

**Q8. What output shape is returned?**
**APPROVED WITH CHANGES.** `CodeChangePreview` (§5.4) — not domain, not persisted. Required additions
applied: normalized target filtering (§5.3), zero-in-scope-change handling (§5.3/§5.4), safe fenced
rendering (§5.4), bounded out-of-scope warnings (§5.4).

**Q9. Where is preview text composed?**
**APPROVED.** `ResponseComposer` owns preview success text, failure text, the zero-valid-change text,
out-of-scope warning wording, the message-length clamp, and safe code-block rendering. `Runtime` only
assembles the `CodeChangePreview` facts.

**Q10. How do we prove `Patch`/`WorkspaceWrite`/`CommandExecution` are not invoked?**
**APPROVED.** `runCodeGenerationPreview` never calls `deps.orchestrator.run`/`.resume` — `Patch`/
`WorkspaceWrite`/`CommandExecution` are reachable only from inside the Orchestrator's
`runMutatingStages`, so they are categorically unreachable from this method. Plus: `orchestrator.resume`
for a `planningOnly` request still only ever selects `[PLANNING, APPROVAL]` (ADR-0035, untouched). Test
proof required: `patch.generate`/`workspaceWrite.apply`/`command.run` call counts `0`, and
`codeGeneration.generate` called **exactly once** on the success path (§8).

**Q11. What happens on CodeGeneration failure?**
**APPROVED WITH STATUS CHANGE.** `composeCodeGenerationPreviewFailed` — CA-specified wording verbatim.
**Runtime status is `FAILED`** (via `failComposed`), not `RESPONDED` (§5.2, Required Change #7). Covers
missing guards, a non-`SUCCEEDED` generation, a missing proposal, and a thrown error — all funnel
through the same guarded, `FAILED`-status path.

**Q12. How does this interact with existing Sprint 2n approval-resume behavior?**
**APPROVED.** Deny/cancel/re-ask paths are unchanged. Only the specific `decision === 'approve'` +
`ctx.request.planningOnly` + `outcome.status === COMPLETED` sub-case changes.

## 7. Case matrix (mapped to the CA's five expected-behavior cases)

| Case | Turn | Detection | Result |
|---|---|---|---|
| 1. Missing target | 1st | Sprint 2o/2p behavior | unchanged — anchors, clarification reply, no CodeGeneration |
| 2. Bare path reply | 2nd | Sprint 2p recovery | unchanged — validated target, `planningOnly` `AWAITING_APPROVAL`, no CodeGeneration yet |
| 3. User approves, valid in-scope proposal | 3rd ("승인") | resume `COMPLETED`, `planningOnly`, ≥1 in-scope change | `composeCodeGenerationPreview`, `RESPONDED`, `executionOutcome` preserved |
| 3a. User approves, all proposed paths out of scope | 3rd | resume `COMPLETED`, `planningOnly`, 0 in-scope changes | `composeCodeGenerationPreviewNoValidChange`, **`FAILED`** |
| 4. Deny/cancel | any | `decision === 'deny'\|'cancel'` | unchanged — existing composer, no CodeGeneration |
| 5. CodeGeneration fails / guards missing | 3rd | missing ref/workspaceRef/targetFiles, non-`SUCCEEDED` generation, no proposal, or thrown error | `composeCodeGenerationPreviewFailed`, **`FAILED`**; no `Patch`/`WorkspaceWrite`/`CommandExecution` ever attempted |

## 8. Validation Strategy (tests to add/change at implementation — Node 22)

**`conversation-runtime.test.ts`**:
1. Full sequence "이 버그 고쳐줘" → "packages/core/src/application/foo.ts" → "승인" → fake
   `codeGeneration.generate` returns a `SUCCEEDED` generation with a matching in-scope proposal →
   `composeCodeGenerationPreview` reply, `status: 'RESPONDED'`, `codeGeneration.generate` called
   **exactly once**.
2. The `generate()` call's input has `executionPlanRef` = the resumed outcome's plan ref,
   `instruction` = the **original** request's summary, `workspaceRef`/`targetFiles` matching Sprint
   2o/2p's validated values.
3. `getProposal()` is called exactly once, only after a `SUCCEEDED` generation.
4. Missing `executionPlanRef` on the outcome → `generate` never called, `composeCodeGenerationPreviewFailed`,
   `status: 'FAILED'`.
5. Missing `workspaceRef` on the reconstructed request → `generate` never called, same failed reply,
   `status: 'FAILED'`.
6. Missing `targetFiles` (undefined) → `generate` never called, same failed reply, `FAILED`.
7. Empty `targetFiles` (`[]`) → `generate` never called, same failed reply, `FAILED`.
8. `generate()` returns a `FAILED` generation → `getProposal` **not** called, failed reply, `FAILED`.
9. `generate()` throws → failed reply, `FAILED`, never an unhandled rejection.
10. `SUCCEEDED` generation + `getProposal` returns `null` → failed reply, `FAILED`.
11. A proposal whose path normalizes-equal to a `targetFiles` entry but is formatted differently (e.g.
    a leading `./`) is still treated as in-scope, and the **rendered path is the validated `targetFiles`
    value**, not the AI's raw string.
12. A proposal containing a path outside `targetFiles` → not rendered as content; appears only in the
    composer's warning input; `changes` passed to the composer excludes it.
13. A proposal where **every** path is out of scope → `composeCodeGenerationPreviewNoValidChange`,
    `status: 'FAILED'` — never the success composer.
14. Deny ("거절") and cancel ("취소") at the approval step never call `codeGeneration.generate`.
15. Approval `reconstructResume` failure (re-ask path) never calls `codeGeneration.generate`.
16. A non-`planningOnly` approval resume never calls `runCodeGenerationPreview`/`codeGeneration.generate`.
17. Across the full approve-and-preview sequence: `patch.generate`/`workspaceWrite.apply`/
    `command.run` call counts stay `0` (reusing the existing orchestrator-level fakes/counters already
    in place since Sprint 2n).
18. `deps.orchestrator.run`/`.resume` call counts are unaffected by the preview step (no additional
    Orchestrator calls from it) — proving Q10's "Runtime never calls the Orchestrator for this step."
19. A successful preview's `TurnResult.executionOutcome` equals the resume outcome.
20. A failed preview's `TurnResult.executionOutcome` equals the resume outcome when one is available.

**`response-composer.test.ts`** (new cases):
21. `composeCodeGenerationPreview` — text states the change was not yet applied (checked at least
    twice: the opening line and the closing "아직 지원하지 않아요" line); lists the changed file
    path(s); includes a bounded excerpt; includes the out-of-scope warning line when present, omits it
    when absent; never contains "적용했어요"/"수정했어요"/"반영했어요"/"변경 완료".
22. An excerpt containing a run of triple backticks does not break the rendered fence (the fence is
    longer than any backtick run in the content).
23. More than `MAX_OUT_OF_SCOPE_WARNING_PATHS` out-of-scope paths → warning line shows the cap plus an
    "외 N개" suffix, not the full list.
24. `composeCodeGenerationPreviewFailed` — text matches the CA-specified wording exactly.
25. `composeCodeGenerationPreviewNoValidChange` — text does not claim a successful proposal; states the
    file was not modified; includes the bounded out-of-scope warning when paths are given.
26. Full rendered preview text stays within the existing `MAX_MESSAGE_CHARS` bound even with a
    near-limit excerpt (reuses Sprint 2m's existing regression-guard pattern).

**Unit-level (co-located or a new small test file)**:
27. `toCodeChangePreview` — in-scope changes pass through with an excerpt and the validated path; a
    `delete` change has no excerpt; out-of-scope paths are excluded from `changes` and appear in
    `outOfScopeWarnings` using the AI's original (unvalidated) string.

28. `pnpm typecheck` + `pnpm test` green on **Node 22**.

## 9. Architecture Impact / Reuse

- **Reuses, unchanged:** `CodeGenerationManager` (CAP-008, zero changes), `ProviderSelector`/
  `PromptComposer`/`PromptRenderer` (invoked exactly as `ExecutionOrchestrator` already invokes them),
  `ExecutionOrchestrator`/`selectStages`/`run`/`resume` (zero changes), `StatelessApprovalFlow` (zero
  changes), `normalizeRelativePath` (Sprint 2o's `target-scope.ts`, reused directly), `clampToMessageBudget`/
  `MAX_MESSAGE_CHARS` (Sprint 2m's `response-composer.ts`, reused directly).
- **`composePlanningOnlyApproved` (ADR-0035) is retained but no longer reached from production code**
  for an approved `planningOnly` `CODE_IMPLEMENTATION` request — corrected from the earlier draft, which
  inaccurately claimed it stayed on the non-`COMPLETED` path (that path calls `replyForOutcome`, per
  §5.2). It is not deleted; its own tests keep passing; if it becomes unreachable in production, that
  is an accepted, explicit outcome of this sprint (CA Round 1 Required Change #9), not an oversight.
- **Changes:** `conversation-runtime.ts` (+1 new `ConversationRuntimeDeps` field, +1 branch in
  `handleApprovalTurn`, +1 new private method, +1 new private static helper, `respondComposed` gains an
  additive optional `outcome` param), `response-composer.ts` (+1 DTO, +3 methods, +2 small rendering
  helpers), `app.module.ts` (+1 DI wiring entry, no new provider).
- **No new** aggregate / repository / migration / capability / port. **No** `Core` or
  `ExecutionOrchestrator` contract change (§2).
- **ADR-0038** (authored before implementation) must include, per CA Round 1:
  1. Sprint 2q is AI CodeGeneration preview, not Patch/Write.
  2. `ConversationRuntime` composes `CodeGenerationManager` directly after an approved `planningOnly`
     resume; `ExecutionOrchestrator` remains unchanged; no new `ExecutionStage`.
  3. `planningOnly`'s meaning remains Orchestrator-scoped.
  4. `CodeGenerationManager` reused as existing CAP-008; provider independence preserved; no concrete
     provider surfaced.
  5. Preview requires `executionPlanRef`, `workspaceRef`, and non-empty `targetFiles`; no `generate`
     call if any is missing.
  6. `targetFiles` are the authoritative scope; AI-proposed paths are untrusted, normalized, and
     filtered against `targetFiles`; out-of-scope content is never rendered; an all-out-of-scope result
     is not treated as a successful preview.
  7. Preview text is bounded and safe against code-fence breakage.
  8. Failure returns `RuntimeTurnStatus.FAILED` and states the file was not modified.
  9. A successful preview preserves `executionOutcome`.
  10. No Patch/WorkspaceWrite/CommandExecution/file mutation; no Core or `ExecutionOrchestrator`
      contract change.

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| AI proposes changes outside the validated target file | Med (Product/Safety) | Normalized exact-match filtering before rendering; all-out-of-scope never presented as success (§5.3) — tested (§8 items 11-13, 27) |
| A large proposal (long file content) exceeds Discord's message limit | Low | Reuses Sprint 2m's `MAX_MESSAGE_CHARS`/`clampToMessageBudget`, plus a per-file excerpt cap (§5.4) |
| AI output containing backticks breaks the rendered Markdown fence | Low | Dynamic fence length longer than any backtick run in the excerpt (§5.4) — tested (§8 item 22) |
| Users read the preview as "already applied" | Med (Product) | Wording repeats "not applied"/"not modified" at open and close; forbidden-word list enforced by test (§5.4, §8 item 21) |
| A failed/no-valid-change preview reads as an ordinary successful reply | Low | `RuntimeTurnStatus.FAILED` for every non-success branch (§5.2, CA Round 1 Required Change #7) — tested (§8 items 4-10, 13) |
| Confusing `composePlanningOnlyApproved`'s continued (but unreached) existence with this sprint's new reply | Low | Documentation corrected (§9, CA Round 1 Required Change #9) — no longer claims it's still reached |
| `CodeGenerationManager.generate()` is slower than prior turns (first real AI call reachable in production) | Low | Pre-existing, already-accepted cost — CAP-008 was always going to make a real provider call once activated |
| Reviewers expect `WorkspaceDiff` to be part of the preview | Low-Med | Explicitly addressed as a deferred, low-risk future enhancement (§5.4/Q8), not an oversight |

## Next Step

**Plan changes applied — CA Round 1 requirements incorporated above.** Per the approved implementation
sequence: (1) plan changes applied (this document); (2) author ADR-0038 next; (3) implement exactly
this scope (§3/§5) on a `v2/<topic>` branch; (4) add/update tests per §8; (5) validate on **Node 22**;
(6) open a PR for Chief Architect Implementation Review. No commit/PR has been made yet — proceeding
to ADR-0038 + implementation now.
