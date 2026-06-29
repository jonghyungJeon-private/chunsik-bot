import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { NotImplementedError } from '@chunsik/core';
import type {
  CommandResult,
  ContextFile,
  GitStatus,
  Id,
  ProjectFileEntry,
  ProjectReadout,
  ProjectScan,
  ResolveOptions,
  RunCommandOptions,
  WorkspaceProvider,
  WorkspaceRef,
} from '@chunsik/core';

/** Directories excluded from file-tree summaries / reads (ADR-0018/0019). */
const TREE_EXCLUDE = new Set(['node_modules', 'dist', 'build', '.git', 'coverage']);

/** Files whose full text may be read during gated analysis (ADR-0019). */
const ANALYSIS_ALLOW = new Set([
  'package.json',
  'pnpm-workspace.yaml',
  'README.md',
  'ARCHITECTURE.md',
  'DECISIONS.md',
]);

/** Per-file read cap for analysis. */
const MAX_FILE_BYTES = 8000;

/** Never read env / secret-looking files (ADR-0019). */
function isSecretName(name: string): boolean {
  return /\.env(\.|$)/i.test(name) || /(secret|token|key|credential|password)/i.test(name);
}

function isAnalysisAllowed(name: string): boolean {
  return ANALYSIS_ALLOW.has(name) || /^tsconfig.*\.json$/.test(name);
}

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

  /** Read-only, size-limited read of an allow-listed file set (ADR-0019). */
  async readProjectFiles(rootPath: string): Promise<ProjectReadout> {
    const files: ProjectFileEntry[] = [];
    let rootEntries: string[];
    try {
      rootEntries = readdirSync(rootPath);
    } catch {
      return { files, tree: '' };
    }
    for (const name of rootEntries.sort()) {
      if (TREE_EXCLUDE.has(name) || isSecretName(name) || !isAnalysisAllowed(name)) continue;
      const full = join(rootPath, name);
      try {
        const st = statSync(full);
        if (!st.isFile()) continue;
        let content = readFileSync(full, 'utf8');
        const truncated = content.length > MAX_FILE_BYTES;
        if (truncated) content = content.slice(0, MAX_FILE_BYTES);
        files.push({ path: name, content, truncated });
      } catch {
        /* skip unreadable file */
      }
    }
    return { files, tree: LocalCloneWorkspaceProvider.analysisTree(rootPath) };
  }

  /** Top-level tree (root + apps/ + packages/), excluding ignored/secret entries. */
  private static analysisTree(rootPath: string): string {
    const lines = LocalCloneWorkspaceProvider.listDir(rootPath);
    for (const sub of ['apps', 'packages']) {
      const subPath = join(rootPath, sub);
      try {
        if (statSync(subPath).isDirectory()) {
          for (const child of LocalCloneWorkspaceProvider.listDir(subPath)) lines.push(`${sub}/${child}`);
        }
      } catch {
        /* sub dir absent */
      }
    }
    return lines.join('\n');
  }

  private static listDir(dir: string): string[] {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((e) => !TREE_EXCLUDE.has(e.name) && !isSecretName(e.name))
        .sort((a, b) =>
          a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1,
        )
        .slice(0, 60)
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    } catch {
      return [];
    }
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
