# Sprint 3f Plan — Explicit Pull Request Merge Approval (approval gate only; NO merge, NO GitHub write)

- **Status:** APPROVED WITH CHANGES (all 7 CA required changes applied) → implemented; PR open for CA
  Implementation Review.
- **Base:** `main @ fdaa8cd14b1fd12b522a44d6108d9d70d7b25ba8`
- **Validation runtime:** Node 22
- **ADR (proposed):** ADR-0056 — Explicit Pull Request Merge Approval.
- **Nature:** a CRITICAL **approval gate only** on an existing `PR_CREATED` anchor — records permission to merge
  a specific PR context. **No merge, no GitHub write API, no deploy/release, no new RepositoryHosting/Git
  method.** Mirrors the Sprint 3b PR-creation-**approval** flow (ADR-0049) exactly, applied to merge.
- **Predecessors (reused, not re-litigated):** ADR-0054 (Sprint 3d-D — the `PR_CREATED` anchor + full causal
  chain this reads/preserves), ADR-0055 (Sprint 3e — the read-only status preview reused from `MERGE_APPROVED`),
  ADR-0049 (Sprint 3b — the CRITICAL request → `*_APPROVAL_PENDING` → decision → `*_APPROVED` template mirrored),
  ADR-0025 (CAP-004 Approval — `requestForRisk`/`get`/`decide`, `RiskLevel.CRITICAL`), ADR-0023 (Git local-only).

## 0. CA review disposition (Sprint 3f plan — APPROVED WITH CHANGES)

All 7 CA required changes applied:

| CA change | Where applied |
|---|---|
| 1. Remove all "merge-creation" wording → "merge approval" / permission record | §4.5/§4.6; tests 65/66 |
| 2. `mergeApprovalDecisionBy` REQUIRED on MERGE_APPROVED; cleared on deny/cancel | §4.1/§4.4; tests 67/68 |
| 3. Decision uses structured `ApprovalRequest` fields only (never parse reason) | §4.4; tests 69/70 |
| 4. "진행해" approves only while pending; PR_CREATED + "진행해" → no approval | §4.2/§4.4; tests 71/72 |
| 5. MERGE_APPROVED + status preview keeps approval; adds reminder line | §4.3/§4.4; tests 73–75 |
| 6. Reason must not imply checks/reviews/mergeability/safety; rename "status" → "pr source" | §4.5; tests 76–80 |
| 7. MERGE_APPROVED + "머지해줘" does not mutate; says future step | §4.4; test 81 |

**Result:** full suite **47 files / 920 tests pass** on Node v22.22.1; `pnpm typecheck` exit 0. Approval-only —
no merge, no GitHub write, no new state beyond `MERGE_APPROVAL_PENDING`/`MERGE_APPROVED`; Git capability +
`ExecutionOrchestrator` unchanged. (The 3d-D "PR_CREATED + merge phrase → companion" test was updated: a merge
phrase now routes to merge approval; a bare deploy/release phrase still → companion.)

## 1. Goal

From a live `PR_CREATED` anchor, an explicit merge-approval / merge phrase records a **CRITICAL merge approval
(a merge permission record)** and halts — it does **not** merge:

```text
PR_CREATED
→ explicit merge approval / merge phrase ("머지 승인해줘" / "이 PR 머지해줘" / "approve merge" / "merge this PR")
→ verify PR_CREATED context (identity + pullRequestRef + head/base/commit)
→ approvals.requestForRisk(CRITICAL, deterministic reason)          ← CAP-004
→ re-anchor MERGE_APPROVAL_PENDING (+ mergeApprovalId, mergeApprovalRequestedAt; full chain preserved)
→ AWAITING_APPROVAL

MERGE_APPROVAL_PENDING + "승인"       → approvals.decide → MERGE_APPROVED (record only)  → NO merge
MERGE_APPROVAL_PENDING + "거절"/"취소" → back to PR_CREATED, clear ONLY merge fields      → NO merge
```

`MERGE_APPROVED` means **permission recorded only** — never merged/deployed/released/safe-to-merge/CI-passed/
review-approved/GitHub-mergeable/branch-deleted/production-ready. **Actual merge execution is a future,
separate, CA-reviewed sprint.**

## 2. Boundary & the most important rule

