# Sprint 3a Plan — Approved Git Push Execution (PUSH_APPROVED → exact approved `git push`, first remote mutation)

- **Status:** APPROVED WITH CHANGES (all 16 required changes applied) → implementing.
- **Base:** `main @ bbc5c57e6968293451a88a51ce6002c851a9ef3f`
- **Validation runtime:** Node 22
- **ADR (proposed):** ADR-0048
- **Predecessors:** ADR-0047 (Sprint 2z — push approval), ADR-0046 (Sprint 2y — commit execution,
  the mutation template), ADR-0044 (Sprint 2w — read-only git preview), ADR-0023 (CAP-002 Git).

## 1. Goal

From a `PUSH_APPROVED` anchor (Sprint 2z — a CRITICAL push approval is recorded, nothing pushed), an
explicit push-**execution** command ("승인된 push 실행해줘"/"push 실행해줘"/"이제 실제 push 해줘"/
"execute approved push"/"push approved commit") performs **the exact approved push**: re-verifies the
live approval, **re-reads Git state**, re-validates the persisted approved target + that HEAD/upstream/
ahead/behind/clean-tree still match the approved snapshot, then pushes **exactly the approved local
commit to the exact approved upstream** via a narrow Git-capability mutation, and re-anchors `GIT_PUSHED`.

This is the product's **FIRST real remote mutation** — deliberately narrow and heavily guarded.

```text
PUSH_APPROVED
→ explicit push-execution request
→ verify complete approved push context + safe persisted target strings (CA #3)
→ verify pushApprovalId → APPROVED, plan-matched
→ re-read git.info + git.status (point-in-time)
→ verify not detached, HEAD == pushCommitHash == commitHash
→ verify upstream == pushUpstreamRef, parsed remote/branch == pushRemote/pushBranch
→ verify clean tree, ahead ≥ 1, behind == 0
→ GitManager.pushApprovedCommit(exact approved target)  ← Ref-gated + conservative ref validation
→ LocalGitProvider: git --no-pager push <remote> HEAD:<branch>
→ validate result integrity
→ GIT_PUSHED
→ NO PR creation, NO deployment, NO force, NO rollback
```

## 2. Boundary & the most important rule

> **A push is only ever the exact approved commit to the exact approved upstream, and only after the
> approved Git snapshot is re-proven against a fresh read.** Any drift → **no push, safe failure**.
> `GIT_PUSHED` means the approved commit was pushed to the approved upstream — **never PR-created,
> never deployed, never "ready-to-push"/"push-safe"/"deploy-ready".**

