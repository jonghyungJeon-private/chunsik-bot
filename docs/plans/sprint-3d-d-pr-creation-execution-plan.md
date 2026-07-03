# Sprint 3d-D Plan — Actual PR Creation Execution (PR_APPROVED → wired GitHub adapter → PR_CREATED)

- **Status:** APPROVED WITH CHANGES (all 15 CA required changes applied) → implemented; PR open for CA
  Implementation Review.
- **Base:** `main @ ba00f139f8d301f8bd2a0e8a4c9750621cd0fb2d`
- **Validation runtime:** Node 22
- **ADR (proposed):** ADR-0054 — Actual PR Creation Execution.
- **Nature:** the **first product-reachable repository-hosting mutation.** It wires the accepted (unwired)
  GitHub adapter (ADR-0053) through `REPOSITORY_HOSTING_PROVIDER` → `RepositoryHostingManager` (ADR-0052) into
  `ConversationRuntime`, and adds the `PR_CREATED` state + explicit execution trigger + safe-failure taxonomy.
- **Predecessors (reused, not re-litigated):** ADR-0049 (PR approval gate + `PR_APPROVED` anchor + PR context),
  ADR-0050 (RepositoryHosting design), ADR-0051 (`RepositoryIdentity` config + `RepositoryIdentityResolver`),
  ADR-0052 (`RepositoryHostingManager` — the capability backstop; owns all hosting checks + result integrity),
  ADR-0053 (`GitHubRepositoryHostingProvider` — real REST adapter, unwired until now).

## 0. CA review disposition (Sprint 3d-D plan — APPROVED WITH CHANGES)

All 15 CA required changes applied:

| CA change | Where applied |
|---|---|
| 1. Bind `repositoryIdentity` at PR-approval time; execution requires exact match | `handlePrApprovalTurn` stores it; `handlePrCreationExecutionTurn` re-resolves + matches |
| 2. Do not parse `ApprovalRequest.reason`; structured fields + `ApprovalRef` only | `handlePrCreationExecutionTurn` (get + status + plan) |
| 3. Token app-local; runtime gets `RepositoryHostingManager | undefined`, never the token | `config.ts` `githubToken`; `app.module.ts`; deps `repositoryHosting.manager?` |
| 4. Missing/blank token → no adapter constructed, inject undefined manager | `app.module.ts` (token-present guard) |
| 5. Startup warning optional / no token logged | no new logging added |
| 6. Typed manager errors: Blocked (pre-mutation) vs Unverified (post-attempt) | `RepositoryHostingBlockedError`/`RepositoryHostingUnverifiedError`; runtime maps wording |
| 7. Runtime does not duplicate manager validation; never imports/calls the adapter | runtime calls manager only; absence guards |
| 8. `PR_CREATED` preserves the full causal chain + PR result; no token/remoteUrl | anchor fields + tests |
| 9. `GIT_PUSHED` PR approval fails safe when identity not configured | `handlePrApprovalTurn` step 0 |
| 10. Reason may mention owner/repo but is never parsed later | `buildPrApprovalReason` owner/repo; structured verify |
| 11. PR body count-only, no raw file list | `buildPrBody` |
| 12. Auth-failure vs missing-token wording distinguished where possible | `composePrCreationNotConfigured` vs `composePrCreationBlocked` |
| 13. `PR_CREATED` follow-ups bounded (already-created / merge-deploy-release future) | `handlePrAlreadyCreatedTurn` / `handlePrCreatedCompanionUnsupportedTurn` + `PR_CREATED_COMPANION_WORDS` |
| 14. Avoid a generic "failed" that could imply no-PR after a POST | `composePrCreationBlocked` (pre-mutation) vs `composePrCreationUnverified` (post-attempt) |
| 15. No live GitHub in tests — fake manager / fake fetch only | runtime tests use fake manager; adapter fake fetch; no token required |

**Result:** full suite **47 files / 888 tests pass** on Node v22.22.1; `pnpm typecheck` exit 0. First
product-reachable PR mutation — gated by live `PR_APPROVED` + exact identity/context match + explicit phrase +
manager checks. Prior-sprint "not wired" absence guards (3d-A/3d-B/3d-C) updated to their enduring invariants.

