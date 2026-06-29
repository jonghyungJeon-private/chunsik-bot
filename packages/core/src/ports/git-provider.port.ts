import type { GitStatus, RepositoryInfo } from '../domain';

/**
 * PORT: read-only git **repository** inspection (CAP-002, ADR-0023).
 *
 * Git ≠ Workspace. This port owns the *repository* abstraction; `WorkspaceProvider`
 * owns the *filesystem* abstraction. Capabilities compose **through `rootPath`** —
 * this port takes a plain path and does NOT depend on `WorkspaceRef` or any
 * Workspace type.
 *
 * Sprint 2b is **read-only**: no commit/checkout/branch/merge/reset/stash/push/
 * pull/fetch/tag/worktree. Implementations run git **adapter-side only**, via
 * argument-array spawn (never a shell string), with a timeout and the repository
 * root as cwd. Core never touches `child_process`. Write operations are a future
 * capability gated by Approval.
 */
export interface GitProvider {
  readonly kind: string;

  /** True when `rootPath` is inside a git work tree. */
  isRepository(rootPath: string): Promise<boolean>;

  /** Minimal repository metadata (branch / HEAD / detached). No remote URLs. */
  info(rootPath: string): Promise<RepositoryInfo>;

  /** Working-tree status (clean/branch + staged/unstaged/untracked summaries). */
  status(rootPath: string): Promise<GitStatus>;
}
