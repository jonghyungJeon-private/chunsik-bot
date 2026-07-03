# Sprint 3e Plan — Pull Request Status Preview (read-only hosting status from PR_CREATED; no mutation)

- **Status:** APPROVED WITH CHANGES (all 10 CA required changes applied) → implemented; PR open for CA
  Implementation Review.
- **Base:** `main @ 5a29e17ef62574bd41c65e98a0066c442c74b45a`
- **Validation runtime:** Node 22
- **ADR (proposed):** ADR-0055 — Pull Request Status Preview.
- **Nature:** a **read-only** repository-hosting observation on an existing `PR_CREATED` anchor. **Not** merge,
  deployment, release, CI re-run, review mutation, or any durable "verified/safe-to-merge" state. Point-in-time
  provider-reported status only.
- **Predecessors (reused, not re-litigated):** ADR-0054 (Sprint 3d-D — the `PR_CREATED` anchor + fields this
  reads; runtime-calls-manager-only + token boundary), ADR-0053 (`GitHubRepositoryHostingProvider` — gains a
  read-only method here), ADR-0052 (`RepositoryHostingProvider` port + `RepositoryHostingManager` — gain a
  read-only method), ADR-0051 (`RepositoryIdentity`), ADR-0023 (Git stays local-only).

## 0. CA review disposition (Sprint 3e plan — APPROVED WITH CHANGES)

All 10 CA required changes applied:

| CA change | Where applied |
|---|---|
| 1. Manager input uses `PullRequestRef` (not a bare number); validate ref vs identity/URL/number | §4.2; manager `getPullRequestStatus`; tests 61–63 |
| 2. Ignore user-supplied PR number/URL — always query `anchor.pullRequestRef` | §4.4 `handlePrStatusPreviewTurn`; tests 64–67 |
| 3. `observedAt` generated internally (adapter clock), not caller/user-controlled | §4.1; adapter `new Date().toISOString()`; tests 68/69 |
| 4. Bounded GitHub reads — one GET each, fixed `per_page`, no pagination/retry | §4.3; adapter; tests 70–72 |
| 5. check-runs only, documented as provider-reported/partial | §4.3/§4.5; composer wording; tests 73/74 |
| 6. Review = current signal summary, not approval readiness; no review body | §4.3/§4.5; tests 75–77 |
| 7. merged/closed reported but no new state; keep `PR_CREATED` | §4.4; tests 78–80 |
| 8. Result-integrity mismatch → "could not check current status", not "checks failed" | §4.2/§4.5; tests 81–84 |
| 9. Sanitized adapter errors (no token/Authorization/raw body) | §4.3; adapter; tests 85–87 |
| 10. Empty/no check-runs → unknown, never "success" | §4.3/§4.5; tests 88/89 |

**Result:** read-only slice — full suite **47 files / 910 tests pass** on Node v22.22.1; `pnpm typecheck` exit
0. No mutation, no new anchor state (keeps `PR_CREATED`), no GitHub write, no live network (fake manager / fake
fetch). Git capability + `ExecutionOrchestrator` unchanged.

## 1. Goal

After Sprint 3d-D the product can reach `PR_CREATED`. Sprint 3e adds a **read-only Pull Request status
preview** so the user can ask, at `PR_CREATED`, "PR 상태 어때? / CI 통과했어? / 체크/리뷰 상태 봐줘" and get a
bounded, point-in-time answer — **without any new mutation and without any new anchor state**:

```text
PR_CREATED
→ explicit PR status/check/review phrase
→ verify live PR_CREATED context (identity + PullRequestRef + head/base/commit match)
→ RepositoryHostingManager.getPullRequestStatus(...)   (→ GitHubRepositoryHostingProvider read-only)
→ bounded provider-reported PullRequestStatusPreview
→ point-in-time response
→ keep PR_CREATED  (no state change, no mutation)
```

## 2. Boundary & the most important rule

