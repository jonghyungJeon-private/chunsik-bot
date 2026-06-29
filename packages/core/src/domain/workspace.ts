import type { Id, Metadata } from './common';

/**
 * Which workspace strategy/provider produced a ref. v1 ships only 'local-clone';
 * future providers (git-worktree, and later docker/ssh/remote) extend this. `kind`
 * is the provider discriminator on a `WorkspaceRef`.
 */
export type WorkspaceKind = 'local-clone' | 'git-worktree';

/**
 * A resolved working directory with a **stable identity** (`id`). The core passes
 * this around opaquely; only the WorkspaceProvider knows how a `kind` maps to the
 * filesystem. `metadata` carries provider-specific data (e.g. a future docker
 * container id or ssh host) without changing the contract. v2's
 * GitWorktreeWorkspaceProvider produces the same shape with kind='git-worktree'.
 */
export interface WorkspaceRef {
  /** Stable workspace identity. */
  id: Id;
  projectId?: Id;
  rootPath: string;
  /** Provider discriminator. */
  kind: WorkspaceKind;
  branch?: string;
  /** Provider-specific data for future workspace kinds (docker/ssh/remote). */
  metadata?: Metadata;
}

/** Result of running a command inside a workspace. */
export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Kind of change a proposed edit represents (ADR-0022). */
export type DiffChangeKind = 'add' | 'modify' | 'delete';

/**
 * A proposed end-state for one file, the INPUT to read-only diff generation
 * (ADR-0022). `newContent` is the desired content; omit it with `delete: true`
 * to propose removal. The workspace never writes — it only reads the current
 * file and computes the unified diff. This seam feeds the future Approval gate.
 */
export interface ProposedChange {
  /** Path relative to the workspace root. */
  path: string;
  /** Desired file content after the change (omit for a deletion). */
  newContent?: string;
  /** True to propose deleting the file. */
  delete?: boolean;
}

/** Unified diff for a single proposed file change (ADR-0022). */
export interface FileDiff {
  path: string;
  changeKind: DiffChangeKind;
  /** Unified-diff text; empty when `binary` or when there is no change. */
  unified: string;
  /** True when current or proposed content looks binary (diff skipped). */
  binary: boolean;
  /** Byte length of the current file (absent for an add). */
  oldSize?: number;
  /** Byte length of the proposed content (absent for a delete). */
  newSize?: number;
}

/**
 * A read-only diff of a proposed change set against the current workspace
 * contents (ADR-0022). Purely current-file → proposed-content; no git, no
 * repository history. The pre-Approval representation the future Write slice
 * routes through the approval gate.
 */
export interface WorkspaceDiff {
  refId: Id;
  files: FileDiff[];
  /**
   * Total added+removed lines across all files. Computed once by the provider so
   * future Approval workflows can size a change (5 vs 5000 lines) without
   * recomputing. Excludes binary/oversized files (which carry no unified text).
   */
  estimatedChangedLines: number;
  /** True when any file was skipped/clipped by the size guard. */
  truncated: boolean;
}
