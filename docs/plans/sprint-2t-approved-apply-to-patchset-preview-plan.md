# Sprint 2t Plan — Approved Apply Context → PatchSet Preview (representation only, still no mutation)

- **Status:** ✅ APPROVED WITH CHANGES (Chief Architect Review, Round 1) — required changes applied below;
  implementing this scope next.
- **Base:** `main` @ `67def77` · **Validation runtime:** Node 22 (to be run at implementation time).
- **Directed by:** Chief Architect (this sprint's topic is CA-assigned, not Claude-proposed).
- **Goal:** When the user, after an **APPROVED** apply anchor (Sprint 2s), gives an **explicit patch/continue
  command** ("패치 만들어줘", "계속 진행해", "다음 단계 진행해"), recover the approved apply context,
  re-validate the proposal against the latest workspace content, and generate a `PatchSet` **representation**
  via the existing Patch capability (CAP-005) — then render a PatchSet preview. Still no `WorkspaceWrite`, no
  file mutation, no `CommandExecution`, no git mutation. Actual apply is Sprint 2u's job.
- **Phase:** Phase 2 — Product Construction (tenth runtime sprint, after 2k–2s). **Not** a new capability —
  reuses `PatchManager`/`PatchSet` (CAP-005, ADR-0026) exactly as built, plus the Sprint 2s apply anchor,
  Sprint 2r `WorkspaceManager.diff`, and Sprint 2o `filterInScopeChanges`.
- **Process:** V2 architecture-first, step 1 (plan-only). No implementation, no branch, no commit, no PR in
  this step.

> **Framing.** Every ingredient this sprint needs already exists and was verified by reading the code, not
> assumed (CA Q1's explicit instruction). `PatchManager.generate` is already representation-only —
> `patch-manager.ts:19-26/32-67` proves it validates approval purely off the passed `ApprovalRef.status`,
> imports no other capability manager, never touches `storage.approvals`/filesystem/git, and only
> `storage.patches.save`s the generated set. So this sprint is composition: recover the approved context →
> load the `CodeProposal` → re-filter to `targetFiles` → re-run `WorkspaceManager.diff` → derive an
> `ApprovalRef` in the Application layer → hand `{executionPlanRef, approvalRef, changes, diff}` to
> `PatchManager.generate`. The one genuinely new decision is the anchor lifecycle: a `PATCH_READY` state that
> preserves the generated `PatchRef` for Sprint 2u without letting a repeated command regenerate.

---

## 1. Objective

After Sprint 2s leaves an apply anchor in status `APPROVED` (carrying `executionPlanRef`, `workspaceRef`,
`targetFiles`, `codeGenerationRef`, `codeProposalRef`, `approvalId`), a later turn with an **explicit patch
command** drives `ConversationRuntime` to:
1. confirm the anchor is `APPROVED` and its `approvalId` resolves to an APPROVED `ApprovalRequest`;
2. load the `CodeProposal` by `codeProposalRef.id` (source of truth — never rendered diff text or chat
   history);
3. re-filter its `proposal` against the validated `targetFiles` (`filterInScopeChanges`);
4. re-run `WorkspaceManager.diff(workspaceRef, inScope)` to catch stale/unreadable/add/binary/empty cases
   against the **current** file content;
5. derive an `ApprovalRef` from the loaded approval and call `PatchManager.generate({executionPlanRef,
   approvalRef, changes: inScope, diff})` — the Application layer supplies the ref; `PatchManager` never
   loads it;
6. re-anchor the apply anchor as `PATCH_READY`, preserving the generated `PatchRef`;
7. render a PatchSet preview.

Any failure at steps 1–5 (wrong status, missing approval, missing proposal, all-out-of-scope, diff throw/
empty/add/binary/oversized, generation throw) yields a safe "unavailable"/"couldn't build patch" reply —
never a PatchSet, never a mutation.

## 2. Central finding — the Patch capability is already representation-only, and every input is recoverable

**Verified against source (CA Q1 — "do not guess"):**
- `PatchManager` (`patch-manager.ts`): constructor takes only `StorageProvider`; `generate(input:
  PatchGenerationInput): Promise<PatchSet>` (line 31) validates `input.approvalRef.status !== APPROVED` →
  throw (32-36), validates `input.approvalRef.executionPlanRef.id !== input.executionPlanRef.id` → throw
  (40-45), maps each `input.changes[i]` to a `PatchOperation` using the matching `FileDiff` from
  `input.diff.files` (46-58, throws if no matching diff), builds a `PatchSet {id, executionPlanRef,
  approvalRef, operations, status: GENERATED, createdAt}` and `storage.patches.save`s it (59-67). **It
  imports no `ApprovalManager`, no filesystem/git/WorkspaceWrite/CommandExecution** (imports are `newId`,
  `now`, domain types, `StorageProvider` only, lines 1-12). Persisting a PatchSet is representation storage,
  explicitly allowed (CA Q11).
- `PatchGenerationInput` (`patch.ts:56-61`): `{executionPlanRef, approvalRef, changes: ProposedChange[],
  diff: WorkspaceDiff}` — no `codeProposalRef`; the caller supplies `changes` and `diff` directly.
- `PatchSet` (`patch.ts:29-36`), `PatchOperation` (`patch.ts:16-22` — `{path, operation, diff, metadata?}`),
  `PatchRef` (`patch.ts:42-45` — `{id, status}`), `patchRef(set)` pure derivation (`patch.ts:48-50`),
  `PatchStatus.GENERATED` the only status (`enums.ts:139-141`).
- `ApprovalRef` (`approval.ts:46-56` — `{id, status, executionPlanRef}`, plan-scoped) and `approvalRef(request)`
  (`approval.ts:59-65`) already exist. `ApprovalManager.get(approvalId)` (`approval-manager.ts:62`) already
  exposed on the runtime deps (`conversation-runtime.ts:254`, `approvals.get`, Sprint 2s).
- `CodeProposal` loadable by id directly: `storage.codeProposals.get(id)` (`storage-provider.port.ts:114`,
  `CodeProposalRepository`; SQLite-backed). `CodeProposal.proposal: ProposedChange[]` (`code-generation.ts:57`).
- `PatchManager` is **already registered** as a DI provider (`app.module.ts:208-212`) and already injected
  into `ExecutionOrchestrator` — reuse, not a new registration.

**Consequence: no new capability, port, aggregate, migration, or `ExecutionOrchestrator` change.** The only
recovery gap is the `ApprovalRef`: the anchor stores only `approvalId?`, so the Application layer must
`approvals.get(approvalId)` and derive the ref (§5.3) — exactly the "Application loads it, `PatchManager`
receives it" split CA Q2 requires.

## 3. Scope (this sprint)

- **`ApplyPreviewAnchor` gains a `PATCH_READY` status and a `patchRef?: PatchRef` field** (§5.1) — the one
  justified new anchor state (CA Q12): it preserves the generated `PatchRef` for Sprint 2u's handoff and
  makes a repeated patch command idempotent (no duplicate `PatchSet`). `StatelessApplyPreviewFlow` needs no
  logic change — its Task-status mapping only special-cases `AWAITING_APPROVAL`; `PATCH_READY` falls to the
  existing `PENDING` inert-anchor case.
- **`ConversationRuntimeDeps` gains two dependencies** (§5.2): `patch: { generate }` (the existing
  `PatchManager`) and `codeProposals: { get }` (backed by `storage.codeProposals`). Both satisfied by
  already-registered instances; `app.module.ts` wires them (§5.6).
- **New explicit patch-intent detection**, `ConversationRuntime.interpretPatchIntent(text)`, using a
  dedicated `PATCH_WORDS` list **distinct from** both `APPROVE_WORDS` and `APPLY_WORDS` — "좋아"/"오케이"/
  "확인" must never trigger patch generation (§5.4). **CA Round 1 Required Change #2:** the ambiguous
  standalone "계속 진행" is dropped; the list is narrowed to explicit patch phrases only (`['패치 만들어',
  '패치 생성', '패치로 만들어', 'patch 만들어', 'generate patch', 'patchset 만들어', '다음 단계 진행']`).
- **`handle()` routing** (§5.4): a new patch-intent branch, checked **after** the `AWAITING_APPROVAL`
  interception and **before** the existing apply-intent branch, non-overlapping by construction.
- **`handlePatchGenerationTurn`** (the main flow, §5.5), plus `handlePatchAlreadyGeneratedTurn`
  (`PATCH_READY` + patch command → don't regenerate) and `handlePatchUnavailableTurn` (patch command with no
  `APPROVED`/`PATCH_READY` anchor).
- **Four new `ResponseComposer` methods** (§5.7): `composePatchSetPreview`, `composePatchUnavailable`
  (no approved context — CA Q3), `composePatchGenerationFailed` (approved but latest diff/generation failed —
  CA Q7), `composePatchAlreadyGenerated`.
- Tests for all of the above (§8), including the CA's 27 explicitly required test items.

## 4. Non-goals (explicit, per Chief Architect direction)

No implementation before plan approval · no branch/commit/PR beyond this plan-only step · actual
`WorkspaceWrite` apply · filesystem mutation · git mutation · `CommandExecution` · test execution after patch
generation · autonomous agent loop · retry loop · multi-file selection · directory/module scope · semantic
repository search · repository indexing · AI target-file guessing · new-file creation/`changeKind: 'add'`
support · provider-specific patch behavior · treating PatchSet generation as file application ·
`ExecutionOrchestrator` stage change · `Core` contract change · `PatchManager` querying `ApprovalManager` ·
generating a PatchSet for binary/oversized/unrenderable changes (CA Q7).

## 5. Design

### 5.1 `ApplyPreviewAnchor` — one new status, one new field

**CA Round 1 Required Change #1: `PATCH_READY` means "a PatchSet representation exists," NOT "ready to
apply"/"applied."** It asserts only: a `PatchSet` was generated and stored, a `patchRef` is available, and
**no** workspace file was modified, **no** command ran, **no** git operation happened. This meaning is
carried in the enum's doc comment (below), in `composePatchSetPreview`'s wording (§5.7), and in ADR-0041.

```ts
export type ApplyPreviewAnchorStatus =
  | 'ELIGIBLE'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  /**
   * PatchSet representation has been generated and stored (patchRef available).
   * This does NOT mean the patch was applied to the workspace — no file/command/git mutation occurred.
   */
  | 'PATCH_READY';

export interface ApplyPreviewAnchor {
  kind: 'code-preview-apply';
  status: ApplyPreviewAnchorStatus;
  executionPlanRef: ExecutionPlanRef;
  workspaceRef: WorkspaceRef;
  targetFiles: string[];
  codeGenerationRef: CodeGenerationRef;
  codeProposalRef: CodeProposalRef;
  instruction: string;
  projectId?: Id;
  createdAt: IsoTimestamp;
  approvalId?: Id;
  approvedAt?: IsoTimestamp;
  /** Set once `status` becomes `PATCH_READY` — the generated PatchSet's ref, preserved for Sprint 2u
   *  (CA Q12). Its presence is what makes a repeated patch command idempotent. */
  patchRef?: PatchRef;
}
```
`PATCH_READY` never regresses; deny/cancel of the *apply* approval already cleared the anchor in Sprint 2s
before it could reach `APPROVED`, so there is no deny/cancel path out of `PATCH_READY` this sprint.
`StatelessApplyPreviewFlow.anchor`'s existing status→`TaskStatus` mapping (`AWAITING_APPROVAL` →
`WAITING_APPROVAL`, else `PENDING`) already handles `PATCH_READY` correctly (inert `PENDING` anchor) — no
change to that file.

### 5.2 `ConversationRuntimeDeps` — two new dependencies (both already-registered instances)

```ts
/** Reused for PatchSet generation (Sprint 2t, ADR-0041) — the same already-registered PatchManager
 *  ExecutionOrchestrator already depends on. Representation-only (CAP-005); never applies. */
readonly patch: { generate(input: PatchGenerationInput): Promise<PatchSet> };
/** Read-only load of the approved CodeProposal by ref (Sprint 2t) — backed by storage.codeProposals,
 *  already in the runtime factory's scope. Not a new port. */
readonly codeProposals: { get(id: Id): Promise<CodeProposal | null> };
```

### 5.3 Recovering the `ApprovalRef` (CA Q2 — Application loads, PatchManager receives)

The anchor stores `approvalId`, not the approval. The handler loads and derives:
```ts
const approval = await this.deps.approvals.get(anchor.approvalId!);
if (!approval || approval.status !== ('APPROVED' as ApprovalStatus)) {
  return this.failComposed(message, session, this.deps.composer.composePatchUnavailable(message.context));
}
const ref = approvalRef(approval); // domain pure derivation — { id, status, executionPlanRef }
```
`approvalRef` is the existing `approval.ts:59` function, imported, not reimplemented. `PatchManager.generate`
independently re-validates `ref.status === APPROVED` and the plan-scope match (`patch-manager.ts:32-45`) — a
belt-and-suspenders second check, but the handler checks first so a non-approved case never even reaches
`generate`.

### 5.4 `handle()` routing + explicit patch-intent detection

```ts
/** Explicit patch phrases (Sprint 2t, ADR-0041) — distinct from APPROVE_WORDS and APPLY_WORDS.
 *  CA Round 1 Required Change #2: the ambiguous standalone "계속 진행" is deliberately excluded — a bare
 *  "continue" intent must never be auto-read as PatchSet generation. Every entry is an explicit
 *  patch-generation phrase; "다음 단계 진행" is the full multi-word form (never bare "다음 단계"), and none
 *  collide with APPROVE_WORDS' "진행" or APPLY_WORDS' "이대로 진행". "좋아"/"오케이"/"확인" never match. */
const PATCH_WORDS = [
  '패치 만들어',
  '패치 생성',
  '패치로 만들어',
  'patch 만들어',
  'generate patch',
  'patchset 만들어',
  '다음 단계 진행',
];

static interpretPatchIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  return PATCH_WORDS.some((w) => t.includes(w));
}
```
Combined with the routing (patch generation only fires on an `APPROVED` anchor), this enforces CA's rule:
**explicit patch phrase + `APPROVED` anchor ⇒ generation; a bare "계속 진행" ⇒ never generation.**

The apply-preview routing block (currently `conversation-runtime.ts:402-422`) gains a patch-intent branch
between the `AWAITING_APPROVAL` interception and the apply-intent branch:
```ts
const applyAnchor = await this.deps.applyPreviewFlow.findAnchor(session);

// AWAITING_APPROVAL intercepts every turn (Sprint 2s) — unchanged, checked first.
if (applyAnchor?.status === 'AWAITING_APPROVAL') {
  return this.handleApplyApprovalTurn(message, session, actor, applyAnchor);
}

// (Sprint 2t) Explicit patch/continue command → PatchSet generation. Checked before apply-intent;
// PATCH_WORDS and APPLY_WORDS are non-overlapping, so order is safe either way, but patch-intent is a
// later product step so it takes precedence when both somehow matched.
if (ConversationRuntime.interpretPatchIntent(message.text)) {
  if (applyAnchor?.status === 'APPROVED') {
    return this.handlePatchGenerationTurn(message, session, actor, applyAnchor);
  }
  if (applyAnchor?.status === 'PATCH_READY') {
    return this.handlePatchAlreadyGeneratedTurn(message, session); // don't regenerate
  }
  // patch command with no APPROVED/PATCH_READY anchor (none / ELIGIBLE) — never falls through to a new
  // code-change request, mirroring Sprint 2s's apply-unavailable handling.
  return this.handlePatchUnavailableTurn(message, session);
}

// (Sprint 2s) Apply-intent branch — unchanged EXCEPT APPROVED|PATCH_READY both route to
// handleApplyAlreadyApprovedTurn (a PATCH_READY anchor is still "already approved" for apply purposes).
if (ConversationRuntime.interpretApplyIntent(message.text)) {
  if (applyAnchor?.status === 'ELIGIBLE') return this.handleApplyIntentTurn(message, session, actor, applyAnchor);
  if (applyAnchor?.status === 'APPROVED' || applyAnchor?.status === 'PATCH_READY') {
    return this.handleApplyAlreadyApprovedTurn(message, session);
  }
  return this.handleApplyPreviewUnavailableTurn(message, session);
}
// fall through untouched
```

### 5.5 `handlePatchGenerationTurn` — the main flow (APPROVED + patch command)

```ts
private async handlePatchGenerationTurn(
  message: InboundMessage,
  session: Session,
  actor: Actor,
  anchor: ApplyPreviewAnchor,
): Promise<TurnResult> {
  void actor; // no new decision recorded here — the approval was already decided in Sprint 2s
  // 1. Approved-context guards (CA Q3).
  if (!anchor.approvalId || !anchor.workspaceRef || !anchor.targetFiles.length || !anchor.codeProposalRef) {
    return this.failComposed(message, session, this.deps.composer.composePatchUnavailable(message.context));
  }
  const approval = await this.deps.approvals.get(anchor.approvalId);
  if (!approval || approval.status !== ('APPROVED' as ApprovalStatus)) {
    return this.failComposed(message, session, this.deps.composer.composePatchUnavailable(message.context));
  }

  // 2. Source of truth = the CodeProposal aggregate (CA Q4), never rendered diff text / chat memory.
  const proposal = await this.deps.codeProposals.get(anchor.codeProposalRef.id);
  if (!proposal) {
    return this.failComposed(message, session, this.deps.composer.composePatchUnavailable(message.context));
  }

  // 3. Re-filter against validated targetFiles (CA Q5) — targetFiles stays authoritative.
  const { inScope } = filterInScopeChanges(proposal.proposal, anchor.targetFiles);
  if (inScope.length === 0) {
    return this.failComposed(message, session, this.deps.composer.composePatchUnavailable(message.context));
  }

  // 4. Re-run WorkspaceManager.diff against CURRENT content (CA Q6) — staleness/add/binary/empty check.
  let diff: WorkspaceDiff;
  try {
    diff = await this.deps.workspace.diff(anchor.workspaceRef, inScope);
  } catch {
    this.logPatchGenerationFailed(session, anchor, 'workspace diff failed'); // CA Round 1 Required Change #4
    return this.failComposed(message, session, this.deps.composer.composePatchGenerationFailed(message.context));
  }
  // CA Q7: no PatchSet for empty / changeKind:add / binary / oversized(empty unified) results.
  const unrenderable =
    diff.files.length === 0 ||
    diff.files.some((f) => f.changeKind === 'add' || f.binary || !f.unified.trim());
  if (unrenderable) {
    this.logPatchGenerationFailed(session, anchor, 'unrenderable diff (empty/add/binary/oversized)');
    return this.failComposed(message, session, this.deps.composer.composePatchGenerationFailed(message.context));
  }

  // 5. Application derives the ApprovalRef; PatchManager receives it (CA Q2). generate() re-validates.
  let patchSet: PatchSet;
  try {
    patchSet = await this.deps.patch.generate({
      executionPlanRef: anchor.executionPlanRef,
      approvalRef: approvalRef(approval),
      changes: inScope,
      diff,
    });
  } catch {
    this.logPatchGenerationFailed(session, anchor, 'patch generation failed'); // CA Round 1 Required Change #4
    return this.failComposed(message, session, this.deps.composer.composePatchGenerationFailed(message.context));
  }

  // 6. Preserve PatchRef on the anchor for Sprint 2u (CA Q12) — re-anchor, never clear.
  await this.deps.applyPreviewFlow.anchor(session, { ...anchor, status: 'PATCH_READY', patchRef: patchRef(patchSet) });

  // 7. ResponseComposer renders the preview from PatchSet facts (CA Q9).
  const reply = this.deps.composer.composePatchSetPreview(message.context, {
    operations: patchSet.operations.map((op) => ({ path: op.path, kind: op.operation, unified: op.diff })),
  });
  await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
  return this.responded(session, reply);
}
```
**CA Round 1 Required Change #4 — structured failure log (no diff/file content):** each
`composePatchGenerationFailed` path first calls a small private helper so operators can trace *why*
generation failed without the user seeing internals and without leaking file/diff content:
```ts
private logPatchGenerationFailed(session: Session, anchor: ApplyPreviewAnchor, reason: string): void {
  this.deps.logger.warn('PatchSet generation failed', {
    reason,
    sessionId: session.id,
    executionPlanId: anchor.executionPlanRef.id,
    approvalId: anchor.approvalId,
    codeProposalId: anchor.codeProposalRef.id,
    targetFiles: anchor.targetFiles,
  }); // deliberately NO diff text / file content
}
```
`filterInScopeChanges`, `approvalRef`, `patchRef` are all existing exports, reused directly. The two other
handlers are trivial:
```ts
private async handlePatchAlreadyGeneratedTurn(message: InboundMessage, session: Session): Promise<TurnResult> {
  const reply = this.deps.composer.composePatchAlreadyGenerated(message.context);
  await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
  return this.responded(session, reply);
}
private async handlePatchUnavailableTurn(message: InboundMessage, session: Session): Promise<TurnResult> {
  const reply = this.deps.composer.composePatchUnavailable(message.context);
  await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
  return this.responded(session, reply);
}
```

### 5.6 `app.module.ts` — wire the two reused dependencies

The `ConversationRuntime` factory gains `patch: PatchManager` in its params + `inject` array (the provider
already exists, `app.module.ts:208-212`, already injected into `ExecutionOrchestrator` — reuse), and passes:
```ts
patch: patchManager,
codeProposals: { get: (id) => storage.codeProposals.get(id) },
```
`storage` is already the factory's first param (used for `projects.get`), so `storage.codeProposals` needs no
new injection. No new provider registration.

### 5.7 `ResponseComposer` — four new methods (reusing Sprint 2r's bounded rendering)

```ts
/** Display DTO for a generated PatchSet (Sprint 2t, ADR-0041) — Application-layer, not domain. Each entry
 *  is a PatchOperation reshaped for display; `unified` came from WorkspaceManager.diff, never AI text. */
export interface PatchSetPreview {
  operations: Array<{ path: string; kind: 'add' | 'update' | 'delete'; unified: string }>;
}
```
- `composePatchSetPreview(context, preview)` — success. Reuses the Sprint 2r budget-aware, backtick-safe
  block renderer (extract the reserved-budget assembly currently inside `composeCodeDiffPreview` into a
  shared private `renderBoundedDiffBody(header, footerLines, blocks)` and call it from both). **CA Round 1
  Required Change #3: the header uses "패치 미리보기" framing, never a bare "패치를 만들었어요" that a
  non-developer could read as "something was applied."** Header: `'패치 미리보기를 만들었어요. 아직 실제
  파일에는 적용하지 않았어요. 파일은 수정되지 않았어요.'`, footer: `'실제 파일 적용은 아직 지원하지 않아요.'`.
  **CA test 18/19: says files are not modified; never "적용했어요"/"반영했어요"/"수정했어요"/"변경 완료"/
  "적용 완료".**
- `composePatchUnavailable(context)` — no approved apply context to patch (CA Q3): `'패치를 만들 수 있는
  승인된 코드 변경이 없어요. 먼저 코드 변경을 요청하고 미리보기·적용 승인을 완료해 주세요.'`
- `composePatchGenerationFailed(context)` — approved, but the latest diff/generation couldn't be built
  cleanly (CA Q7 — stale/add/binary/empty/throw): `'승인된 변경으로 패치를 만들지 못했어요. 파일 내용이
  바뀌었거나 표시할 수 없는 변경일 수 있어요. 파일은 수정되지 않았어요.'`
- `composePatchAlreadyGenerated(context)` — `PATCH_READY` + repeated command: `'이미 패치를 만들어 뒀어요.
  아직 실제 파일 적용은 하지 않았어요. 파일은 수정되지 않았어요.'`

Reused unchanged: `fenceFor`, `clampDiffText`, `clampToMessageBudget`/`MAX_MESSAGE_CHARS`, the reserved-budget
assembly (factored into the shared helper). No out-of-scope warning line is needed in the success preview
(out-of-scope changes are dropped before `generate`, and a PatchSet only ever contains in-scope operations);
if the implementation prefers, the dropped-paths list can be surfaced the same way Sprint 2r does — decided
at implementation, not required.

## 6. Required Architecture Questions — answers for CA review

**Q1. What is the current Patch capability API?** Documented from source in §2: `PatchManager.generate/get/
findByExecutionPlan`; `PatchGenerationInput {executionPlanRef, approvalRef, changes, diff}`; `PatchSet`/
`PatchOperation`/`PatchRef`/`patchRef()`; `PatchStatus.GENERATED` (only value); approval validated off the
passed `ApprovalRef` (never loaded); persists via `storage.patches.save`; imports no other capability manager.

**Q2. Where does the approved `ApprovalRef` come from?** `anchor.approvalId → approvals.get(approvalId) →
verify status APPROVED → approvalRef(request)` (§5.3). Application loads the `ApprovalRequest`; `PatchManager`
receives only the derived `ApprovalRef` and never queries `ApprovalManager`.

**Q3. What if the apply anchor is not APPROVED?** No PatchSet, `composePatchUnavailable`, no mutation. Cases
covered by routing + guards: no anchor / `ELIGIBLE` → `handlePatchUnavailableTurn`; `AWAITING_APPROVAL` → the
Sprint 2s approval-turn interception runs first (patch-intent never reached); `APPROVED` but missing
`approvalId` / `approvalId` not found / approval not APPROVED → `handlePatchGenerationTurn`'s guards →
`composePatchUnavailable` (§5.5 steps 1).

**Q4. What is the source of proposal content?** The `CodeProposal` aggregate loaded via
`codeProposals.get(anchor.codeProposalRef.id)` (§5.5 step 2). Never rendered diff text, conversation memory,
or unfiltered AI paths.

**Q5. How is target scope preserved?** `filterInScopeChanges(proposal.proposal, anchor.targetFiles)` (§5.5
step 3) — the same normalized-exact-match filter Sprint 2o/2q/2r use; `targetFiles` stays authoritative and
out-of-scope AI paths never reach `WorkspaceManager.diff` or `PatchManager.generate`.

**Q6. Does latest workspace content need to be revalidated?** Yes (CA-recommended). §5.5 step 4 re-runs
`WorkspaceManager.diff(workspaceRef, inScope)` against current content immediately before generation — this
is the staleness/add/binary/empty check.

**Q7. What happens if the latest diff cannot be generated cleanly?** No PatchSet,
`composePatchGenerationFailed`, no mutation. Covered: `workspace.diff` throws; `diff.files` empty; any
`changeKind: 'add'`; any binary; any empty `unified` (oversized/size-skipped). Binary/oversized are
explicitly rejected for the **whole** set this sprint (CA Q7 recommendation) — a PatchOperation carrying an
unrenderable diff would be unsafe for a future WorkspaceWrite.

**Q8. What does PatchSet represent?** The existing `PatchSet` — `operations: PatchOperation[]` (each `{path,
operation, diff (unified), metadata?}`), `executionPlanRef`, `approvalRef`, `status: GENERATED`. No parallel
patch DTO invented; the display-only `PatchSetPreview` (§5.7) is a narrow Application-layer projection for
rendering, not a domain type.

**Q9. Who renders user-facing text?** `ResponseComposer` (§5.7). `ConversationRuntime` passes only the
reshaped operation facts; it composes no text itself.

**Q10. Does `ExecutionOrchestrator` change?** No. Nothing in this sprint calls `deps.orchestrator.run`/
`.resume`; no new `ExecutionStage`.

**Q11. How do we prove no mutation?** Tests (§8): `workspaceWrite.apply`/`command.run` call counts `0`,
no git write, no filesystem write. Structurally the handler only calls `approvals.get`, `codeProposals.get`,
`workspace.diff`, `filterInScopeChanges`, `patch.generate`, `applyPreviewFlow.anchor`, `composer`, `memory`
— none mutate files. `patch.generate` persisting a `PatchSet` is representation storage, explicitly allowed.

**Q12. What is the handoff to future Apply Sprint (2u)?** After generation, the apply anchor is `PATCH_READY`
carrying `patchRef` **plus** every prior ref (`executionPlanRef`, `workspaceRef`, `targetFiles`,
`codeProposalRef`, `approvalId`). Sprint 2u consumes: `PATCH_READY` anchor → `patchRef` (+ the approved
`ApprovalRef` re-derivable from `approvalId`) → future `WorkspaceWrite`. The `PATCH_READY` state is the one
new anchor state, justified precisely by this handoff + repeat-command idempotency (§5.1).

## 7. Case matrix

| Case | Detection | Result |
|---|---|---|
| 1. "패치 만들어줘" / "계속 진행해" / "다음 단계 진행해" with an `APPROVED` anchor | patch words match, `status === 'APPROVED'`, all guards pass | `PatchManager.generate` → PatchSet, anchor → `PATCH_READY` (+`patchRef`), `composePatchSetPreview` |
| 2. Patch command with no anchor | `findAnchor` → `null` | `composePatchUnavailable`, no generation |
| 3. Patch command, anchor `ELIGIBLE` | `status === 'ELIGIBLE'` | `composePatchUnavailable`, no generation |
| 4. Patch command, anchor `AWAITING_APPROVAL` | intercepted by the Sprint 2s approval-turn branch first | approval decision handling — patch-intent never reached |
| 5. `APPROVED` anchor missing `approvalId` | guard | `composePatchUnavailable` |
| 6. `approvalId` not found | `approvals.get` → `null` | `composePatchUnavailable` |
| 7. Approval not APPROVED | `approval.status !== APPROVED` | `composePatchUnavailable` |
| 8. `CodeProposal` not found | `codeProposals.get` → `null` | `composePatchUnavailable` |
| 9. Proposal all out-of-scope | `filterInScopeChanges` → `inScope.length === 0` | `composePatchUnavailable`; `workspace.diff`/`patch.generate` never called |
| 10. `workspace.diff` throws | caught | `composePatchGenerationFailed` |
| 11. `diff.files` empty / any `changeKind: 'add'` / any binary / any empty `unified` | `unrenderable` guard | `composePatchGenerationFailed`; `patch.generate` never called |
| 12. `patch.generate` throws (defensive) | caught | `composePatchGenerationFailed` |
| 13. Patch command while anchor `PATCH_READY` | `status === 'PATCH_READY'` | `composePatchAlreadyGenerated` — no regeneration |
| 14. Apply command ("적용해줘") while `APPROVED`/`PATCH_READY` | apply-intent branch | `handleApplyAlreadyApprovedTurn` (unchanged Sprint 2s wording) |
| 15. Ordinary chat / "좋아" with any anchor | no patch/apply words | falls through untouched |

## 8. Required Tests (Node 22) — mapped to the CA's 27-item list

**`conversation-runtime.test.ts`**:
1. Explicit "패치 만들어줘" (and "계속 진행해", "다음 단계 진행해") with an `APPROVED` anchor generates a
   PatchSet preview (`patch.generate` called once) and re-anchors `PATCH_READY`.
2. Patch command with no anchor → `composePatchUnavailable`, `patch.generate` call count `0`.
3. `ELIGIBLE` anchor + patch command → `composePatchUnavailable`, no generation.
4. `AWAITING_APPROVAL` anchor + any message → the Sprint 2s approval branch handles it (patch-intent never
   reached; `patch.generate` `0`).
5. `APPROVED` anchor missing `approvalId` → no generation, `composePatchUnavailable`.
6. `approvalId` not found (`approvals.get` → null) → no generation.
7. approval loaded but not APPROVED → no generation.
8. `CodeProposal` not found → no generation.
9. proposal all out-of-scope → `workspace.diff` never called, no generation.
10. an out-of-scope proposal path is never included in the `changes` passed to `patch.generate` (mixed
    in-scope/out-of-scope → only the validated path reaches `generate`).
11. `workspace.diff` is re-run before `patch.generate` (assert call order / that `workspace.diff` was called
    with the in-scope changes).
12. `workspace.diff` throws → no generation, `composePatchGenerationFailed`.
12a. **(CA Round 1 Required Change #5)** a `changes` path with no matching `diff.files` entry makes
    `patch.generate` throw (`no diff found for proposed change`) → the runtime catches it and returns
    `composePatchGenerationFailed` (fixes this failure path at the runtime level, not only in
    `patch-manager.test.ts`).
13. `diff.files` empty → no generation.
14. `diff` contains `changeKind: 'add'` → no generation.
15. binary diff → no generation; empty `unified` (oversized) → no generation (the plan's decided handling).
16. `patch.generate` receives an `ApprovalRef` (`{id, status, executionPlanRef}`), **not** an
    `ApprovalRequest` — assert the input shape.
17. `patch.generate` runs without the runtime ever calling an `ApprovalManager`-query beyond `approvals.get`
    in the Application layer (structural: the fake `patch.generate` never receives/needs approvals access).
18. the PatchSet preview text states files are not modified.
19. the PatchSet preview text never says applied/changed/completed (forbidden-word assertion).
20. after generation the anchor is `PATCH_READY` and carries `patchRef` plus every prior ref.
21. no `workspaceWrite.apply` call across the full sequence.
22. no `command.run` call across the full sequence.
23. no git operation across the full sequence (structural — no git dep reachable).
24. no filesystem write (structural — the runtime has no filesystem dep on this path).
25. no `ExecutionOrchestrator.run`/`.resume` call from patch generation.
26. `PATCH_READY` + repeat patch command → `composePatchAlreadyGenerated`, `patch.generate` call count stays
    at 1 (no regeneration); apply command while `PATCH_READY` → `handleApplyAlreadyApprovedTurn`.
27. "좋아"/"오케이"/"확인" and ordinary chat with an `APPROVED` anchor do **not** trigger patch generation.

**`response-composer.test.ts`** (new cases): `composePatchSetPreview` (lists operation paths + a bounded
diff, says not-modified at least twice, no forbidden mutation words, backtick-safe, stays within
`MAX_MESSAGE_CHARS`); `composePatchUnavailable` / `composePatchGenerationFailed` /
`composePatchAlreadyGenerated` (distinct wording, none imply completion).

**Node 22**: `pnpm typecheck` + `pnpm test` green.

## 9. Architecture Impact / Reuse

- **Reuses, unchanged:** `PatchManager`/`PatchSet`/`PatchOperation`/`PatchRef`/`patchRef()` (CAP-005,
  ADR-0026, zero changes), `ApprovalRef`/`approvalRef()`/`ApprovalManager.get` (CAP-004, zero changes),
  `CodeProposal` + `storage.codeProposals` (CAP-008, zero changes), `WorkspaceManager.diff` (CAP-001, zero
  changes), `filterInScopeChanges` (Sprint 2r), `StatelessApplyPreviewFlow` (Sprint 2s — no logic change,
  only the anchor type it stores gains a status/field), Sprint 2r's bounded/backtick-safe diff renderer
  (factored into a shared private helper).
- **Changes:** `conversation-runtime.ts` (+`PATCH_READY` status & `patchRef` on `ApplyPreviewAnchor`, +2 new
  `ConversationRuntimeDeps` fields, +`PATCH_WORDS` + `interpretPatchIntent`, +1 routing branch, +3 handlers),
  `response-composer.ts` (+1 display DTO `PatchSetPreview`, +4 methods, +1 extracted shared helper),
  `app.module.ts` (+`PatchManager` param/inject + `codeProposals` passthrough, no new provider).
- **No new** aggregate / repository / migration / capability / port. **No** `Core` or `ExecutionOrchestrator`
  contract change. `PatchManager` stays representation-only and never learns about `ApprovalManager`.
- **ADR-0041** (to be authored before implementation) must document: Patch capability reused representation-
  only; Application derives the `ApprovalRef`, `PatchManager` receives it and never queries `ApprovalManager`;
  `CodeProposal` (not rendered diff) is the content source; `targetFiles` stays authoritative via
  `filterInScopeChanges`; latest content is re-validated via `WorkspaceManager.diff` before generation;
  binary/oversized/add/empty/stale → no PatchSet; the `PATCH_READY` anchor state + preserved `patchRef` as the
  Sprint 2u handoff; still no `WorkspaceWrite`/`CommandExecution`/file/git mutation; no `ExecutionOrchestrator`
  or `Core` change. **Per CA Round 1 it must additionally state explicitly: `PATCH_READY` means "PatchSet
  representation exists," NOT applied/ready-to-apply (no file/command/git mutation); the `PATCH_WORDS` trigger
  excludes the ambiguous standalone "계속 진행"; the success wording is "패치 미리보기" framing; and generation
  failures are logged (structured, no diff/file content) for operability.**

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| PatchSet generated from stale content that no longer matches the file | Med (Safety) | `WorkspaceManager.diff` re-run against current content immediately before generation; stale→`add`/empty/throw all reject (§5.5 step 4, CA Q6) — tested (§8 12-15) |
| An out-of-scope AI path reaches `PatchManager` | Med (Safety) | `filterInScopeChanges` before diff/generate; only validated `targetFiles` paths pass — tested (§8 10) |
| A binary/oversized change produces an unapplyable PatchOperation | Med | Whole-set rejection for any binary/empty-unified/add file this sprint (CA Q7) — tested (§8 15) |
| Users read "패치를 만들었어요" as "applied" | Med (Product) | Wording repeats "not applied"/"not modified", forbidden-word discipline from ADR-0038/0039/0040 — tested (§8 18-19) |
| A repeated patch command regenerates a duplicate PatchSet | Low | `PATCH_READY` short-circuits to `composePatchAlreadyGenerated`; no regeneration — tested (§8 26) |
| `PatchManager` accidentally coupled to `ApprovalManager` | Low | Application derives+passes `ApprovalRef`; `PatchManager` unchanged, imports no manager (§2, CA Q2) — tested (§8 16-17) |
| Reviewers expect this sprint to also apply the patch | Low | Explicitly out of scope (§4, CA direction) — Sprint 2u consumes the `PATCH_READY` handoff |

## Next Step

**Plan changes applied — CA Round 1's 5 required changes incorporated above** (`PATCH_READY` meaning
narrowed; `PATCH_WORDS` tightened to explicit patch phrases only; `composePatchSetPreview` "패치 미리보기"
wording; structured generation-failure log with no diff/file content; runtime test for the diff/path
mismatch failure). Per the approved sequence: (1) plan changes applied (this document); (2) author ADR-0041
next; (3) implement exactly this scope (§3/§5) on a `v2/<topic>` branch; (4) add/update tests per §8;
(5) validate on **Node 22**; (6) open a PR for Chief Architect Implementation Review. No commit/PR made yet.
