import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createTwoFilesPatch } from 'diff';
import { NotImplementedError } from '@chunsik/core';
import type {
  CommandResult,
  ContextFile,
  DiffChangeKind,
  FileDiff,
  ProjectFileEntry,
  ProjectReadout,
  ProjectScan,
  ProposedChange,
  RunCommandOptions,
  WorkspaceDiff,
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

// --- v2 Workspace capability (ADR-0022): read-only filesystem helpers. ---

/** Large-file guard for read/diff (bytes). Oversized files are refused/skipped. */
const MAX_READ_BYTES = 256_000;

/** Upper bound on entries returned by listFiles, to avoid runaway walks. */
const MAX_LIST_ENTRIES = 5000;

/**
 * Resolve `relPath` to an absolute path confined to `root` (ADR-0022 sandbox).
 * Rejects absolute inputs, `..` traversal, and symlink escapes for existing
 * targets. Never follows a path outside the workspace root.
 */
function resolveWithin(root: string, relPath: string): string {
  if (isAbsolute(relPath)) throw new Error(`absolute paths are not allowed: ${relPath}`);
  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, relPath);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) {
    throw new Error(`path escapes the workspace root: ${relPath}`);
  }
  if (existsSync(abs)) {
    const realRoot = realpathSync(rootAbs);
    const real = realpathSync(abs);
    if (real !== realRoot && !real.startsWith(realRoot + sep)) {
      throw new Error(`path escapes the workspace root via symlink: ${relPath}`);
    }
  }
  return abs;
}