> **A PR status preview is a read-only, point-in-time hosting observation — never a durable guarantee.** It is
> **not** merge/auto-merge, deployment, release, CI re-run/check re-run, reviewer/label/assignee/metadata
> mutation, review approve/dismiss, PR close/reopen/draft-convert, or any "safe-to-merge / CI-verified /
> deploy-ready / verified" state. The runtime calls `RepositoryHostingManager` only (never the adapter), and
> the same token boundary as ADR-0054 holds. **Naming discipline:** call it *PR status preview* /
> *point-in-time hosting status* / *provider-reported status* — never "PR verification" / "CI verification" /
> "safe-to-merge" / "merge readiness".

**Explicitly out of scope (verified none introduced):** merge · auto-merge · deployment · release · reviewer/
label/assignee/metadata mutation · draft conversion · branch creation · force push · CI/check re-run · review
approve/dismiss · PR close/reopen/update · `PR_MERGED`/`PR_STATUS_VERIFIED`/`READY_TO_MERGE`/any new state ·
`GitProvider`/`GitManager` PR method · `CommandExecution` · runtime shell · `ExecutionOrchestrator` change · any
GitHub write (`POST`/`PATCH`/`PUT`/`DELETE`).

## 3. Architecture & reuse (source-verified)

- **`PR_CREATED` anchor (ADR-0054) is the sole source of what to query.** It carries `repositoryIdentity`,
  `pullRequestRef` (provider/owner/repo/number/url), `pullRequestNumber`, `pullRequestUrl`,
  `pullRequestHeadBranch`, `pullRequestBaseBranch`, `pullRequestCommitHash`. The preview verifies against these
  (no fresh derivation, no user-supplied PR number/URL).
- **Port + Manager + adapter already exist** (ADR-0052/0053). 3e adds ONE **read-only** method to each:
  `getPullRequestStatus`. Mirrors the manager's existing Ref-gating shape minus the ApprovalRef (read-only,
  Q5): provider.kind match + identity/PR-number validation + result-integrity + bounded shape, then a single
  provider read call. The adapter uses Node 22 `fetch` (github.com only), read-only GitHub REST, sanitized
  errors, injected fake fetch in tests — same discipline as ADR-0053.
- **Runtime calls the manager only (ADR-0054 boundary).** `ConversationRuntime` never imports
  `@chunsik/repository-hosting-github`; the `deps.repositoryHosting.manager` structural type gains
  `getPullRequestStatus`; the token stays adapter-local (never in core/runtime/anchor/reason/response/log). No
  ApprovalRef, no state change.
- **Reuses** `isSafeGitHubPullRequestUrl` (validate the reported PR URL), the `RepositoryHosting` domain module,
  and the ADR-0054 not-configured / fake-fetch / no-live-network test patterns.

## 4. Design

### 4.1 Domain shape (`packages/core/src/domain/repository-hosting.ts`; Q3/Q10)

Provider-independent, bounded — **no** raw GitHub response, token, raw check logs, review body text, file
paths, diff, or file content:

```ts
export type PullRequestState = 'open' | 'closed' | 'merged' | 'unknown';
export type PullRequestChecksState = 'success' | 'failure' | 'pending' | 'neutral' | 'skipped' | 'unknown';
export type PullRequestReviewState = 'approved' | 'changes_requested' | 'commented' | 'none' | 'unknown';

export interface PullRequestStatusPreview {
  ref: PullRequestRef;                 // provider/owner/repo/number/url
  state: PullRequestState;
  headBranch: string;
  baseBranch: string;
  headCommitHash: string;
  isDraft?: boolean;
  checks: {
    state: PullRequestChecksState;
    totalCount: number;
    successCount: number;
    failureCount: number;
    pendingCount: number;
  };
  reviews?: {
    state: PullRequestReviewState;
    approvedCount?: number;
    changesRequestedCount?: number;
  };
  /** Provider-reported observation timestamp string (passed in by the caller; bounded). Point-in-time only. */
  providerReportedAt: string;
}
```
All counts are non-negative integers; strings are bounded; `state`/`checks.state`/`reviews.state` fall back to
`'unknown'`. Nothing here is a durable claim.