**Remote-mutation safety (CA #1/#2/#10/#11/#16).** A push mutates a remote that may already have changed
by the time a result is validated, so:
- **Pre-push failures** (wrong state / stale approval / drift / read failure / malformed target) →
  **safe to say "git push는 시도하지 않았어요"** (push not attempted).
- **Provider push failure** (the push call threw) → **never claim "remote unchanged" / "확실히 push
  안 됨"**; say push did not complete and the remote should be checked if unsure; **no rollback**.
- **Result-integrity mismatch after a reported success** → say push may have been attempted but the
  result could not be verified; **check the remote manually; no rollback; no `GIT_PUSHED`**.
- **`GitPushResult` is the provider-reported successful target after `git push` exited 0 — NOT an
  independent remote verification.** The runtime uses it only for local integrity checking.

**Explicitly out of scope (NOT implemented in 3a):** force push (`--force`/`-f`/강제) · bare `git push`/
`--all`/`--tags`/`-u`/`--set-upstream` · arbitrary refspec/remote/branch · user-provided remote/branch ·
upstream/branch creation · tags · PR creation · deployment · automatic push · push from any state other
than `PUSH_APPROVED` · a generic `push` API · CommandExecution-based git · runtime shell-out · reset/
checkout/stash/merge/rebase · **remote-mutation rollback** · a `GitPush` aggregate · ExecutionOrchestrator
change · WorkspaceWrite/Patch/CodeGeneration.

## 3. Architecture & reuse

- **Reuses the 2y commit-execution template exactly (ADR-0046).** `GitManager.pushApprovedCommit`
  mirrors `GitManager.commitFiles` (Ref-gated `approvalRef.status === APPROVED` + defensive validation;
  ApprovalRef consumed here, **NOT** passed to the provider); `LocalGitProvider.pushApprovedCommit`
  mirrors `commitFiles` (argv-only `spawnSync`, defensive validation before any git runs,
  `sanitizeGitStderr`, `failure(label,res)`).
- **Reuses `ApprovalManager.get` + `approvalRef()` (CAP-004)** and the 2y/2z re-verify pattern. Risk is
  already CRITICAL (execution adds no new approval).
- **Reuses the read-only Git inspection (CAP-002, 2z):** `git.info` + `git.status` (with the 2z
  `upstream`/`ahead`/`behind` parser) + `parsePushUpstream`. No new read-only surface.
- **Shared conservative ref validator (CA #4):** a new `packages/core/src/application/push-target.ts`
  exports `isSafePushRemote` / `isSafePushBranch`, reused by the runtime (CA #3 pre-mutation),
  `GitManager` (backstop), and the adapter (`assertSafePushTarget`, imported from `@chunsik/core`).
- **`ConversationRuntime` composes it directly.** One new anchor status `GIT_PUSHED` + four pushed
  fields; `interpretPushExecutionIntent`; `handlePushExecutionTurn`; small GIT_PUSHED handlers.
- **Runtime `git` dep widened with `pushApprovedCommit`** (type-only; `GitManager` already registered).
- **No Core/Orchestrator contract change; no `app.module.ts` change.** No CommandExecution/shell git;
  runtime never shells out and never builds low-level push argv (the capability owns it — CA #15).

## 4. Anchor state & context

Extend `ApplyPreviewAnchorStatus` after `PUSH_APPROVED`:

```text
… | 'PUSH_APPROVED'
  | 'GIT_PUSHED'   // the approved commit was pushed to the approved upstream. NOT PR-created, NOT deployed.
```

New `ApplyPreviewAnchor` fields (Q11 — no `GitPush` aggregate): `pushedCommitHash?` / `pushedRemote?` /
`pushedBranch?` / `pushedUpstreamRef?`. Set once `status` becomes `GIT_PUSHED`.

**GIT_PUSHED preserves the full audit context (CA #12):** `pushApprovalId`, `pushCommitHash`,
`pushRemote`, `pushBranch`, `pushUpstreamRef`, `commitApprovalId`, `commitHash`, `committedFiles`,
`workspaceRef`, `workspaceChangeRef`, `targetFiles`, `executionPlanRef`, `postApplyValidationRef`.

State-by-state behavior for a push-execution phrase (gated to push-relevant states):

| Anchor state | push-execution phrase | forbidden-companion (push + force/PR/deploy/…) |
|---|---|---|
| `PUSH_APPROVED` | execute the approved push (§5.5) | `composePushUnsupportedCompanion` (2z), no push |
| `GIT_PUSHED` | `composePushAlreadyPushed` (hash+target, no new push) — CA #7 | `composePushUnsupportedCompanion`, no push |
| `PUSH_APPROVAL_PENDING` | **unchanged — 2z decision flow → ambiguous re-prompt (CA #9)** | unchanged |
| `GIT_COMMITTED` | **unchanged — 2z push-APPROVAL flow (CA #8);** "이제 실제 push 해줘" / "execute approved push" → CRITICAL push approval, NOT execute | unchanged |
| `COMMIT_APPROVED`/`COMMIT_APPROVAL_PENDING`/`WORKSPACE_APPLIED`/no-anchor/other | **unchanged**; NO push execution | unchanged |

A standalone PR/deploy phrase at `GIT_PUSHED` → `composePushPrDeployUnsupported` (already-pushed state +
future sprint; no PR, no deploy) — CA #13.

## 5. Detailed design

### 5.1 Domain (`packages/core/src/domain/git.ts`)

```ts
/**
 * The provider-reported successful push target after `git push` exited 0 (CAP-002, ADR-0048 — the first
 * REMOTE mutation). NOT an independent remote verification, NOT persisted as an aggregate; the runtime uses
 * it only for local result-integrity checking and stores the pushed target on the anchor. `GIT_PUSHED`
 * means pushed to the approved upstream — never PR-created/deployed/push-safe-forever.
 */
export interface GitPushResult {
  remote: string;        // remote pushed to (approved remote)
  branch: string;        // branch pushed to (approved branch; may contain '/')
  upstreamRef: string;   // upstream ref pushed to, e.g. "origin/main" (approved)
  commitHash: string;    // commit sha pushed (approved pushCommitHash; HEAD at push time)
}
```

### 5.2 Shared ref validator (`packages/core/src/application/push-target.ts`, CA #4)

```ts
/** Conservative safe git remote name (ADR-0048, CA #4): non-empty, ≤100, no leading '-', no '/'/':'/whitespace/control. */
export function isSafePushRemote(remote: string): boolean;
/** Conservative safe git branch name (ADR-0048, CA #4): non-empty, ≤200, no leading '-'/'/', no whitespace/control,
 *  no ':' '~' '^' '?' '*' '[' '\\', no '..', no '@{', no '//', no trailing '/', no '.lock' suffix. May contain single '/'. */
export function isSafePushBranch(branch: string): boolean;
```

### 5.3 Port (`packages/core/src/ports/git-provider.port.ts`)

```ts
/**
 * The SECOND mutating method (CAP-002, ADR-0048) — the first REMOTE mutation. Pushes EXACTLY the current
 * HEAD to `<remote> HEAD:<branch>` and returns the provider-reported target (not independent remote
 * verification). Single `git --no-pager push <remote> HEAD:<branch>`, argv-only, timeout, masked stderr.
 * NEVER `--force`/`-f`/`--tags`/`--all`/`-u`/`--set-upstream`/bare `git push`, no arbitrary refspec, no
 * user remote/branch. Validates remote/branch with conservative ref rules before any git call. Approval
 * gating is `GitManager.pushApprovedCommit`'s job; this port takes no ApprovalRef.
 */
pushApprovedCommit(rootPath: string, remote: string, branch: string, commitHash: string): Promise<GitPushResult>;
```

### 5.4 Adapter (`packages/git-local/src/index.ts`)

```ts
/** Defensive push-target validation (ADR-0048, CA #4/#5) — reuses core isSafePushRemote/isSafePushBranch +
 *  SHA-shaped commitHash. Throws (NO git run) on an unsafe target — so an unsafe branch NEVER reaches argv. */
export function assertSafePushTarget(remote: string, branch: string, commitHash: string): void { … }

async pushApprovedCommit(rootPath, remote, branch, commitHash): Promise<GitPushResult> {
  assertSafePushTarget(remote, branch, commitHash);          // throws (no git run) on unsafe target (CA #5)
  const res = this.exec(rootPath, ['--no-pager', 'push', remote, `HEAD:${branch}`]); // one refspec argv element
  if (res.code !== 0) throw this.failure('push', res);        // sanitized/masked stderr
  return { remote, branch, upstreamRef: `${remote}/${branch}`, commitHash };
}
```

`HEAD:<branch>` pushes the current HEAD (runtime has verified == `commitHash`) to the approved branch on
the approved remote — never a different/current branch name, all branches, or tags. No shell escaping is
used as a substitute for ref validation (CA #5).

### 5.5 Core (`packages/core/src/application/git-manager.ts`)

```ts
async pushApprovedCommit(input: { rootPath; remote; branch; commitHash; approvalRef }): Promise<GitPushResult> {
  if (input.approvalRef.status !== ApprovalStatus.APPROVED) throw new Error(`git push requires an APPROVED approval (got ${input.approvalRef.status})`);
  if (!input.rootPath.trim()) throw new Error('git push requires a rootPath');
  if (!isSafePushRemote(input.remote)) throw new Error('git push rejects an unsafe remote');
  if (!isSafePushBranch(input.branch)) throw new Error('git push rejects an unsafe branch');
  if (!/^[0-9a-f]{7,40}$/i.test(input.commitHash)) throw new Error('git push rejects an invalid commitHash');
  return this.provider.pushApprovedCommit(input.rootPath, input.remote, input.branch, input.commitHash);
}
// No generic push method (CA #15).
```

### 5.6 Runtime — dep + intent + routing + handler

**`ConversationRuntimeDeps.git`** widened (type-only): `pushApprovedCommit(input): Promise<GitPushResult>`.

**Push-execution intent** (forbidden requires a push/exec word — 2z CA #2 lesson):

```ts
const PUSH_EXECUTION_WORDS = /(승인된?\s*(푸시|push)\s*실행|(푸시|push)\s*실행|이제\s*실제\s*(푸시|push)|execute\s+(the\s+)?approved\s+push|run\s+approved\s+push|push\s+approved\s+commit)/i;
static interpretPushExecutionIntent(text): 'execute' | 'push-unsupported' | null {
  const t = text.trim().toLowerCase();
  if (!PUSH_EXECUTION_WORDS.test(t) && !PUSH_WORDS.test(t)) return null;   // no push/exec word → not push handling
  if (PUSH_FORBIDDEN_COMPANION.test(t)) return 'push-unsupported';         // push + force/PR/deploy/tag/branch/…
  if (PUSH_EXECUTION_WORDS.test(t)) return 'execute';
  return null;  // bare push word (no exec word) at PUSH_APPROVED → 2z already-approved
}
```

**Routing** (execution checked before the 2z already-approved). `GIT_COMMITTED`/`PUSH_APPROVAL_PENDING`
are **NOT** given execution routing → 2z handles them (CA #8/#9):

```ts
if (applyAnchor?.status === 'PUSH_APPROVED') {
  const ex = ConversationRuntime.interpretPushExecutionIntent(message.text);
  if (ex === 'push-unsupported') return this.handlePushUnsupportedCompanionTurn(message, session);
  if (ex === 'execute')         return this.handlePushExecutionTurn(message, session, actor, applyAnchor);
  const k = ConversationRuntime.interpretPushIntent(message.text);           // 2z
  if (k === 'push-unsupported') return this.handlePushUnsupportedCompanionTurn(message, session);
  if (k === 'push')             return this.handlePushAlreadyApprovedTurn(message, session);
}
if (applyAnchor?.status === 'GIT_PUSHED') {
  const ex = ConversationRuntime.interpretPushExecutionIntent(message.text);
  if (ex === 'push-unsupported') return this.handlePushUnsupportedCompanionTurn(message, session);
  if (ex === 'execute')         return this.handlePushAlreadyPushedTurn(message, session, applyAnchor);   // CA #7
  if (PR_DEPLOY_WORDS.test(message.text)) return this.handlePushPrDeployUnsupportedTurn(message, session); // CA #13
  if (ConversationRuntime.interpretPushIntent(message.text) === 'push') return this.handlePushAlreadyPushedTurn(message, session, applyAnchor);
}
```

**`handlePushExecutionTurn`** (the guarded remote mutation):

```ts
// 1. Complete approved push context, else composePushExecutionUnavailable (pre-push, no push). Log never throws.
// 2. (CA #3) safe persisted target: isSafePushRemote(pushRemote) & isSafePushBranch(pushBranch) &
//    parsePushUpstream(pushUpstreamRef) → {pushRemote,pushBranch} & SHA(pushCommitHash) & SHA(commitHash),
//    else composePushExecutionUnavailable (no GitManager call).
// 3. (Constraint 4) approvals.get(pushApprovalId) exists/APPROVED/same-plan → approvalRef(request); else unavailable.
// 4. Fresh read-only info; throw → composePushStatusUnavailable (pre-push). (CA #6) info.branch is used ONLY
//    for detached detection + logging, NEVER as the push target.
// 5. (Q5, CA #6) not detached AND info.headSha == pushCommitHash AND commitHash == pushCommitHash, else
//    composePushExecutionUnavailable (require new approval). Local branch name is NOT required to equal pushBranch.
// 6. Fresh read-only status; throw → composePushStatusUnavailable.
// 7. (Q9) clean tree, else composePushDirtyWorkingTree.
// 8. (Q6) status.upstream present, parses, == pushUpstreamRef, parsed remote/branch == pushRemote/pushBranch,
//    else composePushExecutionUnavailable.
// 9. (Q7/Q8) ahead ≥ 1 else composePushNothingToPush; behind == 0 else composePushDiverged.
// 10. push via Ref-gated capability. try/catch:
//     catch → composePushExecutionFailed (could-not-complete / check remote / NO rollback; never "remote
//             unchanged"). KEEP PUSH_APPROVED, preserve context, NO GIT_PUSHED (CA #2/#11).
// 11. (Constraint 9/10, CA #10) result-integrity: result.remote/branch/upstreamRef/commitHash === approved.
//     mismatch → composePushResultUnverified (check remote / no rollback). KEEP PUSH_APPROVED, preserve
//     context, NO GIT_PUSHED, structured log.
// 12. (Q12) success → re-anchor GIT_PUSHED, store pushed target, preserve full audit context (CA #12).
//     composePushExecuted (hash + remote/branch + no PR/deployment; no readiness claims — CA #14).
```

Small handlers: `handlePushAlreadyPushedTurn(anchor)` → `composePushAlreadyPushed(context, {commitHash:
anchor.pushedCommitHash, remote: anchor.pushedRemote, branch: anchor.pushedBranch})`;
`handlePushPrDeployUnsupportedTurn` → `composePushPrDeployUnsupported`; reuse 2z
`handlePushUnsupportedCompanionTurn`; `logPushExecutionFailed` (optional field access, never throws,
no diff/stderr).

### 5.7 `ResponseComposer` — methods (CA #1/#2/#13/#14 — no PR/deploy/readiness overclaim)

```ts
composePushExecuted(ctx, { commitHash, remote, branch }): OutboundMessage;
// "원격에 push했어요: <shortHash> → <remote>/<branch>\nPR 생성과 배포는 하지 않았어요." (no 배포 준비/ready-to-push/deploy-ready)
composePushExecutionUnavailable(ctx): OutboundMessage;   // (CA #2 pre-push) "…다시 push 승인을 받아 주세요. git push는 시도하지 않았어요."
// composePushStatusUnavailable — REUSE 2z (read failure, pre-push: git push는 하지 않았고 CommandExecution/shell fallback도 쓰지 않았어요).
composePushExecutionFailed(ctx): OutboundMessage;        // (CA #2 provider throw) "push를 완료하지 못했어요. 원격 상태는 필요하면 직접 확인해 주세요. rollback은 하지 않았어요." (never 원격 변경 없음)
composePushResultUnverified(ctx): OutboundMessage;       // (CA #2/#10) "push는 시도됐지만 결과를 확인할 수 없어요. 원격 상태를 직접 확인해 주세요. rollback은 하지 않았어요."
composePushAlreadyPushed(ctx, { commitHash, remote, branch }): OutboundMessage; // "이미 push했어요: <shortHash> → <remote>/<branch>. 다시 push하지 않았어요."
composePushPrDeployUnsupported(ctx): OutboundMessage;    // (CA #13) "이미 로컬 커밋은 원격에 push된 상태예요. PR 생성/배포는 아직 지원하지 않아요."
// reuse 2z composePushDirtyWorkingTree / composePushNothingToPush / composePushDiverged / composePushUnsupportedCompanion.
```

Bounded remote/branch display (reuse 2z `MAX_GIT_REF_DISPLAY`).

## 6. Required Architecture Questions — CA decisions applied

- **Q1 API:** `GitPushResult` (provider-reported target, not independent verification — CA #1) +
  `GitProvider.pushApprovedCommit` + `GitManager.pushApprovedCommit`; ApprovalRef → Manager only; runtime
  validates persisted target strings before mutation (CA #3); conservative ref validation (CA #4).
- **Q2 name:** `pushApprovedCommit`, no generic `push` (CA #15).
- **Q3 command:** `git --no-pager push <remote> HEAD:<branch>` after conservative validation; never bare/
  `--force`/`--tags`/`--all`/`-u`.
- **Q4 branch `/`:** slash allowed; reject colon/whitespace/leading-dash/control/`..`/`@{`/`.lock`/trailing-
  slash/consecutive-slash/`~`/`^`/`?`/`*`/`[`/`\` (CA #4). remote rejects leading-dash/`/`/whitespace/`:`/control.
- **Q5 HEAD ≠ pushCommitHash:** no push; new approval.
- **Q6 upstream differs:** no push; new approval. Local branch name NOT required to equal pushBranch (CA #6).
- **Q7 not ahead:** no push; nothing to push.
- **Q8 behind/diverged:** no push; no force.
- **Q9 dirty tree:** no push; commit/clean first.
- **Q10 push fails:** no fake success; sanitized error; **no "remote unchanged" claim; no rollback**; keep
  PUSH_APPROVED; no `GIT_PUSHED` (CA #2/#11).
- **Q11 pushed state:** `GIT_PUSHED` only after provider success + result integrity; no `GitPush` aggregate.
- **Q12 success:** re-anchor `GIT_PUSHED`, store target, preserve audit context (CA #12), reply no PR/deploy,
  no readiness claims (CA #14).
- **Q13 repeat:** already pushed; no new push.
- **Q14 PR/deploy after push:** future sprint; wording avoids implying this turn pushed (CA #13).
- **Q15 Orchestrator:** no change.
- **Q16 no side effects:** tests (conservative ref validation, no generic push API, failure/unverified
  preserve PUSH_APPROVED context, no remote rollback, GIT_PUSHED audit preservation, no PR/deploy readiness).

## 7. Case matrix

| Case | State / detection | Result |
|---|---|---|
| 1. PUSH_APPROVED + execution phrase, all gates pass | `execute` | `git.pushApprovedCommit(exact)` → `GIT_PUSHED` → `composePushExecuted` (no PR/deploy) |
| 2. ambiguous / bare push at PUSH_APPROVED | null / 2z | no execution (bare push → `composePushAlreadyApproved`) |
| 3. no anchor / COMMIT_*/WORKSPACE_APPLIED + execution phrase | not 3a | existing behavior; no push |
| 4. GIT_COMMITTED + "이제 실제 push 해줘" / "execute approved push" | 2z (CA #8) | CRITICAL push **approval**, no `pushApprovedCommit` |
| 5. PUSH_APPROVAL_PENDING + execution phrase | 2z decision (CA #9) | ambiguous re-prompt, no push |
| 6. push + force/PR/deploy/tag/branch/reset/… | `push-unsupported` | `composePushUnsupportedCompanion`, no push |
| 7. incomplete/unsafe persisted target (CA #3) | guard | `composePushExecutionUnavailable`, no push, log never throws |
| 8. approval null / not APPROVED / plan mismatch | verify | `composePushExecutionUnavailable`, no push |
| 9. `git.info`/`git.status` throws | caught | `composePushStatusUnavailable` (pre-push), no push |
| 10. detached / HEAD ≠ pushCommitHash / commitHash ≠ pushCommitHash | verify | `composePushExecutionUnavailable`, no push |
| 11. dirty tree | verify | `composePushDirtyWorkingTree`, no push |
| 12. upstream missing/differs, parsed remote/branch differ | verify | `composePushExecutionUnavailable`, no push |
| 13. ahead 0 / behind > 0 | verify | `composePushNothingToPush` / `composePushDiverged`, no push |
| 14. `pushApprovedCommit` throws | caught (CA #2/#11) | `composePushExecutionFailed`; KEEP PUSH_APPROVED; no `GIT_PUSHED` |
| 15. result integrity mismatch after success | gate (CA #2/#10) | `composePushResultUnverified`; KEEP PUSH_APPROVED; no `GIT_PUSHED` |
| 16. success | — | `GIT_PUSHED` + pushed fields; reply hash+target + no PR/deploy; audit context preserved |
| 17. GIT_PUSHED + execution/push phrase again | already pushed (CA #7) | `composePushAlreadyPushed`, no new push |
| 18. GIT_PUSHED + PR/deploy phrase | future (CA #13) | `composePushPrDeployUnsupported`, no PR/deploy |

## 8. Required Tests (Node 22) — CA's full list (135 items)

**`conversation-runtime.test.ts`** — execute + gating (1–12): 1–5. PUSH_APPROVED + "승인된 push 실행해줘" /
"이제 실제 push 해줘" / "push 실행해줘" / "execute approved push" / "push approved commit" →
`git.pushApprovedCommit` once. 6. ambiguous → no push. 7. no anchor + execution phrase → no push. 8.
GIT_COMMITTED + "이제 실제 push 해줘" → CRITICAL push **approval**, no `pushApprovedCommit`. 9. GIT_COMMITTED
+ "execute approved push" → 2z push approval (treated as push request), no `pushApprovedCommit`. 10–11.
PUSH_APPROVAL_PENDING + "execute approved push" / "승인된 push 실행해줘" → 2z decision ambiguous re-prompt,
no push. 12. COMMIT_APPROVED / COMMIT_APPROVAL_PENDING / WORKSPACE_APPLIED → no push.

Companion/force (13–19): force push / push --force / push -f / push and PR / push and deploy / push tag/
branch / push reset/checkout/stash/merge/rebase → reject, no push.

Context/verification (20–48): 20–26. missing pushApprovalId / pushCommitHash / pushRemote / pushBranch /
pushUpstreamRef / commitHash / workspaceRef|executionPlanRef → safe failure, no push. 27–31. **unsafe
pushRemote / unsafe pushBranch / malformed pushUpstreamRef / invalid pushCommitHash / invalid commitHash
in anchor → no `GitManager.pushApprovedCommit` (CA #3)**. 32–34. approval null / not-APPROVED / plan-
mismatch → safe failure. 35–36. git.info / git.status failure → safe failure. 37. detached → safe failure.
38. HEAD ≠ pushCommitHash → safe failure. 39. commitHash ≠ pushCommitHash → safe failure. 40. upstream
missing → safe failure. 41. upstream ≠ pushUpstreamRef → safe failure. 42. parsed remote ≠ pushRemote →
safe failure. 43. parsed branch ≠ pushBranch → safe failure. 44. ahead 0 → no push. 45. behind > 0 → no
push. 46–48. dirty staged/unstaged/untracked → no push.

pushApprovedCommit input + Manager (49–58): 49. valid → once. 50–52. input remote/branch/commitHash ==
approved. 53. receives approved ApprovalRef. 54. `GitManager.pushApprovedCommit` rejects non-APPROVED. 55.
rejects unsafe remote. 56. rejects unsafe branch. 57. rejects invalid commitHash. 58. no generic push
method (CA #15).

**`git-local/src/index.test.ts`** — adapter + ref validation (59–78): 59. argv-array only. 60. `push
<remote> HEAD:<branch>`. 61. never `--force`/`-f`. 62. never `--tags`. 63. never `--all`. 64. never `-u`/
`--set-upstream`. 65–66. rejects unsafe remote/branch before git call. 67. unsafe branch never appears in
argv as `HEAD:<branch>`. 68. slash branch allowed. 69–74. branch colon / whitespace / leading-dash / `..`
/ `@{` / `.lock` rejected (CA #4). 75–78. remote leading-dash / colon / slash / whitespace rejected.

Result / success / repeat (79–105, runtime): 79–82. result validates commitHash/remote/branch/upstreamRef.
83. integrity failure → **no `GIT_PUSHED`**. 84. integrity failure **preserves PUSH_APPROVED (CA #10)**.
85. integrity failure preserves push context. 86. integrity failure → result-unverified wording. 87.
success re-anchors `GIT_PUSHED`. 88. stores pushedCommitHash. 89. stores pushedRemote/Branch/UpstreamRef.
90. preserves pushApprovalId/pushCommitHash/pushRemote/pushBranch/pushUpstreamRef (CA #12). 91. preserves
commitApprovalId/commitHash/committedFiles. 92. preserves workspace context. 93. reply says pushed to
remote. 94. reply says no PR/deployment. 95. reply avoids readiness claims (CA #14). 96–98. provider
failure reply does not claim pushed / does not claim remote unchanged / says no rollback (CA #2). 99.
provider failure **preserves PUSH_APPROVED context (CA #11)**. 100. provider failure → no `GIT_PUSHED`.
101. repeat after GIT_PUSHED → no new push. 102. GIT_PUSHED + "push approved commit" → already pushed (CA
#7). 103. GIT_PUSHED + "execute approved push" → already pushed. 104. GIT_PUSHED + PR phrase → future
sprint (CA #13). 105. GIT_PUSHED + deploy phrase → future sprint.

No side effects (106–125): 106. no `command.run`. 107. no runtime shell. 108. no `workspaceWrite.apply`.
109. no `patch.*`. 110. no `codeGeneration.*`. 111. no `orchestrator.run/.resume`. 112. no PR. 113. no
deploy. 114–125. adapter argv never reset/checkout/stash/branch/tag/merge/rebase/force/`--all`/`--tags`/
`-u`/remote-rollback (CA #16).

Composer (126–133): 126. executed says pushed + no PR/deployment. 127. failed says could-not-complete /
check remote / no rollback (never "remote unchanged"). 128. result-unverified says may-have-been-attempted
/ check remote / no rollback. 129. pre-verification unavailable says push not attempted + new approval/
recheck. 130. already-pushed includes commit+target + no new push. 131. PR/deploy-unsupported says already-
pushed state + future sprint (CA #13). 132. no reply says deployed / PR created. 133. no reply says
ready-to-push / push-safe / deploy-ready (CA #1/#14).

**Node 22:** 134. `pnpm typecheck` green. 135. `pnpm test` green.

## 9. Architecture Impact / Reuse

- **Reuses, unchanged:** the 2y commit-mutation template, the 2z read-only inspection + push anchor fields
  + `PUSH_WORDS`/`PUSH_FORBIDDEN_COMPANION` + `parsePushUpstream` + `handlePushUnsupportedCompanionTurn` +
  `MAX_GIT_REF_DISPLAY` + `composePushDirtyWorkingTree`/`composePushNothingToPush`/`composePushDiverged`/
  `composePushStatusUnavailable`, `ApprovalManager.get`/`approvalRef()`, `RiskPolicy`.
- **Adds:** `GitPushResult`; `push-target.ts` (`isSafePushRemote`/`isSafePushBranch`); `GitProvider.
  pushApprovedCommit` + `LocalGitProvider.pushApprovedCommit` + `assertSafePushTarget`;
  `GitManager.pushApprovedCommit`; anchor status `GIT_PUSHED` + 4 pushed fields;
  `interpretPushExecutionIntent` + `PUSH_EXECUTION_WORDS` + `PR_DEPLOY_WORDS`; routing;
  `handlePushExecutionTurn` + `handlePushAlreadyPushedTurn` + `handlePushPrDeployUnsupportedTurn` +
  `logPushExecutionFailed`; 6 `ResponseComposer` methods; a type-only `git.pushApprovedCommit` dep widening.
- **Does NOT change:** Execution Orchestrator, Core/Orchestrator contract, `app.module.ts`, WorkspaceWrite/
  Patch/CodeGeneration/CommandExecution; no generic push API, no force/tags/all/upstream-create, no PR, no
  deploy, no rollback.

## 10. ADR-0048 (proposed) — Approved Git Push Execution

- **Status:** Proposed (v2, Phase 3, Sprint 3a — Product Construction).
- **Decision:** From `PUSH_APPROVED`, an explicit push-execution command performs **the exact approved
  push** — re-verifies the live APPROVED `ApprovalRequest` (plan-matched), validates the persisted approved
  target strings (conservative ref rules), re-reads `git.info` + `git.status`, and re-validates
  not-detached + HEAD == `pushCommitHash` == `commitHash` + `upstream` == `pushUpstreamRef` + parsed
  remote/branch == `pushRemote`/`pushBranch` + clean tree + ahead ≥ 1 + behind == 0, then pushes via the
  **Ref-gated `GitManager.pushApprovedCommit`** (`git --no-pager push <remote> HEAD:<branch>`, argv-only,
  conservative ref validation, **never `--force`/`--tags`/`--all`/`-u`/bare `git push`/arbitrary refspec/
  user remote-branch**). On success + **result-integrity** → re-anchor `GIT_PUSHED` (store the pushed
  target; preserve full audit context). This is the product's **first real remote mutation**. **No PR
  creation, no deployment, no force push, no remote rollback, no CommandExecution/shell, no generic push
  API, no ExecutionOrchestrator change.** `GIT_PUSHED` means pushed to the approved upstream only — never
  PR-created/deployed/ready-to-push/push-safe. **`GitPushResult` is the provider-reported successful target
  after `git push` exited 0, NOT an independent remote verification.** The approved target is the **upstream
  ref**, not the local branch name; `info.branch` is used only for detached detection + logging. `PUSH_APPROVED`
  is not durable push-ready — all Git state is re-read before mutation. **Remote-mutation safety:** a
  pre-push failure may say push was not attempted; a provider push failure never claims "remote unchanged"
  and never rolls back; a result-integrity mismatch after a reported success says the push could not be
  verified — check the remote manually (no rollback, no `GIT_PUSHED`). **Remote rollback is not attempted
  in Sprint 3a; any remote correction requires a separate CA-gated plan.**
- **Not implemented:** force push, bare/`--all`/`--tags`/`-u` push, arbitrary refspec/remote/branch,
  upstream/branch creation, tags, PR creation, deployment, remote rollback, a `GitPush` aggregate.
- **Relations:** ADR-0047 (provides `PUSH_APPROVED` + push context), ADR-0046 (commit-execution template
  mirrored — Ref-gate + provider argv + result-integrity), ADR-0044/2z (read-only `info`/`status` +
  upstream parser reused), ADR-0025 (CAP-004 Approval — `get`/`approvalRef`, CRITICAL), ADR-0023 (CAP-002
  Git — second mutating method, first remote), ADR-0031 (Execution Orchestrator — not extended).
  Supersedes nothing.

## 11. Implementation sequence (per CA Final Decision)

1. Apply plan changes (this document). 2. Author ADR-0048 in `DECISIONS.md`. 3. Implement minimal approved
scope. 4. Add/update tests (135 items). 5. Validate on Node 22 (typecheck exit 0 + test green). 6. Open PR
for Chief Architect Implementation Review. **No force push, no PR, no deployment, no remote rollback.**
