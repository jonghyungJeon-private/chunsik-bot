# Sprint 2x Plan — Explicit Git Commit Approval (WORKSPACE_APPLIED → commit approval halt, NO git mutation)

- **Status:** ✅ APPROVED WITH CHANGES (Chief Architect Review) — the 14 required changes are applied below
  (git.status only, never git.diff; strict pending-context integrity guard; approval id verified before
  decide; approval-planning-not-execution wording; defensive path normalization; bounded out-of-scope +
  candidate lists; conservative single-message parsing; deny/cancel reverts to WORKSPACE_APPLIED clearing
  only commit fields; COMMIT_APPROVED ≠ committed; commit-specific deny/cancel replies; split
  unavailable-vs-status-read-failure; ambiguous preserves pending context; empty-candidate blocks approval).
  No branch/commit/PR until implementation. **No git mutation in this sprint.**
- **Base:** `main` @ `063ba25` · **Validation runtime:** Node 22 (to be run at implementation time).
- **Directed by:** Chief Architect (this sprint's topic and constraints are CA-assigned, not Claude-proposed).
- **Goal:** After Sprint 2u leaves a `WORKSPACE_APPLIED` anchor (real file mutation) — optionally validated
  (2v) and previewed read-only (2w) — a later turn with an **explicit commit request** ("이 변경사항
  커밋해줘") **plans** a git commit: read-only git status → derive in-scope candidate files → deterministic
  commit message → create a **HIGH-risk `ApprovalRequest`** → **halt at a commit-approval-pending state**.
  **This sprint performs NO git mutation** — no `git add`, no `git commit`, no `git push`; not even after the
  user approves (execution is a future Sprint 2y). It only creates the approval gate.
- **Phase:** Phase 2 — Product Construction (fourteenth runtime sprint, after 2k–2w). **Not** a new
  capability — reuses `ApprovalManager.requestForRisk/decide/get` (CAP-004), the Sprint 2s approval-#2
  pattern, `GitManager.status` (CAP-002, read-only, 2w), and the Sprint 2u `WORKSPACE_APPLIED` anchor +
  (read-only) the 2v `postApplyValidationRef`.
- **Process:** V2 architecture-first, step 1 (plan-only).

> **Framing.** A git commit is a **repository mutation** — so Sprint 2x stops *before* it, exactly as
> Sprint 2s stopped before the file apply by creating a HIGH approval and halting. Everything needed already
> exists and was verified by reading source (CA "do not guess"): `ApprovalManager.requestForRisk({
> executionPlanRef, riskLevel: HIGH, reason, requestedBy})` creates a **PENDING** `ApprovalRequest` (never
> auto-approves); the runtime's Sprint 2s handlers (`handleApplyIntentTurn` → `AWAITING_APPROVAL` anchor;
> `handleApplyApprovalTurn` → decide) are the exact template; `GitManager.status` gives the read-only changed
> files. Crucially, the apply/commit anchor Task is **plan-less**, so `StatelessApprovalFlow.findPending`
> (which needs `task.planId`) never returns the commit approval — it is handled solely via a dedicated
> anchor-status interception (verified, §6 Q1). Proceeding with strict approval-before-git-mutation
> discipline: **no git mutation anywhere in this sprint.**

---

## 1. Objective

At `WORKSPACE_APPLIED` (Sprint 2u/2v/2w), an **explicit commit request** drives `ConversationRuntime` to:
1. require a `WORKSPACE_APPLIED` anchor and detect an explicit commit intent (§5.4); a bare
   "좋아"/"오케이"/"확인"/"다음 단계"/"진행해"/"이대로 해" never triggers;
2. **reject** non-commit git mutations and commit+other combos ("push 해줘"/"git add 해줘"/"reset"/"stash"/
   "commit and push") — no approval, no git (CA Constraint 1, Q3);
3. read **read-only** `GitManager.status(anchor.workspaceRef.rootPath)`; on a clean tree → "no changes to
   commit", no approval (Q8); on a read failure → safe failure, no approval, no fallback (Q9);
4. compute candidate files = changed files ∩ `anchor.targetFiles`; if any changed file is **outside**
   `targetFiles` → warn and stop, **no approval** (Q5 safe rule);
5. derive a **deterministic** bounded commit message (or accept a validated user-provided one) (Q6/Q7);
6. create a **HIGH-risk `ApprovalRequest`** via `requestForRisk` whose reason names the operation, workspace,
   candidate files, commit message, validation context, and that no git add/commit/push has been performed
   (Q11) — never raw diff content;
7. re-anchor `COMMIT_APPROVAL_PENDING` (preserving `commitApprovalId`/`proposedCommitMessage`/
   `commitCandidateFiles`) and **halt at AWAITING_APPROVAL** (Q2/Q12);
8. on the next turn, decide the approval (reusing the existing decision words): **approve → record only** and
   re-anchor `COMMIT_APPROVED` with a reply that says the commit approval is recorded but the commit is **not
   executed yet** (Sprint 2y); **deny/cancel → record and revert to `WORKSPACE_APPLIED`** (never discard the
   applied state) (Q12).

Throughout: **no `git add`/`commit`/`push`/`reset`/`checkout`/`stash`/`branch`/`tag`/`merge`/`rebase`, no
CommandExecution, no shell, no WorkspaceWrite, no Patch, no CodeGeneration, no ExecutionOrchestrator change**
(Constraints 1–4, Q13/Q14).

## 2. Central finding — the approval halt is already a solved pattern; git commit stays a future mutation

**Verified against source (CA "do not guess"):**
- `ApprovalManager.requestForRisk(input)` (`approval-manager.ts:78-101`): `{executionPlanRef, riskLevel:
  HIGH|CRITICAL, reason, requestedBy}` → a **PENDING** `ApprovalRequest` (`status: PENDING` unconditionally —
  "never auto-approves"; throws if risk is not HIGH/CRITICAL, or reason/requestedBy empty), persisted via
  `storage.approvals.save`. `decide(id, decision)` (`:44-60`) → APPROVED/REJECTED (throws if not PENDING).
  `get(id)` (`:62`). This is exactly what Sprint 2s used for the apply approval.
- **Sprint 2s approval-#2 pattern** (`conversation-runtime.ts`): `handleApplyIntentTurn` (`:895-919`) calls
  `requestForRisk({executionPlanRef: anchor.executionPlanRef, riskLevel: HIGH, reason, requestedBy: actor.id})`,
  re-anchors `{...anchor, status: 'AWAITING_APPROVAL', approvalId: approval.id}`, returns `AWAITING_APPROVAL`.
  `handleApplyApprovalTurn` (`:927-962`) reuses `interpretDecision`/`decisionOf` + `APPROVE_WORDS`/
  `DENY_WORDS`/`CANCEL_WORDS`: ambiguous → `composeApprovalNotice` re-prompt; approve → `decide` + re-anchor
  `APPROVED`; deny/cancel → `decide` + `applyPreviewFlow.clear`. Sprint 2x mirrors this exactly for commit.
- **`findPending` does NOT catch the commit approval (critical).** `StatelessApprovalFlow.findPending`
  (`stateless-approval-flow.ts:34-40`) derives from `session.activeTaskId → task.planId →
  approvals.findByExecutionPlan → PENDING`, and **returns null when the active task has no `planId`**. The
  apply/commit anchor Task created by `StatelessApplyPreviewFlow.anchor` (`stateless-apply-preview-flow.ts:
  53-79`) is **plan-less** (no `planId` set) and it is what `session.activeTaskId` points at while an anchor
  is live. So `findPending` returns null and the commit approval is handled **solely** via the anchor-status
  interception — identical to how the Sprint 2s apply approval works. No first-approval-handler conflict.
- `GitManager.status(rootPath): GitStatus` (`git-manager.ts:25-27`, CAP-002/ADR-0023) — read-only; the 2w
  `git` dep already exposes it on `ConversationRuntimeDeps` (`{ status, diff }`). `GitStatus = {clean, branch,
  staged[], unstaged[], untracked[], …}`.
- The 2w `commandExecutions.get` read dep + `loadValidationContext` helper already resolve the last
  validation for display (reused verbatim for Q10).
- `ApplyPreviewAnchor` carries `executionPlanRef`, `workspaceRef`, `targetFiles`, `instruction`,
  `approvalId`, `workspaceChangeRef`, `postApplyValidationRef` (2u–2w). `interpretDecision`
  (`:485-491`) + `APPROVE_WORDS`/`DENY_WORDS`/`CANCEL_WORDS` (`:351-353`) + `decisionOf` + `normalizeRelativePath`
  (target-scope) all exist and are reused.

**Consequence: no new capability, port, aggregate, migration, dependency, or `ExecutionOrchestrator` change.**
`GitProvider.commit`/`add`/`push` are **NOT** added (CA Constraint 3). The changes are all on
`ConversationRuntime`: two new anchor statuses + three fields, a commit-intent detector, one interception +
one routing block, five handlers, and `ResponseComposer` methods; plus a one-line `StatelessApplyPreviewFlow`
status mapping.

## 3. Scope (this sprint)

- **`ApplyPreviewAnchor` gains two statuses and three optional fields** (§5.1): statuses
  `COMMIT_APPROVAL_PENDING` (a real commit `ApprovalRequest` is pending — halts every turn) and
  `COMMIT_APPROVED` (approved, preserved for the future Sprint 2y commit executor); fields
  `commitApprovalId?: Id`, `proposedCommitMessage?: string`, `commitCandidateFiles?: string[]`. **No
  `COMMITTED`/`GIT_COMMITTED`** (nothing is committed).
- **`StatelessApplyPreviewFlow.anchor` maps `COMMIT_APPROVAL_PENDING` → `TaskStatus.WAITING_APPROVAL`** (one
  line, mirrors `AWAITING_APPROVAL`) for observability; all other new statuses fall to the inert `PENDING`
  case. `findAnchor` finds the anchor regardless of status (plan-less task), so `findPending` stays null (§2).
- **No new `ConversationRuntimeDeps` dependency** (§5.2) — reuses `git` (2w, read-only `status` **only —
  never `git.diff`**, CA #1), `approvals` (`requestForRisk`/`decide`/`get`), `commandExecutions.get` (2w),
  `applyPreviewFlow`.
- **New explicit commit-intent detection**, `ConversationRuntime.interpretCommitIntent(text): 'commit' |
  'commit-with-forbidden' | null` (§5.4), using dedicated `COMMIT_WORDS` and a `COMMIT_FORBIDDEN_COMPANION`
  set, distinct from every prior word-set. Bare approval words → null; push/add/reset-only (no commit word) →
  null (so the Sprint 2w git-preview mutating-reject still handles them, unchanged).
- **`handle()` routing** (§5.4): a `COMMIT_APPROVAL_PENDING` interception right after the `AWAITING_APPROVAL`
  interception; and a commit-intent block placed **before** the Sprint 2v/2w `WORKSPACE_APPLIED` validation/
  git-preview block (so "커밋해줘" is a commit request, not a 2w git-mutation reject).
- **Five handlers** (§5.5): `handleCommitApprovalTurn` (create approval + halt; **git.status only**),
  `handleCommitApprovalDecisionTurn` (decide — with a **strict pending-context integrity guard** and an
  **approval-request existence/PENDING/plan verification** before `decide`, CA #2/#3), `handleCommitAlreadyApprovedTurn`
  (at `COMMIT_APPROVED`), `handleCommitUnavailableTurn` (commit requested without a `WORKSPACE_APPLIED`/
  `COMMIT_APPROVED` anchor), `handleCommitUnsupportedCompanionTurn` (commit+push/reset/… combo).
- **Deterministic commit message** (§5.6): a bounded template from `targetFiles`; a user-provided message is
  accepted only if **exactly one** quoted segment, single-line, ≤120 chars, control-char-free, trimmed
  (backticks/punctuation allowed within those bounds; else ask again, no approval). **No AI generation.**
- **Candidate-file safety rule** (§5.6): candidates = changed files ∩ `anchor.targetFiles` after
  **defensive `safeRelativePath` normalization** (absolute/`..`/empty/non-normalizable → unsafe → out-of-scope);
  any out-of-scope/unsafe path **or an empty in-scope set** → bounded warning, **no approval** (CA #6/#14).
  Lists are bounded (out-of-scope ≤10, candidates ≤30, CA #7).
- **`ResponseComposer` methods** (§5.7, nine): `composeCommitApprovalRequested`, `composeCommitApprovalRecorded`,
  `composeCommitApprovalDenied`, `composeCommitApprovalCancelled`, `composeCommitNothingToCommit`,
  `composeCommitOutOfScopeChanges`, `composeCommitMessageInvalid`, `composeCommitUnavailable` (wrong state) +
  `composeCommitStatusUnavailable` (git-read failure, split per CA #12), `composeCommitAlreadyApproved`,
  `composeCommitUnsupportedCompanion`. Commit-specific deny/cancel replace the generic
  `composeExecutionResult` (CA #11); approve/COMMIT_APPROVED wording never says committed (CA #10).
- **No git mutation, no CommandExecution/shell, no WorkspaceWrite, no Patch, no CodeGeneration, no
  ExecutionOrchestrator change** (§4). Tests for all of the above (§8), incl. the CA's 47 required items.

## 4. Non-goals (explicit, per Chief Architect direction)

No implementation before plan approval · no branch/commit/PR beyond this plan-only step · `git add`/`commit`/
`push`/`reset`/`checkout`/`stash`/`branch`/`tag`/`merge`/`rebase` · **actual commit execution even after
approval** (Sprint 2y) · automatic commit · automatic git status/preview after apply or validation ·
AI-generated commit messages (deterministic bounds only) · adding `GitProvider.commit`/`add`/`push` (or any
git mutation method) · CommandExecution-based git · shelling out to git from the runtime · `WorkspaceWrite` ·
`PatchManager` · `CodeGeneration` · `ExecutionOrchestrator` stage change · PR creation · deployment · broad
general commit handling outside the `WORKSPACE_APPLIED`/`COMMIT_APPROVED` path · a `COMMITTED`/`GIT_COMMITTED`
state · persisting raw diff content · claiming fully-verified/safe-to-commit/ready-to-push/ready-to-deploy/
clean-forever.

## 5. Design

### 5.1 `ApplyPreviewAnchor` — two new statuses, three new fields

```ts
export type ApplyPreviewAnchorStatus =
  | 'ELIGIBLE' | 'AWAITING_APPROVAL' | 'APPROVED' | 'PATCH_READY' | 'WORKSPACE_APPLIED'
  /** A HIGH-risk git-commit ApprovalRequest is pending decision (Sprint 2x, ADR-0045). Intercepts every
   *  turn like AWAITING_APPROVAL. NOT committed — no git add/commit/push has run. */
  | 'COMMIT_APPROVAL_PENDING'
  /** The git-commit approval was granted (Sprint 2x). Context preserved for a future Sprint 2y executor.
   *  NOT committed yet — this sprint executes nothing. NOT `COMMITTED`/`GIT_COMMITTED`. */
  | 'COMMIT_APPROVED';

export interface ApplyPreviewAnchor {
  // ...existing fields (…, approvalId?, workspaceChangeRef?, postApplyValidationRef?) ...
  /** The git-commit ApprovalRequest id (Sprint 2x) — DISTINCT from `approvalId` (the apply approval). */
  commitApprovalId?: Id;
  /** The bounded, deterministic (or validated user-provided) commit message proposed for approval (2x). */
  proposedCommitMessage?: string;
  /** In-scope candidate file paths for the commit (changed ∩ targetFiles) preserved for Sprint 2y (2x). */
  commitCandidateFiles?: string[];
}
```
`COMMIT_APPROVAL_PENDING`/`COMMIT_APPROVED` never regress into an "applied but uncommitted" lie: the copy and
ADR state files are applied and a commit was *approved*, not performed.

### 5.2 `ConversationRuntimeDeps` — no new dependency

Reuses: `git.status` (2w, read-only), `approvals.requestForRisk`/`decide`/`get`, `commandExecutions.get`
(2w, for validation context), `applyPreviewFlow.anchor`/`findAnchor`/`clear`. **No new dep, capability, or
port.** **CA Required Change #1: Sprint 2x calls `git.status` ONLY — never `git.diff`.** Commit approval
needs candidate files + a commit message, not diff content; raw/bounded diff display belongs to Sprint 2w's
read-only preview. The approval reason and prompt contain **no diff content**.

### 5.3 `StatelessApplyPreviewFlow` — one-line status mapping

```ts
status: anchor.status === 'AWAITING_APPROVAL' || anchor.status === 'COMMIT_APPROVAL_PENDING'
  ? TaskStatus.WAITING_APPROVAL
  : TaskStatus.PENDING,
```
A pending commit approval is genuinely waiting on the user; mapping it to `WAITING_APPROVAL` mirrors the apply
approval. The task stays **plan-less**, so `findPending` still returns null (§2) — the commit approval is
handled only via the anchor interception. `findAnchor` is unaffected (finds by the metadata discriminator,
not status).

### 5.4 `handle()` routing + explicit commit detection

```ts
/** Explicit git-commit request phrases (Sprint 2x, ADR-0045) — qualified; a bare "좋아"/"오케이"/"확인"/
 *  "다음 단계"/"진행해"/"이대로 해" never matches. */
const COMMIT_WORDS =
  /(커밋\s*(해|해줘|하자|할래|준비|승인)|커밋\s*메시지|git\s*commit|commit\s+this|prepare\s+commit|create\s+commit\s+approval)/i;
/** Non-commit git mutations that must NOT ride along with a commit request (Sprint 2x). */
const COMMIT_FORBIDDEN_COMPANION =
  /(푸시|\bpush\b|git\s*add|\badd\s*해|리셋|\breset\b|checkout|체크아웃|stash|스태시|\bbranch\b|브랜치|merge|머지|rebase|리베이스|\btag\b|태그)/i;

/** Explicit commit intent (Sprint 2x). 'commit' = a pure commit request; 'commit-with-forbidden' = commit
 *  bundled with push/add/reset/… (rejected — commit-approval only); null = not a commit request (a
 *  push/add/reset-only phrase returns null so the Sprint 2w git-preview mutating-reject handles it, unchanged). */
static interpretCommitIntent(text: string): 'commit' | 'commit-with-forbidden' | null {
  const t = text.trim().toLowerCase();
  if (!COMMIT_WORDS.test(t)) return null;
  if (COMMIT_FORBIDDEN_COMPANION.test(t)) return 'commit-with-forbidden'; // e.g. "commit and push"
  return 'commit';
}
```
Routing:
```ts
if (applyAnchor?.status === 'AWAITING_APPROVAL') {          // Sprint 2s apply approval — unchanged
  return this.handleApplyApprovalTurn(message, session, actor, applyAnchor);
}
// (Sprint 2x) a pending COMMIT approval intercepts every turn, exactly like AWAITING_APPROVAL.
if (applyAnchor?.status === 'COMMIT_APPROVAL_PENDING') {
  return this.handleCommitApprovalDecisionTurn(message, session, actor, applyAnchor);
}
// (Sprint 2x) explicit commit request → commit-approval planning. Checked BEFORE the 2v/2w
// WORKSPACE_APPLIED validation/git-preview block so "커밋해줘" plans a commit, not a 2w git-mutation reject.
const commitKind = ConversationRuntime.interpretCommitIntent(message.text);
if (commitKind) {
  if (applyAnchor?.status === 'WORKSPACE_APPLIED') {
    return commitKind === 'commit'
      ? this.handleCommitApprovalTurn(message, session, actor, applyAnchor)
      : this.handleCommitUnsupportedCompanionTurn(message, session);       // commit + push/reset/…
  }
  if (applyAnchor?.status === 'COMMIT_APPROVED') {
    return this.handleCommitAlreadyApprovedTurn(message, session);         // already approved; exec is 2y
  }
  return this.handleCommitUnavailableTurn(message, session);              // no WORKSPACE_APPLIED/COMMIT_APPROVED
}
// (Sprint 2v/2w) WORKSPACE_APPLIED validation + read-only git preview — unchanged. A push/add/reset-only
// phrase (interpretCommitIntent → null) still reaches the 2w git-preview 'mutating' reject.
if (applyAnchor?.status === 'WORKSPACE_APPLIED') { /* validation → git-preview, as today */ }
// (Sprint 2u/2t/2s) final-apply / patch / apply intents — unchanged.
```

### 5.5 Handlers

```ts
/** Explicit commit request at WORKSPACE_APPLIED (Sprint 2x) — plan a commit and halt at approval. Runs ONLY
 *  read-only git.status; NO git mutation, CommandExecution, WorkspaceWrite, Patch, CodeGen, or Orchestrator. */
private async handleCommitApprovalTurn(message, session, actor, anchor): Promise<TurnResult> {
  if (!anchor.workspaceRef || !anchor.executionPlanRef || !anchor.targetFiles.length) {
    return this.failComposed(message, session, this.deps.composer.composeCommitUnavailable(message.context));
  }
  // 1. Commit message: user-provided (validated) else deterministic template (§5.6). Invalid user msg → ask.
  const parsed = ConversationRuntime.parseCommitMessage(message.text, anchor.targetFiles);
  if (parsed === 'invalid') {
    return this.respondComposed(message, session, this.deps.composer.composeCommitMessageInvalid(message.context));
  }
  const commitMessage = parsed.message;

  // 2. Read-only git status ONLY (CA #1/#12/Q9). A throw → composeCommitStatusUnavailable (a read WAS
  //    attempted — precise wording, never "git 명령은 실행하지 않았어요"), NO approval, NO fallback. NEVER git.diff.
  let status: GitStatus;
  try { status = await this.deps.git.status(anchor.workspaceRef.rootPath); }
  catch { this.logCommitApprovalFailed(session, anchor, 'git status read failed');
          return this.failComposed(message, session, this.deps.composer.composeCommitStatusUnavailable(message.context)); }

  // 3. Candidate files = changed ∩ targetFiles (CA #6/#14/Q5). Defensively normalize+validate every git
  //    status path: an absolute / traversal (`..`) / empty / non-normalizable path is UNSAFE → treated as
  //    out-of-scope, no approval. Clean → nothing to commit. Any out-of-scope OR empty-after-intersection
  //    → bounded warning, no approval.
  const rawChanged = [...status.staged, ...status.unstaged, ...status.untracked];
  if (rawChanged.length === 0) {
    return this.respondComposed(message, session, this.deps.composer.composeCommitNothingToCommit(message.context));
  }
  const scope = new Set(anchor.targetFiles.map(normalizeRelativePath));
  const inScope: string[] = [];
  const outOfScope: string[] = [];
  for (const raw of rawChanged) {
    const safe = safeRelativePath(raw); // null when absolute / contains `..` / empty / non-normalizable
    if (safe !== null && scope.has(safe)) inScope.push(safe);
    else outOfScope.push(safe ?? raw); // unsafe paths are surfaced as out-of-scope (never trusted/committed)
  }
  const candidateFiles = [...new Set(inScope)];
  // (CA #14) any out-of-scope/unsafe change, OR no in-scope candidate after intersection → warn, no approval.
  if (outOfScope.length > 0 || candidateFiles.length === 0) {
    return this.respondComposed(message, session, this.deps.composer.composeCommitOutOfScopeChanges(message.context, outOfScope));
  }

  // 4. Read-only validation context (reused 2w helper) — display only, never blocks (CA Q10).
  const validation = await this.loadValidationContext(anchor);

  // 5. Create the HIGH commit ApprovalRequest (CA Constraint 2, Q11). Reason: op + workspace + candidate
  //    files + message + validation + "no git add/commit/push performed". NO raw diff.
  const approval = await this.deps.approvals.requestForRisk({
    executionPlanRef: anchor.executionPlanRef,
    riskLevel: RiskLevel.HIGH,
    reason: buildCommitApprovalReason({ workspaceRef: anchor.workspaceRef, candidateFiles, commitMessage, validation }),
    requestedBy: actor.id,
  });

  // 6. Halt at COMMIT_APPROVAL_PENDING, preserving commit context for the decision turn / Sprint 2y.
  await this.deps.applyPreviewFlow.anchor(session, {
    ...anchor, status: 'COMMIT_APPROVAL_PENDING',
    commitApprovalId: approval.id, proposedCommitMessage: commitMessage, commitCandidateFiles: candidateFiles,
  });
  const reply = this.deps.composer.composeCommitApprovalRequested(message.context, { candidateFiles, commitMessage, validation });
  await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
  return { status: 'AWAITING_APPROVAL', reply, sessionId: session.id };
}

/** Decide the pending commit approval (Sprint 2x) — mirrors handleApplyApprovalTurn, with strict guards.
 *  Approve → record only, re-anchor COMMIT_APPROVED (NO git commit — that is Sprint 2y). Deny/cancel → record
 *  and REVERT to WORKSPACE_APPLIED (never discard the applied state), with a COMMIT-SPECIFIC reply. */
private async handleCommitApprovalDecisionTurn(message, session, actor, anchor): Promise<TurnResult> {
  // (CA #2) Strict pending-context integrity guard — a pending commit approval is valid only with COMPLETE
  //  resume context for Sprint 2y. Any missing field → safe failure, NO decide/git/re-anchor.
  if (
    anchor.status !== 'COMMIT_APPROVAL_PENDING' || !anchor.commitApprovalId ||
    !anchor.proposedCommitMessage || !anchor.commitCandidateFiles?.length ||
    !anchor.workspaceRef || !anchor.workspaceChangeRef || !anchor.executionPlanRef
  ) {
    this.logCommitApprovalFailed(session, anchor, 'pending commit approval context incomplete');
    return this.failComposed(message, session, this.deps.composer.composeCommitUnavailable(message.context));
  }
  const decision = ConversationRuntime.interpretDecision(message.text);
  if (decision === 'ambiguous') {
    // (CA #13) preserve pending context: re-prompt only; no decide, no new approval, no re-anchor.
    const fresh = await this.deps.approvals.get(anchor.commitApprovalId);
    const reply = fresh ? this.deps.composer.composeApprovalNotice(message.context, fresh)
                        : this.deps.composer.composeCommitUnavailable(message.context);
    await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
    return { status: 'AWAITING_APPROVAL', reply, sessionId: session.id };
  }
  // (CA #3) Verify the referenced ApprovalRequest before deciding: exists, PENDING, same plan.
  const request = await this.deps.approvals.get(anchor.commitApprovalId);
  if (!request || request.status !== ApprovalStatus.PENDING || request.executionPlanRef.id !== anchor.executionPlanRef.id) {
    this.logCommitApprovalFailed(session, anchor, 'commit approval request missing/mismatched');
    return this.failComposed(message, session, this.deps.composer.composeCommitUnavailable(message.context));
  }
  const approved = decision === 'approve';
  await this.deps.approvals.decide(anchor.commitApprovalId, this.decisionOf(anchor.commitApprovalId, actor.id, approved));
  if (!approved) {
    // (CA #9/#11) deny/cancel: the applied workspace state MUST survive → revert to WORKSPACE_APPLIED,
    //  clearing ONLY the commit fields (workspaceRef/workspaceChangeRef/postApplyValidationRef/targetFiles
    //  preserved). Use a COMMIT-SPECIFIC reply — never the generic composeExecutionResult (which could read
    //  as the whole code change being undone; the applied files remain).
    await this.deps.applyPreviewFlow.anchor(session, {
      ...anchor, status: 'WORKSPACE_APPLIED',
      commitApprovalId: undefined, proposedCommitMessage: undefined, commitCandidateFiles: undefined,
    });
    const reply = decision === 'deny'
      ? this.deps.composer.composeCommitApprovalDenied(message.context)
      : this.deps.composer.composeCommitApprovalCancelled(message.context);
    await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
    return { status: decision === 'deny' ? 'DENIED' : 'CANCELLED', reply, sessionId: session.id };
  }
  // approve — Sprint 2x records only; the actual git commit is a future sprint. Preserve full context.
  await this.deps.applyPreviewFlow.anchor(session, { ...anchor, status: 'COMMIT_APPROVED' });
  const reply = this.deps.composer.composeCommitApprovalRecorded(message.context);
  await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
  return { status: 'RESPONDED', reply, sessionId: session.id };
}
```
Plus the trivial trio — `handleCommitAlreadyApprovedTurn` (`composeCommitAlreadyApproved`, RESPONDED),
`handleCommitUnavailableTurn` (`composeCommitUnavailable`, RESPONDED), `handleCommitUnsupportedCompanionTurn`
(`composeCommitUnsupportedCompanion`, RESPONDED) — and `logCommitApprovalFailed` (structured, no diff/content).

### 5.6 Commit message + candidate files (deterministic, bounded)

- **Deterministic template (default, CA Q6 — no AI):** primary = `targetFiles[0]`; `msg = \`chore: update
  ${primary}${targetFiles.length > 1 ? \` 외 ${targetFiles.length - 1}개\` : ''}\``; clamped to **120 chars**.
- **User-provided (CA Q7/#8):** parse a quoted message following a `메시지`/`message` keyword (e.g. `메시지는
  "fix: …"`). Accept only if **exactly one** quoted message-like segment is found (**more than one → invalid**,
  CA #8), and it is **single line** (no `\n`/`\r`), **≤120 chars**, **no control chars**, **trimmed
  non-empty**. **Backticks and other normal punctuation are allowed** as long as the message is single-line,
  bounded, and control-char-free (CA #8 recommendation). Otherwise `'invalid'` → `composeCommitMessageInvalid`
  (ask again, **no approval**). Never interpolate diff/file content into the message.
- **Candidate files + defensive path safety (CA #6/#14/Q5):** `changed = staged ∪ unstaged ∪ untracked`.
  **`safeRelativePath(p)`** returns a normalized project-relative path or `null` when the path is **absolute /
  contains `..` traversal / empty / not safely normalizable** — such paths are **never trusted** and are
  surfaced as out-of-scope (never committed). Clean (`changed = ∅`) → `composeCommitNothingToCommit`. Any
  out-of-scope/unsafe path, **or an empty in-scope candidate set after intersection** → `composeCommitOutOfScopeChanges`,
  **no approval**. Otherwise candidates = the in-scope changed set.
- **Bounds (CA #7):** out-of-scope files shown ≤ **10** (labeled "외 N개"); candidate files in the approval
  prompt ≤ **30** (labeled); approval-reason candidate files ≤ **30** with an omitted count. No unbounded
  file lists anywhere.

### 5.7 `ResponseComposer` — nine methods

**No overclaim (CA Constraint 6/#10):** never "커밋 완료"/committed/commit created/변경사항이 커밋됐어요/
"safe to commit"/"ready to push"/"ready to deploy"/"clean forever". Every commit reply states the current
truth: files are applied; **no git add/commit/push has been performed**.
```ts
// AWAITING_APPROVAL prompt (CA #4/#5): bounded candidate files (≤30) + commit message + validation record +
// "승인/거절"; MUST say approving does NOT run git add/commit/push in this step and that actual commit is a
// later step: "커밋 승인을 요청했어요. 승인해도 이번 단계에서는 실제 git add/commit/push는 수행하지 않아요.
// 실제 커밋 실행은 다음 단계에서 진행돼요."
composeCommitApprovalRequested(context, { candidateFiles, commitMessage, validation }): OutboundMessage;
// approve (CA #10): "커밋 승인은 기록했어요. 아직 실제 git add/commit/push는 수행하지 않았어요." — forbidden:
// 커밋 완료/committed/commit created/변경사항이 커밋됐어요.
composeCommitApprovalRecorded(context): OutboundMessage;
// deny (CA #11, commit-specific — NOT generic composeExecutionResult): "커밋 승인을 거절했어요. 이미 적용된
// 파일 변경은 그대로 있어요. 실제 git commit은 수행하지 않았어요."
composeCommitApprovalDenied(context): OutboundMessage;
// cancel (CA #11, commit-specific): "커밋 승인을 취소했어요. 이미 적용된 파일 변경은 그대로 있어요. 실제 git
// commit은 수행하지 않았어요."
composeCommitApprovalCancelled(context): OutboundMessage;
composeCommitNothingToCommit(context): OutboundMessage;         // clean tree: "현재 Git 기준 커밋할 변경이 없어요."
composeCommitOutOfScopeChanges(context, outOfScope: string[]): OutboundMessage; // ≤10 shown + "외 N개"; "적용 대상 밖의(또는 안전하지 않은) 변경이 있어요 … 먼저 정리가 필요해요." no approval
composeCommitMessageInvalid(context): OutboundMessage;          // "커밋 메시지는 한 줄, 120자 이하로 하나만 다시 알려 주세요." no approval
// wrong state — no WORKSPACE_APPLIED/COMMIT_APPROVED anchor OR incomplete pending context (CA #12): a safe
// failure that does NOT imply a git read happened.
composeCommitUnavailable(context): OutboundMessage;
// git STATUS read failure (CA #12, precise like Sprint 2w): "커밋 준비를 위해 Git 상태를 읽지 못했어요 …
// 읽기 전용 Git 상태 확인 중 문제가 발생했지만 git add/commit/push는 하지 않았어요." — MUST NOT say "git 명령은
// 실행하지 않았어요" (a read WAS attempted). No CommandExecution/shell fallback.
composeCommitStatusUnavailable(context): OutboundMessage;
composeCommitAlreadyApproved(context): OutboundMessage;         // COMMIT_APPROVED (CA #10): "이미 커밋 승인을 받아 뒀어요. 아직 실제 git add/commit/push는 수행하지 않았어요."
composeCommitUnsupportedCompanion(context): OutboundMessage;    // commit+push/reset/…: "커밋 승인만 준비할 수 있어요. push/reset 등은 아직 지원하지 않아요. git 명령은 실행하지 않았어요."
```
(That is **nine** commit composer methods plus the two split unavailable variants — count them explicitly in
tests.) `buildCommitApprovalReason(...)` composes the approval `reason` string (CA #4/#11): operation "git
commit approval planning" · workspaceRef id · bounded candidate files (≤30 + omitted count) · commit message ·
validation context · "no git add/commit/push has been performed" · "this approval records permission only;
actual git commit is deferred to a later step" · risk HIGH — **no raw diff**.

### 5.8 (reserved)

## 6. Required Architecture Questions — answers for CA review

**Q1. Which approval flow to reuse?** `ApprovalManager.requestForRisk` creates the PENDING HIGH
`ApprovalRequest`; `decide(id, decision)` records APPROVED/REJECTED; `get(id)` reads it. The runtime pattern
is Sprint 2s's `handleApplyIntentTurn`/`handleApplyApprovalTurn` (create → `AWAITING_APPROVAL` anchor →
decide). Approved context is stored **on the plan-less apply anchor** (metadata via `StatelessApplyPreviewFlow`).
Denial/cancel in the apply flow **cleared** the anchor; the commit flow instead **reverts to WORKSPACE_APPLIED**
(§5.5, Q12). **`findPending` never returns the commit approval** (plan-less anchor task → `task.planId`
absent → null), so there is no first-approval-handler conflict (§2, verified). **CA #3:** before `decide`,
the handler `approvals.get(anchor.commitApprovalId)` and verifies the request **exists, is PENDING, and its
`executionPlanRef.id === anchor.executionPlanRef.id`** — else safe failure, no decide (§5.5).

**Q2. New commit-approval context + state?** New anchor statuses `COMMIT_APPROVAL_PENDING` (justified: a real
HIGH approval is pending and must intercept every turn, exactly like `AWAITING_APPROVAL`, but is a distinct,
post-apply gate) and `COMMIT_APPROVED` (justified: preserves the approved commit context —
`commitApprovalId`/`proposedCommitMessage`/`commitCandidateFiles` + existing refs — for a future Sprint 2y
executor, mirroring how 2s's `APPROVED` preserved apply context for 2t/2u). Reuses the existing
`ApplyPreviewAnchor` with explicit fields (no broad new global state). **No `COMMITTED`/`GIT_COMMITTED`.** No
raw diff persisted.

**Q3. Trigger?** `interpretCommitIntent` (§5.4): `COMMIT_WORDS` (커밋해/커밋 준비/커밋 승인/커밋 메시지/git
commit/commit this/prepare commit/create commit approval) → `'commit'`; a commit word bundled with a
push/add/reset/stash/checkout/branch/tag/merge/rebase companion → `'commit-with-forbidden'` (rejected);
otherwise null. Bare 좋아/오케이/확인/다음 단계/진행해/이대로 해 → null. Push/add/reset-**only** phrases → null,
so the Sprint 2w git-preview mutating-reject still handles them unchanged. "커밋 전에 변경사항 요약" does
**not** match `COMMIT_WORDS` (no action verb after 커밋) → remains a 2w status phrase.

**Q4. Is `git add` in scope?** No. Sprint 2x plans approval only; whether the future commit executor stages
exact files is Sprint 2y's decision. No `add`/`commit` here.

**Q5. Candidate files? (APPROVED WITH CHANGES)** `git status` changed set ∩ `anchor.targetFiles`, each path
first passed through **`safeRelativePath`** (absolute/`..`/empty/non-normalizable → unsafe → out-of-scope,
never trusted, CA #6). Any out-of-scope/unsafe path **or an empty in-scope set after intersection** → warn
and stop, **no approval** (`composeCommitOutOfScopeChanges`, CA #14). Clean tree → `composeCommitNothingToCommit`.
Lists bounded (out-of-scope ≤10, candidates ≤30, CA #7). Staged/unstaged/untracked summarized by group.

**Q6. Commit message?** Deterministic template only, no AI (§5.6), bounded to 120 chars.

**Q7. User-provided message? (APPROVED WITH CHANGES)** Accepted only if **exactly one** quoted segment,
single-line, ≤120 chars, control-char-free, trimmed non-empty; **more than one quoted message-like segment →
invalid** (CA #8). Backticks/punctuation are allowed within those bounds. Else `composeCommitMessageInvalid`,
no approval (§5.6).

**Q3. Trigger? (APPROVED WITH CHANGE)** `interpretCommitIntent` (§5.4): commit words → `'commit'`; **a commit
word bundled with a push/add/reset/… companion → `'commit-with-forbidden'` (priority over plain commit)** →
rejected; push/add/reset-**only** (no commit word) → null (2w mutating-reject handles it, unchanged); "커밋
전에 변경사항 요약" → 2w status preview (no commit word). "커밋 메시지 만들어줘" creates an approval whose reply
is unambiguous that it is an approval request and nothing is committed (CA #5).

**Q8. Clean tree?** `composeCommitNothingToCommit`, no approval, no mutation.

**Q9. Git status read fails? (APPROVED WITH CHANGE)** `composeCommitStatusUnavailable` (split from
`composeCommitUnavailable`, CA #12) — a read WAS attempted, so it states "읽기 전용 Git 상태 확인 중 문제가
발생했지만 git add/commit/push는 하지 않았어요" and **never** "git 명령은 실행하지 않았어요"; no approval, **no
CommandExecution/shell fallback**, no mutation; failure logged without content.

**Q10. Validation context?** Reuses the 2w read-only `loadValidationContext` (`commandExecutions.get`):
resolved → "최근 검증 기록: {cmd} {status}"; absent → "검증 기록 없음"; lookup fail → "최근 검증 기록을
불러올 수 없어요" (never blocks the commit approval). Validation is **not required** to request a commit
approval — it is display-only.

**Q11. Approval reason? (APPROVED WITH CHANGES)** `buildCommitApprovalReason`: operation ("git commit approval
planning"), `workspaceRef` id, **bounded** candidate files (≤30 + omitted count), proposed commit message,
validation context, risk HIGH, an explicit note that **no git add/commit/push has been performed**, and that
**this approval records permission only — actual git commit is deferred to a later step** (CA #4). **No raw
diff content** (and no `git.diff` is ever called, CA #1).

**Q12. After approval this sprint? (APPROVED WITH CHANGES)** **No commit execution.** Approve → `decide`
records APPROVED, re-anchor `COMMIT_APPROVED`, `composeCommitApprovalRecorded` ("승인은 기록했어요; 아직 실제
git add/commit/push는 수행하지 않았어요" — never "커밋 완료"/committed, CA #10). Deny/cancel → `decide` records
REJECTED, **revert to `WORKSPACE_APPLIED`** clearing **only** the commit fields (`commitApprovalId`/
`proposedCommitMessage`/`commitCandidateFiles`) while **preserving** `workspaceRef`/`workspaceChangeRef`/
`postApplyValidationRef`/`targetFiles` (CA #9), with a **commit-specific** reply
(`composeCommitApprovalDenied`/`composeCommitApprovalCancelled` — "이미 적용된 파일 변경은 그대로 있어요";
never the generic `composeExecutionResult`, CA #11).

**Q13. Does ExecutionOrchestrator change?** **No.** The handler creates the approval directly (as Sprint
2s–2w compose capabilities directly). No new stage; not called on this path.

**Q14. Prove no hidden side effects? (APPROVED WITH CHANGES)** Tests (§8): the commit path calls only
`git.status` (read-only) + `approvals.requestForRisk`/`decide`/`get` + `commandExecutions.get`; **`git.diff`
is never called** (CA #1); `workspaceWrite.apply` 0, `patch.generate`/`patch.get` 0, `codeGeneration.generate`
0, `command.run` 0, `orchestrator.run`/`.resume` 0; no shell; no git mutation capability exists on the dep so
add/commit/push/reset is not even callable. **Added per CA #14:** `approvals.decide` is **not** called on a
malformed pending context or a missing/mismatched approval request; **no** approval is created for
unsafe/out-of-scope paths or an empty candidate set; deny/cancel uses commit-specific (not generic) wording;
the approval reason contains no raw diff.

## 7. Case matrix

| Case | Detection / state | Result |
|---|---|---|
| 1. WORKSPACE_APPLIED + "커밋해줘"/"이 변경사항 커밋해줘"/"git commit 준비해줘"/"commit this", in-scope changes | `commit` | `git.status` (never `git.diff`) → HIGH `requestForRisk` → re-anchor `COMMIT_APPROVAL_PENDING` → `AWAITING_APPROVAL` |
| 2. + user message `메시지는 "fix: …"` (one valid quoted segment) | `commit` | same, using the sanitized user message |
| 3. + user message multiline / >120 / control chars / **multiple quoted segments** | `commit` | `composeCommitMessageInvalid`, **no approval** |
| 4. WORKSPACE_APPLIED, git status clean | `commit` | `composeCommitNothingToCommit`, no approval |
| 5. WORKSPACE_APPLIED, changes outside `targetFiles`, or **empty in-scope after intersection** | `commit` | `composeCommitOutOfScopeChanges` (≤10 shown), no approval |
| 5b. WORKSPACE_APPLIED, a changed path is absolute/`..`/empty/non-normalizable | `commit` | unsafe → out-of-scope → `composeCommitOutOfScopeChanges`, no approval |
| 6. WORKSPACE_APPLIED, `git.status` throws | `commit` | `composeCommitStatusUnavailable` (read attempted; not "git 명령 미실행"), no approval, no fallback |
| 7. "commit and push"/"커밋하고 push" | `commit-with-forbidden` | `composeCommitUnsupportedCompanion`, no git, no approval |
| 8. "push 해줘"/"git add 해줘"/"reset"/"stash" (no commit word) | → null | Sprint 2w git-preview mutating-reject (unchanged), no approval |
| 9. COMMIT_APPROVAL_PENDING + "승인" | approve | verify request (exists/PENDING/plan) → `decide` APPROVED → re-anchor `COMMIT_APPROVED` → `composeCommitApprovalRecorded` (commit NOT executed) |
| 10. COMMIT_APPROVAL_PENDING + "거절" / "취소" | deny/cancel | verify → `decide` REJECTED → revert `WORKSPACE_APPLIED` (clear commit fields only) → `composeCommitApprovalDenied`/`Cancelled` (applied files remain) |
| 11. COMMIT_APPROVAL_PENDING + ambiguous | ambiguous | `composeApprovalNotice` re-prompt; **no decide, no new approval**; pending context preserved |
| 11b. COMMIT_APPROVAL_PENDING with incomplete context (missing id/msg/candidates/refs) | integrity guard (CA #2) | `composeCommitUnavailable`, **no decide, no git, no re-anchor** |
| 11c. COMMIT_APPROVAL_PENDING but approval request missing / not PENDING / plan mismatch | verify (CA #3) | `composeCommitUnavailable`, **no decide** |
| 12. COMMIT_APPROVED + "커밋해줘" | `commit` | `composeCommitAlreadyApproved` (already approved, not committed; no new approval, no commit) |
| 13. "커밋해줘" with no WORKSPACE_APPLIED/COMMIT_APPROVED anchor | `commit` | `composeCommitUnavailable`, no approval, no git |
| 14. "좋아"/"오케이"/"확인"/"다음 단계"/"진행해" at WORKSPACE_APPLIED | null | not a commit request; falls through (no approval) |
| 15. any commit path | — | never `git.diff`; never `COMMITTED`; never git add/commit/push / CommandExecution / WorkspaceWrite |

## 8. Required Tests (Node 22) — the CA's full 72-item list

**`conversation-runtime.test.ts`** — intent + status read (1–6): 1–4. WORKSPACE_APPLIED + "커밋해줘"/"이
변경사항 커밋해줘"/"git commit 준비해줘"/"commit this" → `git.status` read. 5. "커밋 메시지 만들어줘" → creates
an explicit approval request (reply says approval-only, no mutation). 6. "커밋 전에 변경사항 요약" → **not** a
commit approval; stays a 2w status preview.

Negative / gating (7–9): 7. "좋아"/"오케이"/"확인" → no approval. 8. "다음 단계"/"진행해" → no approval.
9. no WORKSPACE_APPLIED anchor → `composeCommitUnavailable`, no approval.

Mutation rejection (10–13): 10. "push 해줘" → no approval. 11. "commit and push" →
`composeCommitUnsupportedCompanion`, no approval. 12. "git add 해줘" → no approval. 13. "reset/stash/checkout"
→ no approval.

Status preconditions (14–17): 14. clean → `composeCommitNothingToCommit`, no approval. 15. `git.status`
throws → `composeCommitStatusUnavailable`, no approval. 16. status failure → no `command.run` fallback.
17. status-failure reply does **not** say "git 명령은 실행하지 않았어요".

Candidate files + path safety (18–25): 18. in-scope changes → approval created. 19. change outside
`targetFiles` → warn, no approval. 20. untracked outside `targetFiles` → warn, no approval. 21. changes only
outside `targetFiles` (empty in-scope) → warn, no approval. 22. absolute changed path → warn, no approval.
23. traversal (`..`) changed path → warn, no approval. 24. empty changed path → warn, no approval. 25.
staged/unstaged/untracked summarized clearly.

Commit message (26–33): 26. deterministic ≤120 chars. 27. valid user message accepted. 28. multiline
rejected. 29. >120 rejected. 30. message trimmed. 31. **multiple quoted candidates rejected**. 32. message
contains no raw diff. 33. approval reason contains no raw diff.

Approval shape (34–39): 34. risk HIGH. 35. reason includes bounded candidate files. 36. reason includes commit
message. 37. reason includes validation context. 38. reason says no git add/commit/push performed. 39. reason
says actual commit is deferred.

Anchor / decision integrity (40–53): 40. commit context stored only when approval is created. 41. PENDING
missing `commitApprovalId` → safe failure, no decide. 42. missing `proposedCommitMessage` → safe failure, no
decide. 43. missing `commitCandidateFiles` → safe failure, no decide. 44. approval request missing/not
PENDING/plan-mismatch → safe failure, no decide. 45. ambiguous decision → preserves pending context, no new
approval, no decide. 46. deny → revert `WORKSPACE_APPLIED`, clear commit fields. 47. cancel → revert, clear
commit fields. 48. deny/cancel preserve `workspaceRef`/`workspaceChangeRef`/`postApplyValidationRef`/
`targetFiles`. 49. deny/cancel reply says applied files remain + commit not performed. 50. "승인" does not
execute a git commit. 51. "승인" reply says approval recorded but commit not performed. 52. "승인" re-anchors
`COMMIT_APPROVED`. 53. `COMMIT_APPROVED` + "커밋해줘" → already-approved/not-committed reply.

No side effects (54–65): 54. no `git.diff`. 55. no git add. 56. no git commit. 57. no git push. 58. no git
reset. 59. no `command.run`. 60. no `workspaceWrite.apply`. 61. no `patch.generate`. 62. no `patch.get`.
63. no `codeGeneration.generate`. 64. no `orchestrator.run`/`.resume`. 65. no runtime shell (structural — the
`git` dep exposes only read-only `status`/`diff`; no mutation method exists).

**`response-composer.test.ts`** (66–70): 66. `composeCommitApprovalRequested` says approval-only, no actual
commit. 67. `composeCommitApprovalRecorded` says no git add/commit/push performed. 68. deny/cancel texts are
commit-specific (say applied files remain; not the generic execution-result wording). 69.
`composeCommitUnavailable` (wrong state) and `composeCommitStatusUnavailable` (read failure) are distinct.
70. no commit reply says committed / 커밋 완료 / pushed / ready to deploy / safe to commit; all
`composeCommit*` replies are distinct.

**Node 22**: 71. `pnpm typecheck` green. 72. `pnpm test` green.

## 9. Architecture Impact / Reuse

- **Reuses, unchanged:** `ApprovalManager.requestForRisk`/`decide`/`get` (CAP-004), the Sprint 2s approval-#2
  runtime pattern (`interpretDecision`/`decisionOf`/`APPROVE|DENY|CANCEL_WORDS`/`composeApprovalNotice`/
  `composeExecutionResult`), `GitManager.status` (CAP-002, read-only, 2w `git` dep), the 2w
  `loadValidationContext`/`commandExecutions.get`, `StatelessApplyPreviewFlow` (findAnchor/anchor/clear),
  `normalizeRelativePath`, the Sprint 2u `WORKSPACE_APPLIED` anchor + refs.
- **Changes:** `conversation-runtime.ts` (+2 anchor statuses, +3 anchor fields, +`interpretCommitIntent` +
  word-sets, +`safeRelativePath` helper, +1 interception & +1 routing block, +5 handlers +
  `parseCommitMessage`/`buildCommitApprovalReason`/`logCommitApprovalFailed`, with strict decision-turn
  integrity + approval-request verification, CA #2/#3), `response-composer.ts` (+**11** methods — the nine
  listed in §5.7 including the split `composeCommitUnavailable`/`composeCommitStatusUnavailable` and the
  separate `composeCommitApprovalDenied`/`Cancelled`), `stateless-apply-preview-flow.ts` (+1-line status
  mapping). **No `app.module.ts` change** (no new dep/provider). **`git.diff` is never called** (CA #1).
- **No new** capability / port / aggregate / repository / migration / dependency. **No** `GitProvider`
  mutation method. **No** `Core` or `ExecutionOrchestrator` contract change. **No git mutation.**
- **ADR-0045** (to be authored before implementation) must document, per CA-required content: Sprint 2x is
  explicit git-commit **approval planning** only; a git commit is a repository mutation and is **not**
  performed — no git add/commit/push, not even after approval (execution deferred to Sprint 2y); HIGH
  `ApprovalRequest` via `ApprovalManager.requestForRisk`; approval context stored on `ApplyPreviewAnchor`;
  `COMMIT_APPROVAL_PENDING`/`COMMIT_APPROVED` semantics with **`COMMIT_APPROVED` ≠ committed** and **no
  `COMMITTED`/`GIT_COMMITTED`**; the plan-less anchor ↔ `StatelessApprovalFlow` interaction (`findPending`
  returns null) and the commit-approval decision interception; **strict pending-context integrity guard** and
  **approval-request get/status/executionPlan verification before `decide`**; deny/cancel **reverts to
  `WORKSPACE_APPLIED` clearing only commit fields** and **preserving** the applied workspace context, with a
  commit-specific (not generic) reply; deterministic commit message (no AI) + conservative single-message
  user-provided validation; candidate files = changed ∩ targetFiles with **defensive path normalization** and
  **bounded** lists; out-of-scope/unsafe/empty-candidate blocks approval; clean tree blocks approval; git
  **status** read failure blocks approval with **precise wording** (never "git 명령 미실행"); validation is
  display-only and not required; approval reason bounded and **contains no raw diff**; **no `GitProvider`
  add/commit/push**; **no `git.diff`** in Sprint 2x; no CommandExecution/shell fallback; no WorkspaceWrite/
  Patch/CodeGeneration/ExecutionOrchestrator; no overclaim (safe-to-commit/ready-to-push/deploy/committed).

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| A git mutation slips in | High (safety) | no git mutation method exists on any dep (only read-only `git.status`; **`git.diff` never called**); the handler only reads status + creates an approval; execution is explicitly Sprint 2y (§4/§5.5, CA #1) — tested (§8 54–65) |
| Commit runs after "승인" | High (safety) | approve re-anchors `COMMIT_APPROVED` + "not performed yet" reply; no git call (§5.5, Q12) — tested (§8 50–52) |
| Deciding on a malformed/missing approval | High (safety) | strict pending-context integrity guard + `approvals.get` existence/PENDING/plan verification before `decide` → safe failure (§5.5, CA #2/#3) — tested (§8 41–44) |
| commit+push bundled runs a push | High | `commit-with-forbidden` → `composeCommitUnsupportedCompanion`, no approval, no git (§5.4, CA #3) — tested (§8 11) |
| Unrelated / unsafe working-tree changes get committed | High | candidates = changed ∩ targetFiles after `safeRelativePath` (absolute/`..`/empty → unsafe → out-of-scope); any out-of-scope/unsafe/empty-candidate → warn + stop, no approval (§5.6, CA #6/#14) — tested (§8 19–24) |
| `findPending` hijacks the commit approval | Med (arch) | plan-less anchor task → `task.planId` absent → `findPending` null; handled only via the anchor interception (§2/§6 Q1) |
| Unsanitized/AI/multi commit message | Med | deterministic template default; user message single-line/≤120/no-control/trimmed/**exactly one segment** else rejected; no AI, no diff (§5.6, CA #8) — tested (§8 26–33) |
| Denied commit discards the applied state, or reads as code-change cancel | Med | deny/cancel reverts to `WORKSPACE_APPLIED` clearing only commit fields (preserve refs), never `clear()`, with a **commit-specific** reply (§5.5, CA #9/#11) — tested (§8 46–49) |
| Git-read failure falls back / mis-worded | Med | caught → `composeCommitStatusUnavailable` (precise; not "git 명령 미실행"), no fallback (§5.5, CA #9/#12) — tested (§8 15–17) |
| Unbounded file lists flood chat | Med | out-of-scope ≤10, candidates ≤30, reason ≤30 + omitted count (§5.6/§5.7, CA #7) |
| Overclaim / COMMIT_APPROVED read as committed | Med (Product) | replies say files applied, no git add/commit/push performed, "아직 실제 commit 안 함"; forbidden 커밋 완료/committed/deploy (§5.7, CA #10) — tested (§8 66–70) |
| Broad general commit handling | Low | gated on WORKSPACE_APPLIED/COMMIT_APPROVED; else `composeCommitUnavailable`; no anchor → no commit flow (§5.4, Constraint 5) — tested (§8 9, 13) |

## Next Step

Plan-only (this document). Per the approved sequence: (1) this plan → **Chief Architect Review**; (2) on
approval, author ADR-0045; (3) implement exactly this scope (§3/§5) on a `v2/<topic>` branch; (4) add/update
tests per §8; (5) validate on **Node 22**; (6) open a PR for Chief Architect Implementation Review. **Stop
here** — no implementation, branch, commit, or PR until the plan is approved. **No git mutation in this
sprint.**