### 4.2 Port + Manager read-only method (Q4/Q5)

```ts
// RepositoryHostingProvider (port) — read-only, NO ApprovalRef:
getPullRequestStatus(input: {
  identity: RepositoryIdentity;
  pullRequestNumber: number;
  expectedHeadBranch: string;
  expectedBaseBranch: string;
  expectedCommitHash: string;
}): Promise<PullRequestStatusPreview>;

// RepositoryHostingManager.getPullRequestStatus(input) — owns:
//   provider.kind === identity.provider; supported provider; safe owner/repo;
//   Number.isSafeInteger(pullRequestNumber) && > 0; SHA-shaped expectedCommitHash; safe head/base;
//   → provider.getPullRequestStatus(input);
//   → result integrity: result.ref identity == identity; result.headBranch == expectedHeadBranch;
//     result.baseBranch == expectedBaseBranch; result.headCommitHash == expectedCommitHash;
//     ref.pullRequestNumber == pullRequestNumber; isSafeGitHubPullRequestUrl(ref.pullRequestUrl, identity, number);
//     counts are non-negative integers → mismatch throws (read-only failure, no state change).
```
No `ApprovalRef` (read-only, Q5). The manager throws a bounded read-only error on any mismatch/failure — no
typed Blocked/Unverified distinction is needed (nothing is mutated), and the runtime maps any failure to a
"could not check current status" response (Q8) with **no state change**.

### 4.3 GitHub adapter read-only calls (Q11, if plan approved)

`GitHubRepositoryHostingProvider.getPullRequestStatus` — read-only GitHub REST via `fetch` (github.com only):
```text
GET /repos/{owner}/{repo}/pulls/{number}
  → state (open/closed), merged (→ 'merged'), draft, head.ref, base.ref, head.sha
GET /repos/{owner}/{repo}/commits/{head.sha}/check-runs
  → total_count + check_runs[].{status,conclusion} → success/failure/pending/neutral/skipped counts + rollup state
GET /repos/{owner}/{repo}/pulls/{number}/reviews
  → summarize latest-per-reviewer → approved / changes_requested counts + rollup state
```
Maps ONLY the bounded fields above; **ignores** everything else — no raw response/body, no check logs/output,
no review body text, no commit message, no file list/diff/content, no token. **No** `POST`/`PATCH`/`PUT`/
`DELETE`, no reviewer/label/merge/rerun/update calls (Q11). Sanitized errors (no token/raw payload); 404 →
`state: 'unknown'` or a read-only "could not check" failure per the manager's integrity rules; one fetch per
sub-call, no retry. github.com only; Enterprise deferred.

### 4.4 Runtime handling (Q1/Q2/Q6)

New `interpretPrStatusIntent(text)` — matches an explicit PR-status/check/review phrase (needs a status verb +
a PR/CI/check/review noun): e.g. `PR 상태 (확인/어때/봐줘)`, `CI 상태`, `체크 상태`, `checks 봐줘`, `review 상태`,
`리뷰 상태`. Does **not** match a bare "상태" with no PR/CI/check/review context (Q1/test 6), and does **not**
match merge/deploy/release/approve/label/reviewer/assignee (those keep routing to
`handlePrCreatedCompanionUnsupportedTurn` — 3d-D). Consulted **only** at `PR_CREATED`.

`PR_CREATED` routing (extends the 3d-D block; status checked before the companion catch):
```ts
if (applyAnchor?.status === 'PR_CREATED') {
  if (interpretPrStatusIntent(text))        return this.handlePrStatusPreviewTurn(message, session, applyAnchor);
  if (interpretPrIntent(text) === 'create') return this.handlePrAlreadyCreatedTurn(message, session, applyAnchor);
  if (interpretPrIntent(text) === 'pr-unsupported' || PR_CREATED_COMPANION_WORDS.test(text))
                                            return this.handlePrCreatedCompanionUnsupportedTurn(message, session);
}
```

