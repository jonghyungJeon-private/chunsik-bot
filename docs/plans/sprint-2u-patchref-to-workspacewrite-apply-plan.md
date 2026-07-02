# Sprint 2u Plan — PatchRef → WorkspaceWrite Apply (first real file mutation, WorkspaceWrite only)

- **Status:** ✅ APPROVED WITH CHANGES (Chief Architect Review, Round 1) — required changes applied below;
  implementing this scope next.
- **Base:** `main` @ `9d4f23f` · **Validation runtime:** Node 22 (to be run at implementation time).
- **Directed by:** Chief Architect (this sprint's topic is CA-assigned, not Claude-proposed).
- **Goal:** When a `PATCH_READY` apply anchor (Sprint 2t) exists and the user gives an **explicit final
  workspace-apply command** ("패치 적용해줘", "파일에 적용해줘", "최종 적용해줘"), recover the `PatchSet`
  by `patchRef`, verify its integrity, and apply it to workspace files through the existing
  **WorkspaceWrite** capability (CAP-006) — the **first real file mutation** in the product. Still no git
  mutation, no `CommandExecution`, no test execution, no `ExecutionOrchestrator` change.
- **Phase:** Phase 2 — Product Construction (eleventh runtime sprint, after 2k–2t). **Not** a new
  capability — reuses `WorkspaceWriteManager`/`WorkspaceChange` (CAP-006, ADR-0027) exactly as built,
  plus the Sprint 2t `PATCH_READY` anchor and `PatchManager.get`.
- **Process:** V2 architecture-first, step 1 (plan-only). No implementation, no branch, no commit, no PR.

> **Framing.** Every mutation-side piece already exists and was verified by reading the code (CA Q1's
> "do not guess"). `WorkspaceWriteManager.apply({patchSet, approvalRef, workspaceRef})` is Ref-gated (no
> `ApprovalManager` query), delegates file writes to the `WorkspaceWriter` port, and persists a
> `WorkspaceChange` aggregate — and critically, `LocalWorkspaceWriter.applyOperation` applies each
> operation's unified diff to the **current** file via `applyPatch`, recording `failed` (file left
> untouched) when it no longer applies cleanly. That built-in per-file conflict detection **is** the
> latest-content revalidation this sprint needs (CA Q6). So this sprint is composition: recover the
> `PatchSet` → verify integrity → hand it, with its own approvalRef and the workspaceRef, to
> `WorkspaceWrite`. Proceeding with extreme boundary discipline: WorkspaceWrite is the only thing that
> touches a file; git, tests, and command execution are untouched.

---

## 1. Objective

