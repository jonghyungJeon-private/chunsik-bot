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
  // Reserved optional fields (ADR-0023). NOT populated in Sprint 2b — declared now
  // so future capabilities (Approval, Patch, Workspace Write) add no domain ripple.
  /** Commits ahead of upstream. */
  ahead?: number;
  /** Commits behind upstream. */
  behind?: number;
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
