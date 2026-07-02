import type { GitCommitResult, GitDiff, GitStatus, RepositoryInfo } from '../domain';

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

  /**
   * Read-only unified diff of TRACKED staged/unstaged changes vs HEAD (ADR-0044). Still read-only — runs
   * only `git diff` (never a mutating subcommand), argument-array spawn (never a shell string), with the
   * same timeout discipline. Untracked file contents are excluded (surfaced via {@link status}); binary
   * files appear as a marker only. Size-bounded by the implementation.
   */
  diff(rootPath: string): Promise<GitDiff>;

  /**
   * The FIRST mutating method on this port (CAP-002, ADR-0046) — commits EXACTLY `files` with `message` and
   * returns the new commit's hash. READ-ONLY-elsewhere discipline is preserved everywhere else. Runs a
   * single `git commit --only -- <files>` of the exact **tracked** pathspecs (NO separate `git add`; untracked
   * files are blocked upstream), argument-array only (never a shell string), timeout, masked stderr. The
   * message is a single argv element. Commits no other path; **never pushes** (no push/reset/checkout/stash/
   * branch/tag/merge/rebase). Validates its path args defensively (absolute/traversal/empty rejected before
   * any git call). Approval gating is done by `GitManager.commitFiles`; this port takes no ApprovalRef.
   */
  commitFiles(rootPath: string, files: string[], message: string): Promise<GitCommitResult>;
}
