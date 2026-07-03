# Sprint 3c Plan — Repository Hosting Capability (boundary design for future PR creation execution)

- **Status:** CONFIRMED / ACCEPTED as architecture direction (design-only; all CA required changes applied).
  Sprint 3c produced no implementation. Recorded as **ADR-0050** in `DECISIONS.md` (backfilled in PR #25 per CA
  Implementation Review). Next: Sprint 3d-A (repository identity configuration, ADR-0051) → 3d-B/3d-C gated.
- **Base:** `main @ 65da46eeea91ed1caa4cdebe3543e7e3fae7b27d`
- **Validation runtime:** Node 22
- **ADR (proposed):** ADR-0050
- **New capability number (proposed):** CAP-010 — Repository Hosting (next unused CAP number after CAP-001..009,
  Phase 1 independent capabilities; verified no CAP-010 exists in `DECISIONS.md`/`ARCHITECTURE.md`/`docs/plans`).
- **Predecessors:** ADR-0049 (Sprint 3b — `PR_APPROVED`/`PR_APPROVAL_PENDING` anchor + PR context this sprint
  consumes; the boundary rule "PR creation is repository-hosting/platform mutation, not Git" this sprint
  operationalizes), ADR-0048 (Sprint 3a — `GIT_PUSHED` + pushed context + the "provider-reported, not
  independent verification" discipline for `GitPushResult`), ADR-0047/ADR-0045 (approval-halt template),
  ADR-0025 (CAP-004 Approval — `requestForRisk`/`get`/`decide`, `ApprovalRef`), ADR-0023 (CAP-002 Git — the
  Port/Manager/Adapter/Token pattern this sprint mirrors, and the remote-URL-exclusion decision grounding Q9).

## 0. CA review disposition (Sprint 3c plan — APPROVED WITH CHANGES)

Every CA required change (1–16), every "APPROVED WITH CHANGE" architecture decision (Q3/Q6/Q8/Q11/Q12/Q14),
the full ADR-0050 content list, and the additional future tests (61–96) are applied below. Map:

| CA item | Where applied |
|---|---|
| 1. Split Sprint 3d into tracks; block PR execution until identity source accepted | §1.1, §5 Q9, §8 |
| 2. RepositoryIdentity is its own reviewed contract (`RepositoryIdentityConfig` + validation; no URL parsing) | §4.3, §5.7 |
| 3. Hosting-state verify includes `findOpenPullRequest` before create; no non-idempotent creation by default | §4.4, §4.5, §5 Q8/Q12 |
| 4. Commit reachability explicitly deferred, not overclaimed (ADR + response wording) | §4.7, §5 Q8, §8 |
| 5. `PullRequestResult` is provider-reported, not independent truth (mirror `GitPushResult`) | §4.3, §5 Q13 |
| 6. Manager owns ordering/approval/validation/integrity; Provider owns API calls only | §4.5 |
| 7. `createPullRequest` not callable without prior checks in normal flow (Manager tests) | §4.5, §6 tests 66–72 |
| 8. Existing-open-PR result integrity validated too; require `pullRequestCommitHash` for `PR_CREATED` | §4.5, §4.6, §5 Q11/Q12 |
| 9. `PullRequestRef` includes provider/owner/repo | §4.3 |
| 10. `PR_CREATED` anchor stores repository identity + reused flag | §4.8, §5 Q11 |
| 11. PR URL validation (https / expected host / bounded / no creds) | §4.6 |
| 12. GitHub Enterprise deferred — github.com only for first adapter | §4.9, §5 Q1, §8 |
| 13. Token/auth adapter-local, never logged/stored anywhere | §4.9, §5 Q10 |
| 14. Failure taxonomy separated; sanitized; named composer methods | §4.10 |
| 15. Existing-PR reuse response explicit (not "newly created") | §4.10, §5 Q12 |
| 16. No second approval, but context match must include PR context + RepositoryIdentity | §4.11, §5 Q14/Q16 |
| Additional tests 61–96 | §6 |
| ADR-0050 content list | §8 |

## 1. Goal

Sprint 3c is **plan-only**. It designs the capability boundary that a **future** execution sprint needs to
turn a live `PR_APPROVED` anchor into an actual GitHub Pull Request:

```text
PR_APPROVED
→ explicit PR-creation EXECUTION request (a new, distinct trigger phrase — not "승인")
→ verify PR approval context (ApprovalManager.get + plan match, mirrors 3a/3b)
→ resolve reviewed RepositoryIdentity (from configuration only — NEVER a git remote string)
→ verify repository-hosting state (repositoryExists / branchExists(head) / branchExists(base) / findOpenPullRequest)
→ RepositoryHostingManager.createPullRequest(...)                                  ← NEW capability (CAP-010)
→ validate provider-reported result integrity
→ PR_CREATED  (never merged / deployed / released)
```

This document answers CA's 16 required architecture questions, applies the 16 required review changes, defines
the `RepositoryHosting` capability's domain/port/manager/adapter boundary (mirroring the existing Git — CAP-002
— pattern verified in the codebase), and lists the tests a future implementation sprint must satisfy. **No
implementation, branch, commit, PR, or GitHub API call happens in this sprint.**

### 1.1 Sprint sequencing after 3c (CA required change 1)

**Sprint 3d is NOT automatically PR-creation execution.** The next sprint after 3c is one of:

```text
3d-A: Repository identity configuration capability/support (RepositoryIdentityConfig + validation)
3d-B: RepositoryHosting skeleton (domain/port/manager/token/adapter shell) WITHOUT any hosting mutation
3d-C: Actual PR creation execution
```