After Sprint 2t leaves an apply anchor at `PATCH_READY` (carrying `patchRef`, `executionPlanRef`,
`workspaceRef`, `targetFiles`, `approvalId`), a later turn with an **explicit final workspace-apply
command** drives `ConversationRuntime` to:
1. confirm the anchor is `PATCH_READY` and carries a `patchRef`;
2. load the `PatchSet` via `patch.get(patchRef.id)`;
3. verify PatchSet integrity — `id === anchor.patchRef.id` (CA Round 1 #2), `status === GENERATED`,
   `approvalRef.status === APPROVED`, `approvalRef.id === anchor.approvalId`, `executionPlanRef.id ===
   anchor.executionPlanRef.id`, exactly one operation (single-file this sprint), the single op is
   `operation === 'update'` (CA Round 1 #1 — `add`/`delete`/binary all rejected), and its `path`
   normalizes to one of `anchor.targetFiles` (CA Round 1 #2);
4. apply it via `workspaceWrite.apply({patchSet, approvalRef: patchSet.approvalRef, workspaceRef})` —
   WorkspaceWrite's per-file `applyPatch` re-validates the `update` diff against current content and
   records `failed` (file untouched) on a stale/conflicting diff (this IS the revalidation, CA Round 1 #4);
5. interpret the returned `WorkspaceChange` — success requires `status === APPLIED` **and** a full
   result-integrity match (CA Round 1 #3: `patchRef.id`/`approvalRef.id`/`executionPlanRef.id`/
   `workspaceRef.id` all match, `results.length === 1`, `results[0].status === 'applied'`,
   `results[0].path === patchSet.operations[0].path`). On success re-anchor `WORKSPACE_APPLIED` with the
   `workspaceChangeRef`; on any mismatch or non-APPLIED status → no re-anchor, safe failure (file may be
   unchanged on a stale `FAILED`);
6. render a result that says the workspace file was modified, **git commands were not run, commit/push
   were not performed, tests were not run** (CA Round 1 #5 — never "git 변경 없음").

Any failure at steps 1–4 (wrong state, missing/invalid PatchSet, unsupported op, write throw, non-APPLIED
result) yields a safe "cannot apply"/"nothing to apply" reply — WorkspaceWrite is never called except on
a fully-valid `PATCH_READY` + explicit final-apply turn.

## 2. Central finding — WorkspaceWrite is the built, Ref-gated, conflict-detecting mutation capability

**Verified against source (CA Q1 — "do not guess"):**
- `WorkspaceWriteManager` (`workspace-write-manager.ts:29-116`): `constructor(storage: StorageProvider,
  writer: WorkspaceWriter)` — depends on `StorageProvider` + the `WorkspaceWriter` port, **imports no
  `ApprovalManager`**. `apply(input: ApplyInput): Promise<WorkspaceChange>` (`:41`) validates
  `approvalRef.status === APPROVED` (`:45`) and `approvalRef.executionPlanRef.id ===
  patchSet.executionPlanRef.id` (`:48`) — Ref-only, no `ApprovalManager` query (CA Q7). It delegates each
  op to `this.writer.applyOperation(workspaceRef, op)` (`:93`) and persists a `WorkspaceChange` via
  `storage.workspaceChanges.save` (`:105`). `get(id)`/`findByPatchSet(id)` also exist.
- `ApplyInput` (`workspace-change.ts:68-72`): `{ patchSet: PatchSet; approvalRef: ApprovalRef;
  workspaceRef: WorkspaceRef }` — takes the **full immutable PatchSet**, not `PatchOperation[]`.
- **Atomic unit = file, best-effort across files, no cross-file rollback** (CA Q9). `deriveStatus`
  (`:14-19`): all applied → `APPLIED` (empty → `APPLIED`); zero applied → `FAILED`; else
  `PARTIALLY_APPLIED`. Per-file `FileChangeResult {path, operation, status: 'applied'|'failed'|'skipped',
  message, durationMs}` (`workspace-change.ts:15-23`), all recorded on the aggregate.
- **Idempotent by `WorkspaceChange.status`** (`:57-68`): a `patchHash = contentHash(JSON.stringify(
  patchSet.operations))` keys the change; an already-`APPLIED` PatchSet is a no-op return; a different
  revision on the same PatchSet id throws.
- `LocalWorkspaceWriter.applyOperation` (`workspace-local/src/index.ts:416-448`): binary
  (`op.metadata.binary === true`) → `skipped`; `delete` → `unlinkSync` if present → `applied`; add/update
  → reads current, `applyPatch(current, op.diff)`, **`false` → `failed` "unified diff did not apply
  cleanly" (file left unchanged)**; atomic write = temp + `renameSync`; sandboxed via `resolveWithin`
  (rejects `..`/absolute/symlink escape); all errors caught → `failed`. **This per-file `applyPatch`
  against current content is the latest-content/conflict check (CA Q6).**
- `WorkspaceChange`/`WorkspaceChangeRef`/`workspaceChangeRef()` (`workspace-change.ts:31-61`),
  `WorkspaceChangeStatus` (`enums.ts:148-154`: PENDING/APPLYING/APPLIED/PARTIALLY_APPLIED/FAILED),
  `storage.workspaceChanges` (`storage-provider.port.ts:111`).
- `PatchManager.get(id): Promise<PatchSet | null>` exists (`patch-manager.ts:70`). **Gap:**
  `ConversationRuntimeDeps.patch` is `{ generate }` only — Sprint 2u must widen it with `get`.
- `WorkspaceWriteManager` is **already a registered provider** (`app.module.ts:214-219`) and **already
  injected into `ExecutionOrchestrator`** as `workspaceWrite` (`:290/:309`) — reuse, not new registration.

**Consequence: no new capability, port, aggregate, migration, or `ExecutionOrchestrator` change.** The
only wiring gaps are on `ConversationRuntime`: add a `workspaceWrite` dep, widen `patch` with `get`, and
add a `WORKSPACE_APPLIED` anchor state (+ `workspaceChangeRef?`).

## 3. Scope (this sprint)

- **`ApplyPreviewAnchor` gains a `WORKSPACE_APPLIED` status and a `workspaceChangeRef?: WorkspaceChangeRef`
  field** (§5.1) — CA Q8's preferred name (avoids implying committed/tested/deployed): it means workspace
  files were mutated; git/tests were **not** run. `StatelessApplyPreviewFlow` needs no logic change
  (`WORKSPACE_APPLIED` falls to the existing `PENDING` inert-anchor mapping alongside PATCH_READY).
- **`ConversationRuntimeDeps` gains one dependency and widens one** (§5.2): `workspaceWrite: {
  apply(input: ApplyInput): Promise<WorkspaceChange> }` (the existing `WorkspaceWriteManager`), and
  `patch` gains `get(id): Promise<PatchSet | null>` (the existing `PatchManager.get`). Both satisfied by
  already-registered instances; `app.module.ts` wires `WorkspaceWriteManager` (§5.6).
- **New explicit final-apply detection**, `ConversationRuntime.interpretFinalApplyIntent(text)`, using a
  dedicated `FINAL_APPLY_WORDS` list (`['최종 적용', '파일에 적용', '패치 적용', 'workspace에 적용', 'apply
  patch', 'apply to workspace']`) **distinct from** `APPROVE_WORDS`/`APPLY_WORDS`/`PATCH_WORDS` (§5.4).
  All are qualified multi-word phrases — a bare "적용"/"좋아"/"오케이"/"확인"/"다음 단계 진행" never triggers
  a file write (CA Q3).
- **`handle()` routing** (§5.4): a new final-apply branch, checked **after** the `AWAITING_APPROVAL`
  interception and **before** patch-intent and apply-intent (so "패치 적용해줘", which also contains the
  apply-word "적용", routes to file-apply, not to Sprint 2s's apply-intent).
- **`handleWorkspaceApplyTurn`** (the main flow, §5.5), plus `handleWorkspaceAlreadyAppliedTurn`
  (`WORKSPACE_APPLIED` + final-apply → don't re-apply) and `handleWorkspaceApplyUnavailableTurn`
  (final-apply with no `PATCH_READY`/`WORKSPACE_APPLIED` anchor, or `PATCH_READY` without `patchRef`).
- **Four new `ResponseComposer` methods** (§5.7): `composeWorkspaceApplied`,
  `composeWorkspaceApplyUnavailable` (CA Q4), `composeWorkspaceApplyFailed` (CA Q5/Q6/write failure),
  `composeWorkspaceAlreadyApplied`.
- **Single-file, `update`-only this sprint (CA Q9 + CA Round 1 #1):** a PatchSet is rejected before any
  write unless it has **exactly one** operation whose `operation === 'update'`. This rejects multi-op
  (no partial-apply ambiguity), `add`/new-file, `delete` (the writer's delete path does not validate the
  diff against current content — too risky for the first mutation sprint), and binary. Stated explicitly.
- **Identity + scope checks before write (CA Round 1 #2):** `patchSet.id === anchor.patchRef.id` and the
  single op's `path` normalizes (via `normalizeRelativePath`) to one of `anchor.targetFiles` — a PatchSet
  outside the user-approved scope never reaches WorkspaceWrite.
- **Result-integrity checks after write (CA Round 1 #3):** the returned `WorkspaceChange` must fully match
  the applied artifact/context (patchRef/approvalRef/executionPlanRef/workspaceRef ids, single `applied`
  result on the expected path) before `WORKSPACE_APPLIED` is set — defensive, appropriate for the first
  mutation sprint.
- Tests for all of the above (§8), including the CA's 49 explicitly required test items.

## 4. Non-goals (explicit, per Chief Architect direction)

No implementation before plan approval · no branch/commit/PR beyond this plan-only step · `git add`/
`commit`/`push` (or any git call) · `CommandExecution` · test execution after apply · `pnpm test`/
`pnpm typecheck`/any shell command · autonomous agent loop · retry loop · AI regeneration · AI
target-file guessing · multi-file selection / multi-op apply · directory/module scope · semantic
repository search · repository indexing · new-file creation/`changeKind:add`/`add` operations · binary
operations · applying an unapproved PatchSet · applying without a `PATCH_READY` anchor · applying from a
stale/mismatched context (rejected via WorkspaceWrite's clean-apply check) · `ExecutionOrchestrator`
stage change · `Core` contract change · `PatchManager` gaining apply behavior · treating apply success as
git success.

## 5. Design

### 5.1 `ApplyPreviewAnchor` — one new status, one new field

```ts
export type ApplyPreviewAnchorStatus =
  | 'ELIGIBLE'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'PATCH_READY'
  /**
   * Workspace files were mutated by WorkspaceWrite (a workspaceChangeRef is available). CA Round 1 #6:
   * this does NOT mean committed, pushed, deployed, verified by tests, or that the working tree is clean
   * — no git command was run, no test/command ran, and the working tree now holds the applied change.
   */
  | 'WORKSPACE_APPLIED';

export interface ApplyPreviewAnchor {
  // ...existing fields (kind, status, executionPlanRef, workspaceRef, targetFiles, codeGenerationRef,
  //    codeProposalRef, instruction, projectId?, createdAt, approvalId?, approvedAt?, patchRef?) ...
  /** Set once `status` becomes `WORKSPACE_APPLIED` (Sprint 2u, ADR-0042) — the WorkspaceChange record of
   *  the file mutation, preserved for a future git/test sprint. Files mutated; git/tests NOT run. */
  workspaceChangeRef?: WorkspaceChangeRef;
}
```
`WORKSPACE_APPLIED` never regresses. `StatelessApplyPreviewFlow.anchor`'s status→`TaskStatus` mapping only
special-cases `AWAITING_APPROVAL`; `WORKSPACE_APPLIED` falls to the existing inert `PENDING` case — no
change to that file.

### 5.2 `ConversationRuntimeDeps` — one new dependency, one widened

```ts
/** Reused for the first real file mutation (Sprint 2u, ADR-0042) — the same already-registered
 *  WorkspaceWriteManager ExecutionOrchestrator already depends on. The ONLY thing that mutates files. */
readonly workspaceWrite: { apply(input: ApplyInput): Promise<WorkspaceChange> };
readonly patch: {
  generate(input: PatchGenerationInput): Promise<PatchSet>;
  /** Load the generated PatchSet from anchor.patchRef (Sprint 2u) — PatchManager.get already exists;
   *  a type-only widening, not a new method. */
  get(id: Id): Promise<PatchSet | null>;
};
```

### 5.3 What is applied, and where the ApprovalRef comes from (CA Q2/Q7)

The artifact is the **PatchSet** loaded via `patch.get(anchor.patchRef.id)` — never the AI `CodeProposal`,
rendered diff text, chat memory, or `workspace.diff` output (CA Q2). The `ApprovalRef` handed to
WorkspaceWrite is the **PatchSet's own embedded `approvalRef`** — it is the exact approval that authorized
this patch, captured at generation time (Sprint 2t), plan-scoped and carrying its status. The handler
verifies `patchSet.approvalRef.status === APPROVED` and `patchSet.approvalRef.id === anchor.approvalId`
before use, so no `ApprovalManager` load is needed on this path at all (stronger than CA Q7's "don't let
WorkspaceWrite query ApprovalManager" — nothing on the apply path queries it). `WorkspaceWriteManager`
then independently re-validates `approvalRef.status` + plan-scope (`workspace-write-manager.ts:45-53`).

### 5.4 `handle()` routing + explicit final-apply detection

```ts
/** Explicit final workspace-apply phrases (Sprint 2u, ADR-0042) — distinct from APPROVE_WORDS,
 *  APPLY_WORDS, and PATCH_WORDS. Every entry is a QUALIFIED apply phrase; a bare "적용"/"반영"/"좋아"/
 *  "오케이"/"확인"/"다음 단계 진행" never matches (CA Q3 — actual file mutation needs clearer wording than
 *  the Sprint 2s/2t triggers). No overlap with PATCH_WORDS; checked before APPLY_WORDS so "패치 적용해줘"
 *  (which also contains the apply-word "적용") routes to file-apply, not to Sprint 2s apply-intent. */
const FINAL_APPLY_WORDS = ['최종 적용', '파일에 적용', '패치 적용', 'workspace에 적용', 'apply patch', 'apply to workspace'];

static interpretFinalApplyIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  return FINAL_APPLY_WORDS.some((w) => t.includes(w));
}
```

The apply-preview routing block gains a final-apply branch **first among the intent checks**:
```ts
const applyAnchor = await this.deps.applyPreviewFlow.findAnchor(session);

// AWAITING_APPROVAL intercepts every turn (Sprint 2s) — unchanged, checked first.
if (applyAnchor?.status === 'AWAITING_APPROVAL') {
  return this.handleApplyApprovalTurn(message, session, actor, applyAnchor);
}

// (Sprint 2u) Explicit final workspace-apply → the first real file mutation. Checked before patch- and
// apply-intent (FINAL_APPLY_WORDS is non-overlapping with PATCH_WORDS, and precedes APPLY_WORDS so
// "패치 적용해줘" is a file-apply, not a Sprint 2s apply-intent).
if (ConversationRuntime.interpretFinalApplyIntent(message.text)) {
  if (applyAnchor?.status === 'PATCH_READY') {
    return this.handleWorkspaceApplyTurn(message, session, applyAnchor);
  }
  if (applyAnchor?.status === 'WORKSPACE_APPLIED') {
    return this.handleWorkspaceAlreadyAppliedTurn(message, session); // never re-applies
  }
  // no anchor / ELIGIBLE / APPROVED / PATCH_READY-without-patchRef — never a new code-change request.
  return this.handleWorkspaceApplyUnavailableTurn(message, session);
}

// (Sprint 2t) patch-intent. CA Round 1 #8: at WORKSPACE_APPLIED, do NOT reply "이미 패치 미리보기를
// 만들어 뒀어요" (that hides the stronger applied state) — route to the workspace-already-applied reply.
if (ConversationRuntime.interpretPatchIntent(message.text)) {
  if (applyAnchor?.status === 'APPROVED') return this.handlePatchGenerationTurn(message, session, applyAnchor);
  if (applyAnchor?.status === 'PATCH_READY') return this.handlePatchAlreadyGeneratedTurn(message, session);
  if (applyAnchor?.status === 'WORKSPACE_APPLIED') return this.handleWorkspaceAlreadyAppliedTurn(message, session);
  return this.handlePatchUnavailableTurn(message, session);
}

// (Sprint 2s) apply-intent. At WORKSPACE_APPLIED, handleApplyAlreadyApprovedTurn would falsely say
// "아직 실제 파일 적용은 수행하지 않았어요" — so WORKSPACE_APPLIED routes to the applied reply instead.
if (ConversationRuntime.interpretApplyIntent(message.text)) {
  if (applyAnchor?.status === 'ELIGIBLE') return this.handleApplyIntentTurn(message, session, actor, applyAnchor);
  if (applyAnchor?.status === 'APPROVED' || applyAnchor?.status === 'PATCH_READY') {
    return this.handleApplyAlreadyApprovedTurn(message, session);
  }
  if (applyAnchor?.status === 'WORKSPACE_APPLIED') return this.handleWorkspaceAlreadyAppliedTurn(message, session);
  return this.handleApplyPreviewUnavailableTurn(message, session);
}
// fall through untouched
```

### 5.5 `handleWorkspaceApplyTurn` — the main flow (PATCH_READY + explicit final-apply)

```ts
private async handleWorkspaceApplyTurn(
  message: InboundMessage,
  session: Session,
  anchor: ApplyPreviewAnchor,
): Promise<TurnResult> {
  // 1. Anchor-state guard (CA Q4): PATCH_READY must carry a patchRef + the refs we need.
  if (!anchor.patchRef || !anchor.workspaceRef || !anchor.approvalId || !anchor.executionPlanRef) {
    return this.failComposed(message, session, this.deps.composer.composeWorkspaceApplyUnavailable(message.context));
  }

  // 2. Load the PatchSet — the artifact to apply (CA Q2).
  const patchSet = await this.deps.patch.get(anchor.patchRef.id);
  if (!patchSet) {
    this.logWorkspaceApplyFailed(session, anchor, 'patch set not found');
    return this.failComposed(message, session, this.deps.composer.composeWorkspaceApplyFailed(message.context));
  }

  // 3. PatchSet integrity (CA Q5 + CA Round 1 #1/#2). Any failure → no WorkspaceWrite. Sprint 2u accepts
  //    exactly one `update` op whose path is within the user-approved targetFiles; add/delete/binary/
  //    multi-op are all rejected.
  const op = patchSet.operations[0];
  const badIntegrity =
    patchSet.id !== anchor.patchRef.id ||                                   // CA #2: identity
    patchSet.status !== PatchStatus.GENERATED ||
    patchSet.approvalRef.status !== ApprovalStatus.APPROVED ||
    patchSet.approvalRef.id !== anchor.approvalId ||
    patchSet.executionPlanRef.id !== anchor.executionPlanRef.id ||
    patchSet.operations.length !== 1 ||                                     // CA Q9: single-file only
    !op ||
    op.operation !== 'update' ||                                            // CA #1: update ONLY (no add/delete)
    op.metadata?.['binary'] === true ||                                     // no binary
    !anchor.targetFiles.some((tf) => normalizeRelativePath(tf) === normalizeRelativePath(op.path)); // CA #2: scope
  if (badIntegrity) {
    this.logWorkspaceApplyFailed(session, anchor, 'patch set failed integrity/support checks');
    return this.failComposed(message, session, this.deps.composer.composeWorkspaceApplyFailed(message.context));
  }

  // 4. Apply through WorkspaceWrite — the ONLY file mutation. Its per-file applyPatch re-validates the
  //    `update` diff against current content (CA Round 1 #4): a stale diff → FileChangeResult 'failed',
  //    file left unchanged. WorkspaceWrite IS the revalidation — no separate Application-layer re-diff.
  let change: WorkspaceChange;
  try {
    change = await this.deps.workspaceWrite.apply({
      patchSet,
      approvalRef: patchSet.approvalRef, // the approval that authorized THIS patch (§5.3)
      workspaceRef: anchor.workspaceRef,
    });
  } catch {
    this.logWorkspaceApplyFailed(session, anchor, 'workspace write threw');
    return this.failComposed(message, session, this.deps.composer.composeWorkspaceApplyFailed(message.context));
  }

  // 5. Result-integrity gate (CA Round 1 #3/#4). A stale update → WorkspaceChange.status FAILED (file
  //    unchanged). Success requires APPLIED *and* a full match of the returned change to the artifact/
  //    context — anything else → no WORKSPACE_APPLIED, safe failure.
  const r = change.results[0];
  const applyOk =
    change.status === WorkspaceChangeStatus.APPLIED &&
    change.patchRef.id === patchSet.id &&
    change.approvalRef.id === patchSet.approvalRef.id &&
    change.executionPlanRef.id === patchSet.executionPlanRef.id &&
    change.workspaceRef.id === anchor.workspaceRef.id &&
    change.results.length === 1 &&
    r?.status === 'applied' &&
    r?.path === op.path;
  if (!applyOk) {
    this.logWorkspaceApplyFailed(session, anchor, `workspace change not cleanly applied (status ${change.status})`);
    return this.failComposed(message, session, this.deps.composer.composeWorkspaceApplyFailed(message.context));
  }

  // 6. Success — re-anchor WORKSPACE_APPLIED, preserving the WorkspaceChangeRef for a future git/test sprint.
  await this.deps.applyPreviewFlow.anchor(session, {
    ...anchor,
    status: 'WORKSPACE_APPLIED',
    workspaceChangeRef: workspaceChangeRef(change),
  });
  const reply = this.deps.composer.composeWorkspaceApplied(message.context, anchor.targetFiles);
  await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
  return this.responded(session, reply);
}
```
The two other handlers mirror Sprint 2t's trivial pair:
```ts
private async handleWorkspaceAlreadyAppliedTurn(message: InboundMessage, session: Session): Promise<TurnResult> {
  const reply = this.deps.composer.composeWorkspaceAlreadyApplied(message.context);
  await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
  return this.responded(session, reply);
}
private async handleWorkspaceApplyUnavailableTurn(message: InboundMessage, session: Session): Promise<TurnResult> {
  const reply = this.deps.composer.composeWorkspaceApplyUnavailable(message.context);
  await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
  return this.responded(session, reply);
}
```
And the structured, no-content failure log (mirrors `logPatchGenerationFailed`, CA Q10/operability):
```ts
private logWorkspaceApplyFailed(session: Session, anchor: ApplyPreviewAnchor, reason: string): void {
  this.deps.logger.warn('workspace apply failed', {
    reason,
    sessionId: session.id,
    executionPlanId: anchor.executionPlanRef.id,
    approvalId: anchor.approvalId,
    patchId: anchor.patchRef?.id,
    targetFiles: anchor.targetFiles.join(', '),
  }); // deliberately NO diff text / file content
}
```

### 5.6 `app.module.ts` — wire the reused WorkspaceWriteManager

The `ConversationRuntime` factory gains `workspaceWrite: WorkspaceWriteManager` in its params + `inject`
array (the provider already exists, `app.module.ts:214-219`, already injected into `ExecutionOrchestrator`
— reuse), and passes `workspaceWrite`. The existing `patch: patchManager` already exposes `get` (only the
declared dep type widens — no wiring change for that). No new provider registration.

### 5.7 `ResponseComposer` — four new methods

**CA Round 1 #5 — precise git wording.** After WorkspaceWrite mutates a file, the working tree *does*
contain changes (`git status` would show them); so the copy must never say "git 변경 없음"/"git에는 아무
변경도 하지 않았어요." Instead it states what was and wasn't *done*: file modified; git **commands** not
run; commit/push not performed; tests not run; and that the working tree now holds the applied change.
```ts
/** Successful workspace file mutation (Sprint 2u, ADR-0042). CA Round 1 #5/#6/Q10: says the file was
 *  modified, git COMMANDS were not run, commit/push were not performed, and tests were not run — and
 *  that the working tree may now show the change. Never "git 변경 없음"/committed/pushed/deployed/
 *  verified/적용 완료. */
composeWorkspaceApplied(context: ConversationContext, targetFiles: string[]): OutboundMessage {
  return {
    context,
    text:
      `파일을 수정했어요: ${targetFiles.join(', ')}\n` +
      'git 명령은 실행하지 않았어요. 커밋/푸시는 하지 않았어요.\n' +
      '작업 트리에는 방금 적용한 파일 변경이 남아 있을 수 있어요.\n' +
      '테스트도 실행하지 않았어요.',
  };
}

/** No PATCH_READY apply context to write (CA Q4) — no anchor / not PATCH_READY / PATCH_READY without
 *  patchRef. Never implies anything was written. */
composeWorkspaceApplyUnavailable(context: ConversationContext): OutboundMessage {
  return {
    context,
    text: '지금 파일에 적용할 수 있는 준비된 패치가 없어요. 먼저 코드 변경 요청 → 승인 → 패치 생성을 완료해 주세요.',
  };
}

/** PATCH_READY but the PatchSet is missing/invalid/unsupported, or WorkspaceWrite failed / the diff no
 *  longer applies cleanly (stale/conflict) (CA Q5/Q6). Safe; reason is logged separately, never here.
 *  CA Round 1 #5: "git 명령이나 테스트는 실행하지 않았어요", never "git 변경 없음". */
composeWorkspaceApplyFailed(context: ConversationContext): OutboundMessage {
  return {
    context,
    text: '이 패치를 파일에 적용하지 못했어요. 파일 내용이 바뀌었거나 지원하지 않는 변경일 수 있어요. git 명령이나 테스트는 실행하지 않았어요.',
  };
}

/** WORKSPACE_APPLIED + another final/patch/apply command (Sprint 2u) — no re-apply, must not hide the
 *  applied state (CA Round 1 #8). CA Round 1 #5: "git 명령이나 테스트는 실행하지 않았어요". */
composeWorkspaceAlreadyApplied(context: ConversationContext): OutboundMessage {
  return {
    context,
    text: '이미 파일을 수정했어요. git 명령이나 테스트는 실행하지 않았어요.',
  };
}
```

## 6. Required Architecture Questions — answers for CA review

**Q1. Current WorkspaceWrite API?** Documented from source in §2: `WorkspaceWriteManager.apply(ApplyInput)
/get/findByPatchSet`; `ApplyInput {patchSet, approvalRef, workspaceRef}`; Ref-gated (no ApprovalManager);
delegates to `WorkspaceWriter.applyOperation` per op; atomic-per-file, best-effort, `deriveStatus` →
APPLIED/PARTIALLY_APPLIED/FAILED; status-based idempotency + patchHash revision guard; persists
`WorkspaceChange`.

**Q2. What is applied?** The `PatchSet` loaded via `patch.get(anchor.patchRef.id)` → `patchSet.operations`.
Never the AI `CodeProposal`, rendered diff, chat memory, or `workspace.diff` output (§5.3/§5.5 step 2).

**Q3. Final user trigger?** A new `FINAL_APPLY_WORDS` set of qualified phrases (§5.4), separate from
APPROVE/APPLY/PATCH words; "좋아"/"오케이"/"확인"/"계속 진행"/"다음 단계 진행" and a bare "적용" never
trigger a write.

**Q4. Anchor not PATCH_READY?** No WorkspaceWrite, `composeWorkspaceApplyUnavailable`, never a classifier
fallback. Routing sends no-anchor/ELIGIBLE/APPROVED/WORKSPACE_APPLIED-non-final and the handler sends
PATCH_READY-without-patchRef to the unavailable reply (§5.4/§5.5 step 1). (AWAITING_APPROVAL is
intercepted earlier by the Sprint 2s approval turn.)

**Q5. PatchSet unloadable/invalid? (APPROVED WITH CHANGE)** No WorkspaceWrite, `composeWorkspaceApplyFailed`.
Checked (§5.5 step 3): missing (`patch.get` → null), **`id !== anchor.patchRef.id` (CA Round 1 #2)**,
`status !== GENERATED`, `approvalRef.status !== APPROVED`, `approvalRef.id !== anchor.approvalId`,
`executionPlanRef` mismatch, `operations.length !== 1`, the op is **not `update`** (rejects add/delete —
CA Round 1 #1), binary, or its **path not within `anchor.targetFiles`** (normalized — CA Round 1 #2).

**Q6. Latest-content revalidation before write? (APPROVED WITH CHANGE)** Built into WorkspaceWrite **for
`update` ops** (the only kind Sprint 2u allows): `LocalWorkspaceWriter` applies the op's unified diff to
the **current** file via `applyPatch`; a diff that no longer applies cleanly is recorded `failed` and the
file is left unchanged (`workspace-local:435-436`). This is why `delete` is rejected (CA Round 1 #1 — the
writer's delete path does NOT diff-check against current content). No separate Application-layer re-diff is
done (it would require lossy `newContent` reconstruction and only duplicate this check) — CA Q6's explicit
allowance. **CA Round 1 #4 wording:** a stale update means WorkspaceWrite *is* called, returns
`FAILED`/non-clean result, the file is unchanged, no `WORKSPACE_APPLIED` — it is not a "revalidation
failure before WorkspaceWrite."

**Q7. What does WorkspaceWrite receive?** `{patchSet, approvalRef: patchSet.approvalRef, workspaceRef:
anchor.workspaceRef}` — the existing `ApplyInput`. It never queries `ApprovalManager` (and neither does
this handler — §5.3).

**Q8. Output preserved after write?** The `WorkspaceChange` aggregate (persisted by WorkspaceWrite);
its `workspaceChangeRef()` is stored on the anchor as it re-anchors `WORKSPACE_APPLIED`, **only after the
full result-integrity gate passes** (§5.5 step 5, CA Round 1 #3) — the handoff for a future git/test
sprint. `WORKSPACE_APPLIED` is CA Q8's preferred name; CA Round 1 #6: it means files mutated only — not
committed/pushed/tested/deployed, and **not a clean working tree**.

**Q9. Rollback/failure semantics? (APPROVED WITH CHANGE)** WorkspaceWrite is atomic-per-file, best-effort,
**no cross-file rollback**. Sprint 2u therefore **restricts apply to exactly one `update` operation**
(rejects `operations.length !== 1` and any non-`update` op, §5.5 step 3) so partial-apply ambiguity cannot
arise — one file, `APPLIED` or `FAILED` (file left unchanged on `failed`). The current validated-target
flow produces one file; multi-file/add/delete/binary apply is deferred (§4). Stated explicitly per CA Q9.

**Q10. User-facing text? (APPROVED WITH CHANGE)** `ResponseComposer` (§5.7). Success says the file was
modified, git **commands** were not run, commit/push were not performed, tests were not run, and the
working tree may now hold the change (CA Round 1 #5). Forbidden across all four methods: "git 변경 없음"/
"git에는 아무 변경도"/committed/pushed/deployed/verified-by-tests/테스트 통과/검증 완료. Runtime passes
only `targetFiles`.

**Q11. Does `ExecutionOrchestrator` change?** No. The handler calls `deps.workspaceWrite.apply` directly,
as Sprint 2q–2t call their capabilities directly. No new `ExecutionStage`; no orchestrator call.

**Q12. Prove no hidden side effects?** Tests (§8): `workspaceWrite.apply` called only on a valid
`PATCH_READY` + explicit final-apply turn (and never on any guard-fail path); `patch.generate` 0,
`codeGeneration.generate` 0, `command.run` 0, git 0, `orchestrator.run`/`.resume` 0. Files are mutated
only through the `WorkspaceWriter` provider (behind `workspaceWrite.apply`); the runtime has no direct
filesystem/git/command dependency on this path. `PatchManager` gains no apply behavior (unchanged).

## 7. Case matrix

| Case | Detection | Result |
|---|---|---|
| 1. "패치 적용해줘"/"파일에 적용해줘"/"최종 적용해줘" + PATCH_READY + valid single-op PatchSet | final-apply words, PATCH_READY, integrity ok, `applyPatch` clean | `workspaceWrite.apply` → `APPLIED`, anchor → `WORKSPACE_APPLIED` (+`workspaceChangeRef`), `composeWorkspaceApplied` |
| 2. Final-apply, no anchor / ELIGIBLE / APPROVED | routing | `composeWorkspaceApplyUnavailable`, no write |
| 3. Final-apply, AWAITING_APPROVAL | Sprint 2s approval-turn intercept (first) | approval decision handling — final-apply never reached |
| 4. Final-apply, PATCH_READY without patchRef | handler guard | `composeWorkspaceApplyUnavailable`, no write |
| 5. PatchSet not found (`patch.get` → null) | handler | `composeWorkspaceApplyFailed`, no write |
| 6. PatchSet `id ≠ anchor.patchRef.id` / status ≠ GENERATED / approvalRef not APPROVED / approvalRef.id ≠ anchor.approvalId / executionPlanRef mismatch / empty ops | integrity (CA #2) | `composeWorkspaceApplyFailed`, no write |
| 7. PatchSet has >1 operation | integrity (single-file only, CA Q9) | `composeWorkspaceApplyFailed`, no write |
| 8. PatchSet op is `add`/`delete`/binary (non-`update`) | integrity (CA #1) | `composeWorkspaceApplyFailed`, no write |
| 9. PatchSet op path outside `anchor.targetFiles` (normalized) | integrity (CA #2) | `composeWorkspaceApplyFailed`, no write |
| 10. `applyPatch` conflict (stale `update`) → `WorkspaceChange.status FAILED` (or non-clean result) | result-integrity gate (CA #3/#4) | `composeWorkspaceApplyFailed`, no `WORKSPACE_APPLIED`, file left unchanged |
| 11. `WorkspaceChange` APPLIED but result path/patchRef/refs mismatch or results empty | result-integrity gate (CA #3) | `composeWorkspaceApplyFailed`, no `WORKSPACE_APPLIED` |
| 12. `workspaceWrite.apply` throws | caught | `composeWorkspaceApplyFailed` |
| 13. Final-apply while WORKSPACE_APPLIED | routing | `composeWorkspaceAlreadyApplied`, no re-write |
| 14. patch-/apply-intent while WORKSPACE_APPLIED | routing (CA #8) | `composeWorkspaceAlreadyApplied` — never hides the applied state |
| 15. "좋아"/"오케이"/"확인"/"다음 단계 진행"/bare "적용" with PATCH_READY | not final-apply words | no write (patch-/apply-intent or fall-through, per existing Sprint 2s/2t behavior) |

## 8. Required Tests (Node 22) — mapped to the CA's 49-item list

**`conversation-runtime.test.ts`** — success path & anchor preservation (CA 1–4):
1. Explicit final-apply ("패치 적용해줘"/"파일에 적용해줘"/"최종 적용해줘") + PATCH_READY + a valid single
   `update`-op PatchSet calls `workspaceWrite.apply` once.
2. Success re-anchors `WORKSPACE_APPLIED`. 3. Success preserves `workspaceChangeRef`. 4. Success preserves
   every prior ref on the anchor.

Success wording (CA 5–9, in `response-composer.test.ts`): 5. says the file was modified; 6. says git
commands were not run; 7. says commit/push were not performed; 8. says tests were not run; 9. does **not**
say "git 변경 없음"/"git에는 아무 변경도".

No-write on bad anchor state (CA 10–14): 10. no anchor; 11. ELIGIBLE; 12. AWAITING_APPROVAL (intercepted
by the approval turn); 13. APPROVED without patchRef; 14. PATCH_READY without patchRef → no
`workspaceWrite.apply`.

No-write on invalid PatchSet (CA 15–26): 15. `patch.get` null; 16. `id !== anchor.patchRef.id`; 17. status
≠ GENERATED; 18. approvalRef not APPROVED; 19. approvalRef.id ≠ anchor.approvalId; 20. executionPlanRef
mismatch; 21. empty ops; 22. `operations.length > 1`; 23. op path outside `targetFiles` (normalized);
24. op is `add`; 25. op is `delete`; 26. op is binary → each → no `workspaceWrite.apply`,
`composeWorkspaceApplyFailed`.

Result-integrity / stale (CA 27–31): 27. `WorkspaceChange.status FAILED` → no `WORKSPACE_APPLIED`;
28. `PARTIALLY_APPLIED` → no `WORKSPACE_APPLIED`; 29. APPLIED but `results[0].path` mismatch → no
`WORKSPACE_APPLIED`; 30. APPLIED but `patchRef.id` mismatch → no `WORKSPACE_APPLIED`; 31.
`workspaceWrite.apply` throws → `composeWorkspaceApplyFailed`, failure logged. (A production-level test
using the real `LocalWorkspaceWriter` with a stale `update` diff asserting the file's contents remain
unchanged is added if feasible; otherwise the fake models the `FAILED`/mismatch result — CA Round 1 #4.)
Also: APPLIED with a `failed` result / empty `results` → no `WORKSPACE_APPLIED`.

Trigger discipline (CA 32–37): 32–34. "좋아"/"오케이"/"확인" / "다음 단계 진행" / a bare "적용" with
PATCH_READY → no `workspaceWrite.apply`; 35. "패치 적용해줘" routes to the final WorkspaceWrite path, **not**
`handleApplyAlreadyApprovedTurn` (CA Round 1 #7); 36–37. a final-apply phrase with no valid context calls
neither the classifier nor the Orchestrator.

Input & no-side-effects (CA 38–45): 38. `workspaceWrite.apply` receives `{patchSet, approvalRef,
workspaceRef}`; 39. it does **not** receive a `CodeProposal`; 40. `patch.generate` is not called on the
apply path; 41. `PatchManager` gains no apply method (structural — `patch` dep exposes only
`generate`/`get`); 42. no `command.run`; 43. no git operation; 44. no `orchestrator.run`/`.resume`;
45. no `codeGeneration.generate` — across the full apply sequence.

Idempotency / applied-state (CA 46–47): 46. `WORKSPACE_APPLIED` + a final-apply command →
`composeWorkspaceAlreadyApplied`, no second `workspaceWrite.apply`; 47. `WORKSPACE_APPLIED` + a patch
command → `composeWorkspaceAlreadyApplied` (does **not** hide the applied state, CA Round 1 #8); likewise
apply-intent at `WORKSPACE_APPLIED`.

**`response-composer.test.ts`**: `composeWorkspaceApplied` (says file modified + git-commands-not-run +
commit/push-not-performed + tests-not-run + working-tree-may-hold-change; forbidden: "git 변경 없음"/
committed/pushed/deployed/테스트 통과/검증 완료); `composeWorkspaceApplyUnavailable`/
`composeWorkspaceApplyFailed`/`composeWorkspaceAlreadyApplied` distinct, none implying git/tests ran or a
clean tree (CA Round 1 #5/#6).

**Node 22**: 48. `pnpm typecheck` green. 49. `pnpm test` green.

## 9. Architecture Impact / Reuse

- **Reuses, unchanged:** `WorkspaceWriteManager`/`WorkspaceChange`/`WorkspaceChangeRef`/
  `workspaceChangeRef()`/`WorkspaceChangeStatus` (CAP-006, ADR-0027, zero changes), `LocalWorkspaceWriter`
  (zero changes — its `applyPatch` conflict check is the staleness guard), `PatchManager.get`/`PatchSet`
  (CAP-005, zero changes — Patch stays representation-only, no apply behavior), `ApprovalRef` (used from
  the PatchSet, no `ApprovalManager` touch), `StatelessApplyPreviewFlow` (no logic change — anchor type
  gains a status/field), Sprint 2s/2t routing + `interpretApplyIntent`/`interpretPatchIntent`.
- **Changes:** `conversation-runtime.ts` (+`WORKSPACE_APPLIED` status & `workspaceChangeRef` on
  `ApplyPreviewAnchor`, +1 new `ConversationRuntimeDeps` dep `workspaceWrite` + widen `patch` with `get`,
  +`FINAL_APPLY_WORDS` + `interpretFinalApplyIntent`, +1 routing branch + WORKSPACE_APPLIED cases in the
  patch/apply branches, +3 handlers + `logWorkspaceApplyFailed`), `response-composer.ts` (+4 methods, no
  new DTO — `targetFiles: string[]` passed directly), `app.module.ts` (+`WorkspaceWriteManager` param/
  inject + `workspaceWrite` passthrough, no new provider).
- **No new** aggregate / repository / migration / capability / port. **No** `Core` or
  `ExecutionOrchestrator` contract change. WorkspaceWrite is the sole file mutator; git/CommandExecution
  untouched.
- **ADR-0042** (to be authored before implementation) must document, per CA Round 1's required content:
  Sprint 2u is the first real workspace file-mutation sprint; WorkspaceWrite is the only file mutator;
  the PatchSet is the applied artifact (never CodeProposal/rendered diff/chat memory); Patch stays
  representation-only; git and CommandExecution/tests stay untouched; `ExecutionOrchestrator` unchanged;
  the final trigger uses qualified `FINAL_APPLY_WORDS` (a bare "적용" and "다음 단계 진행" are **not**
  enough); `WORKSPACE_APPLIED` means workspace files mutated **only** — not committed/pushed/tested/
  deployed/clean-tree; WorkspaceWrite is file-atomic/best-effort across files, so **Sprint 2u restricts to
  exactly one `update` operation** — add/delete/binary/multi-op are deferred; `LocalWorkspaceWriter.
  applyPatch` is the latest-content revalidation **for `update` only**, and `delete` is rejected because
  the writer's delete path does not diff-check against current content; the embedded `approvalRef`
  authorizes the apply (no `ApprovalManager` on the apply path); pre-write identity/scope + post-write
  result-integrity gates; `workspaceChangeRef` preserved for a future git/test sprint; no implicit git
  mutation.

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Applying a stale patch corrupts a file | High if unaddressed | `LocalWorkspaceWriter.applyPatch` refuses a non-clean `update` diff (`failed`, file untouched); non-clean result → failure reply, no advance (§5.5 step 5/§6 Q6, CA #4) — tested (§8 27) |
| A `delete` slips through without a stale-content check | High (safety) | `delete` rejected before write — `update` is the only accepted op this sprint (§5.5 step 3, CA #1) — tested (§8 25) |
| Partial multi-file apply leaves the workspace half-changed | High if unaddressed | Single-op restriction — `operations.length !== 1` rejected before any write (§5.5/§6 Q9) — tested (§8 22) |
| Applying an unapproved/mismatched/out-of-scope PatchSet | High (safety) | Pre-write gate (id/status/approval/plan/op-count/type/scope) + WorkspaceWrite's own Ref re-validation + post-write result-integrity gate (§5.5 steps 3/5, CA #2/#3) — tested (§8 15-26, 29-30) |
| A `add`/binary op reaches the writer | Med | Rejected in the pre-write gate (`update`-only, §5.5 step 3, CA #1) — tested (§8 24, 26) |
| User reads "적용했어요" as committed/deployed or a clean tree | Med (Product) | Success copy says git commands not run + commit/push not performed + tests not run + working tree may hold the change; forbidden-word discipline (§5.7/§6 Q10, CA #5/#6) — tested (§8 5-9) |
| A bare "적용해줘" accidentally mutates files | High (safety) | `FINAL_APPLY_WORDS` are qualified phrases only; bare "적용" stays Sprint 2s apply-intent; final-apply checked before apply-intent (§5.4, CA #7) — tested (§8 34-35) |
| WORKSPACE_APPLIED re-applies, or a reply hides the applied state | Low/Med | Final/patch/apply intent at `WORKSPACE_APPLIED` all route to `composeWorkspaceAlreadyApplied` (CA #8); WorkspaceWrite is idempotent anyway — tested (§8 46-47) |
| Reviewers expect git commit/test after apply | Low | Explicitly out of scope (§4) — separate future sprint |

## Next Step

**Plan changes applied — CA Round 1's 8 required changes incorporated above** (#1 `update`-only, delete
rejected; #2 PatchSet id + op-path-in-targetFiles pre-write checks; #3 post-write result-integrity gate;
#4 stale-update expectation corrected to WorkspaceWrite-returns-FAILED; #5 precise git wording; #6
`WORKSPACE_APPLIED` ≠ tested/committed/clean; #7 final-apply before apply-intent; #8 `WORKSPACE_APPLIED` +
patch/apply intent → already-applied reply). Per the approved sequence: (1) plan changes applied (this
document); (2) author ADR-0042 next; (3) implement exactly this scope (§3/§5) on a `v2/<topic>` branch;
(4) add/update tests per §8; (5) validate on **Node 22**; (6) open a PR for Chief Architect Implementation
Review. No commit/PR made yet.
