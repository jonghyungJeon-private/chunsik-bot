# Sprint 3d-C Plan — GitHub RepositoryHosting Adapter (adapter-only; runtime PR-creation execution deferred to 3d-D)

- **Status:** APPROVED WITH CHANGES (all 18 CA required changes applied) → implemented (adapter-only); PR open
  for CA Implementation Review.
- **Base:** `main @ 665d7f9876d4ada5275a7ec873d2f97a75a0dbd6`
- **Validation runtime:** Node 22
- **ADR (proposed):** ADR-0053 — GitHub RepositoryHosting Adapter (adapter-only; runtime execution deferred).
- **Scope decision (Q1, with evidence):** **3d-C1 — GitHub adapter only.** Actual runtime PR-creation
  execution (the first product-reachable remote mutation) is **split out to Sprint 3d-D**. See §1.1 for the
  evidence and §9 for the 3d-D preview.
- **Predecessors:** ADR-0052 (Sprint 3d-B — `RepositoryHostingProvider` port + `RepositoryHostingManager` this
  adapter implements/plugs into), ADR-0051 (Sprint 3d-A — `RepositoryIdentity` the adapter consumes),
  ADR-0050 (Sprint 3c — RepositoryHosting design), ADR-0048 (provider-reported `GitPushResult` discipline
  mirrored by `PullRequestResult`; `git-local` adapter pattern mirrored), ADR-0023 (Git stays local-only).

## 0. CA review disposition (Sprint 3d-C plan — APPROVED WITH CHANGES)

All 18 CA required changes applied in the implementation:

| CA change | Where applied |
|---|---|
| 1. Token constructor-only; no `CHUNSIK_GITHUB_TOKEN` read in `config.ts` | §4.1; adapter tests (env-token guard) |
| 2. Constructor rejects blank/whitespace token (no fetch) | §4.1; tests 1/2 |
| 3. Exact headers `Authorization: Bearer` / `Accept` / `X-GitHub-Api-Version: 2022-11-28` / `User-Agent: chunsik-bot` | §4.1; tests 3–6 |
| 4. API base fixed `https://api.github.com`; no override option | §4.1; tests 7/8 |
| 5. `encodeURIComponent` for path/query segments; raw branches in POST body | §4.2; tests 14/19/27 |
| 6. Multiple open PRs → deterministic ambiguous safe failure (never first) | §4.2; test 23 |
| 7. Same-repo head only; fork rejected via `head.repo.owner.login`/`name` | §4.2; test 24 |
| 8. `branchExists` boolean-only; no branch commit SHA exposed | §4.2 |
| 9. `pullRequestCommitHash` from `head.sha` (find + create); missing/invalid → reject | §4.2; tests 25/31 |
| 10. PR number must be positive safe integer | §4.2; test 32 |
| 11. Explicit HTTP status handling; `createPullRequest` 201-only | §4.2; tests 9–12/28/29/30 |
| 12. Minimal POST body `{title,head,base,body}` only | §4.2; test 27 |
| 13. No retry — one `fetch` per method | §4.3; test 39 |
| 14. Timeout optional/injected; tests never wait real time | §4.1/§4.3 |
| 15. Sanitized errors — no token/response body/Authorization/request body | §4.3; tests 36–38 |
| 16. All tests use injected fake `fetch` (no live network) | adapter test harness; test 40 |
| 17. Not wired into `app.module`; ConversationRuntime unchanged | §4/§7; tests 44–47 |
| 18. ADR-0053 states adapter-only + real `createPullRequest` impl unreachable in runtime | §8 |

**Result:** new package `@chunsik/repository-hosting-github` + 35 adapter tests (fake-fetch); full suite **47
files / 870 tests pass** on Node v22.22.1; `pnpm typecheck` exit 0. **Not wired into runtime — product flow
still stops at `PR_APPROVED`.**

## 1. Goal

Sprint 3d-C builds the **real GitHub adapter** implementing the CAP-010 `RepositoryHostingProvider` port —
`GitHubRepositoryHostingProvider` in a new `@chunsik/repository-hosting-github` package, calling the GitHub
REST API via Node 22 built-in `fetch`. **It is not wired into `app.module.ts` and not reachable by any product
flow**, and its unit tests use an **injected fake fetch** (no live GitHub network). The product flow still
stops at `PR_APPROVED`; the adapter exists but nothing can invoke it in runtime.