**CA decision (binding):** *actual PR creation execution is NOT allowed until a repository-identity
configuration source is implemented and accepted.* Therefore **3d-C is gated behind 3d-A** (and may be gated
behind 3d-B). If `RepositoryIdentity` configuration is absent, the PR-creation-execution sprint must be
blocked. This is recorded in ADR-0050 (§8) so it cannot be re-litigated implicitly.

## 2. Boundary & the most important rule

> **Pull Request creation is a repository-hosting/platform mutation, not a local Git operation** (ADR-0049,
> reaffirmed here). It must not be added to `GitProvider`, `GitManager`, `CommandExecution`, `Runtime` shell-out,
> `ExecutionOrchestrator`, `WorkspaceWrite`, `PatchManager`, or `CodeGeneration`. A new, independent
> `RepositoryHosting` capability (CAP-010) owns it — provider-agnostic at the domain/port level, with GitHub
> (github.com only for the first adapter) as the first adapter.

**Prerequisites & discipline carried into every future sprint:** actual execution is **blocked until a reviewed
`RepositoryIdentity` configuration source exists** (§1.1, §5.7); identity is **never** parsed from a git remote
URL and `RepositoryInfo` still never exposes a remote URL (ADR-0023); the auth token is adapter-local and
never enters domain types / `ApprovalRequest.reason` / the anchor / logs (§4.9); no ChatGPT/GitHub connector
(MCP or otherwise) is a product-runtime dependency (§5 Q10).

**Explicitly out of scope for Sprint 3c (plan-only; verified nothing below exists in `packages/*/src` today —
see §3):** actual Pull Request creation implementation · GitHub API mutation ·
`RepositoryHostingProvider`/`GitHubRepositoryHostingProvider` implementation · `PR_CREATED` state
implementation · `RepositoryIdentityConfig` implementation · reviewer/label/assignee mutation · draft PR mode ·
merge/auto-merge · deployment/release · branch creation · force push · GitHub Enterprise support ·
`CommandExecution` `gh`/`curl` · runtime shell-out · a new branch, commit, or PR for this repository.

## 3. Architecture & reuse (source-verified)

Before designing names, the existing capability conventions were inspected directly:

- **Zero existing hosting surface.** `grep -rn "RepositoryHosting|GitHubProvider|createPullRequest|PullRequestRef|pullRequest" packages/*/src`
  matches only the 3b **negative** test assertions (`conversation-runtime.test.ts:4075-4077`, asserting these
  do NOT exist) — confirming a clean slate for this boundary.