> **A merge approval is a permission record — not a merge.** Sprint 3f adds **only** the approval state + the
> approval decision flow. It performs **no** merge, **no** GitHub write API, **no** auto-merge/deploy/release/
> reviewer/label/assignee/branch-deletion/PR-update/PR-close-reopen/check-rerun, adds **no** RepositoryHosting
> mutating method and **no** `GitProvider`/`GitManager` merge method, uses **no** `CommandExecution`/shell, and
> **no** `ExecutionOrchestrator` change. The runtime never claims merged/deployed/released/safe-to-merge/
> CI-verified.

## 3. Architecture & reuse (source-verified)

- **Mirrors the 3b PR-approval flow exactly** (`conversation-runtime.ts`): `handlePrApprovalTurn` /
  `handlePrApprovalDecisionTurn` (line ~2896) are the template — verify context → `approvals.requestForRisk`
  (CRITICAL) → re-anchor `*_APPROVAL_PENDING` → `AWAITING_APPROVAL`; the pending state intercepts every turn
  (`interpretDecision`; a merge/deploy/status phrase while pending → ambiguous re-prompt, no decide); approve →
  record-only `*_APPROVED`; deny/cancel → revert clearing only the phase's fields. Reuses
  `ApprovalManager.requestForRisk`/`get`/`decide` + `decisionOf` + `RiskLevel.CRITICAL`.
- **Reads/preserves the ADR-0054 `PR_CREATED` chain** — `repositoryIdentity`, `pullRequestRef`,
  `pullRequestNumber`/`Url`/`HeadBranch`/`BaseBranch`/`CommitHash`/`Reused`, plus all push/commit/workspace
  context. The merge approval anchors carry the entire chain (§ anchor fields).
- **`now()`** (already imported from `util/clock`) supplies `mergeApprovalRequestedAt`/`mergeApprovedAt`.
- **`DEPLOY_ONLY_WORDS`/`PR_CREATED_COMPANION_WORDS`/`interpretPrStatusIntent`** (3d-D/3e) are reused for
  routing precedence; a new `interpretMergeIntent` classifies merge phrases.
- **Reuses the 3e read-only status preview from `MERGE_APPROVED`** (Q10/Q11 — chosen option): the same
  `handlePrStatusPreviewTurn` (its `PR_CREATED`-guard widens to also accept `MERGE_APPROVED`), read-only, and it
  never re-anchors so `MERGE_APPROVED` is preserved.
- **No Git/Orchestrator/adapter change.** `RepositoryHostingProvider`/`RepositoryHostingManager`/
  `GitHubRepositoryHostingProvider` gain **no** method (approval is pure runtime + CAP-004, no hosting call).

## 4. Design

### 4.1 New states + anchor fields (Q2)

`ApplyPreviewAnchorStatus` gains, after `PR_CREATED`: `MERGE_APPROVAL_PENDING`, `MERGE_APPROVED`. (No `PR_MERGED`/
`MERGED`/`DEPLOY_APPROVAL_PENDING`/`DEPLOYED`.) New `ApplyPreviewAnchor` fields, distinct from PR/commit/push
approval ids:
```text
mergeApprovalId?: Id          // pending/decided merge ApprovalRequest id; set at PENDING; preserved at APPROVED; cleared on deny/cancel
mergeApprovalRequestedAt?: IsoTimestamp
mergeApprovedAt?: IsoTimestamp        // set at MERGE_APPROVED
mergeApprovalDecisionBy?: Id          // required on MERGE_APPROVED (the deciding actor); set together with mergeApprovedAt
```
`MERGE_APPROVAL_PENDING`/`MERGE_APPROVED` **preserve the full `PR_CREATED` causal chain** (workspaceRef/
workspaceChangeRef/executionPlanRef/…/prApprovalId/prHeadBranch/prBaseBranch/prTitle/prBodyPreview/
repositoryIdentity/pullRequestRef/pullRequestNumber/Url/HeadBranch/BaseBranch/CommitHash/Reused). **Never
stored:** token · raw GitHub/PR-status response · raw diff · file content · review body · check logs ·
remoteUrl.

### 4.2 Intent classifier (Q1)