## 1. Goal

Turn a live `PR_APPROVED` anchor into an actual GitHub Pull Request, product-runtime:

```text
GIT_PUSHED → PR approval request → PR_APPROVED
→ explicit PR creation execution request (PR-create/open verb, AT PR_APPROVED)
→ resolve RepositoryIdentity (config → resolver)
→ verify live ApprovalRef + PR context + identity match
→ RepositoryHostingManager.createPullRequest  (→ GitHubRepositoryHostingProvider via REPOSITORY_HOSTING_PROVIDER)
→ validate provider-reported result through the manager
→ PR_CREATED  (never merged/deployed/released/independently-verified-after-creation)
```

The runtime calls `RepositoryHostingManager` **only** — never the provider directly. This sprint is the
candidate to move the product past `PR_APPROVED`, **but is plan-only first**; no implementation until CA
approves this plan.

## 2. Boundary & the most important rule

> Actual PR creation is a **high-risk remote platform mutation.** It fires **only** on: (1) live `PR_APPROVED`,
> (2) exact PR/pushed context match, (3) resolved + validated `RepositoryIdentity`, (4) an explicit PR
> create/open phrase at `PR_APPROVED`, (5) via `RepositoryHostingManager`, (6) with provider-reported result
> integrity. It must **never** fire on approval alone, a bare "PR" noun, deploy/merge/release, an ambiguous
> follow-up, runtime guessing, git-remote parsing, or a user-pasted URL.

**Still forbidden in 3d-D (Q12):** merge · auto-merge · deployment · release · reviewer/label/assignee mutation
· draft mode · branch creation · force push · **direct GitHub-adapter call from Runtime** · git-remote parsing
· `RepositoryInfo.remoteUrl` · `CommandExecution` · runtime shell · any `GitProvider`/`GitManager` PR method ·
`ExecutionOrchestrator` change.

## 3. Architecture & reuse (source-verified)

