import type {
  PullRequestCreationInput,
  PullRequestMergePreflight,
  PullRequestMergeResult,
  PullRequestRef,
  PullRequestResult,
  PullRequestStatusPreview,
  RemoteBranchCleanupResult,
  RepositoryIdentity,
} from '../domain';

/**
 * PORT: repository-hosting platform operations (CAP-010, ADR-0052 — the Sprint 3d-B skeleton). Distinct from
 * `GitProvider` (CAP-002, local repository only). Implementations call an external hosting API adapter-side;
 * core depends only on this interface, never on an SDK/HTTP-client type.
 *
 * **Skeleton discipline (ADR-0052):** `createPullRequest` exists as a port **shape only** in Sprint 3d-B —
 * there is **no real provider implementation**, no GitHub adapter, no DI binding, and no product-runtime path
 * that reaches it. Only **fake providers in unit tests** may implement or call these methods.
 *
 * Approval gating is done by `RepositoryHostingManager`; this port takes **no** `ApprovalRef` (mirrors
 * `GitProvider` — the provider owns hosting API calls only and never sees the approval).
 */
export interface RepositoryHostingProvider {
  /** Provider discriminator, e.g. "github". The Manager requires `kind === identity.provider`. */
  readonly kind: string;

  /** Read-only: true when `identity` resolves to a repository the provider can act on. */
  repositoryExists(identity: RepositoryIdentity): Promise<boolean>;

  /** Read-only: true when `branch` exists on the hosting provider for `identity`. */
  branchExists(identity: RepositoryIdentity, branch: string): Promise<boolean>;

  /** Read-only: an existing OPEN pull request for the exact head/base pair, or null if none. Throws when the
   *  provider genuinely cannot answer the query, so the Manager applies the "no non-idempotent creation by
   *  default" policy (block). */
  findOpenPullRequest(
    identity: RepositoryIdentity,
    headBranch: string,
    baseBranch: string,
  ): Promise<PullRequestResult | null>;

  /** The ONLY mutating method — creates exactly one Pull Request from validated, bounded input. Takes **no**
   *  `ApprovalRef` (consumed by the Manager). Port shape only in 3d-B; no real implementation ships. */
  createPullRequest(input: PullRequestCreationInput): Promise<PullRequestResult>;

  /** READ-ONLY point-in-time PR status (CAP-010, ADR-0055 — Sprint 3e). No mutation, no ApprovalRef. Returns a
   *  bounded, provider-reported {@link PullRequestStatusPreview} with an internally-generated `observedAt`.
   *  Bounded GET calls only (no pagination/retry loops); sanitized errors (no token/raw payload). */
  getPullRequestStatus(input: {
    identity: RepositoryIdentity;
    pullRequestRef: PullRequestRef;
    expectedHeadBranch: string;
    expectedBaseBranch: string;
    expectedCommitHash: string;
  }): Promise<PullRequestStatusPreview>;

  /** READ-ONLY immediate pre-merge snapshot (CAP-010, ADR-0057 — Sprint 3g). No mutation, no ApprovalRef.
   *  Returns a bounded {@link PullRequestMergePreflight} incl. NORMALIZED `mergeability` (raw provider payload is
   *  mapped adapter-side; core never sees it) with an internally-generated `observedAt`. Bounded GET only;
   *  sanitized errors (no token/raw payload). Distinct from `getPullRequestStatus` (read-only user status). */
  getMergePreflight(input: {
    identity: RepositoryIdentity;
    pullRequestRef: PullRequestRef;
    expectedHeadBranch: string;
    expectedBaseBranch: string;
    expectedCommitHash: string;
  }): Promise<PullRequestMergePreflight>;

  /** The ONLY new mutating method (CAP-010, ADR-0057 — Sprint 3g) — merges exactly one PR. Takes **no**
   *  `ApprovalRef` (consumed by the Manager); receives only hosting-safe refs + the expected head SHA (sent to the
   *  provider so it refuses a moved head). No force merge / branch deletion / auto-merge / reviewer-label-assignee
   *  mutation. Called only AFTER the Manager's full live preflight passes. */
  mergePullRequest(input: {
    identity: RepositoryIdentity;
    pullRequestRef: PullRequestRef;
    expectedHeadSha: string;
  }): Promise<PullRequestMergeResult>;

  /** READ-ONLY (CAP-010, ADR-0060 — Sprint 3j-B) — the remote branch head commit for `identity`, or `null` when the
   *  branch is absent (404). Single bounded GET (`GET /git/ref/heads/<branch>`); sanitized errors (no token/raw
   *  payload); no pagination/retry. Used by the Manager's remote-cleanup preflight. */
  getRemoteBranchCommit(identity: RepositoryIdentity, branch: string): Promise<{ commitHash: string } | null>;

  /** The ONLY new mutating method (CAP-010, ADR-0060 — Sprint 3j-B) — deletes EXACTLY one remote branch. Takes **no**
   *  `ApprovalRef` (consumed by the Manager). Reads the ref IMMEDIATELY before delete and verifies `object.sha ===
   *  expectedCommitHash` (GitHub has no atomic SHA-conditional delete), then issues a single `DELETE /git/refs/heads/
   *  <branch>`. NEVER the default branch, a wildcard/pattern, a force flag, or `git push`. PHASE-AWARE: a pre-DELETE
   *  SHA mismatch / known failure throws `RemoteBranchCleanupBlockedError`; a failure AT/AFTER the DELETE throws
   *  `RemoteBranchCleanupUnverifiedError`. An already-absent branch returns `{ deleted:false, alreadyAbsent:true }`. */
  deleteRemoteBranch(input: {
    identity: RepositoryIdentity;
    branch: string;
    expectedCommitHash: string;
  }): Promise<RemoteBranchCleanupResult>;
}
