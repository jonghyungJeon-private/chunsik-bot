import type { CommandResult, ContextFile, GitStatus, Id, WorkspaceRef } from '../domain';

export interface ResolveOptions {
  branch?: string;
}

export interface RunCommandOptions {
  /** Subdirectory relative to the workspace root. */
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

/**
 * PORT: the filesystem/git surface a task operates on.
 * v1 implementation: LocalCloneWorkspaceProvider (operates on an existing
 * local clone). v2 adds GitWorktreeWorkspaceProvider with the SAME contract.
 *
 * Safety rule: this port exposes NO auto-commit / auto-push / auto-delete.
 * Such mutations are HIGH/CRITICAL and run only through the approval gate via
 * `runCommand` after a decision — never implicitly.
 */
export interface WorkspaceProvider {
  readonly kind: string;

  /** Resolve (and prepare, if needed) a working directory for a project. */
  resolve(projectId: Id, options?: ResolveOptions): Promise<WorkspaceRef>;

  /** Inspect git state — the core checks this BEFORE modifying code. */
  gitStatus(ref: WorkspaceRef): Promise<GitStatus>;

  readFile(ref: WorkspaceRef, relPath: string): Promise<string>;
  writeFile(ref: WorkspaceRef, relPath: string, content: string): Promise<void>;
  listFiles(ref: WorkspaceRef, glob?: string): Promise<string[]>;

  /** Materialize memory context files (CLAUDE.md, .chunsik/context.md, ...). */
  writeContextFiles(ref: WorkspaceRef, files: ContextFile[]): Promise<void>;

  /** Run an arbitrary command. Risk is assessed by the core, not here. */
  runCommand(ref: WorkspaceRef, command: string, options?: RunCommandOptions): Promise<CommandResult>;
}
