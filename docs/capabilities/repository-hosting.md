# Capability — RepositoryHosting (CAP-010)

> V2 is capability-driven. Doc for the **RepositoryHosting** capability — the product's hosting-platform
> (github.com) reads and mutations. Authority: `ARCHITECTURE.md`, `DECISIONS.md`
> (ADR-0050/0051/0052/0053/0054/0055/0057/0060), and `docs/lifecycle-state-machine.md`.
> Descriptive only; the code is the source of truth.

## 1. Responsibility & non-responsibility

**RepositoryHosting owns hosting-provider reads and mutations, keyed by a validated repository identity.**
**Git (CAP-002) owns local repository operations only** — and, by settled decision (ADR-0023), never handles a remote
URL/credentials.

```text
RepositoryHosting owns:  provider repository existence/branch checks, PR creation, PR status preview,
                         PR merge execution, and remote branch cleanup (GitHub Git-refs DELETE).
Git owns:                local repo reads + the local mutations (commit, push, fast-forward main sync,
                         local branch delete). NEVER a remote-branch delete via `git push --delete`.
```

This split is *why* remote branch deletion (ADR-0060) is RepositoryHosting-owned, not a Git `push --delete`: a remote
mutation must not be smuggled behind a "local" capability that is forbidden from touching remote URLs/credentials.

## 2. Repository identity & token boundary

- **`RepositoryIdentity`** = `{ provider: 'github', owner, repo }` — a small validated value object that **carries no
  token and no remote URL** (a secret cannot be represented as identity). Resolved once at composition by
  `RepositoryIdentityResolver` from reviewed config (ADR-0051); `owner`/`repo` pass conservative safe-name +
  token-shaped-value rejection (`isSafeRepoOwner`/`isSafeRepoName`/`looksLikeSecret`). github.com only; GitHub
  Enterprise deferred.
- **Token boundary:** the GitHub token is **adapter-local only** — held by `GitHubRepositoryHostingProvider` and used
  solely as an `Authorization: Bearer` header. It is **never** returned, logged, placed in an error, stored on the
  anchor, put in an approval reason, or shown in a response. The manager and runtime never see it. When no token is
  configured, the manager is absent and the capability fails safe as "not configured" (no attempt).

## 3. Provider / manager / runtime layering

```text
GitHubRepositoryHostingProvider (adapter, @chunsik/repository-hosting-github)
   — bounded GitHub REST via built-in fetch; adapter-local token; maps raw payloads → normalized core types
        ▲ implements
RepositoryHostingProvider (port, core/ports)      — core depends only on this interface, never an SDK/HTTP type
        ▲ used by
RepositoryHostingManager (application, core)      — owns approval gating, input/identity validation, call ordering,
                                                    result-integrity, existing-PR reuse, phase-aware error taxonomy
        ▲ called by
ConversationRuntime                               — calls the MANAGER only, never the provider; passes no token
```

The runtime re-validates the anchored context every turn, then calls exactly one manager method; the manager makes at
most one mutating provider call. Bindings: `manager` is present only when a token is configured.

## 4. PR creation (Sprint 3d-D, ADR-0054)

`createPullRequest({ identity, headBranch, baseBranch, title, body, expectedCommitHash, approvalRef })` — from a live
`PR_APPROVED` anchor + an explicit create phrase. Backstop validation (APPROVED ref, provider-kind == identity,
supported provider, safe owner/repo, safe head/base, head≠base, normalized non-empty bounded title, bounded body,
SHA-shaped commit) → ordered read-only checks (repo exists, head/base branch exists) → existing-open-PR lookup
(ambiguous/unavailable → block) → single mutating create. Manager owns the `reused` flag and result integrity
(`pullRequestCommitHash === expectedCommitHash`, canonical github.com URL). → `PR_CREATED`.

## 5. PR status preview (Sprint 3e, ADR-0055)

`getPullRequestStatus({ identity, pullRequestRef, expectedHeadBranch, expectedBaseBranch, expectedCommitHash })` —
**read-only, point-in-time**, no `ApprovalRef`, no state change. Returns a bounded `PullRequestStatusPreview`
(state / checks / reviews / head-commit; internally-generated `observedAt`). The query target is always the anchored
`pullRequestRef` (never a freshly user-supplied id). A stale/unattributable result is surfaced as "could not check
current status", never "checks failed". Reachable from `PR_CREATED`/`MERGE_APPROVED`/`PR_MERGED`/`MAIN_SYNCED`/
`BRANCH_CLEANED`/`REMOTE_BRANCH_CLEANUP_APPROVED`/`REMOTE_BRANCH_CLEANED` — always keeps the caller's state.

## 6. PR merge execution (Sprint 3f approval + 3g execution, ADR-0056/0057)

Two turns: `MERGE_APPROVAL_PENDING` (CRITICAL approval, permission only) → `MERGE_APPROVED` → explicit execution →
`mergePullRequest({ identity, pullRequestRef, expectedHeadBranch, expectedBaseBranch, expectedHeadSha, approvalRef })`.
The manager consumes the ApprovalRef, runs a **live pre-merge read** (`getMergePreflight`), validates preflight
integrity **always** (ref/head/base/SHA), branches on state (`merged` at the exact approved head → idempotent
`alreadyMerged`, no mutation; not `open` → block; non-`MERGEABLE` → block), then makes a single `merge_method:'merge'`
call (the adapter sends the expected head `sha` so GitHub refuses a moved head). → `PR_MERGED`. Never force/squash/
rebase/auto-merge/branch-delete/reviewer-label-assignee mutation.