- **3b PR-approval flow (kept intact).** `conversation-runtime.ts`: `interpretPrIntent` → `'create' |
  'pr-unsupported' | null` (line ~989); `PR_APPROVAL_PENDING` intercepts decisions (line 1065);
  `DEPLOY_ONLY_WORDS = /(배포|deploy|릴리즈|release)/i` (line 554). The **`PR_APPROVED` routing block (line
  1117)** currently maps `interpretPrIntent === 'create'` → `handlePrAlreadyApprovedTurn` ("already approved,
  not created") — **3d-D changes this branch to EXECUTE** (see §4.2). Composers live on `this.deps.composer`
  (`ResponseComposer`); e.g. `composePrApprovalRecorded`/`composePrAlreadyApproved`/
  `composePrApprovedDeployUnsupported`.
- **Trigger reuse (Q3).** The execution trigger reuses `interpretPrIntent === 'create'` — the phrase grammar
  ("PR 만들어줘"/"Pull Request 생성해줘"/"승인된 PR 생성 진행해줘"/"create/open the approved pull request") is
  identical to the 3b approval-request grammar; **the anchor STATE disambiguates** request-approval (at
  `GIT_PUSHED`) from execute (at `PR_APPROVED`). It already rejects a bare "PR"/"pull request" noun (→ null),
  "승인"/"좋아"/"진행해" (no PR word → null), and PR+companion (→ `'pr-unsupported'`). No new classifier needed.
- **Manager + adapter already exist and are reused unchanged in contract** (ADR-0052/0053): the runtime passes
  `{ identity, headBranch, baseBranch, title, body, expectedCommitHash, approvalRef }` to
  `RepositoryHostingManager.createPullRequest`, which owns provider.kind match + `repositoryExists` +
  `branchExists(head/base)` + `findOpenPullRequest` + reuse + single `createPullRequest` + result integrity
  (incl. `head.sha === expectedCommitHash`). One small refinement (§4.5): the manager exposes **typed errors**
  (blocked-pre-mutation vs unverified-post-attempt) so the runtime composes accurate wording — no validation
  moves into the runtime.
- **Identity + token wiring.** `RepositoryIdentityResolver` (ADR-0051) resolves `ChunsikConfig.repositoryHosting`
  → `RepositoryIdentity`. `config.ts` is the sole env reader; 3d-D adds `CHUNSIK_GITHUB_TOKEN` there because
  this sprint introduces the runtime adapter binding.
- **Anchor.** `ApplyPreviewAnchor` (in `conversation-runtime.ts`) already carries `prApprovalId`/
  `prPushedCommitHash`/`prHeadBranch`/`prBaseBranch`/`prTitle`/`prBodyPreview` + pushed/commit context; 3d-D
  adds a `PR_CREATED` status + PR-result fields (§4.1/Q2).

## 4. Design

### 4.1 New state + anchor fields (Q1/Q2)

`ApplyPreviewAnchorStatus` gains `PR_CREATED` (after `PR_APPROVED`). **Meaning:** a provider-reported PR was
created, or an existing open PR was safely connected, **during this run**. **Never** merged/deployed/released/
reviewed/CI-passed/safe-forever/independently-verified-after-creation.

`PR_CREATED` preserves all prior context and adds:
```text
repositoryIdentity: { provider, owner, repo }
pullRequestRef              (provider/owner/repo/number/url — from ADR-0052 pullRequestRef())
pullRequestNumber
pullRequestUrl
pullRequestHeadBranch
pullRequestBaseBranch
pullRequestCommitHash
pullRequestReused
```
**Never stored:** token · raw GitHub response · raw diff · file content · GitHub SDK object · remoteUrl.

### 4.2 Routing change at `PR_APPROVED` + new `PR_CREATED` guard (Q3/Q13/Q14)

```ts
if (applyAnchor?.status === 'PR_APPROVAL_PENDING') { /* 3b — unchanged; approval decision only, no execution */ }

if (applyAnchor?.status === 'PR_APPROVED') {
  const prKind = ConversationRuntime.interpretPrIntent(message.text);
  if (prKind === 'pr-unsupported')  return this.handlePrUnsupportedCompanionTurn(message, session);        // Q12
  if (prKind === 'create')          return this.handlePrCreationExecutionTurn(message, session, actor, applyAnchor); // NEW (was already-approved)
  if (DEPLOY_ONLY_WORDS.test(message.text)) return this.handlePrApprovedDeployUnsupportedTurn(message, session); // 3b
}

if (applyAnchor?.status === 'PR_CREATED') {                                                                 // NEW state
  const prKind = ConversationRuntime.interpretPrIntent(message.text);
  if (prKind === 'create')          return this.handlePrAlreadyCreatedTurn(message, session, applyAnchor);  // already created/opened + URL
  if (prKind === 'pr-unsupported' || DEPLOY_ONLY_WORDS.test(message.text))
                                    return this.handlePrCreatedCompanionUnsupportedTurn(message, session);  // merge/deploy/release → future sprint
}
```
`PR_APPROVAL_PENDING` still intercepts (3b) — an execution phrase while pending does **not** bypass approval;
only `PR_APPROVED` proceeds to execution (Q13). No fresh Git read (Q14) — the manager's `branchExists` checks
are the authoritative preflight; the PR is based on the pushed commit hash + hosting branch state.

### 4.3 `handlePrCreationExecutionTurn` (the execution path; Q4/Q5/Q8)

```ts
// 0. Hosting configured? resolver(config.repositoryHosting) → RepositoryIdentity; manager present (token wired).
//    missing/invalid identity OR manager absent (no token) → composePrCreationNotConfigured; NO manager/provider call,
//    NO PR_CREATED (Q5/Q6).
// 1. anchor.status === 'PR_APPROVED' AND complete PR context (prApprovalId, prPushedCommitHash, prHeadBranch,
//    prBaseBranch, prTitle, workspaceRef, executionPlanRef) — else composePrCreationUnavailable, no call.
// 2. approvals.get(prApprovalId): exists AND status === APPROVED AND executionPlanRef.id === anchor.executionPlanRef.id
//    (Q4) — else composePrCreationUnavailable, NO manager/provider call, NO PR_CREATED.
// 3. context match (Q4): prPushedCommitHash === pushedCommitHash === pushCommitHash === commitHash;
//    prHeadBranch === pushedBranch; prBaseBranch === PR_BASE_BRANCH_POLICY ("main");
//    resolvedIdentity matches the approved/pushed context — else composePrCreationUnavailable, no call.
// 4. body = deriveDeterministicPrBody(anchor)  (generated-by-ChunsikBot + prTitle + short pushedCommitHash +
//    head→base + committedFiles COUNT + "no merge/deploy/release"; NO raw diff/file content/token/remoteUrl).
// 5. RepositoryHostingManager.createPullRequest({ identity: resolvedIdentity, headBranch: prHeadBranch,
//    baseBranch: prBaseBranch, title: prTitle, body, expectedCommitHash: prPushedCommitHash, approvalRef }).
//    Runtime calls the MANAGER only — never the provider (Q7/Q8).
// 6a. success → re-anchor PR_CREATED (preserve all context + §4.1 PR fields; pullRequestReused from result);
//     reused ? composePrCreatedReusedExisting : composePrCreated.
// 6b. manager throws BlockedError (pre-mutation: repo/branch/find/existing-invalid) → keep PR_APPROVED,
//     composePrCreation{Unavailable|RepositoryUnavailable|...}; "PR은 만들지 않았어요."
// 6c. manager throws UnverifiedError (createPullRequest attempted but failed/result-unverified) → keep
//     PR_APPROVED, composePrCreationUnverified: "PR 생성 완료를 확인하지 못했어요. GitHub 상태를 확인해 주세요."
//     (Q10 — do NOT claim no PR when mutation may have occurred.)
```

Runtime owns conversation state, intent/trigger, approval+context verification, identity resolution, response
composition, anchor transition. Manager owns the hosting checks + result integrity (Q8) — not duplicated in
the runtime beyond the context checks above.

### 4.4 Token + DI wiring (Q6/Q7)

- **`config.ts`** gains `githubToken?: string` from `CHUNSIK_GITHUB_TOKEN` (adapter-local; read only because the
  runtime adapter binding is introduced here). Token **never** enters core/domain/anchor/`ApprovalRequest.reason`/
  logs/responses.
- **Missing-token policy (Q6, decided):** if `repositoryHosting` identity is configured but the token is
  absent/blank, **do NOT crash startup or unrelated non-PR flows** — instead the composition root binds **no**
  provider/manager, and the runtime treats PR execution as **not-configured** (`composePrCreationNotConfigured`,
  no PR attempt). Justification: a PR-only misconfiguration must not take down chat/other flows; a runtime
  safe-fail is the least-blast-radius, user-visible outcome. (Startup logs a clear internal config warning.)
- **`app.module.ts`:** bind `REPOSITORY_HOSTING_PROVIDER` → `new GitHubRepositoryHostingProvider({ token })`
  **only when a non-blank token is present**; construct `RepositoryHostingManager` from it; inject
  `RepositoryHostingManager` (optional) + a resolved `RepositoryIdentity` (optional, via
  `RepositoryIdentityResolver`) into `ConversationRuntime`. When token/identity absent → inject `undefined` →
  runtime not-configured. `ExecutionOrchestrator` unchanged (Q15).

### 4.5 Manager error surface refinement (Q10, minimal)

The manager keeps all validation (ADR-0052); 3d-D only makes its outcomes **distinguishable** so the runtime
composes accurate wording: throw a `RepositoryHostingBlockedError` for pre-mutation failures (approval/kind/
input/repo/branch/find/existing-invalid — definitively no PR) and a `RepositoryHostingUnverifiedError` when
`createPullRequest` was attempted but failed or its result failed integrity (mutation ambiguity possible). No
validation moves into the runtime.

### 4.6 Response composers (Q9/Q10/Q11)

New `ResponseComposer` methods (approval/PR-created wording; never overclaim):
```text
composePrCreated(ctx, { owner, repo, headBranch, baseBranch, commitHash, prNumber, prUrl })
  → "PR을 만들었어요.\n- 저장소: owner/repo\n- 브랜치: head → base\n- 커밋: <short>\n- PR: <url>\n아직 머지/배포/릴리즈는 하지 않았어요."
composePrCreatedReusedExisting(ctx, {...})   → "기존에 열려 있던 PR을 연결했어요. … 새 PR을 만들지는 않았어요. 머지/배포/릴리즈는 하지 않았어요."
composePrCreationNotConfigured(ctx)          → "PR 생성 대상 저장소(또는 토큰)가 설정되지 않았어요. PR은 만들지 않았어요."
composePrCreationUnavailable(ctx)            → approval/context mismatch: "지금은 PR을 생성할 수 없어요. PR은 만들지 않았어요."
composePrCreationRepositoryUnavailable(ctx)  → repo/branch missing / auth: "GitHub 저장소/브랜치를 확인할 수 없어요. PR은 만들지 않았어요."
composePrCreationFailed(ctx)                 → clean create failure: "PR 생성에 실패했어요. PR은 만들지 않았어요."
composePrCreationUnverified(ctx)             → "PR 생성 완료를 확인하지 못했어요. GitHub 상태를 확인해 주세요." (no rollback claim)
composePrAlreadyCreated(ctx, { prNumber, prUrl })       → PR_CREATED + create phrase: "이미 PR을 만들었어요: #<n> <url>."
composePrCreatedCompanionUnsupported(ctx)    → PR_CREATED + deploy/merge/release: "머지/배포/릴리즈는 이후 단계예요. 지금은 하지 않았어요."
```
Reuse wording (Q9): reused → "기존에 열려 있던 PR을 연결했어요" (never "새 PR을 만들었어요"). Every failure says
"PR은 만들지 않았어요" **except** the post-attempt ambiguous case (unverified). No merge/deploy/release claim on
any success.

## 5. Required Architecture Questions — decisions

- **Q1 (state)** — add `PR_CREATED`; means created/connected this run; not merged/deployed/released/reviewed/
  CI/safe-forever/independently-verified (§4.1).
- **Q2 (anchor fields)** — §4.1 (identity + pullRequestRef/number/url/head/base/commit/reused); no token/raw
  response/diff/file content/SDK/remoteUrl.
- **Q3 (trigger)** — `interpretPrIntent === 'create'` at `PR_APPROVED` (state-driven); rejects bare noun/승인/
  진행해/deploy/merge/release; pending behavior intact (§4.2/§3).
- **Q4 (approval verify)** — `ApprovalManager.get(prApprovalId)` APPROVED + plan match + PR/pushed context match
  + identity match; mismatch → no manager/provider call, no `PR_CREATED` (§4.3 steps 2–3).
- **Q5 (identity)** — `config.repositoryHosting` → `RepositoryIdentityResolver` → `RepositoryIdentity`; missing/
  invalid → safe not-configured failure, no call. No git remote/remoteUrl/user URL/per-request/connector/shell.
- **Q6 (token)** — `CHUNSIK_GITHUB_TOKEN` in `config.ts`, adapter-local only; **missing token → runtime
  safe-fail (not-configured), no startup crash of non-PR flows** (§4.4, justified).
- **Q7 (DI)** — `REPOSITORY_HOSTING_PROVIDER` → `GitHubRepositoryHostingProvider` (token present only) →
  `RepositoryHostingManager` → injected into `ConversationRuntime`; runtime calls the **manager, never the
  provider** (§4.4).
- **Q8 (ownership)** — runtime: state/intent/approval+context verify/identity resolve/response/anchor; manager:
  ApprovalRef gate/input validation/kind/repo+branch checks/find/reuse/create/result integrity (§4.3/§4.5).
- **Q9 (reuse)** — `pullRequestReused: true` → "기존 PR 연결" wording; `false` → "PR 만들었어요" (§4.6).
- **Q10 (safe failures)** — full taxonomy (§4.6); all say "PR은 만들지 않았어요" except post-attempt ambiguous →
  "확인하지 못했어요"; no overclaim if mutation may have occurred (§4.5 typed errors).
- **Q11 (PR_CREATED response)** — URL/owner-repo/head→base/commit/reused-vs-new/no-merge-deploy-release (§4.6).
- **Q12 (forbidden)** — §2 list; proven by tests 49–60.
- **Q13 (pending)** — `PR_APPROVAL_PENDING` intercepts; approval and execution are separate phases; only
  `PR_APPROVED` executes (§4.2).
- **Q14 (GIT_PUSHED/dirty)** — no Git-status blocker; manager `branchExists` is the authoritative preflight; PR
  based on pushed commit hash + hosting branch state (§3/§4.2). No fresh git read.
- **Q15 (ExecutionOrchestrator)** — no change; ConversationRuntime-composed.
- **Q16 (tests)** — §6 (74 items).

## 6. Required tests (Node 22) — CA's 74-item list

**Trigger & state (1–10):** 1 PR create phrase from `PR_APPROVED` triggers execution · 2 bare "PR" no-op · 3
"승인" no-op · 4 ambiguous "진행해" no-op · 5 deploy phrase no create · 6 merge phrase no create · 7
`PR_APPROVAL_PENDING` cannot execute · 8 `GIT_PUSHED` w/o `PR_APPROVED` cannot execute · 9 `PR_CREATED` only
after manager success · 10 no `PR_CREATED` on failure.

**Approval/context verify (11–20):** 11 runtime calls `ApprovalManager.get(prApprovalId)` · 12 missing approval
fails safe · 13 non-APPROVED fails safe · 14 plan mismatch fails safe · 15 PR context mismatch fails safe · 16
pushed commit mismatch fails safe · 17 head/base mismatch fails safe · 18 identity mismatch fails safe · 19
manager not called on mismatch · 20 provider not called on mismatch.

**Identity/token/config (21–32):** 21 resolved identity passed to manager · 22 missing identity fails safe · 23
invalid identity fails safe · 24 no git-remote parsing · 25 no `RepositoryInfo.remoteUrl` · 26 no user-pasted
owner/repo · 27 missing token fails safe · 28 token not in anchor · 29 token not in response · 30 token not in
`ApprovalRequest.reason` · 31 token not logged · 32 `config.ts` reads token only for adapter config.

**Manager/provider integration (33–40):** 33 runtime calls `RepositoryHostingManager`, not the provider · 34
manager gets `ApprovalRef`, provider does not · 35 manager gets expected commit hash from pushed context · 36
existing-PR → `PR_CREATED` `reused: true` · 37 new-PR → `PR_CREATED` `reused: false` · 38 manager failure → no
`PR_CREATED` · 39 result-integrity failure → no `PR_CREATED` · 40 ambiguous existing-PR failure → no `PR_CREATED`.

**Response (41–48):** 41 new-PR success includes URL · 42 says no merge/deploy/release · 43 reuse says existing
connected · 44 reuse does not say newly created · 45 missing identity says PR not created · 46 missing token
says PR not created · 47 auth failure says PR not created · 48 unverified does not overclaim no-PR when
mutation ambiguity possible.

**Side-effect absence (49–60):** 49 no `GitProvider.createPullRequest` · 50 no `GitManager.createPullRequest` ·
51 no `CommandExecution` · 52 no runtime shell · 53 no merge · 54 no deploy · 55 no release · 56 no reviewer ·
57 no label · 58 no assignee · 59 no branch creation · 60 no force push.

**Anchor shape (61–72):** 61 `PR_CREATED` has `repositoryIdentity` · 62 `pullRequestRef` · 63
`pullRequestNumber` · 64 `pullRequestUrl` · 65 head/base branches · 66 `pullRequestCommitHash` · 67
`pullRequestReused` · 68 preserves commit/push/PR-approval context · 69 no token · 70 no raw GitHub response ·
71 no raw diff/file content · 72 no remoteUrl.

**Node 22 (73–74):** 73 `pnpm typecheck` · 74 `pnpm test`.

## 7. Architecture Impact / Reuse

- **Adds:** `PR_CREATED` status + PR-result anchor fields; `handlePrCreationExecutionTurn` +
  `handlePrAlreadyCreatedTurn` + `handlePrCreatedCompanionUnsupportedTurn`; `deriveDeterministicPrBody`; the
  `PR_APPROVED` routing change (create → execute); ~8 `ResponseComposer` methods (§4.6); typed manager errors
  (§4.5); `config.ts` `githubToken`; `app.module.ts` `REPOSITORY_HOSTING_PROVIDER` binding +
  `RepositoryHostingManager` + resolved identity injection into `ConversationRuntime`; ADR-0054; tests.
- **Reuses unchanged:** `interpretPrIntent`/`DEPLOY_ONLY_WORDS`/`PR_BASE_BRANCH_POLICY` (3b), `RepositoryHostingManager`
  contract + `GitHubRepositoryHostingProvider` (ADR-0052/0053), `RepositoryIdentityResolver` (ADR-0051),
  `ApprovalManager.get` (CAP-004).
- **Does NOT change:** `GitProvider`/`GitManager`/`LocalGitProvider`/`RepositoryInfo`, `ExecutionOrchestrator`,
  `WorkspaceWrite`/`Patch`/`CodeGeneration`/`CommandExecution`. No merge/deploy/release/reviewer/label/assignee;
  no direct adapter call from runtime; no git-remote parsing/shell.

## 8. ADR-0054 (proposed) — Actual PR Creation Execution

Records: actual PR creation execution added (first product-reachable repository-hosting mutation); `PR_CREATED`
state + anchor fields (identity + pullRequestRef/number/url/head/base/commit/reused; no token/raw response/diff/
file content/remoteUrl); GitHub adapter wired via `REPOSITORY_HOSTING_PROVIDER`; **runtime calls
`RepositoryHostingManager`, never the adapter directly**; execution requires live `PR_APPROVED` + explicit PR
create/open phrase at `PR_APPROVED` (state-driven trigger; approval alone / bare noun / 승인 / 진행해 / deploy /
merge / release do not execute); `RepositoryIdentity` resolved from reviewed config only; `CHUNSIK_GITHUB_TOKEN`
adapter-local, missing token → runtime safe-fail (not-configured) without crashing non-PR flows; the manager
still owns provider.kind/input/repo+branch/find/reuse/create/result-integrity (incl. `head.sha ===
expectedCommitHash`), with typed errors distinguishing blocked-pre-mutation vs unverified-post-attempt;
`PullRequestResult` remains provider-reported, not independent truth; existing-open-PR reuse → `reused: true`
with "existing PR connected" wording; safe-failure taxonomy (all "PR은 만들지 않았어요" except post-attempt
ambiguous → "확인하지 못했어요"); **no** merge/auto-merge/deploy/release/reviewer/label/assignee/draft/branch-
creation/force-push; Git capability and `ExecutionOrchestrator` unchanged. Relations: ADR-0053 (adapter wired),
ADR-0052 (manager consumed), ADR-0051 (identity), ADR-0049 (`PR_APPROVED` consumed), ADR-0025 (approval).
Plan: `docs/plans/sprint-3d-d-pr-creation-execution-plan.md`.

## 9. Implementation sequence (after CA plan approval)

1. Apply plan changes. 2. Author ADR-0054. 3. Add `PR_CREATED` status + anchor fields + `deriveDeterministicPrBody`.
4. Add `handlePrCreationExecutionTurn` + `PR_CREATED` handlers; change `PR_APPROVED` create-branch to execute.
5. Add `ResponseComposer` methods + typed manager errors. 6. Wire `config.ts` token + `app.module.ts` binding +
`ConversationRuntime` injection. 7. Add the 74 tests. 8. Validate on Node 22 (typecheck exit 0 + full suite
green). 9. Open PR for Chief Architect Implementation Review. This is the first sprint whose implementation, if
approved, makes a real GitHub PR reachable — so the tests must gate it exhaustively.

## 10. Stop condition (this sprint)

Plan-only. **Do not implement. Do not create a branch. Do not commit. Do not open a PR. Do not call the GitHub
API. Do not create a Pull Request.** This document is left on the working tree (untracked) for Chief Architect
Review. Request CA review after the plan is written.