/** Heuristic binary detection: a NUL byte in the first 8 KB. */
function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** Minimal, zero-dependency glob matcher supporting `*`, `**`, and `?`. */
function matchGlob(path: string, glob: string): boolean {
  const pattern = glob
    .split(/(\*\*|\*|\?)/)
    .map((seg) => {
      if (seg === '**') return '.*';
      if (seg === '*') return '[^/]*';
      if (seg === '?') return '[^/]';
      return seg.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${pattern}$`).test(path);
}

/**
 * Centralized read-only access rules for the Workspace capability (ADR-0022) — a
 * dedicated value object so ignore/secret/size/binary rules live in one place,
 * keeping the provider focused on filesystem mechanics. Per-project / core-level
 * configurable policies are a deliberate future extension (not in Sprint 2a).
 */
export interface WorkspacePolicy {
  /** Directory names never descended into or listed. */
  isIgnoredDir(name: string): boolean;
  /** Names that must never be read (env/secret-looking). */
  isSecret(name: string): boolean;
  /** Convenience: readable = not ignored and not secret. */
  isReadable(name: string): boolean;
  /** Maximum bytes read per file; larger files are refused (read) / skipped (diff). */
  readonly maxFileBytes: number;
  /** Heuristic binary detection. */
  isBinary(buf: Buffer): boolean;
}

/** The default policy: the existing ignore/secret/size/binary rules, consolidated. */
export const DEFAULT_WORKSPACE_POLICY: WorkspacePolicy = {
  isIgnoredDir: (name) => TREE_EXCLUDE.has(name),
  isSecret: isSecretName,
  isReadable: (name) => !TREE_EXCLUDE.has(name) && !isSecretName(name),
  maxFileBytes: MAX_READ_BYTES,
  isBinary: looksBinary,
};

/** Count added+removed lines in a unified diff (excludes ---/+++/@@ headers). */
function countChangedLines(unified: string): number {
  let n = 0;
  for (const line of unified.split('\n')) {
    if (
      (line.startsWith('+') && !line.startsWith('+++')) ||
      (line.startsWith('-') && !line.startsWith('---'))
    ) {
      n++;
    }
  }
  return n;
}

export interface LocalCloneConfig {
  /** Absolute root path of the existing local clone. */
  workspaceRoot: string;
}

/**
 * Implements WorkspaceProvider against an existing local clone — the **filesystem**
 * abstraction only (CAP-001). Workspace ≠ Git: git inspection lives in
 * `@chunsik/git-local` (CAP-002), never here.
 *
 * Read-only methods are implemented (`resolve`/`readFile`/`listFiles`/`diff`).
 * `writeFile`/`writeContextFiles`/`runCommand` remain stubs until their
 * approval-gated capabilities land.
 *
 * Safety: NEVER auto-commit, auto-push, or auto-delete. Those are HIGH/CRITICAL
 * and only run via approval-gated capabilities later.
 */
export class LocalCloneWorkspaceProvider implements WorkspaceProvider {
  readonly kind = 'local-clone';

  /** Read-only access rules (ADR-0022). Configurable policies are a future slice. */
  private readonly policy: WorkspacePolicy = DEFAULT_WORKSPACE_POLICY;

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

  // --- v2 Workspace capability (ADR-0022): read-only filesystem. node:fs only,
  //     no child_process, no git, no writes. ---

  /** Validate the core-built ref points at an existing directory; return it. */
  async resolve(ref: WorkspaceRef): Promise<WorkspaceRef> {
    void this.config;
    let isDir = false;
    try {
      isDir = existsSync(ref.rootPath) && statSync(ref.rootPath).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) throw new Error(`workspace root is not a directory: ${ref.rootPath}`);
    return ref;
  }

  /** Read one file's text, sandboxed to the root; refuses secrets/binary/oversized. */
  async readFile(ref: WorkspaceRef, relPath: string): Promise<string> {
    if (this.policy.isSecret(basename(relPath))) {
      throw new Error(`refusing to read a secret file: ${relPath}`);
    }
    const abs = resolveWithin(ref.rootPath, relPath);
    const st = statSync(abs);
    if (!st.isFile()) throw new Error(`not a file: ${relPath}`);
    if (st.size > this.policy.maxFileBytes) {
      throw new Error(`file too large (${st.size} > ${this.policy.maxFileBytes} bytes): ${relPath}`);
    }
    const buf = readFileSync(abs);
    if (this.policy.isBinary(buf)) throw new Error(`binary file is not readable as text: ${relPath}`);
    return buf.toString('utf8');
  }

  /** List relative file paths under the root (read-only); excludes ignored/secret. */
  async listFiles(ref: WorkspaceRef, glob?: string): Promise<string[]> {
    const out: string[] = [];
    const walk = (dirAbs: string, relBase: string): void => {
      if (out.length >= MAX_LIST_ENTRIES) return;
      let entries;
      try {
        entries = readdirSync(dirAbs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (out.length >= MAX_LIST_ENTRIES) return;
        if (!this.policy.isReadable(e.name) || e.isSymbolicLink()) continue;
        const childRel = relBase ? `${relBase}/${e.name}` : e.name;
        if (e.isDirectory()) walk(join(dirAbs, e.name), childRel);
        else if (e.isFile()) out.push(childRel);
      }
    };
    walk(resolveWithin(ref.rootPath, '.'), '');
    return glob ? out.filter((p) => matchGlob(p, glob)) : out;
  }

  /** Read-only unified diff: current file content → proposed content (ADR-0022). */
  async diff(ref: WorkspaceRef, changes: ProposedChange[]): Promise<WorkspaceDiff> {
    const files: FileDiff[] = [];
    let truncated = false;
    let estimatedChangedLines = 0;
    for (const change of changes) {
      const abs = resolveWithin(ref.rootPath, change.path);
      const exists = existsSync(abs) && statSync(abs).isFile();
      const wantDelete = change.delete === true;
      const changeKind: DiffChangeKind = wantDelete ? 'delete' : exists ? 'modify' : 'add';

      let current = '';
      let currentBinary = false;
      let oldSize: number | undefined;
      if (exists) {
        oldSize = statSync(abs).size;
        const buf = readFileSync(abs);
        currentBinary = this.policy.isBinary(buf);
        current = buf.toString('utf8');
      }

      const proposed = wantDelete ? '' : (change.newContent ?? '');
      const newSize = wantDelete ? undefined : Buffer.byteLength(proposed, 'utf8');
      const newBinary = !wantDelete && this.policy.isBinary(Buffer.from(proposed, 'utf8'));

      if ((oldSize ?? 0) > this.policy.maxFileBytes || (newSize ?? 0) > this.policy.maxFileBytes) {
        truncated = true;
        files.push({ path: change.path, changeKind, unified: '', binary: false, oldSize, newSize });
        continue;
      }
      if (currentBinary || newBinary) {
        files.push({ path: change.path, changeKind, unified: '', binary: true, oldSize, newSize });
        continue;
      }
      const unified = createTwoFilesPatch(change.path, change.path, current, proposed, '', '');
      estimatedChangedLines += countChangedLines(unified);
      files.push({ path: change.path, changeKind, unified, binary: false, oldSize, newSize });
    }
    return { refId: ref.id, files, estimatedChangedLines, truncated };
  }

  // --- NOT part of the v2 Workspace capability. Workspace ≠ Git (ADR-0022/0023):
  //     git lives in @chunsik/git-local (CAP-002), never here. Write/exec are
  //     gated behind future approval slices. Stubs for now. ---

  async writeFile(_ref: WorkspaceRef, _relPath: string, _content: string): Promise<void> {
    throw new NotImplementedError('LocalCloneWorkspaceProvider.writeFile');
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
