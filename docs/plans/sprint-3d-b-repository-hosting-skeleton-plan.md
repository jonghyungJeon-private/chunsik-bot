# Sprint 3d-B Plan — RepositoryHosting Skeleton (domain/port/manager/token; fake-provider tests only; NO hosting mutation)

- **Status:** APPROVED WITH CHANGES (all 12 CA required changes applied) → implemented; PR open for CA
  Implementation Review.
- **Base:** `main @ 2fa8582aef609c65a595a37597d3410e3e48e348`
- **Validation runtime:** Node 22
- **ADR (proposed):** ADR-0052 — RepositoryHosting Skeleton.
- **Capability:** the **non-mutating skeleton** of CAP-010 Repository Hosting (ADR-0050 design; ADR-0051
  delivered the identity source). 3d-B adds the provider-independent **domain types + port + manager + DI
  token** with **fake-provider tests only** — **no** `GitHubRepositoryHostingProvider`, **no** GitHub API,
  **no** PR creation, **no** `PR_CREATED`, **no** runtime wiring.
- **Predecessors:** ADR-0050 (Sprint 3c — the accepted RepositoryHosting design this sprint turns into code;
  §4.3–§4.6 of the 3c plan are the source shapes), ADR-0051 (Sprint 3d-A — `RepositoryIdentity`/
  `RepositoryIdentityConfig` + validators this sprint **reuses, not duplicates**), ADR-0048 (Sprint 3a —
  `isSafePushRemote`/`isSafePushBranch` in `push-target.ts` + the SHA-shape guard reused here; the
  provider-reported `GitPushResult` discipline mirrored by `PullRequestResult`), ADR-0046/ADR-0025 (the
  `GitManager` Ref-gating template the manager mirrors).

## 0. CA review disposition (Sprint 3d-B plan — APPROVED WITH CHANGES)

All 12 CA required changes + the "APPROVED WITH CHANGES" Q decisions (Q2/Q3/Q6/Q9/Q10/Q11/Q13/Q14) applied:

| CA change | Where applied |
|---|---|
| 1. Manager validates `provider.kind === identity.provider` before any provider call | §4.3; tests 61/62 |
| 2. Deterministic title normalization (collapse+trim; empty→reject); provider gets normalized title | §4.1 `normalizePrTitle`, §4.3; tests 63–66 |
| 3. Manager-owned `reused` (true via reuse path, false via create path; provider flag not trusted) | §4.3; tests 67/68 |
| 4. Result `pullRequestCommitHash === expectedCommitHash` (both existing + created) | §4.3; tests 69/70 |
| 5. Deterministic capability errors; raw provider errors never forwarded | §4.3; test 71 |
| 6. Do NOT use `isSafePushRemote` (no remote field) | §3, §4.3; test 72 |
| 7. `PullRequestCreationInput` has no `pushedRemote` field (explicit) | §4.1; test 73 |
| 8. PR-URL rejects query string + fragment | §4.1 `isSafeGitHubPullRequestUrl`; tests 74/75 |
| 9. PR-URL exact path, no percent-encoding, exact owner/repo casing | §4.1; tests 76/77 |
| 10. `app.module.ts` binds no provider (absence-guarded) | §4.4; test 78 |
| 11. ADR-0052: port has mutating shape but no real impl; fake providers only | §8 |
| 12. ADR-0052: manager unit-test success = skeleton boundary only, not product PR creation | §8 |

**Result:** 55 new tests; full suite **46 files / 835 tests pass** on Node v22.22.1; `pnpm typecheck` exit 0.

## 1. Goal

Establish the provider-independent RepositoryHosting boundary in code, so a **future** GitHub adapter (3d-C+)
and PR-creation execution flow have a validated seam to plug into — **without any hosting-side mutation**:

```text
RepositoryIdentityConfig → RepositoryIdentityResolver → RepositoryIdentity   (3d-A, reused)
        +
RepositoryHosting domain types (PullRequestCreationInput / PullRequestResult / PullRequestRef)
RepositoryHostingProvider port (repositoryExists / branchExists / findOpenPullRequest / createPullRequest)
RepositoryHostingManager (ApprovalRef gate + input validation + call ordering + result integrity)
REPOSITORY_HOSTING_PROVIDER token
```

