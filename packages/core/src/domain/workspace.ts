import type { Id } from './common';

/** Which workspace strategy produced a ref. v1 ships only 'local-clone'. */
export type WorkspaceKind = 'local-clone' | 'git-worktree';

/**
 * A resolved working directory. The core passes this around opaquely; only the
 * WorkspaceProvider knows how a kind maps to the filesystem. v2's
 * GitWorktreeWorkspaceProvider produces the same shape with kind='git-worktree'.
 */
export interface WorkspaceRef {
  id: Id;
  projectId?: Id;
  rootPath: string;
  kind: WorkspaceKind;
  branch?: string;
}

/** Git state, surfaced generically so the core can gate edits on cleanliness. */
export interface GitStatus {
  clean: boolean;
  branch: string;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

/** Result of running a command inside a workspace. */
export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
