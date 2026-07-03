import type { PullRequestCreationInput, PullRequestResult, RepositoryIdentity } from '../domain';

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
}