Actual execution stays blocked — the product flow still stops at `PR_APPROVED`:

```text
PR_APPROVED → actual PR creation execution → STILL NOT IMPLEMENTED (no adapter, no runtime, no PR_CREATED)
```

Only **fake providers in tests** exercise the manager; no real network, no GitHub, no DI binding of a real
provider.

## 2. Boundary & the most important rule

> **RepositoryHosting is a hosting/platform capability. It is not Git.** No PR method is added to
> `GitProvider`/`GitManager`/`LocalGitProvider`/`CommandExecution`/runtime shell/`ExecutionOrchestrator`/
> `WorkspaceWrite`/`PatchManager`/`CodeGeneration`. The port exposes a `createPullRequest` **shape**, but 3d-B
> ships **no real adapter** and **no runtime call** — only fake-provider unit tests may invoke it.

**Allowed (implemented in 3d-B):** RepositoryHosting domain types (`PullRequestCreationInput`,
`PullRequestResult`, `PullRequestRef` + `pullRequestRef()` + PR-title/body bounds + PR-URL validator);
`RepositoryHostingProvider` port; `RepositoryHostingManager` (ApprovalRef validation, input validation, call
ordering, existing-PR reuse, result integrity); `REPOSITORY_HOSTING_PROVIDER` token; fake-provider tests;
ADR-0052.

**NOT allowed (verified absent):** `GitHubRepositoryHostingProvider` · GitHub API call / octokit · actual PR
creation · `PR_CREATED` state · `ConversationRuntime` PR-execution flow · PR-execution trigger classifier ·
live hosting-state verification against GitHub · auth-token handling · GitHub Enterprise · merge/deploy/release
· reviewer/label/assignee mutation · branch creation · force push · `CommandExecution` · runtime shell-out ·
real DI provider binding.

## 3. Architecture & reuse (source-verified)

- **Extends the existing `packages/core/src/domain/repository-hosting.ts`** (created in 3d-A). Reuses
  `RepositoryHostingProviderKind` (`'github'`), `RepositoryIdentity`, and the validators
  `isSupportedHostingProvider`/`isSafeRepoOwner`/`isSafeRepoName` — **not duplicated** (Q1).
- **Port/Manager/Adapter/Token pattern** mirrors CAP-002 Git exactly (ADR-0023/46/48):
  - Port `RepositoryHostingProvider` — plain interface, `readonly kind: string`, no SDK types, one method per
    operation, doc note "Approval gating is done by `RepositoryHostingManager`; this port takes no
    ApprovalRef" (mirrors `GitProvider`).
  - Manager `RepositoryHostingManager` — `private readonly provider`; `createPullRequest(input + approvalRef)`
    checks `approvalRef.status === ApprovalStatus.APPROVED` first, defensively re-validates every field, runs
    ordered read-only checks, then a single mutating call, then result-integrity — the `ApprovalRef` is
    consumed here and **never** passed to the provider (mirrors `GitManager.pushApprovedCommit`).
  - Token `REPOSITORY_HOSTING_PROVIDER = Symbol('RepositoryHostingProvider')` in `ports/tokens.ts`.