```ts
// Explicit merge-APPROVAL / merge phrase (Sprint 3f) — only consulted at PR_CREATED, AFTER interpretPrStatusIntent.
// Returns 'merge' only for an explicit merge request/approval/execution phrase; null for a merge QUESTION
// (가능/안전/되나/통과/?) or a bare merge noun (→ falls through to the companion-unsupported reply).
const MERGE_WORD = /(머지|병합|\bmerge\b)/i;
const MERGE_QUESTION = /(가능|안전|되나|되나요|통과|봐줘|상태|확인|\?|mergeable|can\s+i|is\s+it)/i;
const MERGE_REQUEST_VERB = /(승인|approval|approve|요청|받아|해줘|해도\s*되게|해\s*줘|merge\s+this|이\s*pr\s*머지)/i;
static interpretMergeIntent(text): 'merge' | null {
  const t = text.trim().toLowerCase();
  if (!MERGE_WORD.test(t)) return null;
  if (MERGE_QUESTION.test(t)) return null;          // "머지 가능해?/안전해?/통과?" → not an approval request
  if (MERGE_REQUEST_VERB.test(t)) return 'merge';   // "머지 승인해줘"/"이 PR 머지해줘"/"approve merge"/"merge this PR"
  return null;                                      // bare "머지" noun → companion-unsupported
}
```
- **"머지해줘" (execution wording)** → `'merge'` → merge **approval** (CA: treat as approval request; the reply
  says permission-only, no merge).
- **"머지 가능해?/머지해도 안전해?"** → null (a question) → falls through (no approval — CA test 3).
- **"CI 통과했어?/PR 상태 봐줘"** → handled by `interpretPrStatusIntent` first (status preview) — no merge
  approval (CA test 4).
- **"배포해줘"/"릴리즈해줘"** → no MERGE_WORD → companion-unsupported (CA test 5).

### 4.3 Routing (PR_CREATED order; new MERGE_* guards)

```ts
if (applyAnchor?.status === 'PR_CREATED') {
  if (interpretPrStatusIntent(text))          return handlePrStatusPreviewTurn(...);   // 3e (first)
  if (interpretMergeIntent(text) === 'merge') return handleMergeApprovalTurn(...);     // 3f (NEW)
  if (interpretPrIntent(text) === 'create')   return handlePrAlreadyCreatedTurn(...);  // 3d-D
  if (interpretPrIntent(text) === 'pr-unsupported' || PR_CREATED_COMPANION_WORDS.test(text))
                                              return handlePrCreatedCompanionUnsupportedTurn(...);
}
if (applyAnchor?.status === 'MERGE_APPROVAL_PENDING') {                                 // intercepts every turn
  return handleMergeApprovalDecisionTurn(...);
}
if (applyAnchor?.status === 'MERGE_APPROVED') {
  if (interpretPrStatusIntent(text))          return handlePrStatusPreviewTurn(...);   // read-only, keeps MERGE_APPROVED (Q10/Q11)
  if (interpretMergeIntent(text) === 'merge') return handleMergeAlreadyApprovedTurn(...);
  if (DEPLOY_ONLY_WORDS.test(text) || PR_CREATED_COMPANION_WORDS.test(text))
                                              return handleMergeApprovedCompanionUnsupportedTurn(...);
}
```
`handlePrStatusPreviewTurn`'s state guard widens from `status === 'PR_CREATED'` to `∈ {PR_CREATED,
MERGE_APPROVED}` (read-only, never re-anchors → both states preserved).

### 4.4 Handlers

- **`handleMergeApprovalTurn` (PR_CREATED → MERGE_APPROVAL_PENDING):** verify complete `PR_CREATED` context
  (status, repositoryIdentity, pullRequestRef, pullRequestNumber/Url/HeadBranch/BaseBranch/CommitHash,
  executionPlanRef) — else `composeMergeApprovalUnavailable`, no approval; then
  `approvals.requestForRisk({ executionPlanRef, riskLevel: CRITICAL, reason: buildMergeApprovalReason(...),
  requestedBy: actor.id })` (the ONLY effect; NO merge, NO GitHub call); re-anchor `MERGE_APPROVAL_PENDING` (add
  `mergeApprovalId`, `mergeApprovalRequestedAt = now()`; preserve chain); reply `composeMergeApprovalRequested`
  → `AWAITING_APPROVAL`.
- **`handleMergeApprovalDecisionTurn` (mirrors `handlePrApprovalDecisionTurn`):** strict pending-context guard;
  a merge/deploy/status phrase (`interpretMergeIntent`/`interpretPrStatusIntent`/`DEPLOY_ONLY_WORDS`) while
  pending → ambiguous re-prompt (no decide, no merge); else `interpretDecision`; verify `approvals.get(
  mergeApprovalId)` exists + PENDING + `executionPlanRef.id` matches (structured only, never parse reason);
  approve → `approvals.decide` → re-anchor `MERGE_APPROVED` (+ `mergeApprovedAt = now()`, optional
  `mergeApprovalDecisionBy = actor.id`; preserve all) → `composeMergeApprovalRecorded`; deny/cancel →
  `approvals.decide` → re-anchor `PR_CREATED` clearing **only** merge fields (mergeApprovalId/RequestedAt/
  ApprovedAt/DecisionBy) → `composeMergeApprovalDenied`/`Cancelled`. **NO merge on any path.**
- **`handleMergeAlreadyApprovedTurn` (MERGE_APPROVED + merge phrase):** `composeMergeAlreadyApproved` ("이미
  승인 기록됨; 실제 머지는 이후 단계"). **`handleMergeApprovedCompanionUnsupportedTurn`:** deploy/release/
  reviewer/label/assignee → `composeMergeApprovedCompanionUnsupported` (future step; no mutation).

### 4.5 Approval reason (deterministic, bounded; Q, CA)

`buildMergeApprovalReason({ owner, repo, prNumber, prUrl, headBranch, baseBranch, commitHash, reused })` →
```text
operation: pull request merge approval planning
repository: <owner>/<repo>
pull request: #<number> <url>
head: <headBranch>
base: <baseBranch>
commit: <short hash>
pr source: created | connected-existing
risk: CRITICAL
no merge has been performed
no deployment has been performed
no release has been performed
this approval records permission only
actual merge execution is NOT performed in Sprint 3f and requires a separate repository-hosting step
merge is not guaranteed safe/mergeable; hosting state is not verified by this approval
```
No token / raw diff / file content / check logs / review body / full GitHub response. **Not parsed later** —
structured anchor fields + `ApprovalRef` are the authority.

### 4.6 Response composers

```text
composeMergeApprovalRequested(ctx, {owner,repo,prNumber,prUrl,headBranch,baseBranch,commitHash})
  → "PR 머지 승인을 요청했어요.\n대상: owner/repo #<n> (<head> → <base>, 커밋 <short>)\n아직 머지는 하지 않았어요.
     승인하면 이후 별도 단계에서 머지를 실행할 수 있어요. 배포/릴리즈도 하지 않았어요.\n진행하려면 \"승인\", 원치 않으면 \"거절\"."