- **Port/Manager/Adapter pattern (CAP-002 Git, ADR-0023/46/48) — the template this sprint mirrors exactly:**
  - **Port** `GitProvider` (`packages/core/src/ports/git-provider.port.ts`): a plain interface with a `readonly
    kind: string` discriminator, no framework/SDK types, one method per capability operation, doc comments
    stating mutation order and the defensive-validation ownership split ("Approval gating is done by
    `GitManager.x`; this port takes no ApprovalRef").
  - **Manager** `GitManager` (`packages/core/src/application/git-manager.ts`): a thin class holding `private
    readonly provider: GitProvider`. Mutating methods take an `{ ...fields, approvalRef: ApprovalRef }` input,
    **check `approvalRef.status === ApprovalStatus.APPROVED` first**, then defensively re-validate every field
    (unsafe-path/unsafe-branch/unsafe-remote/SHA-shape) **before** calling the provider — "the runtime performs
    the full context/state re-validation first; this is the capability-level backstop." **The `ApprovalRef` is
    consumed by the Manager and NEVER passed to the provider.**
  - **Adapter** `LocalGitProvider` (`packages/git-local/src/index.ts`, `@chunsik/git-local`): the only place
    that touches `child_process`; argument-array spawn only, never a shell string; sanitizes stderr.
  - **Token** `GIT_PROVIDER = Symbol('GitProvider')` in `packages/core/src/ports/tokens.ts`; core depends only
    on the token + interface.
  - **Domain types** in `packages/core/src/domain/git.ts` (`GitCommitResult`, `GitPushResult`,
    `RepositoryInfo`) — plain interfaces, no behavior, re-exported via `domain/index.ts`.
  - **Provider-reported discipline (mirrored for `PullRequestResult`):** `GitPushResult`'s doc comment
    (`git.ts:59-76`) states it is *"NOT an independent remote verification — only the target the provider pushed
    to once the command exited 0."* `PullRequestResult` copies this discipline (§4.3, CA change 5).
- **Package naming convention:** capability-scoped adapter packages are `<capability>-<provider>` under
  `@chunsik/<capability>-<provider>` (`git-local`, `storage-sqlite`, `queue-local`, `vector-local`,
  `workspace-local`). The first Repository Hosting adapter is **not** "local" (it calls an external platform),
  so this plan proposes `packages/repository-hosting-github` → `@chunsik/repository-hosting-github`, keeping
  `repository-hosting` as the capability stem so a later provider could ship as `repository-hosting-gitlab`
  without renaming the port/domain.
- **Critical finding for Q9 (repository identity) — source-verified, not assumed:**
  `RepositoryInfo` (`packages/core/src/domain/git.ts:79-94`) is documented as **intentionally excluding remote
  URLs**: *"HTTPS remotes can embed credentials; exposing them needs a future masking policy + ADR (ADR-0023)."*
  `GitProvider.info()`/`LocalGitProvider.info()` return `{ isRepository, rootPath, branch, headSha, detached }`
  — no `remoteUrl`, no `owner`, no `repo`. The git-local test suite has an explicit regression test: *"does NOT
  expose remote URLs / credentials in `info`."* **There is currently no safe, reviewed source anywhere in this
  codebase for GitHub `owner/repo` identity.** This grounds Q9 (§5.7) in a verified, deliberate absence.
- **Approval reuse (CAP-004, ADR-0025):** `ApprovalManager.get`/`decide`, `ApprovalRef` (plan-scoped:
  `{ id, status, executionPlanRef }`), `RiskLevel.CRITICAL` — the same PR approval already created in 3b; the
  future executor re-verifies it, it does not create a new one (Q14).

## 4. Capability design — `RepositoryHosting` (CAP-010)

### 4.1 What it owns / does not own (Q3)

**Owns:** `RepositoryIdentity`, `RepositoryIdentityConfig`, `PullRequestCreationInput`, `PullRequestResult`,
`PullRequestRef` (domain); `RepositoryHostingProvider` (port); `RepositoryHostingManager` (application);
`GitHubRepositoryHostingProvider` (adapter, `@chunsik/repository-hosting-github`).

**Does not own:** local git status/commit/push (`GitProvider`/`GitManager`, unchanged — Q4), workspace file
mutation (`WorkspaceWrite`), code generation (`CodeGeneration`), deployment, merge, release,
`ExecutionOrchestrator` composition (unchanged — Q5).

### 4.2 Provider independence (Q2)

Domain/port types carry **no GitHub-specific shape** (no SDK types, no GitHub REST field names). Generic field
names (`headBranch`, `baseBranch`, `title`, `body`, `url`, `number`) so a hypothetical second provider could
implement the same port. GitHub-specific config/host/token/URL rules live only inside
`@chunsik/repository-hosting-github`, never in `packages/core`.

### 4.3 Domain types (proposed shapes)

```ts
// packages/core/src/domain/repository-hosting.ts

/** Hosting-provider discriminator for the first adapter. github.com only in the first implementation
 *  (CA change 12); GitHub Enterprise is deferred. */
export type RepositoryHostingProviderKind = 'github';

/** Where the PR would be created — resolved from CONFIGURATION only (Q9 / CA change 2), never inferred from a
 *  git remote string, never from RepositoryInfo (which intentionally excludes remote URLs, ADR-0023). */
export interface RepositoryIdentity {
  provider: RepositoryHostingProviderKind;
  owner: string;
  repo: string;
}

/** The reviewed configuration contract that yields a RepositoryIdentity (CA change 2). Bound at the
 *  composition root and validated before use. Validation (in the future config capability):
 *    - provider is a supported RepositoryHostingProviderKind
 *    - owner non-empty, bounded (e.g. ≤ 39 chars, GitHub login rules), safe (no path/URL/whitespace/control)
 *    - repo  non-empty, bounded (e.g. ≤ 100 chars), safe (GitHub repo-name charset)
 *    - contains NO token/secret, NO remote URL
 *  Forbidden inputs: `git remote -v` parsing, `RepositoryInfo.remoteUrl` (does not exist), a raw GitHub URL
 *  pasted by the user, and any unbounded per-request user-supplied owner/repo. */
export interface RepositoryIdentityConfig {
  provider: RepositoryHostingProviderKind;
  owner: string;
  repo: string;
}

/** Input to RepositoryHostingManager.createPullRequest — assembled by the runtime from the live PR_APPROVED
 *  anchor + a freshly re-verified ApprovalRef + the configured RepositoryIdentity. Bounded/sanitized fields
 *  only — no raw diff, no file content, no token. */
export interface PullRequestCreationInput {
  identity: RepositoryIdentity;
  headBranch: string;
  baseBranch: string;
  title: string;
  body: string;
  /** The pushed commit the PR is expected to point at — used for result-integrity checking; mirrors
   *  GitPushResult.commitHash / GitCommitResult.commitHash. */
  expectedCommitHash: string;
}

/** Provider-reported outcome after a successful (or idempotently-reused) PR creation call.
 *  IMPORTANT (CA change 5, mirrors GitPushResult): this represents the PROVIDER-REPORTED PR creation/open
 *  result. It is NOT independent verification beyond the provider response. The Manager validates integrity
 *  against these returned fields but must not overclaim (see §4.7). */
export interface PullRequestResult {
  provider: RepositoryHostingProviderKind;
  owner: string;
  repo: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  pullRequestHeadBranch: string;
  pullRequestBaseBranch: string;
  /** The commit sha the provider reports the PR head points at — REQUIRED for PR_CREATED in the first
   *  implementation (CA change 8). */
  pullRequestCommitHash: string;
  /** True when the provider returned an existing OPEN PR for the same head/base instead of creating a new one
   *  (Q12 idempotency — §4.5 step 6, §4.10 reuse wording). */
  reused: boolean;
}

/** Durable, repository-scoped handle other capabilities/anchors reference (V2 Ref model). Includes
 *  provider/owner/repo because a PR number is repository-scoped and meaningless without them (CA change 9). */
export interface PullRequestRef {
  provider: RepositoryHostingProviderKind;
  owner: string;
  repo: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
}

export function pullRequestRef(result: PullRequestResult): PullRequestRef {
  return {
    provider: result.provider,
    owner: result.owner,
    repo: result.repo,
    pullRequestNumber: result.pullRequestNumber,
    pullRequestUrl: result.pullRequestUrl,
  };
}
```

### 4.4 Port — `RepositoryHostingProvider`

```ts
// packages/core/src/ports/repository-hosting-provider.port.ts
import type { PullRequestCreationInput, PullRequestResult, RepositoryIdentity } from '../domain';

/**
 * PORT: repository-hosting platform mutation (CAP-010, ADR-0050). Distinct from GitProvider (CAP-002, local
 * repository only). Implementations call an external hosting API (adapter-side only); core never depends on an
 * SDK/HTTP client type here — only this interface. The provider owns hosting API calls ONLY; it does NOT
 * decide approval policy and takes NO ApprovalRef (CA change 6, mirrors GitProvider).
 */
export interface RepositoryHostingProvider {
  readonly kind: string;

  /** Read-only: true when `identity` resolves to a repository the provider can act on (Q8 check #1). */
  repositoryExists(identity: RepositoryIdentity): Promise<boolean>;

  /** Read-only: true when `branch` exists on the hosting provider for `identity` (Q8 head/base checks). */
  branchExists(identity: RepositoryIdentity, branch: string): Promise<boolean>;

  /** Read-only: an existing OPEN pull request for the exact head/base pair, if the provider supports the
   *  query (Q8/Q12). Returns null when none exists. Throws (not returns null) if the provider genuinely
   *  cannot perform this query, so the Manager can apply the "no non-idempotent creation by default" policy
   *  (§4.5 step 6, CA change 3). */
  findOpenPullRequest(identity: RepositoryIdentity, headBranch: string, baseBranch: string): Promise<PullRequestResult | null>;

  /** The ONLY mutating method — creates exactly one Pull Request from validated input. No ApprovalRef
   *  parameter (consumed by RepositoryHostingManager — CA change 6). The Manager MUST call the read-only
   *  checks above before this in the normal flow (§4.5); the provider is not required to enforce that
   *  ordering internally, but must not perform merge/deploy/release/reviewer/label/assignee side effects. */
  createPullRequest(input: PullRequestCreationInput): Promise<PullRequestResult>;
}
```

### 4.5 Manager — `RepositoryHostingManager` (explicit orchestration; CA changes 6/7/8)

```ts
// packages/core/src/application/repository-hosting-manager.ts
export class RepositoryHostingManager {
  constructor(private readonly provider: RepositoryHostingProvider) {}

  async createPullRequest(input: {
    identity: RepositoryIdentity;
    headBranch: string;
    baseBranch: string;
    title: string;
    body: string;
    expectedCommitHash: string;
    approvalRef: ApprovalRef;             // consumed here, NEVER forwarded to the provider
  }): Promise<PullRequestResult> {
    // Manager owns: approval gating, input validation, CALL ORDERING, result-integrity validation (CA #6).
    // Provider owns: hosting API calls only.
    //
    // 1. approvalRef.status === ApprovalStatus.APPROVED — else throw (mirrors GitManager exactly).
    // 2. defensive re-validation BEFORE any provider call (mirrors isUnsafeCommitPath/isSafePushBranch):
    //    non-empty identity.owner/identity.repo (safe/bounded), supported identity.provider,
    //    safe headBranch/baseBranch (reuse isSafePushBranch-shaped rules), headBranch !== baseBranch,
    //    bounded title/body, SHA-shaped expectedCommitHash.
    // 3. provider.repositoryExists(identity) — false → throw (no PR attempt).                     [check #1]
    // 4. provider.branchExists(identity, headBranch) — false → throw.                             [check #2]
    // 5. provider.branchExists(identity, baseBranch) — false → throw.                             [check #3]
    // 6. provider.findOpenPullRequest(identity, headBranch, baseBranch):                          [check #4]
    //      - returns an existing PR → validate its integrity (§4.6), then RETURN it with reused: true;
    //        DO NOT call createPullRequest (Q12 idempotent reuse).
    //      - returns null → proceed to step 7.
    //      - throws (provider cannot support the query) → the executor treats this as "cannot guarantee
    //        idempotency": by default BLOCK creation (CA change 3 — no non-idempotent creation by default;
    //        non-idempotent creation only with explicit CA approval in the execution sprint).
    // 7. provider.createPullRequest(input) — the ONLY mutating call, reached only if steps 3–6 passed.
    // 8. validate result integrity (§4.6) on the newly created PR — mismatch → throw
    //    "PR creation result could not be verified"; no retry, no rollback (Q13); PR_APPROVED is kept.
  }
}
```

Mirrors `GitManager.commitFiles`/`pushApprovedCommit`: **Approval status check → defensive field
re-validation → ordered read-only checks → single mutating call → result-integrity check**, `ApprovalRef`
consumed at the Manager boundary, never seen by the provider/adapter. **Manager tests (not the provider) prove
the ordering** (§6 tests 66–72).

### 4.6 Result-integrity validation (created AND reused; CA change 8)

Applied to both a newly-created PR and an existing PR returned by `findOpenPullRequest`:

```text
result.pullRequestHeadBranch === headBranch
result.pullRequestBaseBranch === baseBranch
result.pullRequestUrl is safe/bounded and passes PR-URL validation (§4.6.1)
result.pullRequestNumber is a positive integer
result.pullRequestCommitHash is SHA-shaped   (REQUIRED for PR_CREATED — CA change 8; no PR_CREATED without it)
result.provider/owner/repo === the configured identity's provider/owner/repo
```
Any failure → do not anchor `PR_CREATED`; keep `PR_APPROVED`; safe failure (§4.10 `composePrCreationResultUnverified`).

#### 4.6.1 PR URL validation (CA change 11)

```text
- must be https
- host must equal the expected provider host (github.com for the first adapter — CA change 12)
- path must match the expected shape:  https://github.com/<owner>/<repo>/pull/<number>
    with <owner>/<repo> === configured identity, <number> === pullRequestNumber
- must be bounded (length cap)
- must NOT contain credentials (no userinfo `user:pass@`, no token query param)
```
(A configured GitHub Enterprise host is only allowed if/when a later sprint adds Enterprise support — §4.9.)

### 4.7 Commit reachability — explicitly deferred, not overclaimed (CA change 4)

The first PR-creation implementation verifies **head/base branch existence** (§4.5 checks #2/#3) but may **not**
verify that the approved pushed commit is reachable from the head branch on the hosting provider, unless a
provider method for that is added later. This is acceptable **only** because it is explicit in the ADR and in
user-facing wording:

- **ADR wording (§8):** *"First implementation may verify head/base branch existence but may not verify commit
  reachability unless the provider method is added. Therefore success means a PR was created/opened for
  head/base — not that the approved commit was independently verified on the hosting provider."*
- **Response wording (§4.10):** *"PR created/opened for `<head>` → `<base>`. No merge/deployment/release was
  performed."* The response must **never** say "approved commit verified on GitHub", "commit safely reviewed",
  or "deployment ready" unless commit reachability is actually implemented.

### 4.8 Future `PR_CREATED` anchor context (CA change 10 / Q11)

`PR_CREATED` (added only in the execution sprint) stores repository identity + the reused flag — **not** only
URL/number:

```text
pullRequestRef            (provider/owner/repo/number/url — §4.3)
pullRequestProvider       (or a structured repositoryIdentity)
pullRequestOwner
pullRequestRepo
pullRequestNumber
pullRequestUrl
pullRequestHeadBranch
pullRequestBaseBranch
pullRequestCommitHash      (REQUIRED — CA change 8)
pullRequestReused          (boolean — Q12)
```
`PR_CREATED` means created/opened only — **never** merged/deployed/released (mirrors `GIT_PUSHED`'s "pushed,
never deployed" discipline).

### 4.9 Adapter — `GitHubRepositoryHostingProvider` (future package; CA changes 12/13)

`packages/repository-hosting-github/src/index.ts` (`@chunsik/repository-hosting-github`) implements
`RepositoryHostingProvider` against the **github.com** GitHub API (transport choice deferred to the
implementation sprint). **GitHub Enterprise is deferred** (CA change 12 / CA default) — github.com only for the
first adapter, reducing config + URL-validation complexity; Enterprise (configured API/web base URLs) is a
later CA-approved sprint. It owns: auth-token sourcing, HTTP client lifecycle, GitHub error mapping to the
port's plain return types, and PR-URL construction consistent with §4.6.1.

**Token/auth discipline (CA change 13):**
```text
- token comes from configuration/environment, consumed ONLY inside @chunsik/repository-hosting-github
- token NEVER enters domain types (RepositoryIdentity/PullRequestCreationInput/PullRequestResult/PullRequestRef)
- token NEVER enters ApprovalRequest.reason
- token NEVER enters the ApplyPreviewAnchor
- token NEVER enters logs
- provider errors are sanitized before crossing the port (no token, no raw provider payload) — mirrors
  LocalGitProvider's masked-stderr discipline
```

**Q10 — connector/tool not acceptable for runtime product code.** The `codex-cli`/`playwright` MCP connectors
or a ChatGPT-side GitHub connector used interactively (e.g. during Chief Architect review) are **not** product
runtime infrastructure. Product code uses this adapter/config boundary; no MCP/connector dependency inside
`packages/core` or the hosting adapter.

Token: `REPOSITORY_HOSTING_PROVIDER = Symbol('RepositoryHostingProvider')`, added to
`packages/core/src/ports/tokens.ts` alongside `GIT_PROVIDER`, bound by the composition root the same way.

### 4.10 Failure taxonomy & response composers (CA changes 14/15)

The future `ResponseComposer` distinguishes these outcomes and **never exposes a raw provider error**:

| Outcome | Composer (proposed) | Wording discipline |
|---|---|---|
| RepositoryIdentity not configured (Q9) | `composePrCreationNotConfigured` | "아직 PR 생성 대상 저장소가 설정되지 않았어요. PR은 만들지 않았어요." |
| approval invalid / context mismatch (§4.11) | `composePrCreationUnavailable` | safe failure; no PR; no overclaim |
| hosting repository / branch unavailable | `composePrCreationUnavailable` | branch/base missing → no PR |
| existing open PR reused (Q12) | `composePrAlreadyCreated` | "이미 열린 PR이 있어서 그 PR을 연결했어요: #\<number\> \<url\>. 새 PR은 만들지 않았어요. merge/deploy/release는 하지 않았어요." → `PR_CREATED`, `pullRequestReused: true` |
| creation failed | `composePrCreationFailed` | "PR 생성을 완료하지 못했어요." no rollback claim; keep `PR_APPROVED` |
| creation result unverified (§4.6) | `composePrCreationResultUnverified` | ambiguous → does NOT claim no PR was created (Q13) |
| created/opened successfully | `composePrCreated` | "PR created/opened for \<head\> → \<base\>: #\<number\> \<url\>. No merge/deployment/release was performed." (no commit-reachability overclaim — §4.7) |

**Reuse wording is explicit (CA change 15):** a reused PR response says an existing PR was connected, **not**
that a new PR was created.

### 4.11 Pre-execution context match (no second approval, but strict; CA change 16 / Q14)

**No second approval** is required, but before calling the Manager the future executor must verify ALL of:

```text
anchor.status === 'PR_APPROVED'
prApprovalId exists
approvals.get(prApprovalId) exists AND status === APPROVED
ApprovalRequest.executionPlanRef.id === anchor.executionPlanRef.id
prPushedCommitHash === pushedCommitHash === pushCommitHash === commitHash
prHeadBranch === pushedBranch
prBaseBranch === PR_BASE_BRANCH_POLICY (or the approved context base value)
RepositoryIdentity matches the configured identity
+ an explicit PR-execution phrase (Q15) — not "승인", not a bare continuation word
```
Any mismatch → **no PR creation, safe failure** (`composePrCreationUnavailable`). Approval is not a standing
license: the runtime never creates the PR unprompted the moment `PR_APPROVED` is reached.

## 5. Required Architecture Decisions (Q1–Q16) — with CA dispositions

### Q1. Capability name and scope — **APPROVED**
`RepositoryHosting`, **CAP-010**. github.com only for the first adapter (Enterprise deferred — CA change 12).

### Q2. Provider-independent? — **APPROVED**
Yes at core/domain/port (§4.2). GitHub-specific config/host/token live only in the adapter package.

### Q3. Ownership — **APPROVED WITH CHANGES (applied)**
§4.1/§4.3–§4.5. Changes applied: `PullRequestRef` now includes provider/owner/repo (§4.3, CA change 9);
`PR_CREATED` anchor stores repository identity + reused flag (§4.8, CA change 10).

### Q4. Does Git capability change? — **APPROVED**
No. No `GitManager.createPullRequest`, no `GitProvider.createPullRequest`. Verified zero references (§3).

### Q5. Does ExecutionOrchestrator change? — **APPROVED**
No. The future flow stays `ConversationRuntime`-composed (as 3a/3b are).

### Q6. Required PR creation input — **APPROVED WITH CHANGE (applied)**
Derived from the live `PR_APPROVED` anchor (ADR-0049 fields) + a freshly re-verified `ApprovalRef` + the
configured `RepositoryIdentity` (§4.3/§4.11). `prBodyPreview` is a **preview only**; the executor re-derives the
body deterministically from the approved context (same builder as 3b), never trusting arbitrary user body.

### Q7. Verifying approval before PR creation — **APPROVED**
`approvals.get(prApprovalId)` exists · `status === APPROVED` · `executionPlanRef.id ===
anchor.executionPlanRef.id`. No PR on any failure (§4.5 step 1 / §4.11).

### Q8. Verifying hosting state — **APPROVED WITH CHANGE (applied)**
Mandatory first-implementation checks (§4.5 steps 3–6): `repositoryExists`, `branchExists(head)`,
`branchExists(base)`, `findOpenPullRequest(head, base)` when the provider supports it, and `head != base`.
Commit reachability is **deferred but documented and not overclaimed** (§4.7). The plan does not claim the
pushed anchor alone proves hosting state — these are live provider calls.

### Q9. Repository identity — **APPROVED**
No safe identity source exists today (§3, source-verified). Actual PR creation is **blocked until a reviewed
`RepositoryIdentityConfig` source exists** (§1.1, §4.3). No git remote URL parsing, no `RepositoryInfo.remoteUrl`
(does not exist), no raw pasted URL, no unbounded per-request user owner/repo. Validation contract in §4.3.

### Q10. Runtime connector/tool — **APPROVED**
No. Product adapter/config boundary only; no ChatGPT/GitHub/MCP connector in runtime code (§4.9).

### Q11. `PR_CREATED` — **APPROVED WITH CHANGE (applied)**
Only in the execution sprint. Stores identity + `pullRequestRef`/number/url/head/base/commitHash/reused (§4.8).
`pullRequestCommitHash` is required (CA change 8). No merge/deploy semantics.

### Q12. Duplicate PR creation — **APPROVED WITH CHANGE (applied)**
Prefer idempotent existing-open-PR handling: return the existing PR, validate its integrity (§4.6), anchor
`PR_CREATED` with `pullRequestReused: true` (§4.5 step 6). **No non-idempotent creation by default** — if the
provider cannot support `findOpenPullRequest`, block by default (CA change 3).

### Q13. PR creation failure — **APPROVED**
No fake success; no `PR_CREATED`; keep `PR_APPROVED`; no rollback; an ambiguous provider response must not claim
"no PR was created" (§4.5 step 8, §4.10).

### Q14. Second approval — **APPROVED WITH CHANGE (applied)**
No second approval if `PR_APPROVED` is live and the exact context matches — **plus** an explicit execution phrase
(Q15) and `RepositoryIdentity` matching the configured identity and PR context matching pushed context (§4.11).

### Q15. Execution trigger phrases — **APPROVED**
Explicit phrase required ("승인된 PR 생성 실행해줘" / "이제 실제 PR 만들어줘" / "approved PR 생성해줘" / "create the
approved PR" / "open the approved PR"). Bare continuation words ("좋아"/"오케이"/"다음"/"진행해") are insufficient.
Requires a **new** execution-intent classifier distinct from 3b's `interpretPrIntent` (deferred to the execution
sprint).

### Q16. No deploy/merge side effects — **APPROVED**
Tests prove no merge/auto-merge/deploy/release/labels/reviewers/assignees unless a later sprint explicitly plans
and reviews it (§6 tests 43–53, 91–96).

## 6. Required tests for the future implementation sprint (Node 22)

The future execution sprint (3d-C) must satisfy CA's full 60-item list **plus** the additional 61–96.

**Trigger / gating (1–11):** 1–3. `PR_APPROVED` + each of "이제 실제 PR 만들어줘" / "approved PR 생성해줘" / "create
the approved PR" → calls `RepositoryHostingManager.createPullRequest` exactly once. 4. an ambiguous phrase does
not create a PR. 5. no anchor + execution phrase does not create a PR. 6. `GIT_PUSHED` + execution phrase does
not create a PR directly (remains the 3b approval flow). 7. `PR_APPROVAL_PENDING` + execution phrase does not
create a PR. 8–10. `PR_APPROVED` + PR-and-deploy / PR-and-merge / PR-and-release → rejects, no PR. 11.
`PR_APPROVED` + reviewer/label/assignee-bundled phrase → rejects or defers, no PR/mutation.

**Input completeness (12–16):** 12. missing `prApprovalId` → no PR. 13. missing `prPushedCommitHash` → no PR.
14. missing `prHeadBranch`/`prBaseBranch`/`prTitle` → no PR. 15. missing `workspaceRef`/`executionPlanRef` → no
PR. 16. `prPushedCommitHash !== pushedCommitHash`/`commitHash` → no PR.

**Approval re-verification (17–19):** 17. `approvals.get` null → no PR. 18. approval not `APPROVED` → no PR. 19.
approval `executionPlanRef` mismatch → no PR.

**Hosting-state verification (20–26):** 20. missing repository identity → no PR. 21. malformed repository
identity → no PR. 22. `branchExists(head)` false → no PR. 23. `branchExists(base)` false → no PR. 24.
`headBranch === baseBranch` → no PR. 25. pushed commit not found on head, if made mandatory → no PR (else
documented deferred per §4.7). 26. existing-open-PR policy works as planned (§4.5/§4.6).

**Manager/provider boundary (27–31):** 27. Manager rejects a non-`APPROVED` `ApprovalRef`. 28. Manager rejects
unsafe head/base/title/body before calling the provider. 29. the provider method never receives an
`ApprovalRef`. 30. the provider receives only bounded title/body. 31. the provider never receives raw diff/file
content.

**Success path (32–35):** 32. successful creation re-anchors `PR_CREATED`. 33. `PR_CREATED` stores
`pullRequestRef`/number/url/head/base/commit (+identity+reused — §4.8). 34. success response says PR
created/opened. 35. success response explicitly says no merge/deployment/release.

**Failure path (36–39):** 36. provider failure keeps `PR_APPROVED`. 37. an ambiguous provider failure does not
claim "no PR was created". 38. a result-integrity mismatch keeps `PR_APPROVED`, no `PR_CREATED`. 39. no rollback.

**Post-creation behavior (40–42):** 40. `PR_CREATED` + a PR-creation phrase → already created/opened (no second
creation). 41. `PR_CREATED` + deploy phrase → deployment is a future sprint. 42. `PR_CREATED` + merge phrase →
merge is a future sprint.

**No unintended side effects (43–53):** 43. no `GitManager.createPullRequest`. 44. no
`GitProvider.createPullRequest`. 45. no `CommandExecution` call. 46. no runtime shell-out. 47. no
`WorkspaceWrite`/`Patch`/`CodeGeneration`/`ExecutionOrchestrator` call. 48. no merge. 49. no deployment. 50. no
release. 51. no branch creation. 52. no force push. 53. no reviewer/label/assignee mutation.

**Response wording (54–58):** 54. execution requested while unavailable (not configured — §5 Q9) says no PR
created. 55. a failed creation says "could not complete/verify," no rollback claimed. 56. created-PR text says
no merge/deploy/release. 57. already-created/reused text includes the PR URL/number. 58. unsupported-companion
text says no merge/deploy/release.

**Node 22 (59–60):** 59. `pnpm typecheck` green. 60. `pnpm test` green.

**Additional CA tests (61–96):**
61. `RepositoryIdentity` missing blocks PR creation **before** any provider call. 62. unsafe `owner`/`repo`
blocks PR creation. 63. `RepositoryIdentity` is never parsed from a git remote URL. 64. `RepositoryInfo` still
does not expose a remote URL (regression guard). 65. no GitHub connector/MCP is used by product runtime.
66. Manager calls `repositoryExists` before `createPullRequest`. 67. Manager calls `branchExists(head)` before
`createPullRequest`. 68. Manager calls `branchExists(base)` before `createPullRequest`. 69. Manager calls
`findOpenPullRequest` before `createPullRequest`. 70. `createPullRequest` not called if `repositoryExists`
fails. 71. not called if head branch missing. 72. not called if base branch missing. 73. an existing open PR
skips `createPullRequest`. 74. existing-open-PR result-integrity mismatch keeps `PR_APPROVED`. 75. existing open
PR anchors `PR_CREATED` with `pullRequestReused: true`. 76. `PullRequestRef` includes provider/owner/repo (or
anchor stores identity). 77. `PR_CREATED` stores repository identity. 78. PR URL must be https. 79. PR URL must
match expected github.com owner/repo/number. 80. PR URL must not contain credentials. 81. GitHub Enterprise
unsupported by the first adapter unless configured. 82. token/auth not present in `ApprovalRequest.reason`.
83. token/auth not present in the anchor. 84. token/auth not present in logs. 85. provider error is sanitized.
86. provider failure keeps `PR_APPROVED`. 87. ambiguous provider result does not claim no PR created. 88.
creation result mismatch keeps `PR_APPROVED`. 89. reused existing PR response says existing PR connected, not
newly created. 90. created-PR response does not claim the approved commit was independently verified unless
commit reachability is implemented. 91. `PR_CREATED` + merge phrase says merge is a future sprint. 92.
`PR_CREATED` + deploy phrase says deploy is a future sprint. 93. `PR_CREATED` + release phrase says release is a
future sprint. 94. no reviewer mutation. 95. no label mutation. 96. no assignee mutation.

## 7. Architecture Impact / Reuse (for the future implementation sprint)

- **Reuses unchanged:** `ApprovalManager.get`/`decide` + `ApprovalRef` (CAP-004), the 3b `PR_APPROVED` anchor
  fields (ADR-0049) as source context, the Ref-model convention (`xRef(aggregate)` pure derivations), the
  Port/Manager/Adapter/Token layering + provider-reported discipline from CAP-002 Git (ADR-0023/46/48).
- **Adds (future sprints, not this one):** `packages/core/src/domain/repository-hosting.ts`
  (`RepositoryIdentity`/`RepositoryIdentityConfig`/`PullRequestCreationInput`/`PullRequestResult`/
  `PullRequestRef`), `packages/core/src/ports/repository-hosting-provider.port.ts`, `packages/core/src/
  application/repository-hosting-manager.ts`, `packages/repository-hosting-github`
  (`GitHubRepositoryHostingProvider`), `REPOSITORY_HOSTING_PROVIDER` token, a `PR_CREATED` anchor status + the
  §4.8 anchor fields, a new execution-intent classifier (Q15), and a reviewed `RepositoryIdentityConfig` source
  (Q9, sprint 3d-A — a prerequisite for 3d-C).
- **Does NOT change:** `GitProvider`/`GitManager`/`LocalGitProvider`, `ExecutionOrchestrator`, `app.module.ts`
  beyond adding the new token binding, `WorkspaceWrite`/`PatchManager`/`CodeGeneration`.

## 8. ADR-0050 (proposed) — Repository Hosting Capability (design only; no implementation)

- **Status:** Proposed (v2, Phase 3, Sprint 3c — Product Construction, plan-only). CA review of this plan:
  APPROVED WITH CHANGES (all applied).
- **Decision:** Introduce a new independent capability, **Repository Hosting (CAP-010)**, that will own actual
  Pull Request creation execution in a future sprint. The following are settled by this ADR:

```text
- RepositoryHosting is CAP-010.
- PR creation is a repository-hosting/platform mutation, NOT a local Git operation.
- core/domain/port are provider-independent; GitHub is the first adapter only.
- github.com only for the first adapter; GitHub Enterprise deferred to a later CA-approved sprint.
- Git capability (CAP-002) is unchanged — no GitProvider/GitManager PR method.
- ExecutionOrchestrator is unchanged.
- ApprovalRef is consumed by RepositoryHostingManager, never passed to the Provider.
- Provider receives no ApprovalRef and no raw diff/file content.
- RepositoryIdentity is required from a reviewed configuration source (RepositoryIdentityConfig).
- The current codebase has NO safe RepositoryIdentity source (RepositoryInfo intentionally excludes remote
  URLs, ADR-0023) — no remote URL parsing, no RepositoryInfo.remoteUrl, no raw pasted URL, no unbounded
  per-request user owner/repo.
- No ChatGPT/GitHub connector (MCP or otherwise) in runtime product code; no CommandExecution/shell/gh/curl.
- PR creation execution is BLOCKED until a reviewed RepositoryIdentity configuration source exists and is
  accepted (Sprint 3d-A precedes 3d-C).
- Manager owns approval gating, input validation, call ordering, and result-integrity validation; Provider
  owns hosting API calls only and does not decide approval policy.
- Mandatory first-implementation checks: repositoryExists, branchExists(head), branchExists(base),
  findOpenPullRequest (when the provider supports it), head != base.
- Existing-open-PR reuse is preferred; no non-idempotent creation by default (block if findOpenPullRequest
  is unsupported, unless CA explicitly approves non-idempotent creation in the execution sprint).
- Existing-open-PR result integrity is validated the same as a newly-created PR.
- Commit reachability is deferred unless a provider method is added; success means a PR was created/opened for
  head/base, NOT that the approved commit was independently verified on hosting — and the response must not
  overclaim (no "commit verified on GitHub"/"deployment ready").
- PullRequestResult is provider-reported, not independent truth (mirrors GitPushResult).
- PullRequestRef includes provider/owner/repo (a PR number is repository-scoped).
- PR_CREATED stores repository identity, pullRequestCommitHash (required), and pullRequestReused.
- PR URL is validated: https, expected provider host, bounded, no credentials.
- Auth token is adapter-local only; never in domain types / ApprovalRequest.reason / anchor / logs; provider
  errors are sanitized.
- Failure taxonomy distinguishes: not configured / approval invalid / hosting unavailable / branch missing /
  existing PR reused / creation failed / creation result unverified — never exposing raw provider errors.
- No second approval when PR_APPROVED is live and the exact context matches; an explicit PR-execution phrase
  is required (not "승인", not a bare continuation word); RepositoryIdentity must match the configured identity.
- No merge / auto-merge / deployment / release / reviewer / label / assignee mutation.
- PR_CREATED means created/opened only — never merged/deployed/released.
```

- **Not implemented in this ADR/sprint:** any code in §4.3–§4.9, the `PR_CREATED` anchor state, the
  execution-intent classifier, the `RepositoryIdentityConfig` source, or any GitHub API call. This ADR records
  a **design decision** for future implementation ADR(s)/sprint(s) to build against.
- **Relations:** ADR-0049 (Sprint 3b — provides the `PR_APPROVED` anchor + PR context this design consumes;
  reaffirms "PR creation is not Git capability responsibility"), ADR-0048 (3a — `GIT_PUSHED` + the
  provider-reported discipline mirrored by `PullRequestResult`), ADR-0047/0045 (approval-halt template lineage),
  ADR-0025 (CAP-004 Approval — reused unchanged), ADR-0023 (CAP-002 Git — the Port/Manager/Adapter pattern
  mirrored, and the remote-URL-exclusion decision that grounds Q9).

## 9. Stop condition (this sprint)

Plan-only, and CA has set the next allowed step explicitly:

```text
1. Apply plan review changes to the plan document   ← done (this revision; see §0 map)
2. Stop
3. Request CA confirmation / implementation-direction
```

**Do not implement `RepositoryHosting`/`GitHubRepositoryHostingProvider`. Do not create a branch. Do not commit.
Do not open a PR. Do not call the GitHub API. Do not create a Pull Request.** This document is left on the
working tree (untracked) for Chief Architect confirmation. The next sprint (3d-A repository-identity
configuration, per §1.1 / Q9) begins only after CA confirms — actual PR-creation execution (3d-C) remains
blocked until the identity configuration source is implemented and accepted.