`handlePrStatusPreviewTurn`:
```text
// not configured: no deps.repositoryHosting.identity OR no manager (missing token) → composePrStatusNotConfigured;
//   NO call, NO state change (Q7).
// complete PR_CREATED context: pullRequestRef + pullRequestNumber + pullRequestUrl + pullRequestHeadBranch +
//   pullRequestBaseBranch + pullRequestCommitHash + repositoryIdentity — else composePrStatusUnavailable.
// resolved identity == anchor.repositoryIdentity == pullRequestRef identity (provider/owner/repo) — else unavailable.
// manager.getPullRequestStatus({ identity, pullRequestNumber, expectedHeadBranch, expectedBaseBranch,
//   expectedCommitHash }) — the ONLY call; runtime never calls the provider.
//   success → composePrStatusPreview(view); KEEP PR_CREATED (Q2 — no re-anchor, no new state).
//   any throw → composePrStatusCheckFailed ("현재 PR 상태를 확인하지 못했어요"); KEEP PR_CREATED; NO state change (Q8).
```
No new anchor state (Q2); no ApprovalRef (Q5); no `ExecutionOrchestrator`/Git change (Q12/Q13).

### 4.5 Response composers (Q10)

```text
composePrStatusPreview(ctx, preview) → bounded, point-in-time:
  "현재 조회 기준으로 PR 상태를 확인했어요.\n- PR: #<number> <url>\n- 상태: <open/closed/merged/unknown>[ (draft)]\n
   - 브랜치: <head> → <base>\n- 커밋: <short>\n- 체크: 성공 X / 실패 Y / 대기 Z (총 N)[, 상태 <state>]\n
   - 리뷰: 승인 A / 변경요청 B (있을 때만)\n지금 이 시점 조회 결과예요. 머지/배포/릴리즈는 하지 않았어요."
composePrStatusNotConfigured(ctx) → "PR 상태를 확인할 저장소/토큰이 설정되지 않았어요. (상태 조회만 하며 변경은 없어요)"
composePrStatusUnavailable(ctx)   → "지금은 PR 상태를 확인할 수 없어요. (변경은 하지 않았어요)"
composePrStatusCheckFailed(ctx)   → "현재 PR 상태를 확인하지 못했어요. PR이 없어졌다는 뜻은 아니에요. (변경은 하지 않았어요)"
```
Wording discipline: point-in-time only; a merged/closed report is stated as "provider가 현재 closed/merged로
보고" without implying deploy/release or performing close/reopen (Q9); **never** "안전하게 머지해도 됩니다 /
CI가 영구 통과 / 배포 준비 완료 / 검증 완료"; no raw logs/response/token/file list/diff/review body/commit body.

## 5. Required Architecture Questions — decisions

- **Q1 (trigger)** — `interpretPrStatusIntent` at `PR_CREATED` only; explicit PR/CI/check/review-status phrase;
  never merge/deploy/release/approve/label/reviewer/assignee; bare "상태" without PR/CI/check/review context does
  not trigger (§4.4).
- **Q2 (new state?)** — **No.** Keep `PR_CREATED`; no `PR_STATUS_PREVIEWED`/`PR_VERIFIED`/`READY_TO_MERGE`.
- **Q3 (domain shape)** — `PullRequestStatusPreview` (§4.1), provider-independent, bounded, no raw/secret data.
- **Q4 (method location)** — `getPullRequestStatus` on `RepositoryHostingProvider` + `RepositoryHostingManager`
  (§4.2); manager owns validation/kind/PR-number/integrity/bounding, provider owns read-only API calls.
- **Q5 (ApprovalRef?)** — **No** (read-only). Still requires a live `PR_CREATED` anchor + matching identity/ref/
  head/base/commit.
