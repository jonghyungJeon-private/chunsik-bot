import type {
  CommandResult,
  ContextFile,
  ProposedChange,
  WorkspaceDiff,
  WorkspaceRef,
} from '../domain';

export interface RunCommandOptions {
  /** Subdirectory relative to the workspace root. */
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

/** One allow-listed file read during analysis (ADR-0019). */
export interface ProjectFileEntry {
  /** Path relative to the project root. */
  path: string;
  /** File content, capped to a size limit. */
  content: string;
  /** True when the content was truncated to the size limit. */
  truncated: boolean;
}

/** Read-only, size-limited project readout for gated analysis (ADR-0019). */
export interface ProjectReadout {
  /** Allow-listed files that exist (package.json, tsconfig*, README/ARCHITECTURE…). */
  files: ProjectFileEntry[];
  /** Top-level tree (root + apps/ + packages/), excluding ignored/secret entries. */
  tree: string;
}

/** Read-only scan of a local project directory (ADR-0018). */
export interface ProjectScan {
  exists: boolean;
  name: string;
  rootPath: string;
  /** Current git branch, or 'unknown' when not a git repo. */
  gitBranch: string;
  /** 'pnpm' | 'npm' | 'yarn' | 'unknown'. */
  packageManager: string;
  /** Basic top-level file/dir summary (excludes node_modules/dist/build/.git/coverage). */
  fileTreeSummary: string;
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

  /** Read-only scan of a local directory for project registration (ADR-0018). */
  scanProject(path: string): Promise<ProjectScan>;

  /**
   * Read-only, size-limited read of an allow-listed file set for analysis
   * (ADR-0019). Excludes node_modules/dist/build/coverage/.git and env/secret
   * files. Never runs shell or git commands.
   */
  readProjectFiles(rootPath: string): Promise<ProjectReadout>;

  // --- v2 Workspace capability (ADR-0022): read-only filesystem surface. ---

  /**
   * Prepare/validate a working directory described by a core-built `WorkspaceRef`
   * and return it (ADR-0022). The provider receives ONLY the ref — a pure domain
   * value object — and never resolves project ids or queries storage. For the
   * local clone this validates the root path; a future worktree provider would
   * create the worktree here under the SAME contract.
   */
  resolve(ref: WorkspaceRef): Promise<WorkspaceRef>;

  /** Read one file's text, sandboxed to the workspace root (read-only). */
  readFile(ref: WorkspaceRef, relPath: string): Promise<string>;

  /** List file paths under the workspace root (read-only); optional glob filter. */
  listFiles(ref: WorkspaceRef, glob?: string): Promise<string[]>;

  /**
   * Generate a read-only unified diff for proposed changes (ADR-0022): current
   * file content → proposed content. No write, no git, no repository history.
   * This is the pre-Approval seam, NOT a git capability.
   */
  diff(ref: WorkspaceRef, changes: ProposedChange[]): Promise<WorkspaceDiff>;

  // --- NOT part of the v2 Workspace capability. Workspace ≠ Git (ADR-0022/0023):
  //     git lives in the GitProvider port (CAP-002), never here. Write/exec are
  //     gated behind future approval slices. Stubs for now. ---

  writeFile(ref: WorkspaceRef, relPath: string, content: string): Promise<void>;

  /** Materialize memory context files (CLAUDE.md, .chunsik/context.md, ...). */
  writeContextFiles(ref: WorkspaceRef, files: ContextFile[]): Promise<void>;

  /** Run an arbitrary command. Risk is assessed by the core, not here. */
  runCommand(ref: WorkspaceRef, command: string, options?: RunCommandOptions): Promise<CommandResult>;
}
