import { NotImplementedError, WorkspaceNotSafeError } from '../errors';
import { newId } from '../util/id';
import type {
  ContextFile,
  GitStatus,
  Id,
  ProposedChange,
  Task,
  WorkspaceDiff,
  WorkspaceKind,
  WorkspaceRef,
} from '../domain';
import type { ProjectReadout, ProjectScan, WorkspaceProvider } from '../ports';

/**
 * Thin orchestration over the WorkspaceProvider that enforces the safety rule:
 * check git status BEFORE modifying code, and never auto-commit/push/delete.
 * Swapping LocalCloneWorkspaceProvider -> GitWorktreeWorkspaceProvider later
 * requires no change here.
 */
export class WorkspaceManager {
  constructor(private readonly provider: WorkspaceProvider) {}

  /** Read-only scan of a local directory for project registration (ADR-0018). */
  async scan(path: string): Promise<ProjectScan> {
    return this.provider.scanProject(path);
  }

  /** Read-only, size-limited project read for gated analysis (ADR-0019). */
  async readProjectFiles(rootPath: string): Promise<ProjectReadout> {
    return this.provider.readProjectFiles(rootPath);
  }

  /**
   * Open a read-only workspace for a registered project (ADR-0022). The core
   * builds the pure `WorkspaceRef` (the provider never queries storage); the
   * provider validates/prepares it. The ref's `kind` comes from the bound
   * provider, so swapping in a worktree provider needs no change here.
   */
  async open(project: { id: Id; rootPath: string }): Promise<WorkspaceRef> {
    const ref: WorkspaceRef = {
      id: newId(),
      projectId: project.id,
      rootPath: project.rootPath,
      kind: this.provider.kind as WorkspaceKind,
    };
    return this.provider.resolve(ref);
  }

  /** Read one file's text from the workspace (read-only, sandboxed). */
  async read(ref: WorkspaceRef, relPath: string): Promise<string> {
    return this.provider.readFile(ref, relPath);
  }

  /** List file paths in the workspace (read-only); optional glob filter. */
  async list(ref: WorkspaceRef, glob?: string): Promise<string[]> {
    return this.provider.listFiles(ref, glob);
  }

  /** Read-only unified diff of proposed changes vs current content (ADR-0022). */
  async diff(ref: WorkspaceRef, changes: ProposedChange[]): Promise<WorkspaceDiff> {
    return this.provider.diff(ref, changes);
  }

  /**
   * Resolve a working directory for a task. Deferred: building a `WorkspaceRef`
   * needs the project's root path, which a `Task` does not carry. The
   * task→workspace wiring (and the capabilities that need it) arrive in a later
   * slice; callers with a `Project` should use {@link open}.
   */
  async prepare(task: Task): Promise<WorkspaceRef | undefined> {
    if (!task.projectId) return undefined;
    throw new NotImplementedError('WorkspaceManager.prepare (use open(project); wiring deferred)');
  }

  async status(ref: WorkspaceRef): Promise<GitStatus> {
    return this.provider.gitStatus(ref);
  }

  /** Guard invoked before any code mutation. Throws if the tree is dirty. */
  async ensureSafe(ref: WorkspaceRef): Promise<void> {
    const status = await this.provider.gitStatus(ref);
    if (!status.clean) {
      throw new WorkspaceNotSafeError(
        `branch ${status.branch} has uncommitted changes (${status.unstaged.length} unstaged, ${status.untracked.length} untracked)`,
      );
    }
  }

  /** Materialize memory context files into the workspace before a CLI run. */
  async injectContext(ref: WorkspaceRef, files: ContextFile[]): Promise<void> {
    await this.provider.writeContextFiles(ref, files);
  }
}
