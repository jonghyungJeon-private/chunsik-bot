# Sprint 2z Plan — Explicit Git Push Approval (GIT_COMMITTED → push approval halt, NO remote mutation)

- **Status:** APPROVED WITH CHANGES (all 14 required changes applied) → implementing.
- **Base:** `main @ 4f8e3c9b45bcf9c0684857a3d0c8abab338780fe`
- **Validation runtime:** Node 22
- **ADR (proposed):** ADR-0047
- **Predecessors:** ADR-0045 (Sprint 2x — commit approval), ADR-0046 (Sprint 2y — commit
  execution), ADR-0044 (Sprint 2w — read-only git status/diff preview), ADR-0023 (CAP-002 Git).

## 1. Goal

From a `GIT_COMMITTED` anchor (Sprint 2y — a local commit exists, nothing pushed), an explicit git
**push** request ("푸시해줘"/"원격에 올려줘"/"git push 해줘"/"push this commit") **plans** a push:
re-verifies the committed context, performs the read-only Git inspection needed to prepare a push
(current HEAD == committed hash, clean working tree, an upstream exists + safely parses, the local
branch is ahead and not diverged), creates a **CRITICAL `ApprovalRequest`**, and halts at a
push-approval-pending state.

**This sprint performs NO remote mutation** — no `git push`, not even after the user approves
(execution is a future Sprint 3a+). It only creates the approval gate.

```text
GIT_COMMITTED
→ explicit push request
→ verify committed local context (commitHash SHA-shaped, HEAD == commitHash, clean tree)
→ read-only push-target inspection (upstream exists + parses, ahead ≥ 1, not diverged)
→ CRITICAL push ApprovalRequest (point-in-time snapshot)
→ PUSH_APPROVAL_PENDING
→ approval records PUSH_APPROVED only
→ NO git push
```

## 2. Boundary & the most important rule

> **`git push` mutates a remote, shared repository, so Sprint 2z stops before it.** The runtime reads
> only `git.info` + `git.status` (read-only, no network fetch, no CommandExecution/shell), creates a
> CRITICAL `ApprovalRequest`, and halts. Nothing push-mutating runs — not on request, not on
> approval. `PUSH_APPROVED` means the push was **approved, not performed**, and the approval is a
> **point-in-time snapshot** (future push execution must re-read HEAD/upstream/ahead/behind before
> mutating). There is **no `GIT_PUSHED`/`PUSHED` state** and no overclaim (pushed / ready-to-push /
> push-safe / deployed / PR-created).

**Explicitly out of scope (NOT implemented in 2z):** `git push` execution · `GitProvider.push` ·
`GitManager.push` · a push method on the runtime deps · CommandExecution-based git · runtime
shell-out · PR creation · deployment · automatic push (after commit or after approval) · push from
`WORKSPACE_APPLIED`/`COMMIT_APPROVED`/`COMMIT_APPROVAL_PENDING`/no-anchor · **any new global no-anchor
push handling** · push to an arbitrary/user-provided remote or branch · force push
(`--force`/`-f`/강제) · tags · branch creation · `reset`/`checkout`/`stash`/`merge`/`rebase` · upstream
creation · a `GIT_PUSHED`/`PUSHED` state · clean-tree/push-ready/deploy-ready durable semantics ·
`GitCommit` aggregate · ExecutionOrchestrator change · WorkspaceWrite/Patch/CodeGeneration.

## 3. Architecture & reuse

- **Reuses `ApprovalManager.requestForRisk`/`decide`/`get` + `approvalRef()` (CAP-004)** and the
  Sprint 2x/2y approval-halt runtime pattern (`interpretDecision`/`decisionOf`/`APPROVE|DENY|
  CANCEL_WORDS`/`composeApprovalNotice`, plan-less anchor + status interception). `requestForRisk`
  creates a PENDING **CRITICAL** `ApprovalRequest` (never auto-approves — `RiskPolicy.requiresApproval`
  returns true for CRITICAL).
