/**
 * Git domain types (CAP-002, ADR-0023). Owned by the **Git** capability, not
 * Workspace — Workspace ≠ Git. Read-only in Sprint 2b.
 */

/** Git working-tree state, surfaced generically so callers can gate on cleanliness. */
export interface GitStatus {
  clean: boolean;
  branch: string;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  // `ahead`/`behind` are NOW populated (Sprint 2z, ADR-0047) from the `git status -b` branch header —
  // relative to the LOCAL remote-tracking ref (no network fetch). Both are `undefined` when there is no
  // upstream (distinct from `0` = in sync). The other reserved fields (ADR-0023) stay unpopulated.
  /** Commits ahead of the upstream tracking ref; `undefined` when there is no upstream. */
  ahead?: number;
  /** Commits behind the upstream tracking ref; `undefined` when there is no upstream. */
  behind?: number;
  /** Upstream tracking ref (e.g. "origin/main"), parsed from the `-b` header; `undefined` when the branch
   *  has no upstream (Sprint 2z, ADR-0047). Read-only; no network fetch. */
  upstream?: string;
  /** True when HEAD is detached. */
  isDetached?: boolean;
  /** True when the index has unmerged/conflicted paths. */
  hasUnmergedPaths?: boolean;
}

/**
 * Read-only working-tree diff view (CAP-002, ADR-0044 — read-only extension). Surfaces the unified diff of
 * **tracked** staged/unstaged changes vs HEAD. NOT persisted, no Ref, no storage. Untracked file *contents*
 * are NOT included (`git diff HEAD` excludes them) — untracked paths are surfaced via {@link GitStatus};
 * binary files appear as a marker line only, never binary content. The producing adapter applies a hard
 * size cap and sets `truncated`.
 */
export interface GitDiff {
  /** Changed tracked file paths (derived from a bounded-safe `--name-only` read, not parsed from raw diff). */
  files: string[];
  /** Unified diff of tracked staged/unstaged changes; binary files show a marker only; adapter-size-bounded. */
  unified: string;
  /** True when the adapter dropped diff content to fit its hard cap. */
  truncated: boolean;
}

/**
 * Result of an approved exact-file git commit (CAP-002, ADR-0046 — the first Git mutation). Returned by
 * `GitProvider.commitFiles`/`GitManager.commitFiles`. NOT persisted as an aggregate; the runtime stores the
 * hash + files on the apply anchor. `GIT_COMMITTED` means committed locally — never pushed/deployed.
 */
export interface GitCommitResult {
  /** The new commit's full sha (as read back by the adapter). */
  commitHash: string;
  /** The exact files included in the commit (the approved candidate set). */
  committedFiles: string[];
  /** The commit message used (the approved message). */
  message: string;
}

/**
 * The provider-reported successful push target after `git push` exited 0 (CAP-002, ADR-0048 — the first
 * REMOTE mutation). Returned by `GitProvider.pushApprovedCommit`/`GitManager.pushApprovedCommit`. This is
 * **NOT an independent remote verification** — only the target the provider pushed to once the command
 * exited 0. NOT persisted as an aggregate; the runtime uses it for local result-integrity checking and
 * stores the pushed target on the apply anchor. `GIT_PUSHED` means pushed to the approved upstream — never
 * PR-created/deployed/push-safe-forever.
 */
export interface GitPushResult {
  /** The remote pushed to (the approved remote). */
  remote: string;
  /** The branch pushed to (the approved branch; may contain '/'). */
  branch: string;
  /** The upstream tracking ref pushed to, e.g. "origin/main" (the approved upstream). */
  upstreamRef: string;
  /** The commit sha pushed (the approved pushCommitHash; HEAD at push time). */
  commitHash: string;
}

/**
 * Minimal, read-only repository metadata (CAP-002). Intentionally **excludes
 * remote URLs** — HTTPS remotes can embed credentials; exposing them needs a
 * future masking policy + ADR (ADR-0023).
 */
export interface RepositoryInfo {
  /** Whether `rootPath` is inside a git work tree. */
  isRepository: boolean;
  /** Resolved repository top-level path (the input path when not a repo). */
  rootPath: string;
  /** Current branch name; '' when detached or not a repository. */
  branch: string;
  /** HEAD commit sha, if any (absent on an unborn repository). */
  headSha?: string;
  /** True when HEAD is detached. */
  detached: boolean;
}