## 7. Remote branch cleanup — approval + execution (Sprint 3j-A + 3j-B, ADR-0060)

Two turns, mirroring merge. From `BRANCH_CLEANED`: an explicit remote cleanup phrase records a **new CRITICAL
`ApprovalRequest`** (distinct `remoteBranchCleanupApprovalId`) → `REMOTE_BRANCH_CLEANUP_PENDING` (permission only, no
delete) → approve → `REMOTE_BRANCH_CLEANUP_APPROVED`. From there an explicit **execution** command (checked before the
re-request route; classifier rejects bulk/wildcard/main/default) →
`deleteRemoteBranch({ identity, pullRequestRef, expectedHeadBranch, expectedBaseBranch, branch, expectedCommitHash,
approvalRef })`. The manager re-consumes the approval, runs a **live merged-PR attribution read**
(`getMergePreflight` → `state==='merged'`, ref/head match) and a **live remote-branch read** (`getRemoteBranchCommit`
→ absent = idempotent success; SHA≠expected = block), then a single provider `deleteRemoteBranch`. The target is
always the anchored PR head branch (== `cleanedBranch` == `pushedBranch`, ≠ `main`, safe name); the expected commit is
`anchor.mergedHeadSha` (no fallback). → `REMOTE_BRANCH_CLEANED`. Exactly one remote ref; never default/main,
arbitrary, bulk, wildcard, or force.

## 8. ApprovalRef ownership — manager consumes, provider never receives it

Every mutating manager method takes an `approvalRef` and validates `status === APPROVED` as a backstop; the runtime
additionally re-reads the referenced `ApprovalRequest` via **structured fields only** (`status`, `executionPlanRef.id`)
and never parses the reason. The `ApprovalRef` is **consumed by the manager and never forwarded to the provider** — the
provider receives only bounded, hosting-safe inputs (identity/refs/branches/SHAs), never the approval, never a token.
Read-only methods (`getPullRequestStatus`, `getMergePreflight`, `getRemoteBranchCommit`) take no `ApprovalRef`.

## 9. Blocked vs Unverified policy for remote mutations

The settled remote-mutation safety split (ADR-0054, applied to every RepositoryHosting mutation):

```text
Before the single mutating call (known preflight failure)   → Blocked    → safe to say "did not happen"
At/after the mutating call (unknown/generic/result-integrity)→ Unverified → NEVER say "did not happen"; ask to check
Idempotent (already merged / branch already absent)          → success no-op with an "already …" wording
Not configured (no identity / no manager / no token)         → unavailable; no state change
```

Typed pairs: `RepositoryHosting{Blocked,Unverified}Error` (PR create/merge) and `RemoteBranchCleanup{Blocked,
Unverified}Error` (remote branch delete, exported from `domain/repository-hosting.ts` so adapter + manager + runtime
share them). The manager **does not blanket-convert** a provider `Blocked` into `Unverified`. **GitHub's Git-refs API
has no atomic SHA-conditional delete** — the provider mitigates by reading the ref immediately before the DELETE,
verifying `object.sha === expectedCommitHash`, then issuing a single DELETE; any ambiguity at/after the DELETE is
Unverified. The residual read→delete race is explicitly accepted and bounded (merged-PR context, ms window).

## 10. GitHub adapter constraints

- **Bounded REST via the built-in `fetch` only** — one request per call, fixed base `https://api.github.com`
  (Enterprise deferred, no override), no pagination/retry loops.
- **Adapter-local token** — constructor config only; `Authorization: Bearer` header; never logged/returned/in errors.
- **No shell, no `gh`/`octokit`/`curl`, no `child_process`.** Sanitized errors (`statusError`) never include the token
  or the raw payload.
- **Path safety** — owner/repo/single-segment branch use `encodeURIComponent`; a Git-**ref path** (`heads/<branch>`)
  is per-segment-encoded with slashes **preserved** (`heads/feature/login`, never `%2F`) so a slash-containing branch
  addresses the exact ref, never a wrong/wildcard one.
- **Mutations are exactly:** `POST …/pulls` (create), `PUT …/pulls/{n}/merge` (`merge_method:'merge'` only), and
  `DELETE …/git/refs/heads/<branch>` (remote branch cleanup). Reads: repo/branch existence, `pulls` lookup, PR/
  check-runs/reviews status, merge preflight, `GET …/git/ref/heads/<branch>`.

## 11. Explicitly forbidden actions

```text
deploy · release · tag creation · reviewer / label / assignee mutation · workflow dispatch · check rerun ·
arbitrary/user-named branch deletion · bulk branch deletion · wildcard/pattern deletion · default/main branch
deletion · force behavior · git push --delete · squash/rebase/auto-merge · GitHub Enterprise ·
shell / gh / octokit / curl / CommandExecution fallback · exposing a token or remote URL · a second/new approval
design outside the established gates.
```

## Related ADRs

ADR-0050 (CAP-010 design) · 0051 (repository identity config) · 0052 (skeleton) · 0053 (GitHub adapter) · 0054 (PR
creation execution + Blocked/Unverified) · 0055 (PR status preview) · 0057 (PR merge execution) · 0060 (remote branch
cleanup approval + execution). See also `docs/lifecycle-state-machine.md` and `docs/capabilities/git.md` (the local
sibling; Git ≠ RepositoryHosting).