- **Reuses the read-only Git capability (CAP-002).** `GitManager.info` (branch/headSha/detached) and
  `GitManager.status` (working-tree + branch header) are the only git calls; both read-only, argv-only,
  **no network fetch**, no mutation. **No `GitProvider`/`GitManager` push method is added (CA #14).**
- **ONE read-only Git extension (Q1, CA #1-Q1).** `git status --porcelain=v1 -b` **already fetches**
  the header `## <branch>...<remote>/<branch> [ahead N, behind M]`, but `parseBranchLine` **discards**
  the upstream + ahead/behind. Sprint 2z extends the parser to populate the reserved
  `GitStatus.ahead`/`behind` **plus a new optional `GitStatus.upstream?: string`** — **no new git
  subcommand, no new spawn, no network** (§5.2). A dedicated `GitManager.upstream()`/`remoteStatus()`
  was **rejected** (would add a git-execution surface for data the `-b` header already carries).
- **`ConversationRuntime` composes it directly.** New anchor statuses `PUSH_APPROVAL_PENDING` (a real
  CRITICAL approval pending — intercepts every turn) and `PUSH_APPROVED` (approved; context preserved
  for a future push-execution sprint), plus **distinct** push fields (never reuses `commitApprovalId`).
- **Runtime `git` dep widened with `info` (type-only).** The dep exposes `status`/`diff`/`commitFiles`;
  add `info(rootPath): Promise<RepositoryInfo>` — `GitManager.info` already exists (type-only widening).
- **No Core/Orchestrator contract change; no `app.module.ts` change.** No CommandExecution/shell git;
  runtime never shells out.

## 4. Anchor states & context (Constraints 2, 3, 5)

Extend `ApplyPreviewAnchorStatus` after `GIT_COMMITTED`:

```text
… | 'GIT_COMMITTED'
  | 'PUSH_APPROVAL_PENDING'   // a CRITICAL push ApprovalRequest is pending decision; intercepts every turn
  | 'PUSH_APPROVED'           // push approval granted; context preserved for a future push-execution sprint
```

**No `GIT_PUSHED`/`PUSHED` state (Constraint 5).**

New `ApplyPreviewAnchor` fields (distinct from commit fields — **Constraint 3**):

| Field | Meaning |
|---|---|
| `pushApprovalId?: Id` | the pending/decided **push** ApprovalRequest id (distinct from `commitApprovalId`) |
| `pushCommitHash?: string` | the commit sha the push was approved for (snapshot of `commitHash`) |
| `pushRemote?: string` | resolved remote name, e.g. `origin` |
| `pushBranch?: string` | resolved upstream branch name, e.g. `main` (may contain `/`, e.g. `feature/x`) |
| `pushUpstreamRef?: string` | full upstream tracking ref, e.g. `origin/main` |

Set at `PUSH_APPROVAL_PENDING`; **preserved at `PUSH_APPROVED` (CA #8 — never cleared on approve)**;
cleared on deny/cancel (revert to `GIT_COMMITTED`). **Commit context (`commitApprovalId`/`commitHash`/
`committedFiles`/`workspaceRef`/`workspaceChangeRef`/`targetFiles`/`executionPlanRef`/
`postApplyValidationRef`) is preserved throughout** (a future push-execution sprint needs it).

State-by-state behavior (**Constraint 2** — every state explicit; **CA #1** — no new global handling):

| Anchor state | push phrase | forbidden-companion (push + force/PR/deploy/…) |
|---|---|---|
| `GIT_COMMITTED` | plan a CRITICAL push approval (§5.5) | `composePushUnsupportedCompanion`, no approval |
| `PUSH_APPROVAL_PENDING` | **decision flow → ambiguous → re-prompt** (CA #3), no decide, no push | **ambiguous → re-prompt** (CA #3), no decide |
| `PUSH_APPROVED` | `composePushAlreadyApproved` (approved, not pushed) | `composePushUnsupportedCompanion` |
| `WORKSPACE_APPLIED` | **unchanged** — existing Sprint 2w mutating reject | unchanged |
| `COMMIT_APPROVED` | **unchanged** — existing Sprint 2y `composeCommitPushUnsupported` | unchanged |
| `COMMIT_APPROVAL_PENDING` | **unchanged** — existing Sprint 2x commit-approval decision flow | unchanged |
| no anchor / any other state | **unchanged — existing normal classification/fallback (CA #1: NO new push handling)** | unchanged |

## 5. Detailed design

### 5.1 Domain (`packages/core/src/domain/git.ts`)

```ts
export interface GitStatus {
  clean: boolean;
  branch: string;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  ahead?: number;      // NOW populated (2z) — commits ahead of the upstream tracking ref (undefined ⇒ no upstream)
  behind?: number;     // NOW populated (2z) — commits behind the upstream tracking ref (undefined ⇒ no upstream)
  /** Upstream tracking ref (e.g. "origin/main") from the `-b` header; undefined ⇒ no upstream (CA #12). */
  upstream?: string;   // NEW (2z)
  // … other reserved fields unchanged
}
```

`ahead`/`behind` are relative to the **local** remote-tracking ref (`git status -b` performs **no
network fetch**) — point-in-time. **No upstream ⇒ `upstream`/`ahead`/`behind` all `undefined` (NOT
`0`)** so callers distinguish "no upstream" from "in sync" (CA #12). `RepositoryInfo` is unchanged
(`branch` / `headSha?` / `detached`).

### 5.2 Adapter (`packages/git-local/src/index.ts`) — read-only parser extension ONLY

No new git command; the `-b` header is already fetched by `status`. Extend `parsePorcelain` to derive
`upstream`/`ahead`/`behind` from the `## …` header:

```text
## main...origin/main [ahead 2, behind 1]  → branch=main upstream=origin/main ahead=2 behind=1
## main...origin/main [ahead 3]            → branch=main upstream=origin/main ahead=3 behind=0
## main...origin/main                       → branch=main upstream=origin/main ahead=0 behind=0
## main                                     → branch=main upstream=undefined ahead/behind undefined
## No commits yet on main                   → branch=main upstream=undefined
## HEAD (no branch)                         → branch=HEAD upstream=undefined (detached)
```

`parseBranchLine` keeps returning the bare branch; a sibling `parseBranchTracking(header)` returns
`{ upstream?, ahead?, behind? }`. When there is no `...upstream`, all three are `undefined`. Argv
unchanged (`git status --porcelain=v1 -b`); no mutating subcommand.

### 5.3 Runtime deps (`ConversationRuntimeDeps.git`) — type-only widening

```ts
readonly git: {
  status(rootPath: string): Promise<GitStatus>;
  diff(rootPath: string): Promise<GitDiff>;
  commitFiles(input: { … }): Promise<GitCommitResult>;
  info(rootPath: string): Promise<RepositoryInfo>;   // NEW (reuse GitManager.info; read-only)
};
```

No push method is added to the dep, `GitProvider`, or `GitManager` (CA #14).

### 5.4 Push-intent detection (CA #1, #2)

A forbidden-companion is classified **only when an explicit push word is present** (CA #2) — a bare
`배포해줘`/`branch`/`tag`/`reset`/`stash` never enters push handling.

```ts
// bare 푸시/push counts (only consulted in push-relevant states) so "푸시하고 배포" is caught as a
// forbidden-companion rather than slipping through as non-push.
const PUSH_WORDS = /(푸시|git\s*push|\bpush\b|원격에\s*올려|리모트에\s*올려|원격으로\s*보내|push\s+this\s+commit|push\s+(the\s+)?approved\s+commit)/i;
const PUSH_FORBIDDEN_COMPANION = /(--?force|\bforce\b|강제|(^|\s)-f(\s|$)|\bPR\b|pull\s*request|풀\s*리퀘|배포|deploy|머지|\bmerge\b|리베이스|rebase|\btag\b|태그|\bbranch\b|브랜치|리셋|\breset\b|checkout|체크아웃|stash|스태시)/i;

static interpretPushIntent(text: string): 'push' | 'push-unsupported' | null {
  const t = text.trim().toLowerCase();
  if (!PUSH_WORDS.test(t)) return null;                       // (CA #2) no push word → not push handling
  if (PUSH_FORBIDDEN_COMPANION.test(t)) return 'push-unsupported'; // push + force/PR/deploy/tag/branch/… 
  return 'push';                                              // bare push word → push approval
}
```

**Routing (CA #1 — anchored to post-commit context only; no global no-anchor handler):**

```ts
// (Sprint 2z) A pending push approval intercepts EVERY turn — decision flow only (CA #3).
if (applyAnchor?.status === 'PUSH_APPROVAL_PENDING')
  return this.handlePushApprovalDecisionTurn(message, session, actor, applyAnchor);

if (applyAnchor?.status === 'GIT_COMMITTED') {
  const k = ConversationRuntime.interpretPushIntent(message.text);
  if (k === 'push-unsupported') return this.handlePushUnsupportedCompanionTurn(message, session);
  if (k === 'push')            return this.handlePushApprovalTurn(message, session, actor, applyAnchor);
}
if (applyAnchor?.status === 'PUSH_APPROVED') {
  const k = ConversationRuntime.interpretPushIntent(message.text);
  if (k === 'push-unsupported') return this.handlePushUnsupportedCompanionTurn(message, session);
  if (k === 'push')            return this.handlePushAlreadyApprovedTurn(message, session);
}
// (CA #1) NO no-anchor / other-state push handling is installed. WORKSPACE_APPLIED → 2w reject,
// COMMIT_APPROVED → 2y push-unsupported, COMMIT_APPROVAL_PENDING → 2x decision, no anchor → existing
// classification/fallback — all UNCHANGED.
```

### 5.5 `handlePushApprovalTurn` — plan a push and halt (GIT_COMMITTED)

```ts
private async handlePushApprovalTurn(message, session, actor, anchor): Promise<TurnResult> {
  // 1. (Constraint 2) complete committed context, else safe failure (no approval). Log never throws.
  if (anchor.status !== 'GIT_COMMITTED' || !anchor.commitHash || !anchor.committedFiles?.length ||
      !anchor.workspaceRef || !anchor.executionPlanRef) {
    this.logPushApprovalFailed(session, anchor, 'committed context incomplete');
    return this.failComposed(message, session, this.deps.composer.composePushApprovalUnavailable(message.context));
  }
  // 2. (Constraint 8) commitHash SHA-shaped, else safe failure.
  if (!/^[0-9a-f]{7,40}$/i.test(anchor.commitHash))
    return this.failComposed(message, session, this.deps.composer.composePushApprovalUnavailable(message.context));

  // 3. Fresh read-only info (Constraint 6/9). Throw → composePushStatusUnavailable, NO approval, NO fallback.
  let info: RepositoryInfo;
  try { info = await this.deps.git.info(anchor.workspaceRef.rootPath); }
  catch { this.logPushApprovalFailed(session, anchor, 'git info read failed');
          return this.failComposed(message, session, this.deps.composer.composePushStatusUnavailable(message.context)); }

  // 4. (Constraint 8/Q6, CA #11) detached HEAD OR HEAD ≠ committed hash → no approval, new review.
  if (info.detached || !info.headSha || info.headSha !== anchor.commitHash) {
    this.logPushApprovalFailed(session, anchor, 'HEAD detached or differs from committed hash');
    return this.failComposed(message, session, this.deps.composer.composePushHeadMovedUnavailable(message.context));
  }

  // 5. Fresh read-only status. Throw → composePushStatusUnavailable.
  let status: GitStatus;
  try { status = await this.deps.git.status(anchor.workspaceRef.rootPath); }
  catch { this.logPushApprovalFailed(session, anchor, 'git status read failed');
          return this.failComposed(message, session, this.deps.composer.composePushStatusUnavailable(message.context)); }

  // 6. (CA #10) dirty working tree blocks push approval — push approval must correspond to a clean
  //    committed state. Point-in-time; rechecked at future execution.
  if (status.staged.length || status.unstaged.length || status.untracked.length)
    return this.respondComposed(message, session, this.deps.composer.composePushDirtyWorkingTree(message.context));

  // 7. (Constraint 7/Q7) upstream must exist — 2z never creates/asks for one, never accepts a user remote.
  if (!status.upstream)
    return this.respondComposed(message, session, this.deps.composer.composePushNoUpstream(message.context));
  // 8. (CA #5/#6) upstream must safely parse to <remote>/<branch>: non-empty, no control chars, bounded.
  const parsed = parsePushUpstream(status.upstream); // → { remote, branch } | null (§5.6)
  if (!parsed)
    return this.respondComposed(message, session, this.deps.composer.composePushNoUpstream(message.context));
  // 9. (Constraint 8/Q8) ahead ≥ 1 else nothing to push; (Q23) behind === 0 else diverged.
  if (!status.ahead || status.ahead < 1)
    return this.respondComposed(message, session, this.deps.composer.composePushNothingToPush(message.context));
  if (status.behind && status.behind > 0)
    return this.respondComposed(message, session, this.deps.composer.composePushDiverged(message.context));

  // 10. HEAD == commitHash & ahead ≥ 1 ⇒ committed hash is the tip of the ahead range (Constraint 8).
  //     Create the CRITICAL push ApprovalRequest (Constraint 4). Reason = bounded op/commitHash/remote/
  //     upstream/branch/ahead + "no git push performed" + "records permission only; NOT executed in
  //     Sprint 2z; future execution requires a separate step" + point-in-time note (CA #4/#6/#7/#13).
  //     NO diff/file content; NO validation/test context (CA #13).
  const approval = await this.deps.approvals.requestForRisk({
    executionPlanRef: anchor.executionPlanRef,
    riskLevel: RiskLevel.CRITICAL,
    reason: buildPushApprovalReason({ commitHash: anchor.commitHash, remote: parsed.remote,
                                      branch: parsed.branch, upstream: status.upstream, ahead: status.ahead }),
    requestedBy: actor.id,
  });

  // 11. Halt at PUSH_APPROVAL_PENDING, preserving distinct push context + all commit context.
  await this.deps.applyPreviewFlow.anchor(session, {
    ...anchor, status: 'PUSH_APPROVAL_PENDING', pushApprovalId: approval.id,
    pushCommitHash: anchor.commitHash, pushRemote: parsed.remote, pushBranch: parsed.branch,
    pushUpstreamRef: status.upstream,
  });
  const reply = this.deps.composer.composePushApprovalRequested(message.context,
    { commitHash: anchor.commitHash, remote: parsed.remote, branch: parsed.branch,
      upstream: status.upstream, ahead: status.ahead });
  await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
  return { status: 'AWAITING_APPROVAL', reply, sessionId: session.id };
}
```

### 5.6 Upstream parsing + bounding (CA #5, #6)

```ts
const MAX_GIT_REF_DISPLAY = 80; // bound user-controllable branch/remote display
/** Split an upstream tracking ref into <remote>/<branch> on the FIRST '/'; validate + bound. null ⇒ reject. */
function parsePushUpstream(upstream: string): { remote: string; branch: string } | null {
  if (typeof upstream !== 'string') return null;
  const u = upstream.trim();
  if (u.length === 0 || u.length > MAX_GIT_REF_DISPLAY) return null;      // bounded (CA #6)
  if ([...u].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) return null; // no control chars
  const slash = u.indexOf('/');
  if (slash <= 0 || slash === u.length - 1) return null;                  // must be <remote>/<branch>, both non-empty
  const remote = u.slice(0, slash);
  const branch = u.slice(slash + 1);                                      // may contain '/', e.g. feature/x
  if (/\s/.test(remote)) return null;                                     // remote has no whitespace
  return { remote, branch };
}
```

`buildPushApprovalReason` renders **bounded** remote/branch/upstream (each `.slice(0, MAX_GIT_REF_DISPLAY)`),
never a raw unbounded/control-char string, and includes the point-in-time + permission-only + future-step
lines. `composePushApprovalRequested` likewise bounds displayed values (CA #6).

### 5.7 `handlePushApprovalDecisionTurn` — decide (PUSH_APPROVAL_PENDING), mirrors 2x (CA #3, #9)

- **Strict context guard (CA #9):** status `PUSH_APPROVAL_PENDING` + `pushApprovalId` + `pushCommitHash`
  + `pushRemote` + `pushBranch` + `pushUpstreamRef` + `commitHash` + `workspaceRef` + `executionPlanRef`.
  Any missing → safe failure, **no `decide`, no git, no re-anchor**; the failure log uses optional
  access so it never throws.
- **Ambiguous decision (CA #3)** — including any push/force/deploy phrase (they are not approve/deny/
  cancel) → re-prompt via `composeApprovalNotice` (fresh `approvals.get`), preserving pending context
  (no `decide`, no new approval, no re-anchor, no push). Push phrases are **not** routed to
  unsupported-companion while pending — the pending approval remains the primary interaction.
- **Verify the referenced ApprovalRequest (CA #9):** `approvals.get(pushApprovalId)` exists, PENDING,
  same `executionPlanRef.id`. Failure → safe failure `composePushApprovalUnavailable`, no `decide`.
- **Approve** → `decide` APPROVED, re-anchor `PUSH_APPROVED` **preserving ALL push + commit context
  (CA #8 — push fields NOT cleared)**, `composePushApprovalRecorded` (recorded; never "pushed").
  **No git push.**
- **Deny/cancel** → `decide` REJECTED, **revert to `GIT_COMMITTED` clearing ONLY push fields**
  (commit context preserved), push-specific replies (`composePushApprovalDenied`/`Cancelled` — "커밋은
  로컬에 그대로 있어요; git push는 하지 않았어요"). **No git push.**

### 5.8 Other handlers

- `handlePushAlreadyApprovedTurn` (PUSH_APPROVED + push) → `composePushAlreadyApproved`.
- `handlePushUnsupportedCompanionTurn` (push + force/PR/deploy/tag/branch/… on GIT_COMMITTED or
  PUSH_APPROVED) → `composePushUnsupportedCompanion`.
- `logPushApprovalFailed(session, anchor, reason)` — structured, no-content warn (optional field
  access; never diff/file content), mirrors `logCommitApprovalFailed`.
- **No `handlePushApprovalUnavailableTurn` no-anchor handler (removed per CA #1).**

### 5.9 `ResponseComposer` — methods (no overclaim: never pushed/ready-to-push/push-safe/deployed/PR)

```ts
composePushApprovalRequested(ctx, { commitHash, remote, branch, upstream, ahead }): OutboundMessage; // AWAITING_APPROVAL: short hash + bounded remote/branch + ahead + "승인해도 이번 단계에서는 git push를 하지 않아요" + "승인은 현재 확인한 Git 상태 기준이에요; 실제 push 실행 전에는 다시 확인이 필요해요" (CA #4)
composePushApprovalRecorded(ctx): OutboundMessage;         // "push 승인은 기록했어요. 아직 git push는 하지 않았어요. (실제 push는 이후 단계에서 다시 확인 후 진행돼요)"
composePushApprovalDenied(ctx): OutboundMessage;           // "push 승인을 거절했어요. 커밋은 로컬에 그대로 있어요. git push는 하지 않았어요."
composePushApprovalCancelled(ctx): OutboundMessage;        // cancelled variant
composePushApprovalUnavailable(ctx): OutboundMessage;      // wrong state / incomplete/stale context → no approval, no push
composePushStatusUnavailable(ctx): OutboundMessage;        // read-only info/status read failed → no approval; git push 안 함; CommandExecution/shell fallback 안 씀
composePushHeadMovedUnavailable(ctx): OutboundMessage;     // detached OR HEAD != committed hash → 커밋 이후 상태가 바뀌었어요; 다시 검토/승인 필요; no push
composePushDirtyWorkingTree(ctx): OutboundMessage;         // (CA #10) 로컬에 커밋되지 않은 변경이 있어요; 먼저 커밋하거나 정리해 주세요; no approval, no push
composePushNoUpstream(ctx): OutboundMessage;               // no/invalid upstream → 업스트림이 없어(또는 확인 불가) push 대상을 정할 수 없어요; 2z는 업스트림을 만들지 않아요; no approval
composePushNothingToPush(ctx): OutboundMessage;            // ahead 0 → 원격보다 앞선 커밋이 없어요; no approval
composePushDiverged(ctx): OutboundMessage;                 // behind > 0 → 브랜치가 원격과 갈라졌어요; 먼저 정리 필요; no approval, no force
composePushAlreadyApproved(ctx): OutboundMessage;          // PUSH_APPROVED → "이미 push 승인을 받아 뒀어요. 아직 git push는 하지 않았어요."
composePushUnsupportedCompanion(ctx): OutboundMessage;     // push+force/PR/deploy/tag/branch/… → 지원 안 함; no approval, no git
```

Every reply states **no push**; none says pushed / ready-to-push / push-safe / deployed / PR-created.
No validation/test "push-ready" wording (CA #13).

## 6. Required Architecture Questions — CA decisions applied

- **Q1 (read-only API):** reuse `GitManager.info` + `GitManager.status`; extend the status parser to
  populate `upstream`/`ahead`/`behind` (no new git command, no network fetch). **+ validate upstream
  parsing, bound displayed upstream values, block dirty working tree (CA #1-Q1).** Runtime `git` dep
  widened with `info` (type-only). No push method (CA #14).
- **Q2 (states):** `PUSH_APPROVAL_PENDING`, `PUSH_APPROVED`. No `GIT_PUSHED`/`PUSHED`.
- **Q3 (context):** `pushApprovalId`/`pushCommitHash`/`pushRemote`/`pushBranch`/`pushUpstreamRef`,
  distinct from commit context; **preserved at PUSH_APPROVED; cleared only on deny/cancel; commit
  context preserved throughout (CA #8).**
- **Q4 (triggers):** 푸시해줘 · git push 해줘 · 원격에 올려줘 · 리모트에 올려줘 · push this commit ·
  push approved commit. **Unsupported-companion requires a push word; deploy-only/branch-only never
  enters push handling (CA #2).**
- **Q5 (unsupported):** force/`--force`/`-f`/강제 · push+PR · push+deploy · push+tag · push+branch ·
  push+reset/checkout/stash/merge/rebase → `composePushUnsupportedCompanion`, no approval.
- **Q6 (HEAD moved):** no approval; new review (`composePushHeadMovedUnavailable`).
- **Q7 (no upstream):** no approval; never create/ask for an upstream.
- **Q8 (not ahead):** no approval; nothing to push.
- **Q9 (fresh read):** yes; **PUSH_APPROVED is not durable push-ready — future execution must re-read
  (CA #4/#9-doc).**
- **Q10 (after approve):** `PUSH_APPROVED`, no git push, recorded-only reply.
- **Q11 (push again):** already approved, not pushed.
- **Q12 (GitProvider push?):** no.
- **Q13 (Orchestrator change?):** no.
- **Q14 (no side effects):** tests assert no push surface, no global no-anchor handling, unsupported
  requires push word, dirty tree blocks, upstream parse validated, PUSH_APPROVED preserves context +
  is not durable push-ready.
- **Constraint 4 — risk:** **CRITICAL** (remote shared-state mutation; larger blast radius than a
  local commit). No HIGH argument.

## 7. Case matrix

| Case | State / detection | Result |
|---|---|---|
| 1. GIT_COMMITTED + push phrase, HEAD==commit, clean, upstream parses, ahead≥1, behind=0 | `push` | CRITICAL approval → `PUSH_APPROVAL_PENDING` → `composePushApprovalRequested`, no push |
| 2. ambiguous (좋아/오케이/확인/진행해/다음 단계) at GIT_COMMITTED | null | no approval |
| 3. no anchor + push phrase | (CA #1) | **existing classification/fallback — no push handling, no approval** |
| 4. WORKSPACE_APPLIED + push | not 2z | existing 2w mutating reject |
| 5. COMMIT_APPROVED + push | not 2z | existing 2y `composeCommitPushUnsupported` |
| 6. COMMIT_APPROVAL_PENDING + push | 2x interception | commit-approval decision flow, no push |
| 7. GIT_COMMITTED + deploy-only / branch-only (no push word) | null (CA #2) | existing fallback — no push handling |
| 8. GIT_COMMITTED + push+force / push+deploy / push+PR / push+tag / push+branch | `push-unsupported` | `composePushUnsupportedCompanion`, no approval |
| 9. incomplete committed context | guard | `composePushApprovalUnavailable`, no approval, log never throws |
| 10. commitHash not SHA-shaped | guard | `composePushApprovalUnavailable`, no approval |
| 11. `git.info`/`git.status` throws | caught | `composePushStatusUnavailable`, no approval, no fallback |
| 12. detached HEAD OR HEAD ≠ commitHash | verify | `composePushHeadMovedUnavailable`, no approval |
| 13. dirty working tree (staged/unstaged/untracked) | verify (CA #10) | `composePushDirtyWorkingTree`, no approval |
| 14. no upstream / unparseable upstream | verify (CA #5) | `composePushNoUpstream`, no approval |
| 15. ahead 0 | verify | `composePushNothingToPush`, no approval |
| 16. behind > 0 (diverged) | verify | `composePushDiverged`, no approval, no force |
| 17. valid → CRITICAL approval | — | reason: bounded commitHash/remote/upstream/branch/ahead + no-push + permission-only + not-in-2z + future-step + point-in-time; no diff; no validation context |
| 18. PUSH_APPROVAL_PENDING + 승인 | decision | `decide` APPROVED → `PUSH_APPROVED` (push+commit context preserved), no push |
| 19. PUSH_APPROVAL_PENDING + 거절/취소 | decision | `decide` REJECTED → `GIT_COMMITTED`, clear only push fields, no push |
| 20. PUSH_APPROVAL_PENDING + ambiguous / push / force / deploy phrase | decision (CA #3) | re-prompt, preserve context, no `decide`, no push |
| 21. PUSH_APPROVAL_PENDING malformed context | guard | safe failure, no `decide`, no push |
| 22. PUSH_APPROVED + push phrase | already approved | `composePushAlreadyApproved`, no new approval, no push |
| 23. PUSH_APPROVED + ambiguous | null | no push |

## 8. Required Tests (Node 22) — CA's full list (93 items)

**`conversation-runtime.test.ts`** — trigger + approval (1–9): 1–4. GIT_COMMITTED + "푸시해줘" /
"git push 해줘" / "원격에 올려줘" / "push this commit" → CRITICAL push `requestForRisk` once,
`PUSH_APPROVAL_PENDING`. 5. ambiguous → no approval. 6. **no anchor + push phrase → no push approval
AND does not enter push flow (existing fallback) (CA #1)**. 7. WORKSPACE_APPLIED + push → existing 2w.
8. COMMIT_APPROVED + push → existing 2y. 9. PUSH_APPROVED + push → already approved, not pushed.

Companion/force (10–17): 10. **deploy-only at GIT_COMMITTED → no push flow (CA #2)**. 11.
**branch-only at GIT_COMMITTED → no push flow (CA #2)**. 12. force push → no approval. 13. push --force
→ no approval. 14. push and deploy → no approval. 15. push and PR → no approval. 16. push tag/branch →
no approval. 17. push reset/checkout/stash/merge/rebase → no approval.

Context/verification (18–32): 18. missing commitHash → safe failure. 19. invalid commitHash → safe
failure. 20. missing committedFiles → safe failure. 21. missing workspaceRef → safe failure. 22.
missing executionPlanRef → safe failure. 23. git info read failure → safe failure. 24. git status read
failure → safe failure. 25. HEAD ≠ commitHash → safe failure. 26. **detached HEAD → safe failure
(CA #11)**. 27. no upstream → no approval. 28. **upstream without slash → no approval (CA #5)**. 29.
**upstream empty remote/branch → no approval (CA #5)**. 30. **upstream control chars → no approval
(CA #5)**. 31. branch not ahead → no approval. 32. behind/diverged → no approval.

Dirty tree (33–35, CA #10): 33. staged changes → no approval. 34. unstaged changes → no approval. 35.
untracked changes → no approval.

Valid + parsing (36–40): 36. valid origin/main ahead=1 behind=0 → approval. 37. **origin/feature/x →
remote=origin branch=feature/x (CA #5)**. 38–40 → adapter parser (below).

Approval reason (41–49): 41. includes commitHash. 42. includes remote/upstream/branch. 43. includes no
push performed. 44. **includes permission only (CA #7)**. 45. **includes "actual git push not executed
in Sprint 2z" (CA #7)**. 46. **includes "future execution requires separate step" (CA #7)**. 47. no
diff/file content. 48. **bounds remote/upstream/branch display (CA #6)**. 49. risk CRITICAL.

Decision flow (50–58): 50. ambiguous → re-prompt, preserve. 51. **push phrase → re-prompt, no decide
(CA #3)**. 52. **force push phrase → re-prompt, no decide (CA #3)**. 53. **push deploy phrase →
re-prompt, no decide (CA #3)**. 54. approve verifies ApprovalRequest exists/PENDING/plan. 55. 승인 →
`PUSH_APPROVED` only, no push. 56. 거절 → `GIT_COMMITTED`, clear push fields, no push. 57. 취소 →
`GIT_COMMITTED`, clear push fields, no push. 58. malformed pending context → safe failure, no decide.

PUSH_APPROVED context (59–62, CA #8): 59. preserves push fields. 60. preserves commit context. 61.
push phrase → already approved, not pushed. 62. ambiguous → no push.

No side effects (63–82): 63. no `GitManager.push`. 64. no `GitProvider.push`. 65. **no push method in
runtime deps (CA #14)**. 66. no `command.run`. 67. no runtime shell. 68. no `workspaceWrite.apply`.
69. no `patch.*`. 70. no `codeGeneration.*`. 71. no `orchestrator.run/.resume`. 72. no PR. 73. no
deploy. 74–81. no git push/reset/checkout/stash/branch/tag/merge/rebase (runtime calls only
`git.info`/`git.status`; adapter argv). 82. **status argv stays `status --porcelain=v1 -b` (CA #14)**.

Composer (83–91): 83. requested says approval-only/no push. 84. recorded says no push. 85. deny/cancel
say commit remains local + no push. 86. unavailable does not imply pushed. 87. already-approved says
not pushed. 88. status-unavailable says no approval/no push/no CommandExecution-shell fallback. 89.
no-upstream says upstream not created. 90. **dirty-tree says commit/clean first (CA #10)**. 91. **no
reply says pushed/deployed/ready-to-push/push-safe**.

**Adapter (`git-local/src/index.test.ts`) (38–40 + CA #12):** 38. `## main...origin/main` → upstream
origin/main, ahead 0, behind 0. 39. `## main` → upstream/ahead/behind undefined (NOT 0). 40. `## main...
origin/main [ahead 2, behind 1]` → both parsed. + detached `## HEAD (no branch)` → no upstream; argv
stays `status --porcelain=v1 -b`.

**Node 22:** 92. `pnpm typecheck` green. 93. `pnpm test` green.

## 9. Architecture Impact / Reuse

- **Reuses, unchanged:** `GitManager.info`/`status`/`LocalGitProvider` read path + `GitRunner`/
  `sanitizeGitStderr` (CAP-002), `ApprovalManager.requestForRisk`/`decide`/`get` + `approvalRef()`
  (CAP-004), the 2x/2y plan-less anchor + status-interception pattern,
  `interpretDecision`/`decisionOf`/`APPROVE|DENY|CANCEL_WORDS`, `RiskPolicy` (CRITICAL requires
  approval), bounded-composer helpers.
- **Adds:** `GitStatus.upstream?` (+ populated `ahead?`/`behind?`); a read-only `parsePorcelain`
  extension (no new git command); anchor statuses `PUSH_APPROVAL_PENDING`/`PUSH_APPROVED` + 5 push
  fields; `interpretPushIntent` + routing; `handlePushApprovalTurn`/`handlePushApprovalDecisionTurn`
  + 2 small handlers + `logPushApprovalFailed` + `buildPushApprovalReason` + `parsePushUpstream`; 13
  `ResponseComposer` methods; a type-only `git.info` dep widening.
- **Does NOT change:** `GitProvider`/`GitManager` mutation surface (no push), Execution Orchestrator,
  Core/Orchestrator contract, `app.module.ts`, WorkspaceWrite/Patch/CodeGeneration/CommandExecution.

## 10. ADR-0047 (proposed) — Explicit Git Push Approval

- **Status:** Proposed (v2, Phase 2, Sprint 2z — Product Construction).
- **Decision:** From `GIT_COMMITTED`, an explicit push request plans a push behind a **CRITICAL**
  `ApprovalRequest` and halts (`PUSH_APPROVAL_PENDING` → approve → `PUSH_APPROVED`), using only
  read-only `git.info` + `git.status` (with a read-only `upstream`/`ahead`/`behind` parser extension,
  no network fetch). Push handling is **anchored to post-commit context only — no global/no-anchor push
  handler**. `git push` is a **remote repository mutation**; **no `git push`, no `GitProvider`/
  `GitManager` push method, no push dep method, no CommandExecution/shell, no `GIT_PUSHED`/`PUSHED`
  state, no ExecutionOrchestrator change.** Push context is distinct from commit context and
  **preserved at `PUSH_APPROVED`**; remote/branch are derived from the existing upstream (validated,
  bounded, never user-provided); force push and PR/deploy/tag/branch/reset/checkout/stash/merge/rebase
  bundling (requiring a push word) are rejected; a dirty working tree, no/invalid upstream, HEAD
  moved/detached, not-ahead, and diverged all block approval. `PUSH_APPROVED` means approval recorded,
  **not pushed**, and is a **point-in-time snapshot — not durable push-ready; future push execution
  must re-read HEAD/upstream/ahead/behind before mutating**. The reason states permission-only + not
  executed in Sprint 2z + future step; no validation/test "push-ready" wording.
- **Not implemented:** actual `git push` execution (Sprint 3a+), PR creation, deployment, force push,
  upstream creation, arbitrary remote/branch, tags/branch/reset/checkout/stash/merge/rebase.
- **Relations:** ADR-0046 (provides `GIT_COMMITTED` + `commitHash`), ADR-0045 (approval-halt pattern),
  ADR-0044 (read-only git preview; status parser extended), ADR-0025 (CAP-004 Approval), ADR-0023
  (CAP-002 Git — still no mutation beyond 2y's commit). Supersedes nothing.

## 11. Implementation sequence (per CA Final Decision)

1. Apply plan changes (this document). 2. Author ADR-0047 in `DECISIONS.md`. 3. Implement minimal
approved scope. 4. Add/update tests (93 items). 5. Validate on Node 22 (typecheck exit 0 + test
green). 6. Open PR for Chief Architect Implementation Review. **No `git push`, no remote mutation.**
