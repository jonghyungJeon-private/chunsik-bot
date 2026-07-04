import type { GitBranchCleanupResult, GitCommitResult, GitDiff, GitMainSyncResult, GitPushResult, GitStatus, RepositoryInfo } from '../domain';

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

  /**
   * The SECOND mutating method (CAP-002, ADR-0048) — the first REMOTE mutation. Pushes EXACTLY the current
   * HEAD to `<remote> HEAD:<branch>` and returns the provider-reported target (NOT an independent remote
   * verification). A single `git --no-pager push <remote> HEAD:<branch>`, argument-array only (never a shell
   * string), timeout, masked stderr. NEVER `--force`/`-f`/`--tags`/`--all`/`-u`/`--set-upstream`/bare `git
   * push`, no arbitrary refspec, no user-provided remote/branch. Validates remote/branch with conservative
   * git ref rules BEFORE any git call (unsafe target never reaches argv). Approval gating is done by
   * `GitManager.pushApprovedCommit`; this port takes no ApprovalRef.
   */
  pushApprovedCommit(rootPath: string, remote: string, branch: string, commitHash: string): Promise<GitPushResult>;

  /**
   * READ-ONLY (CAP-002, ADR-0058 — Sprint 3h): observe the remote branch tip WITHOUT updating any local ref or the
   * working tree (`git ls-remote`-style). Single bounded argv call, timeout, masked stderr, NO remote URL exposed.
   * Throws on failure (the Manager maps it to a pre-mutation *Blocked*). Validates remote/branch defensively first.
   */
  getRemoteRefCommit(rootPath: string, remote: string, branch: string): Promise<{ commitHash: string }>;

  /**
   * READ-ONLY (CAP-002, ADR-0058 — Sprint 3h): the LOCAL branch tip (`git rev-parse refs/heads/<branch>`), or `null`
   * when the branch does not exist. Used for the local-main-exists check + the compare-and-swap base
   * (`previousMainCommit`). No mutation. Argument-array spawn only.
   */
  getLocalRefCommit(rootPath: string, branch: string): Promise<{ commitHash: string } | null>;

  /**
   * The THIRD mutating method (CAP-002, ADR-0058 — Sprint 3h) — a **fast-forward-only** local `main` sync, mode-split
   * by the current checkout and compare-and-swap guarded against `expectedPreviousCommit`. Fetches the remote branch,
   * then either fast-forwards the checked-out `main` (working tree/index moves) or, when another branch is checked
   * out, fast-forwards ONLY `refs/heads/main` (no checkout switch, no working-tree change). NEVER `--force`/`-f`,
   * NEVER `reset --hard`, NEVER a push, NEVER a branch deletion, NEVER a checkout switch. Detached HEAD, a non-
   * fast-forward, a fetched-tip mismatch, or a moved local main BEFORE the ref update are **pre-ref-update** failures
   * and throw `GitMainSyncBlockedError` ("not synced"); any failure AT/AFTER the ref-update attempt throws
   * `GitMainSyncUnverifiedError` ("never say not synced"). Approval gating (if any) is the Manager's job; this port
   * takes no ApprovalRef (mirrors commitFiles/pushApprovedCommit).
   */
  syncMainFastForward(
    rootPath: string,
    remote: string,
    branch: string,
    expectedRemoteCommit: string,
    expectedPreviousCommit: string,
  ): Promise<GitMainSyncResult>;

  /** READ-ONLY (CAP-002, ADR-0059 — Sprint 3i): is `ancestor` an ancestor of `descendant`? (`git merge-base
   *  --is-ancestor`). Used by the Manager for the "fully merged into main" check. No mutation. Argv-only. */
  isAncestor(rootPath: string, ancestor: string, descendant: string): Promise<boolean>;

  /**
   * The FOURTH mutating method (CAP-002, ADR-0059 — Sprint 3i) — a compare-and-swap delete of a fully-merged LOCAL
   * branch via `git update-ref -d refs/heads/<branch> <expectedBranchCommit>` (deterministic; NOT `git branch -d`,
   * so it does not depend on the current `HEAD`/checkout — CA change 3). NEVER `-D`/`--force`, NEVER 'main', NEVER a
   * remote ref, NEVER a wildcard/pattern, NEVER a checkout switch. Validates the branch name + SHA defensively
   * first. PHASE-AWARE: a pre-ref-delete failure (branch moved/absent vs `expectedBranchCommit`) throws
   * `BranchCleanupBlockedError`; a failure AT/AFTER the ref-delete attempt throws `BranchCleanupUnverifiedError`.
   * Takes no ApprovalRef (mirrors commitFiles/pushApprovedCommit/syncMainFastForward).
   */
  deleteMergedLocalBranch(rootPath: string, branch: string, expectedBranchCommit: string): Promise<GitBranchCleanupResult>;
}