The full future target flow (completed only after 3d-D):

```text
PR_APPROVED → explicit PR-creation execution request → verify PR approval context → resolve RepositoryIdentity
→ verify hosting state → RepositoryHostingManager.createPullRequest → GitHubRepositoryHostingProvider
→ provider-reported PullRequestResult → validate result integrity → PR_CREATED
```

Sprint 3d-C delivers only the `GitHubRepositoryHostingProvider` box; 3d-D delivers the runtime wiring +
`PR_CREATED` + execution intent + response composers.

### 1.1 Q1 decision — adapter-only (3d-C1), with evidence

CA offered `3d-C1` (adapter only), `3d-C2` (adapter + runtime execution in one sprint), or a split. **Decision:
3d-C1**, because 3d-C2 cannot be proven "narrow, explicit, fully guarded" — source-measured evidence:

- **`ConversationRuntime` is already 3163 lines** (`wc -l packages/core/src/application/conversation-runtime.ts`).
  Runtime PR-**execution** would add to it: a `PR_CREATED` anchor status + ≥9 new anchor fields, a new
  execution-intent classifier (distinct from 3b's `interpretPrIntent`), a `handlePrCreationExecutionTurn`,
  `PR_APPROVED`/`PR_CREATED` routing, companion rejection, and PR_CREATED-state behaviors — a large, high-risk
  change to an already-large state machine.
- **The `ConversationRuntime` DI factory in `app.module.ts` already spans ~69 `inject`/`useFactory` lines** with
  ~25 injected collaborators. Wiring `RepositoryHostingManager` + identity resolution and **making the remote
  mutation reachable** is a significant, high-risk composition change.
- **Bundling both = the largest diff yet AND the first product-reachable remote mutation in one sprint.** That
  is the opposite of narrow/guarded.
- **The adapter alone is a clean, self-contained slice** (new package mirroring `git-local`; 4 REST methods;
  built-in `fetch`; unit-tested with an injected fake fetch — no live network), and — critically — **left
  unwired**, so the mutation surface stays closed (matching the 3d-B "exists but unreachable" progression).

Therefore: **3d-C = GitHub adapter (unwired, fake-fetch-tested). 3d-D = runtime execution (wiring + PR_CREATED +
intent + composers).** ADR-0053 records adapter-only and states runtime execution remains deferred.

## 2. Boundary & the most important rule

> **Pull Request creation is a repository-hosting/platform mutation, not a local Git operation.** No PR logic in
> `GitProvider`/`GitManager`/`CommandExecution`/runtime shell/`ExecutionOrchestrator`/`WorkspaceWrite`/
> `PatchManager`/`CodeGeneration`. The GitHub adapter calls the GitHub REST API **only** through `fetch`
> inside `@chunsik/repository-hosting-github` — **no** `gh`/`hub`/`curl`/`CommandExecution`/shell/
> `git request-pull`. github.com only; GitHub Enterprise deferred.

**3d-C1 does NOT do (verified plan intent):** wire the adapter into `app.module.ts`; add any `ConversationRuntime`/
`ApplyPreviewAnchor`/`ResponseComposer` change; add `PR_CREATED`; add an execution-intent classifier; read
`CHUNSIK_GITHUB_TOKEN` in `config.ts`; make any live GitHub call in tests or product; merge/deploy/release/
reviewer/label/assignee mutation; fetch raw diff/file content.

## 3. Architecture & reuse (source-verified)

- **Node 22 has global `fetch` + `AbortSignal.timeout`** (verified: `node -e "typeof fetch"` → `function`;
  `typeof AbortSignal.timeout` → `function`). So the adapter uses **built-in `fetch`; no `octokit`/SDK
  dependency** (Q3) — justification: the four calls are simple REST GETs/POST; a dependency is unwarranted and
  would enlarge the trust surface.
- **Adapter package template** = `@chunsik/git-local` (`packages/git-local`): `type: commonjs`, `main`/`types`
  → `dist`, `scripts.build: tsc -b`, `dependencies: { "@chunsik/core": "workspace:*" }`, tsconfig extends the
  base + references `../core`. `@chunsik/repository-hosting-github` mirrors this exactly. Added to
  `tsconfig.build.json` references + root `pnpm-workspace.yaml` packages glob (already `packages/*`).
- **Port + Manager already exist (ADR-0052)** — `RepositoryHostingProvider` (the adapter implements it) and
  `RepositoryHostingManager` (unchanged; it remains the capability-level backstop that consumes the adapter in
  3d-D). The adapter takes **no `ApprovalRef`** and returns a provider-reported `PullRequestResult`.
- **`config.ts` is still the only env-reading path** (verified: the sole `process.env` reader in app/packages
  source is `apps/chunsik/src/config.ts`), so any token env reading (3d-D) lives there — not in core, not in
  the adapter's own `process.env` access.
- **PR-URL / result discipline reused from 3d-B**: `isSafeGitHubPullRequestUrl` (Manager validates the
  adapter's returned `html_url`); `PullRequestResult` is provider-reported, not independent truth.

## 4. Design — `GitHubRepositoryHostingProvider` (3d-C1)

### 4.1 Package & construction

`packages/repository-hosting-github/src/index.ts` → `@chunsik/repository-hosting-github`. Implements
`RepositoryHostingProvider` (`kind = 'github'`).

```ts
export interface GitHubHostingConfig {
  /** GitHub token — adapter-local ONLY. Never enters core/domain/anchor/approval/reply/log; used only as an
   *  Authorization header value. */
  token: string;
  /** Injectable fetch for testability (default: global fetch). Tests pass a fake — NO live network. */
  fetchImpl?: typeof fetch;
  /** Optional request timeout ms (default e.g. 10_000) via AbortSignal.timeout. */
  timeoutMs?: number;
}
export class GitHubRepositoryHostingProvider implements RepositoryHostingProvider {
  readonly kind = 'github';
  constructor(private readonly config: GitHubHostingConfig) {}
  // GitHub REST base: https://api.github.com (github.com only; Enterprise deferred — Q3/Q15).
}
```

**Auth (Q2):** token is passed to the constructor (adapter-local). Every request sets
`Authorization: Bearer <token>` + `Accept: application/vnd.github+json` + `X-GitHub-Api-Version`. The token is
**never** logged, never put in an error, never returned. In 3d-D the composition root reads
`CHUNSIK_GITHUB_TOKEN` in `config.ts` and constructs the provider; **3d-C1 does not read it** (adapter unwired).

### 4.2 Methods (exact GitHub REST calls — Q4)

```text
repositoryExists(identity):
  GET https://api.github.com/repos/{owner}/{repo}
  200 → true; 404 → false; 401/403 → throw sanitized "unavailable"; other non-2xx → throw sanitized error.

branchExists(identity, branch):
  GET https://api.github.com/repos/{owner}/{repo}/branches/{branch}
  200 → true; 404 → false; 401/403 → throw sanitized "unavailable"; other → throw.

findOpenPullRequest(identity, headBranch, baseBranch):        // Q5
  GET https://api.github.com/repos/{owner}/{repo}/pulls?state=open&head={owner}:{headBranch}&base={baseBranch}
  0 matches → null; exactly 1 → map to PullRequestResult; ≥2 → throw safe failure (CA: multiple → safe failure).
  head param is same-repository only: "{owner}:{headBranch}" (forks unsupported — CA decision).

createPullRequest(input):                                     // the only mutating call
  POST https://api.github.com/repos/{owner}/{repo}/pulls
  body { title, head, base, body }  (bounded title/body from the Manager; NO ApprovalRef/token/diff/file content)
  201 → map to PullRequestResult; non-2xx → throw sanitized error.
```

**Response mapping (Q6/Q7):** from the GitHub PR object use only `number` → `pullRequestNumber`, `html_url` →
`pullRequestUrl`, `head.ref` → `pullRequestHeadBranch`, `base.ref` → `pullRequestBaseBranch`, **`head.sha` →
`pullRequestCommitHash`** (Q6 option A — provider-reported PR head SHA); `reused` set by the Manager path
(adapter returns a best-effort value the Manager overrides). Everything else is **ignored** — no raw diff, no
file content, no secrets fetched. If a required field (`html_url`/`head.sha`/`number`) is absent/malformed →
throw a sanitized error (the Manager then keeps `PR_APPROVED`). The Manager validates `html_url` via
`isSafeGitHubPullRequestUrl` and `head.sha === expectedCommitHash`.

### 4.3 Error sanitization (Q13 provider portion)

A private `request()` helper: builds the URL + headers, applies `AbortSignal.timeout`, calls `fetchImpl`, and
maps failures to **bounded, deterministic adapter errors** that never include the token or the raw GitHub
response body. 404 is mapped to `false` for the existence checks (not an error); 401/403 → a fixed
"repository hosting unavailable" error; network/timeout → a fixed error. Raw GitHub error payloads are never
surfaced (Q2/Q13). github.com host only — any other host/Enterprise base is rejected (Q15, deferred).

## 5. Required Architecture Questions — decisions

- **Q1 (adapter-only vs both)** — **3d-C1: GitHub adapter only** (evidence §1.1). Runtime execution → 3d-D.
- **Q2 (auth)** — `CHUNSIK_GITHUB_TOKEN`, read in `config.ts` (the verified sole env path) **in 3d-D**; in
  3d-C1 the token is a constructor param (adapter-local). Token never enters core/domain/`RepositoryIdentity`/
  `ApprovalRequest.reason`/`ApplyPreviewAnchor`/`ResponseComposer`/logs; provider errors sanitized. Core never
  reads the token; the Manager never receives it.
- **Q3 (API surface)** — GitHub **REST** via Node 22 built-in **`fetch`**; **no `octokit`/SDK** (justified: 4
  simple calls). No `gh`/`hub`/`curl`/`CommandExecution`/shell/`git request-pull`.
- **Q4 (exact calls)** — §4.2 (GET repos, GET branches, GET pulls, POST pulls). Request/response fields used are
  enumerated; all else ignored; no diff/content/secret fetch.
- **Q5 (existing-PR reuse)** — same-repository head only (`{owner}:{headBranch}`); forks unsupported; **≥2
  matching open PRs → safe failure**; exactly 1 → mapped result (Manager then integrity-validates + sets
  `reused: true`).
- **Q6 (pullRequestCommitHash)** — provider-reported PR `head.sha` (option A). Manager validates `===
  expectedCommitHash`. If absent/malformed in the response → adapter throws (Manager keeps `PR_APPROVED`); no
  extra reachability call in the first implementation.
- **Q7 (PR URL)** — adapter returns GitHub `html_url`; Manager validates via `isSafeGitHubPullRequestUrl`
  (https/github.com/exact `/<owner>/<repo>/pull/<number>`/exact casing/no creds/no query/no fragment/no
  percent-encoding/bounded — ADR-0052).
- **Q8 (PR body)** — **deferred to 3d-D** (body derivation is a runtime concern). Decision recorded now: the
  body is **re-derived deterministically** from approved context in 3d-D (generated-by-ChunsikBot + approved
  title + commit hash + head/base + committed-file count + "no merge/deploy/release"); **no** raw diff/file
  content/token/remote URL; bounded; no arbitrary user body. The adapter just forwards the bounded `body`
  string it is given.
- **Q9 (runtime state `PR_CREATED`)** — **deferred to 3d-D.** Fields: `pullRequestProvider`/`Owner`/`Repo`/
  `Number`/`Url`/`HeadBranch`/`BaseBranch`/`CommitHash`/`Reused`. No merge/deploy/release semantics.
- **Q10 (approval verification before execution)** — **deferred to 3d-D** (runtime). Recorded: anchor
  `PR_APPROVED`; `prApprovalId` exists; `approvals.get` exists + `APPROVED` + plan match; `prPushedCommitHash
  == pushedCommitHash == pushCommitHash == commitHash`; `prHeadBranch == pushedBranch`; `prBaseBranch ==
  "main"`; `RepositoryIdentity` resolves + matches provider config. Any mismatch → safe failure, no PR.
- **Q11 (second approval)** — **No second approval** (3b already made the CRITICAL approval), but an **explicit
  execution phrase** is required (3d-D). Bare 좋아/오케이/진행해/다음/승인 do not execute.
- **Q12 (companion phrases)** — **deferred to 3d-D**: PR+merge/배포/release/reviewer/label/assignee/auto-merge →
  reject before any provider call; no mutation.
- **Q13 (failure wording)** — provider portion in 3d-C (sanitized adapter errors, 404→false, auth→unavailable);
  the ResponseComposer failure taxonomy (not-configured/approval-invalid/repo-unavailable/branch-missing/
  existing-PR-invalid/creation-failed/result-unverified/already-created) is **3d-D**. Rules: no fake success,
  no `PR_CREATED` on failure, keep `PR_APPROVED`, no "no PR created" claim on ambiguous responses, no rollback,
  raw provider errors sanitized.
- **Q14 (`PR_CREATED` behavior)** — **deferred to 3d-D**: PR phrase → already created/opened; deploy/merge/
  release phrases → future sprint. No deploy/merge/release.
- **Q15 (app.module wiring)** — **3d-C1: none.** No `GitHubRepositoryHostingProvider` binding, no
  `REPOSITORY_HOSTING_PROVIDER` binding, no `ConversationRuntime` dependency, no token injection. Wiring is
  3d-D. No `ExecutionOrchestrator` change ever.
- **Q16 (no hidden side effects)** — adapter has no `GitManager`/`GitProvider` PR method, no `CommandExecution`/
  shell, no `WorkspaceWrite`/`Patch`/`CodeGeneration`/`ExecutionOrchestrator`, no merge/deploy/release/reviewer/
  label/assignee/branch-creation/force-push. Proven by adapter tests + source-level absence guards.

## 6. Required tests (Node 22) — CA's 83-item list, tagged by sprint

**3d-C (adapter, this sprint) — implemented with an injected fake `fetch` (no live network):**
- 35 provider receives no `ApprovalRef` · 36 provider input carries no token · 37 no raw diff · 38 no file
  content · 39 bounded title/body only.
- 40 `repositoryExists` → `GET /repos/{owner}/{repo}` · 41 `branchExists` → `GET /repos/{owner}/{repo}/branches/{branch}`
  · 42 `findOpenPullRequest` → same-repo `head=owner:branch` & `base` · 43 `createPullRequest` → `POST
  /repos/{owner}/{repo}/pulls` · 44 no GitHub call outside the allowed endpoints · 45 provider sanitizes GitHub
  errors (no token/raw payload) · 46 404 repo/branch → `false` · 47 auth failure → unavailable, no token leak ·
  48 validates GitHub PR URL shape (via `isSafeGitHubPullRequestUrl`) · 49 maps number/url/head/base/head.sha →
  `PullRequestResult` · 50 github.com only; Enterprise rejected/deferred.
- 33 (adapter portion) multiple open PRs → safe failure · 30 (adapter portion) `findOpenPullRequest`
  unsupported/error surfaces so the Manager blocks.
- Absence guards: 66 no `GitProvider.createPullRequest` · 67 no `GitManager.createPullRequest` · 68 no
  `CommandExecution` · 69 no runtime shell · 70 no `WorkspaceWrite` · 71 no `PatchManager` · 72 no
  `CodeGeneration` · 73 no `ExecutionOrchestrator` change · 74–81 no merge/deploy/release/reviewer/label/
  assignee/branch-creation/force-push (adapter uses only the 4 endpoints) · plus "app.module binds no
  RepositoryHosting provider" (still true after 3d-C1).
- 82 Node 22 `pnpm typecheck` · 83 Node 22 `pnpm test`.

**3d-D (runtime execution, next sprint) — documented here as the future spec:** 1–8 (execution-phrase gating),
9–12 (companion rejection), 13–21 (approval/context verification), 22–25 (identity/token not-configured), 26–29
(ordered checks via Manager), 31–32 (reuse/integrity re-anchor), 34 (single create), 51–56 (result-mismatch
keeps `PR_APPROVED`), 57–59 (`PR_CREATED` re-anchor + fields), 60–65 (response wording incl. reused/failure/
already-created). (The Manager-level ordering/reuse/integrity for 26–34/51–56 already exists and is tested at
the manager layer in ADR-0052; 3d-D adds the runtime/composer layer.)

## 7. Architecture Impact / Reuse

- **Adds (3d-C1):** `packages/repository-hosting-github` (`@chunsik/repository-hosting-github`,
  `GitHubRepositoryHostingProvider` + `GitHubHostingConfig`); its unit tests (injected fake fetch); a
  `tsconfig.build.json` reference; ADR-0053; this plan.
- **Reuses unchanged:** `RepositoryHostingProvider` port + `RepositoryHostingManager` (ADR-0052),
  `RepositoryIdentity` (ADR-0051), `isSafeGitHubPullRequestUrl`/`PullRequestResult` (ADR-0052), the `git-local`
  adapter package template.
- **Does NOT change:** `GitProvider`/`GitManager`/`LocalGitProvider`/`RepositoryInfo`, `ConversationRuntime`,
  `ApplyPreviewAnchor`, `ResponseComposer`, `ExecutionOrchestrator`, `app.module.ts` (no binding), `config.ts`
  (no token read yet), `WorkspaceWrite`/`Patch`/`CodeGeneration`/`CommandExecution`. No `PR_CREATED`, no
  runtime execution, no live GitHub call.

## 8. ADR-0053 (proposed) — GitHub RepositoryHosting Adapter (adapter-only; runtime execution deferred)

Records: `GitHubRepositoryHostingProvider` added (`@chunsik/repository-hosting-github`) implementing the
CAP-010 `RepositoryHostingProvider` port via the **GitHub REST API through Node 22 `fetch`** (no octokit); four
methods `repositoryExists`/`branchExists`/`findOpenPullRequest`/`createPullRequest` on the exact endpoints in
§4.2; **github.com only, GitHub Enterprise deferred**; token is **adapter-local** (constructor param; read from
`CHUNSIK_GITHUB_TOKEN` in `config.ts` only when wired in 3d-D) and **never** enters core/domain/anchor/approval/
reply/logs; provider errors sanitized (no token, no raw payload); 404 → false, auth failure → unavailable;
same-repository head only (`owner:branch`), forks unsupported, **multiple open PRs → safe failure**;
`pullRequestCommitHash` = provider-reported `head.sha`; `PullRequestResult` is provider-reported, not
independent truth; `RepositoryHostingManager` remains the capability-level backstop and validates result
integrity (incl. `html_url` + `head.sha === expectedCommitHash`). **The adapter is NOT wired into `app.module.ts`
and no product flow can reach it; unit tests use an injected fake `fetch` with no live network. Therefore
actual runtime PR-creation execution — `PR_CREATED`, execution-intent classifier, `ConversationRuntime`/
`ResponseComposer` changes, and DI wiring — remains DEFERRED to Sprint 3d-D**, and the product flow still stops
at `PR_APPROVED`. No Git-capability PR method; no `CommandExecution`/shell; no `ExecutionOrchestrator` change;
no merge/deploy/release/reviewer/label/assignee. Relations: ADR-0052 (port/manager implemented), ADR-0051
(identity), ADR-0050 (design), ADR-0048 (provider-reported discipline + adapter template), ADR-0023 (Git
local-only). Plan: `docs/plans/sprint-3d-c-github-pr-creation-execution-plan.md`.

## 9. Sprint 3d-D preview (runtime PR-creation execution — the deferred slice)

So CA can see the split: 3d-D wires `GitHubRepositoryHostingProvider` (`REPOSITORY_HOSTING_PROVIDER` binding) +
injects `RepositoryHostingManager` + a resolved `RepositoryIdentity` into `ConversationRuntime`; reads
`CHUNSIK_GITHUB_TOKEN` in `config.ts`; adds the `PR_CREATED` state + fields (Q9), an explicit PR-execution
intent classifier (Q11), `handlePrCreationExecutionTurn` (Q10 verification → Manager call → `PR_CREATED`),
companion rejection (Q12), the `ResponseComposer` failure taxonomy + created/reused wording (Q13/Q14), and the
runtime tests 1–34/51–65. It is the first product-reachable remote mutation and gets its own CA plan review
and ADR.

## 10. Implementation sequence (after CA plan approval)

1. Apply plan changes (this document). 2. Author ADR-0053 (adapter-only variant). 3. Create
`packages/repository-hosting-github` (mirror `git-local`); implement `GitHubRepositoryHostingProvider` +
`GitHubHostingConfig` with built-in `fetch` + `AbortSignal.timeout` + sanitized errors. 4. Add
`tsconfig.build.json` reference. 5. Add adapter unit tests with an injected fake `fetch` (endpoints, mapping,
404/auth, sanitization, multiple-PR safe failure, github.com-only) + source-level absence guards. 6. Validate
on Node 22 (typecheck exit 0 + full suite green). 7. Open PR for Chief Architect Implementation Review. **No
app.module wiring, no live GitHub call, no runtime execution, no PR creation in product.**

## 11. Stop condition (this sprint)

Plan-only. **Do not implement. Do not create a branch. Do not commit. Do not open a PR. Do not call the GitHub
API. Do not create a Pull Request.** This document is left on the working tree (untracked) for Chief Architect
Review. Request CA review after the plan is written.