- **Reuses existing safe-input helpers (Q10):** `isSafePushBranch` (head/base branch safety) from
  `application/push-target.ts`; the SHA-shape guard `/^[0-9a-f]{7,40}$/i` (mirrors
  `GitManager.pushApprovedCommit`'s `commitHash` check) for `expectedCommitHash`; `ApprovalRef`/
  `ApprovalStatus.APPROVED` (CAP-004). **`isSafePushRemote` is NOT used (CA change 6)** — RepositoryHosting
  works with identity + branch names, not git remotes; the manager has no remote input.
- **No `RepositoryInfo`/Git change (core rule); no runtime wiring (Q12/Q13).** `ConversationRuntime`,
  `ApplyPreviewAnchor`, `ResponseComposer`, `ExecutionOrchestrator`, `app.module.ts` DI bindings unchanged; the
  token may be exported but **no real provider is bound**.

## 4. Design (proposed shapes — from the ADR-0050 accepted design)

### 4.1 Domain additions (`packages/core/src/domain/repository-hosting.ts`)

```ts
export const MAX_PR_TITLE = 200;   // bounded PR subject (non-empty required)
export const MAX_PR_BODY = 8000;   // bounded PR body

/** Input to RepositoryHostingManager.createPullRequest — assembled from a live PR_APPROVED anchor + configured
 *  RepositoryIdentity (future). Bounded/sanitized fields ONLY. NO ApprovalRef, NO token, NO raw diff/file
 *  content, NO GitHub SDK type, NO git remote URL (Q2). */
export interface PullRequestCreationInput {
  identity: RepositoryIdentity;
  headBranch: string;
  baseBranch: string;
  title: string;
  body: string;
  expectedCommitHash: string;
}

/** PROVIDER-REPORTED PR creation/open result — NOT independent verification beyond the provider response
 *  (mirrors GitPushResult; Q3). */
export interface PullRequestResult {
  provider: RepositoryHostingProviderKind;
  owner: string;
  repo: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  pullRequestHeadBranch: string;
  pullRequestBaseBranch: string;
  pullRequestCommitHash: string;
  reused: boolean;
}

/** Durable repository-scoped handle (a PR number is repository-scoped; Q4). */
export interface PullRequestRef {
  provider: RepositoryHostingProviderKind;
  owner: string;
  repo: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
}
export function pullRequestRef(r: PullRequestResult): PullRequestRef { /* {provider,owner,repo,number,url} */ }

/** PR-URL validation (Q11): https only; host === github.com; path EXACTLY /<owner>/<repo>/pull/<number>;
 *  no credentials (no userinfo); bounded length. GHE deferred. */
export function isSafeGitHubPullRequestUrl(url: string, identity: RepositoryIdentity, prNumber: number): boolean;
```

### 4.2 Port (`packages/core/src/ports/repository-hosting-provider.port.ts`; Q5)

```ts
export interface RepositoryHostingProvider {
  readonly kind: string;
  repositoryExists(identity: RepositoryIdentity): Promise<boolean>;
  branchExists(identity: RepositoryIdentity, branch: string): Promise<boolean>;
  findOpenPullRequest(identity: RepositoryIdentity, headBranch: string, baseBranch: string): Promise<PullRequestResult | null>;
  createPullRequest(input: PullRequestCreationInput): Promise<PullRequestResult>;  // takes NO ApprovalRef
}
```
Added to `ports/index.ts`. **No real adapter package is created in 3d-B** — only fake providers in tests
implement it.

### 4.3 Manager (`packages/core/src/application/repository-hosting-manager.ts`; Q6/Q8/Q9/Q10)

```ts
export class RepositoryHostingManager {
  constructor(private readonly provider: RepositoryHostingProvider) {}

  async createPullRequest(input: { identity; headBranch; baseBranch; title; body; expectedCommitHash; approvalRef: ApprovalRef }): Promise<PullRequestResult> {
    // 1. approvalRef.status === ApprovalStatus.APPROVED — else throw (mirrors GitManager).            [Q10]
    // 2. input validation BEFORE any provider call — else throw:
    //      isSupportedHostingProvider(identity.provider); isSafeRepoOwner(identity.owner) & isSafeRepoName(identity.repo);
    //      isSafePushBranch(headBranch) & isSafePushBranch(baseBranch); headBranch !== baseBranch;
    //      title trimmed non-empty & ≤ MAX_PR_TITLE; body ≤ MAX_PR_BODY; /^[0-9a-f]{7,40}$/i.test(expectedCommitHash).
    // 3. provider.repositoryExists(identity) — false → throw (no create).                              [check #1]
    // 4. provider.branchExists(identity, headBranch) — false → throw.                                  [check #2]
    // 5. provider.branchExists(identity, baseBranch) — false → throw.                                  [check #3]
    // 6. provider.findOpenPullRequest(identity, headBranch, baseBranch):                               [check #4]
    //      throws / unsupported → BLOCK by default, do NOT call createPullRequest (Q8);
    //      returns result → assertResultIntegrity(result); valid → return { ...result, reused: true }, NO create (Q9);
    //                       invalid → throw fail-safe, NO create;
    //      returns null → proceed.
    // 7. provider.createPullRequest(input) — the ONLY mutating call, exactly once, only if 1–6 passed.
    // 8. assertResultIntegrity(result) → return { ...result, reused: false }; mismatch → throw.
  }
}
// assertResultIntegrity(result, identity, head, base):
//   result.pullRequestHeadBranch === head; result.pullRequestBaseBranch === base;
//   result.provider/owner/repo === identity; Number.isInteger(result.pullRequestNumber) && > 0;
//   /^[0-9a-f]{7,40}$/i.test(result.pullRequestCommitHash);
//   isSafeGitHubPullRequestUrl(result.pullRequestUrl, identity, result.pullRequestNumber).
```
`ApprovalRef` consumed at the manager, never forwarded to the provider (Q6). The provider receives only the
bounded `PullRequestCreationInput` (no ApprovalRef, no raw diff/file content, no token — Q2). Added to
`application/index.ts`.

### 4.4 Token (`packages/core/src/ports/tokens.ts`; Q13)

```ts
export const REPOSITORY_HOSTING_PROVIDER = Symbol('RepositoryHostingProvider');
```
The token may be exported, but **no `app.module.ts` binding of a real provider** is added (Q13) — a manager
exported-but-unbound is acceptable; no GitHub adapter exists yet.

## 5. Required Architecture Questions — decisions

- **Q1 (types into code)** — add `PullRequestCreationInput`/`PullRequestResult`/`PullRequestRef`; **reuse**
  `RepositoryIdentity`/`RepositoryHostingProviderKind` from 3d-A (no duplication).
- **Q2 (`PullRequestCreationInput`)** — `identity/headBranch/baseBranch/title/body/expectedCommitHash`; **no**
  `ApprovalRef`/token/raw diff/file content/GitHub SDK type/git remote URL. `ApprovalRef` is manager input, not
  provider input.
- **Q3 (`PullRequestResult`)** — `provider/owner/repo/pullRequestNumber/pullRequestUrl/pullRequestHeadBranch/
  pullRequestBaseBranch/pullRequestCommitHash/reused`; documented **provider-reported, not independent truth**.
- **Q4 (`PullRequestRef`)** — `provider/owner/repo/pullRequestNumber/pullRequestUrl` (PR number is
  repository-scoped).
- **Q5 (port methods)** — `repositoryExists`/`branchExists`/`findOpenPullRequest`/`createPullRequest`. Mutating
  shape present but **no real adapter**; only fake providers in tests.
- **Q6 (manager ownership)** — ApprovalRef validation, input validation, call ordering, the four ordered
  read-only checks before mutation, existing-PR reuse, a single `createPullRequest` only if checks pass, result
  integrity. Provider owns hosting API calls only and receives no `ApprovalRef`.
- **Q7 (createPullRequest in tests)** — only via fake-provider unit tests; no real adapter, no network, no
  runtime wiring.
- **Q8 (non-idempotent)** — if `findOpenPullRequest` is unavailable/throws → **block by default**, do not call
  `createPullRequest`; no non-idempotent creation without later CA approval.
- **Q9 (existing-PR reuse)** — valid `findOpenPullRequest` result → integrity-validate → return with
  `reused: true`, `createPullRequest` not called; invalid existing result → fail safe, no create.
- **Q10 (pre-mutation validations)** — `ApprovalRef.status===APPROVED`; supported provider; safe owner/repo;
  safe head/base (via `isSafePushBranch`); `head != base`; non-empty bounded title; bounded body; SHA-shaped
  `expectedCommitHash`. Reuses `push-target.ts` + the git-manager SHA guard.
- **Q11 (PR URL)** — https only; github.com only; path exactly `/<owner>/<repo>/pull/<number>`; no credentials;
  bounded. GHE deferred.
- **Q12 (ConversationRuntime)** — **No change.** No PR-execution flow, no `PR_CREATED`, no trigger phrase, no
  PR-created composer (CA preference: no `ConversationRuntime`/`ResponseComposer` change in 3d-B).
- **Q13 (DI)** — token may be added; **no** real provider binding; exported-but-unused manager acceptable.
- **Q14 (ADR-0052)** — Yes (see §8).

## 6. Required tests (Node 22) — CA's 60-item list

**Shape (1–9):** 1 `PullRequestCreationInput` has no `ApprovalRef` field · 2 no token field · 3 no remoteUrl
field · 4 `PullRequestResult` includes provider/owner/repo/number/url/head/base/commit/reused · 5
`PullRequestRef` includes provider/owner/repo/number/url · 6–9 `RepositoryHostingProvider` has
`repositoryExists`/`branchExists`/`findOpenPullRequest`/`createPullRequest`.

**Manager input validation (10–18):** 10 rejects non-APPROVED `ApprovalRef` · 11 unsafe identity · 12 unsafe
head branch · 13 unsafe base branch · 14 `head == base` · 15 empty title · 16 too-long title · 17 too-long
body · 18 invalid `expectedCommitHash`.

**Manager call ordering / no-mutation (19–30):** 19 calls `repositoryExists` before `createPullRequest` · 20
no create when `repositoryExists` false · 21 calls `branchExists(head)` before create · 22 no create when head
missing · 23 calls `branchExists(base)` before create · 24 no create when base missing · 25 calls
`findOpenPullRequest` before create · 26 existing open PR skips `createPullRequest` · 27 existing-PR integrity
mismatch fails safe · 28 existing valid PR returns `reused: true` · 29 `findOpenPullRequest`
unsupported/throws blocks by default · 30 `createPullRequest` called exactly once when all checks pass and no
existing PR. *(ordering asserted via fake-provider call-log spies.)*

**Provider input hygiene (31–34):** 31 provider does not receive `ApprovalRef` · 32 no raw diff · 33 no file
content · 34 no token.

**Result integrity (35–42):** 35 head mismatch fails safe · 36 base mismatch fails safe · 37 owner/repo
mismatch fails safe · 38 invalid URL fails safe · 39 invalid PR number fails safe · 40 invalid commit hash
fails safe · 41 successful result returns provider-reported `PullRequestResult` · 42 `PullRequestResult`
documented provider-reported, not independent truth.

**Absence guards (43–58):** 43 no `GitHubRepositoryHostingProvider` · 44 no GitHub API import/call · 45 no
octokit dependency · 46 no `CommandExecution` · 47 no runtime shell-out · 48 no `ConversationRuntime` change ·
49 no `ResponseComposer` PR-created wording · 50 no `ApplyPreviewAnchor` `PR_CREATED` field · 51 no
`GitProvider.createPullRequest` · 52 no `GitManager.createPullRequest` · 53 no merge · 54 no deployment · 55 no
release · 56 no reviewer mutation · 57 no label mutation · 58 no assignee mutation. *(source-level guards +
green full suite; new modules import only domain/ports/approval.)*

**Node 22 (59–60):** 59 `pnpm typecheck` green · 60 `pnpm test` green.

**Additional CA tests (61–78):** 61 manager rejects `provider.kind` mismatch before any provider call · 62
`provider.kind` must match `identity.provider` for the success path · 63 title with surrounding whitespace
normalized before provider call · 64 repeated whitespace collapsed · 65 normalized-empty title rejected · 66
provider receives normalized (not raw) title · 67 existing-PR path returns `reused: true` even if provider
result says false · 68 create path returns `reused: false` even if provider result says true · 69 existing-PR
commit-hash mismatch fails safe, no create · 70 create-result commit-hash mismatch fails safe · 71 provider
error from `findOpenPullRequest` not forwarded as a raw message · 72 `RepositoryHostingManager` has no remote
input and does not import `isSafePushRemote` · 73 `PullRequestCreationInput` has no `pushedRemote` field · 74
PR URL with query string rejected · 75 PR URL with fragment rejected · 76 PR URL percent-encoded variation
rejected · 77 PR URL different casing rejected unless exact match · 78 `app.module.ts` does not bind
`REPOSITORY_HOSTING_PROVIDER`.

Test files (implemented): extended `packages/core/src/domain/repository-hosting.test.ts` (PR types shape +
`isSafeGitHubPullRequestUrl` + `normalizePrTitle` + bounds); new
`packages/core/src/application/repository-hosting-manager.test.ts` (fake-provider: port shape, validation,
`provider.kind`, title normalization, ordering, reuse, manager-owned `reused`, integrity, commit-hash
equality, provider input hygiene, error wrapping); extended `repository-identity-guards.test.ts` (absence
guards 43–58, 72, 78). **Result: 55 new tests; full suite 46 files / 835 tests pass on Node v22.22.1;
`pnpm typecheck` exit 0.**

## 7. Architecture Impact / Reuse

- **Adds:** domain `PullRequestCreationInput`/`PullRequestResult`/`PullRequestRef`/`pullRequestRef`/
  `isSafeGitHubPullRequestUrl`/`MAX_PR_TITLE`/`MAX_PR_BODY`; `ports/repository-hosting-provider.port.ts` (+
  `ports/index.ts`); `application/repository-hosting-manager.ts` (+ `application/index.ts`);
  `REPOSITORY_HOSTING_PROVIDER` token; fake-provider tests; ADR-0052.
- **Reuses unchanged:** `RepositoryIdentity`/validators (3d-A), `isSafePushBranch`/`isSafePushRemote` +
  SHA guard (3a), `ApprovalRef`/`ApprovalStatus` (CAP-004), the Port/Manager/Token layering (CAP-002).
- **Does NOT change:** `GitProvider`/`GitManager`/`LocalGitProvider`/`RepositoryInfo`, `ConversationRuntime`,
  `ApplyPreviewAnchor`, `ResponseComposer`, `ApprovalManager`, `ExecutionOrchestrator`, `app.module.ts` real
  bindings, `WorkspaceWrite`/`Patch`/`CodeGeneration`/`CommandExecution`. No adapter package, no GitHub API, no
  PR creation, no `PR_CREATED`.

## 8. ADR-0052 (proposed) — RepositoryHosting Skeleton

Records: RepositoryHosting skeleton (domain types + `RepositoryHostingProvider` port +
`RepositoryHostingManager` + `REPOSITORY_HOSTING_PROVIDER` token) added as the non-mutating shape of CAP-010
(ADR-0050); **no real provider**, **no GitHub API**, **no PR creation**, **no `PR_CREATED`**, **no runtime
wiring**; the manager boundary is established (ApprovalRef consumed at manager not provider; input validation;
ordered `repositoryExists`/`branchExists(head)`/`branchExists(base)`/`findOpenPullRequest` before a single
`createPullRequest`; existing-open-PR reuse; result integrity incl. `pullRequestCommitHash ===
expectedCommitHash`; non-idempotent creation blocked by default); manager also validates `provider.kind ===
identity.provider`, normalizes the title deterministically (provider receives the normalized title), and owns
the `reused` flag by path; deterministic capability errors only (raw provider errors never forwarded);
`PullRequestResult` is provider-reported not independent truth; PR-URL validated (https/github.com/exact path/
exact casing/no creds/**no query**/**no fragment**/**no percent-encoding**/bounded, GHE deferred);
`isSafePushRemote` not used. **`RepositoryHostingProvider.createPullRequest` exists as a port shape only —
Sprint 3d-B ships no real provider implementation, no GitHub adapter, no DI binding, and no product-runtime
path reaches it; only fake providers in unit tests may implement or call it. A successful manager unit test
means the skeleton boundary behaves correctly with a fake provider — it does NOT mean product PR creation
works.** Git/ExecutionOrchestrator/ConversationRuntime/ResponseComposer/`ApplyPreviewAnchor` unchanged;
**actual PR creation execution remains blocked** until a real adapter + runtime flow are separately planned,
implemented, reviewed, merged, and accepted (3d-C+). Relations: ADR-0050 (design realized), ADR-0051 (identity
reused), ADR-0048 (push-target validators + provider-reported discipline), ADR-0046/ADR-0025 (`GitManager`
Ref-gating mirrored).

## 9. Implementation sequence (after CA plan approval)

1. Apply plan changes (this document). 2. Author ADR-0052. 3. Add domain types + PR-URL validator + bounds (+
re-export). 4. Add `RepositoryHostingProvider` port (+ `ports/index.ts`). 5. Add `RepositoryHostingManager` (+
`application/index.ts`). 6. Add `REPOSITORY_HOSTING_PROVIDER` token. 7. Add fake-provider tests + absence
guards (60 items). 8. Validate on Node 22 (typecheck exit 0 + full suite green). 9. Open PR for Chief Architect
Implementation Review. **No real adapter, no GitHub API, no PR creation, no runtime wiring.**

## 10. Stop condition (this sprint)

Plan-only. **Do not implement. Do not create a branch. Do not commit. Do not open a PR. Do not call the GitHub
API. Do not create a Pull Request.** This document is left on the working tree (untracked) for Chief Architect
Review. Request CA review after the plan is written.