composeMergeApprovalRecorded(ctx) → "PR 머지 승인이 기록됐어요. 아직 머지는 하지 않았어요. 배포/릴리즈도 하지 않았어요."
composeMergeApprovalDenied(ctx)   → "PR 머지 승인을 거절했어요. PR은 그대로 있고 머지는 하지 않았어요."
composeMergeApprovalCancelled(ctx)→ "PR 머지 승인을 취소했어요. PR은 그대로 있고 머지는 하지 않았어요."
composeMergeApprovalUnavailable(ctx)→ "지금은 PR 머지 승인을 준비할 수 없어요. (머지는 하지 않았어요)"
composeMergeAlreadyApproved(ctx)  → "PR 머지 승인은 이미 기록되어 있어요. 아직 머지는 하지 않았어요. (실제 머지는 이후 단계에서 진행돼요)"
composeMergeApprovedCompanionUnsupported(ctx) → "배포/릴리즈/리뷰어/라벨/담당자 변경은 이후 단계예요. 지금은 하지 않았어요."
```
Never say merged / deployed / released / safe-to-merge / CI-verified / ready-to-deploy.

## 5. Required Architecture Questions — decisions

- **Q1 (trigger)** — `interpretMergeIntent` at `PR_CREATED` (after status intent): merge word + request/approval/
  execution verb → merge approval; merge question / bare noun / status / deploy → not approval (§4.2).
- **Q2 (states)** — add `MERGE_APPROVAL_PENDING`, `MERGE_APPROVED` + `mergeApprovalId`/`mergeApprovalRequestedAt`/
  `mergeApprovedAt`/`mergeApprovalDecisionBy?`; no `PR_MERGED`/`DEPLOYED`/etc.
- **Q3 (perform merge?)** — **No.** Approval only.
- **Q4 (RepositoryHostingProvider merge API?)** — **No** method added.
- **Q5 (fresh status preview before approval?)** — **No** (permission recording only); wording avoids implying
  current status/check/review safety; a future merge-execution sprint must re-read hosting state.
- **Q6 (requires PR_CREATED?)** — **Yes.** No merge approval from WORKSPACE_APPLIED/GIT_COMMITTED/GIT_PUSHED/
  PR_APPROVAL_PENDING/PR_APPROVED/… (only own-state handling for MERGE_APPROVAL_PENDING/MERGE_APPROVED).
- **Q7 (pending handling)** — `MERGE_APPROVAL_PENDING` intercepts every turn via the ApprovalManager decision
  flow (§4.4).
- **Q8 (deny/cancel)** — return to `PR_CREATED`, clear **only** merge fields, preserve the PR/push/commit/
  workspace chain.
- **Q9 (approve)** — `MERGE_APPROVED`, preserve all context, **still no merge**.
- **Q10 (MERGE_APPROVED follow-up)** — merge phrase → already-approved (future execution only); deploy/release/
  reviewer/label/assignee → unsupported future step; **status phrase → reuse the 3e read-only status preview,
  keeping `MERGE_APPROVED`** (chosen option).
- **Q11 (affects status preview?)** — no mutation; status preview from `MERGE_APPROVED` stays read-only and
  keeps `MERGE_APPROVED`.
- **Q12 (Git change?)** — **No** merge method.
- **Q13 (ExecutionOrchestrator?)** — **No** (ConversationRuntime-composed).
- **Q14 (future merge execution revalidation — deferred)** — a future sprint MUST re-validate: live
  `MERGE_APPROVED` approval, repositoryIdentity, pullRequestRef, head/base/commit, PR open + not-merged +
  not-closed, current head SHA still expected, mergeability if the provider exposes it, checks/reviews per
  future CA policy. **3f implements none of these** as a mutation preflight.

## 6. Required tests (Node 22) — CA's 64-item list

**Trigger/state (1–6):** 1 `PR_CREATED` + merge-approval phrase → `MERGE_APPROVAL_PENDING` · 2 `PR_CREATED` +
merge-execution phrase ("머지해줘") → `MERGE_APPROVAL_PENDING` + reply says no merge happened · 3 merge
question/safety → no approval · 4 PR status phrase → status preview (not merge approval) · 5 deploy/release → no
merge approval · 6 non-`PR_CREATED` → no merge approval.

**Pending interception (7–12):** 7 approve · 8 deny · 9 cancel intercepted · 10 pending + merge phrase → ask
for decision, no mutation · 11 pending + deploy → ask, no mutation · 12 pending + status → ask (or chosen), no
mutation.

**Approval request/reason/risk (13–28):** 13 riskLevel CRITICAL · 14 executionPlanRef matches anchor · 15
reason deterministic/bounded · 16 owner/repo · 17 PR number · 18 head/base · 19 commit short hash · 20 "no
merge/deploy/release done" · 21 no token · 22 no raw diff · 23 no file content · 24 no check logs · 25 no
review body · 26 `MERGE_APPROVAL_PENDING` preserves full chain · 27 stores `mergeApprovalId` · 28 stores
`mergeApprovalRequestedAt`.

**Decision (29–42):** 29 deny → `PR_CREATED` · 30 cancel → `PR_CREATED` · 31 deny/cancel clear only merge
fields · 32 preserve `pullRequestRef` · 33 preserve `repositoryIdentity` · 34 preserve push/commit/workspace
fields · 35 approve requires live `ApprovalManager.get` · 36 rejects missing request · 37 rejects non-pending ·
38 rejects executionPlanRef mismatch · 39 does not parse `ApprovalRequest.reason` · 40 approve →
`MERGE_APPROVED` · 41 stores `mergeApprovedAt` · 42 `MERGE_APPROVED` preserves full chain.

**MERGE_APPROVED follow-up (43–45):** 43 merge phrase → already approved / future execution · 44 deploy phrase →
unsupported future step · 45 status phrase → read-only preview, keeps `MERGE_APPROVED`.

**No mutation / no side effects (46–58):** 46 no `RepositoryHostingProvider.merge` method · 47 no GitHub merge
API call · 48 no `GitProvider` merge method · 49 no `GitManager` merge method · 50 no `CommandExecution` · 51 no
runtime shell · 52 no `ExecutionOrchestrator` change · 53 no `PR_MERGED` state · 54 no `DEPLOYED`/`RELEASED`
state · 55 no reviewer/label/assignee mutation · 56 no PR update/close/reopen · 57 no branch deletion · 58 no
check rerun.

**Response wording (59–62):** 59 never "merged" · 60 never "deployed/released" · 61 never "safe-to-merge" · 62
never "CI verified".

**Node 22 (63–64):** 63 `pnpm typecheck` · 64 `pnpm test`.

## 7. Architecture Impact / Reuse

- **Adds:** `MERGE_APPROVAL_PENDING`/`MERGE_APPROVED` statuses + merge anchor fields; `interpretMergeIntent`;
  `handleMergeApprovalTurn`/`handleMergeApprovalDecisionTurn`/`handleMergeAlreadyApprovedTurn`/
  `handleMergeApprovedCompanionUnsupportedTurn`; `buildMergeApprovalReason`; 7 `ResponseComposer` methods;
  widen `handlePrStatusPreviewTurn`'s state guard to `{PR_CREATED, MERGE_APPROVED}`; ADR-0056; tests.
- **Reuses unchanged:** `ApprovalManager.requestForRisk`/`get`/`decide` + `RiskLevel.CRITICAL` (CAP-004), the 3b
  approval-halt/decision template, the ADR-0054 `PR_CREATED` chain, the ADR-0055 read-only status preview,
  `now()`, `DEPLOY_ONLY_WORDS`/`PR_CREATED_COMPANION_WORDS`/`interpretDecision`.
- **Does NOT change:** `RepositoryHostingProvider`/`RepositoryHostingManager`/`GitHubRepositoryHostingProvider`
  (no method added), `GitProvider`/`GitManager`/`LocalGitProvider`/`RepositoryInfo`, `ExecutionOrchestrator`,
  `WorkspaceWrite`/`Patch`/`CodeGeneration`/`CommandExecution`. No GitHub write; no merge/deploy/release.

## 8. ADR-0056 (proposed) — Explicit Pull Request Merge Approval

Records: an **approval-only** merge gate after `PR_CREATED` — from a live `PR_CREATED` anchor an explicit merge
approval / merge phrase records a `RiskLevel.CRITICAL` `ApprovalRequest` and halts at `MERGE_APPROVAL_PENDING`;
on "승인" → `MERGE_APPROVED` (permission only). **No merge execution, no GitHub write API, no RepositoryHosting
merge method, no Git merge method, no `CommandExecution`/shell, no `ExecutionOrchestrator` change.**
`MERGE_APPROVED` is permission only — never merged/deployed/released/safe-to-merge/CI-passed/mergeable/branch-
deleted/production-ready; actual merge execution is deferred to a future CA-reviewed sprint. Pending state
intercepts every turn (approve/deny/cancel; a merge/deploy/status phrase while pending → ambiguous re-prompt).
Deny/cancel → `PR_CREATED` clearing only merge fields; the full `PR_CREATED` causal chain (identity/pullRequestRef/
head/base/commit/push/commit/workspace) is preserved through both states. The deterministic bounded approval
reason includes owner/repo/PR number/URL/head/base/short commit + explicit "no merge/deploy/release" and is
never parsed later; no token/raw diff/file/check/review payload in the reason or anchor. Approval verification
uses `ApprovalManager.get` (structured fields only). A merge phrase at `PR_CREATED` (incl. execution wording
like "머지해줘") records approval only and the reply says it does not merge; a merge safety question does not
create an approval; a PR status phrase still routes to the read-only status preview. From `MERGE_APPROVED` a
status phrase reuses the read-only preview and keeps `MERGE_APPROVED`. Relations: ADR-0054 (`PR_CREATED` chain),
ADR-0055 (status preview reused), ADR-0049 (approval-halt template), ADR-0025 (CAP-004 CRITICAL), ADR-0023 (Git
local-only). Plan: `docs/plans/sprint-3f-explicit-pr-merge-approval-plan.md`.

## 9. Implementation sequence (after CA plan approval)

1. Apply plan changes. 2. Author ADR-0056. 3. Add `MERGE_APPROVAL_PENDING`/`MERGE_APPROVED` statuses + merge
anchor fields. 4. Add `interpretMergeIntent` + the 4 handlers + `buildMergeApprovalReason`; wire PR_CREATED /
MERGE_* routing; widen the status-preview state guard. 5. Add 7 `ResponseComposer` methods. 6. Add the 64
tests. 7. Validate on Node 22 (typecheck exit 0 + full suite green). 8. Open PR for Chief Architect
Implementation Review. **No merge, no GitHub write, no new state beyond MERGE_APPROVAL_PENDING/MERGE_APPROVED.**

## 10. Stop condition (this sprint)

Plan-only. **Do not implement. Do not create a branch. Do not commit. Do not open a PR. Do not call the GitHub
API. Do not merge/deploy/release.** This document is left on the working tree (untracked) for Chief Architect
Review. Request CA review after the plan is written.