- **Q6 (runtime → adapter?)** — **No.** Runtime calls `RepositoryHostingManager.getPullRequestStatus` only;
  never imports `GitHubRepositoryHostingProvider`/`@chunsik/repository-hosting-github`.
- **Q7 (missing token/manager)** — safe `composePrStatusNotConfigured`; no state change, no crash (ADR-0054
  token boundary).
- **Q8 (failures)** — "현재 PR 상태를 확인하지 못했어요" ≠ PR not created / PR failed / checks failed; no state
  transition, no durable failure state.
- **Q9 (merged/closed)** — report "provider가 현재 merged/closed로 보고"; never merge/close/reopen; never infer
  deploy/release.
- **Q10 (display)** — bounded summary (§4.5); no raw logs/response/token/file list/diff/file content/review
  body/commit body.
- **Q11 (GitHub surface)** — read-only `GET` pull / check-runs / reviews (§4.3); **no** write verbs / reviewer /
  label / merge / rerun / update.
- **Q12 (Git change?)** — **No** (`GitProvider`/`GitManager`/`LocalGitProvider`/`RepositoryInfo` unchanged).
- **Q13 (ExecutionOrchestrator?)** — **No** (ConversationRuntime-composed).
- **Q14 (future merge/deploy)** — 3e previews only; merge-approval / merge-execution / deployment each remain a
  separate future plan-only sprint + CA review; no future mutation is unlocked by this preview.

## 6. Required tests (Node 22) — CA's 60-item list

**Trigger/state (1–6, 50–53):** 1 `PR_CREATED` + PR-status phrase → status preview · 2 non-`PR_CREATED` → no
preview · 3 `PR_CREATED` + merge phrase → not previewed as merge (companion) · 4 + deploy phrase → not deploy ·
5 + reviewer/label/assignee → unsupported · 6 bare "상태" (no PR/CI/check context) → no trigger · 50 preview
keeps `PR_CREATED` · 51 no `PR_STATUS_PREVIEWED` · 52 no `PR_VERIFIED` · 53 no `READY_TO_MERGE`.

**Runtime/manager boundary (7–9, 38–42):** 7 runtime calls `RepositoryHostingManager` only · 8 runtime does not
import the GitHub adapter · 9 runtime receives no token · 38 no `GitProvider` method added · 39 no `GitManager`
method added · 40 no `CommandExecution` · 41 no runtime shell · 42 no `ExecutionOrchestrator` change.

**Config/context (10–15):** 10 missing identity → not configured · 11 missing manager/token → not configured ·
12 anchor missing `pullRequestRef` → unavailable · 13 anchor missing `repositoryIdentity` → unavailable · 14
resolved-identity mismatch → unavailable · 15 `PullRequestRef` identity mismatch → unavailable.

**Result integrity (16–21):** 16 head-branch mismatch → fail safe · 17 base-branch mismatch → fail safe · 18
commit-hash mismatch → fail safe · 19 PR-number mismatch → fail safe · 20 raw provider response not exposed · 21
token-like content not exposed.

**Response wording (22–37, 54–56):** 22 includes PR number + bounded URL · 23 point-in-time wording · 24 no
merge/deploy/release claim · 25 does not say "safe to merge" · 26 does not say "CI verified forever" · 27 checks
success summary · 28 checks pending summary · 29 checks failure summary · 30 checks unknown summary · 31 reviews
approved summary (if available) · 32 reviews changes-requested summary (if available) · 33 no raw check logs ·
34 no review body text · 35 no file paths · 36 no raw diff · 37 no file content · 54 read-only provider error →
"could not check current status" wording · 55 merged state reported without deployment wording · 56 closed state
reported without reopen/close mutation.

**No mutation (43–49):** 43 no merge API call · 44 no deploy/release behavior · 45 no reviewer mutation · 46 no
label mutation · 47 no assignee mutation · 48 no check-rerun call · 49 no PR update/close/reopen call.

**Adapter/Node 22 (57–60):** 57 GitHub adapter tests use fake fetch only · 58 no live GitHub network · 59
`pnpm typecheck` · 60 `pnpm test`.

