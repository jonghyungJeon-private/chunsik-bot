import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { NotImplementedError } from '@chunsik/core';
import type {
  CommandResult,
  ContextFile,
  GitStatus,
  Id,
  ProjectScan,
  ResolveOptions,
  RunCommandOptions,
  WorkspaceProvider,
  WorkspaceRef,
} from '@chunsik/core';

/** Directories excluded from the file-tree summary (ADR-0018). */
const TREE_EXCLUDE = new Set(['node_modules', 'dist', 'build', '.git', 'coverage']);

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

  /** Read-only scan for project registration (ADR-0018). Never mutates anything. */
  async scanProject(path: string): Promise<ProjectScan> {
    let isDir = false;
    try {
      isDir = existsSync(path) && statSync(path).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) {
      return {
        exists: false,
        name: basename(path) || path,
        rootPath: path,
        gitBranch: 'unknown',
        packageManager: 'unknown',
        fileTreeSummary: '',
      };
    }
    return {
      exists: true,
      name: basename(path) || path,
      rootPath: path,
      gitBranch: LocalCloneWorkspaceProvider.detectGitBranch(path),
      packageManager: LocalCloneWorkspaceProvider.detectPackageManager(path),
      fileTreeSummary: LocalCloneWorkspaceProvider.summarizeTree(path),
    };
  }

  private static detectGitBranch(path: string): string {
    try {
      const res = spawnSync('git', ['-C', path, 'rev-parse', '--abbrev-ref', 'HEAD'], {
        encoding: 'utf8',
        timeout: 5000,
      });
      if (res.status === 0 && res.stdout.trim()) return res.stdout.trim();
    } catch {
      /* not a git repo / git unavailable */
    }
    return 'unknown';
  }

  private static detectPackageManager(path: string): string {
    if (existsSync(join(path, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(join(path, 'yarn.lock'))) return 'yarn';
    if (existsSync(join(path, 'package-lock.json'))) return 'npm';
    if (existsSync(join(path, 'package.json'))) return 'npm';
    return 'unknown';
  }

  private static summarizeTree(path: string): string {
    try {
      const entries = readdirSync(path, { withFileTypes: true });
      return entries
        .filter((e) => !TREE_EXCLUDE.has(e.name))
        .sort((a, b) =>
          a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1,
        )
        .slice(0, 50)
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .join('\n');
    } catch {
      return '';
    }
  }

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
