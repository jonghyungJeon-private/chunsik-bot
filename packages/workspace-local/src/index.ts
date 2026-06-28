import { NotImplementedError } from '@chunsik/core';
import type {
  CommandResult,
  ContextFile,
  GitStatus,
  Id,
  ResolveOptions,
  RunCommandOptions,
  WorkspaceProvider,
  WorkspaceRef,
} from '@chunsik/core';

export interface LocalCloneConfig {
  /** Absolute root path of the existing local clone. */
  workspaceRoot: string;
}

/**
 * SKELETON. Implements WorkspaceProvider against an existing local clone.
 *
 * TODO(impl): use node:fs/promises + node:child_process. resolve() returns a
 * WorkspaceRef pointing at workspaceRoot (kind: 'local-clone'). gitStatus()
 * shells `git status --porcelain -b`. writeContextFiles() writes CLAUDE.md /
 * .chunsik/*.md. runCommand() spawns in the ref's directory.
 *
 * Safety: NEVER auto-commit, auto-push, or auto-delete. Those are HIGH/CRITICAL
 * and only run via runCommand AFTER the core's approval gate.
 *
 * v2: GitWorktreeWorkspaceProvider implements this SAME interface (kind:
 * 'git-worktree') — the core is unaffected.
 */
export class LocalCloneWorkspaceProvider implements WorkspaceProvider {
  readonly kind = 'local-clone';

  constructor(private readonly config: LocalCloneConfig) {}

  async resolve(_projectId: Id, _options?: ResolveOptions): Promise<WorkspaceRef> {
    void this.config;
    throw new NotImplementedError('LocalCloneWorkspaceProvider.resolve');
  }

  async gitStatus(_ref: WorkspaceRef): Promise<GitStatus> {
    throw new NotImplementedError('LocalCloneWorkspaceProvider.gitStatus');
  }

  async readFile(_ref: WorkspaceRef, _relPath: string): Promise<string> {
    throw new NotImplementedError('LocalCloneWorkspaceProvider.readFile');
  }

  async writeFile(_ref: WorkspaceRef, _relPath: string, _content: string): Promise<void> {
    throw new NotImplementedError('LocalCloneWorkspaceProvider.writeFile');
  }

  async listFiles(_ref: WorkspaceRef, _glob?: string): Promise<string[]> {
    throw new NotImplementedError('LocalCloneWorkspaceProvider.listFiles');
  }

  async writeContextFiles(_ref: WorkspaceRef, _files: ContextFile[]): Promise<void> {
    throw new NotImplementedError('LocalCloneWorkspaceProvider.writeContextFiles');
  }

  async runCommand(
    _ref: WorkspaceRef,
    _command: string,
    _options?: RunCommandOptions,
  ): Promise<CommandResult> {
    throw new NotImplementedError('LocalCloneWorkspaceProvider.runCommand');
  }
}