## 7. Architecture Impact / Reuse

- **Adds:** `PullRequestStatusPreview` + state enums (domain); `getPullRequestStatus` on the port + manager +
  GitHub adapter (read-only); `interpretPrStatusIntent` + `handlePrStatusPreviewTurn` + `PR_CREATED` status
  routing; `composePrStatusPreview`/`...NotConfigured`/`...Unavailable`/`...CheckFailed`;
  `deps.repositoryHosting.manager.getPullRequestStatus`; ADR-0055; fake-manager/fake-fetch tests.
- **Reuses unchanged:** `PR_CREATED` anchor + fields (ADR-0054), port/manager/adapter (ADR-0052/0053),
  `isSafeGitHubPullRequestUrl`/`RepositoryIdentity` (ADR-0051/0052), the token boundary + not-configured +
  no-live-network patterns (ADR-0053/0054).
- **Does NOT change:** `GitProvider`/`GitManager`/`LocalGitProvider`/`RepositoryInfo`, `ExecutionOrchestrator`,
  `WorkspaceWrite`/`Patch`/`CodeGeneration`/`CommandExecution`, or any anchor state. No new state; no ApprovalRef;
  no GitHub write; no merge/deploy/release/reviewer/label/assignee.

## 8. ADR-0055 (proposed) — Pull Request Status Preview

Records: a **read-only** repository-hosting status preview after `PR_CREATED` — point-in-time provider-reported
status only (`PullRequestStatusPreview`); **no** durable verified/safe-to-merge state, **no** new anchor state
(keep `PR_CREATED`); no merge/auto-merge/deploy/release/CI-rerun/check-rerun/review-mutation/reviewer/label/
assignee/PR-close-reopen-update; `getPullRequestStatus` added to `RepositoryHostingProvider`/
`RepositoryHostingManager` (+ read-only GitHub adapter, github.com only, `GET` only) — **no ApprovalRef**
(read-only) but requires a live `PR_CREATED` anchor + exact identity/ref/head/base/commit match, manager owns
validation + result integrity + bounded shape; runtime calls the **manager only, never the adapter**; the token
stays app/adapter-local (never in core/runtime/anchor/reason/response/log); missing token/identity → safe
not-configured, no state change; a fetch failure means "could not check current status" (never "PR not
created/failed"), no state transition; a merged/closed report is stated as provider-reported without inferring
deploy/release or performing close/reopen; Git capability and `ExecutionOrchestrator` unchanged. Naming: *PR
status preview* / *point-in-time hosting status*, never "verification"/"safe-to-merge". Relations: ADR-0054
(reads `PR_CREATED`), ADR-0053 (adapter read-only method), ADR-0052 (port/manager read-only method), ADR-0051
(identity), ADR-0023 (Git local-only). Plan: `docs/plans/sprint-3e-pr-status-preview-plan.md`.

## 9. Implementation sequence (after CA plan approval)

1. Apply plan changes. 2. Author ADR-0055. 3. Add domain shape + enums. 4. Add `getPullRequestStatus` to port +
manager (read-only, integrity-gated) + GitHub adapter (read-only `GET` calls, fake-fetch-tested). 5. Add
`interpretPrStatusIntent` + `handlePrStatusPreviewTurn` + `PR_CREATED` routing + composers; extend
`deps.repositoryHosting.manager`. 6. Add the 60 tests (fake manager / fake fetch; no live GitHub). 7. Validate
on Node 22 (typecheck exit 0 + full suite green). 8. Open PR for Chief Architect Implementation Review. **No
mutation, no new state, no GitHub write.**

## 10. Stop condition (this sprint)

Plan-only. **Do not implement. Do not create a branch. Do not commit. Do not open a PR. Do not call the GitHub
API. Do not merge/deploy/release.** This document is left on the working tree (untracked) for Chief Architect
Review. Request CA review after the plan is written.
