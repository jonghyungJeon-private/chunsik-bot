import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import type { GitDiff, GitProvider, GitStatus, RepositoryInfo } from '@chunsik/core';

/** Per-call git timeout (ms). */
const GIT_TIMEOUT_MS = 5000;

/** Hard safety cap on the raw unified diff the adapter returns to core (ADR-0044) — a backstop above the
 *  ResponseComposer's display bounds so an enormous diff never reaches the Application layer. */
const MAX_DIFF_CHARS = 20_000;

/** Result of one read-only git invocation. */
export interface GitRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** True when the call exceeded the timeout. */
  timedOut: boolean;
  /** Spawn-level failure (e.g. git not installed). */
  failed: boolean;
}

/**
 * Runs git with an ARGUMENT ARRAY (never a shell string, never `shell: true`).
 * Injectable so tests can assert the exact argv and simulate timeouts/errors.
 */
export type GitRunner = (args: string[], opts: { cwd: string; timeoutMs: number }) => GitRunResult;

/** Mask token-like substrings / embedded URL credentials, then truncate stderr. */
export function sanitizeGitStderr(stderr: string): string {
  return stderr
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,}/g, '***')
    .replace(/\b(?:sk|pk|ghp|gho|ghs|xox[baprs])-[A-Za-z0-9_-]{8,}\b/g, '***')
    .replace(/(https?:\/\/)[^@\s/]+@/g, '$1***@')
    .slice(0, 300)
    .trim();
}

/** Default runner: argument-array `spawnSync`, no shell, cwd = repo root, timeout. */
export const defaultGitRunner: GitRunner = (args, { cwd, timeoutMs }) => {
  const res = spawnSync('git', args, { cwd, timeout: timeoutMs, encoding: 'utf8' });
  const timedOut = !!(res.error && (res.error as NodeJS.ErrnoException).code === 'ETIMEDOUT');
  return {
    code: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    timedOut,
    failed: !!res.error && !timedOut,
  };
};

function isDir(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Parse `git status --porcelain=v1 -b` output into a GitStatus. */
export function parsePorcelain(stdout: string): GitStatus {
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];
  let branch = '';
  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue;
    if (line.startsWith('## ')) {
      branch = parseBranchLine(line);
      continue;
    }
    if (line.length < 3) continue;
    const code = line.slice(0, 2);
    const rest = line.slice(3);
    const path = rest.includes(' -> ') ? (rest.split(' -> ')[1] ?? rest) : rest;
    if (code === '??') {
      untracked.push(path);
      continue;
    }
    const x = code.charAt(0);
    const y = code.charAt(1);
    if (x !== ' ' && x !== '?') staged.push(path);
    if (y !== ' ' && y !== '?') unstaged.push(path);
  }
  const clean = staged.length === 0 && unstaged.length === 0 && untracked.length === 0;
  return { clean, branch, staged, unstaged, untracked };
}

/** Extract the branch name from a porcelain `## ...` header line. */
function parseBranchLine(line: string): string {
  let b = line.slice(3).trim();
  b = b.replace(/^No commits yet on /, '').replace(/^Initial commit on /, '');
  if (b.startsWith('HEAD (no branch)')) return 'HEAD';
  b = b.split('...')[0] ?? b;
  b = b.split(' ')[0] ?? b;
  return b;
}

/**
 * Read-only git repository inspection over a local path (CAP-002, ADR-0023).
 * Git ≠ Workspace: operates purely on `rootPath`, imports no Workspace type, and
 * runs only read-only subcommands via argument-array spawn. No writes, no
 * worktree, no remote-URL exposure.
 */
export class LocalGitProvider implements GitProvider {
  readonly kind = 'local-git';

  constructor(private readonly run: GitRunner = defaultGitRunner) {}

  private exec(rootPath: string, args: string[]): GitRunResult {
    return this.run(args, { cwd: rootPath, timeoutMs: GIT_TIMEOUT_MS });
  }

  private failure(label: string, res: GitRunResult): Error {
    if (res.timedOut) return new Error(`git ${label} timed out after ${GIT_TIMEOUT_MS}ms`);
    if (res.failed) return new Error(`git ${label} could not run (is git installed?)`);
    return new Error(`git ${label} failed (exit ${res.code}): ${sanitizeGitStderr(res.stderr)}`);
  }

  async isRepository(rootPath: string): Promise<boolean> {
    if (!isDir(rootPath)) return false;
    const res = this.exec(rootPath, ['rev-parse', '--is-inside-work-tree']);
    return res.code === 0 && res.stdout.trim() === 'true';
  }

  async info(rootPath: string): Promise<RepositoryInfo> {
    if (!(await this.isRepository(rootPath))) {
      return { isRepository: false, rootPath, branch: '', detached: false };
    }
    const top = this.exec(rootPath, ['rev-parse', '--show-toplevel']);
    const resolvedRoot = top.code === 0 && top.stdout.trim() ? top.stdout.trim() : rootPath;

    // symbolic-ref resolves an attached branch even when unborn; failure ⇒ detached.
    const sym = this.exec(rootPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    const attached = sym.code === 0 && sym.stdout.trim() !== '';
    const branch = attached ? sym.stdout.trim() : '';

    const head = this.exec(rootPath, ['rev-parse', 'HEAD']);
    const headSha = head.code === 0 && head.stdout.trim() ? head.stdout.trim() : undefined;

    return {
      isRepository: true,
      rootPath: resolvedRoot,
      branch,
      ...(headSha ? { headSha } : {}),
      detached: !attached,
    };
  }

  async status(rootPath: string): Promise<GitStatus> {
    const res = this.exec(rootPath, ['status', '--porcelain=v1', '-b']);
    if (res.code !== 0) throw this.failure('status', res);
    return parsePorcelain(res.stdout);
  }

  /**
   * Read-only unified diff of TRACKED staged/unstaged changes vs HEAD (ADR-0044). READ-ONLY: runs only
   * `git diff` variants — never a mutating subcommand — via argument-array spawn (no shell, no user args,
   * no pathspec), `--no-ext-diff`/`--no-color`/`--no-pager`. For an unborn repository (no HEAD) it drops the
   * `HEAD` arg. `files` come from a bounded-safe `--name-only` read; `unified` is hard-capped at
   * MAX_DIFF_CHARS (a backstop above the composer's display bounds). Binary files appear as git's own marker
   * line ("Binary files … differ"), never binary content — no special dumping.
   */
  async diff(rootPath: string): Promise<GitDiff> {
    const base = ['--no-pager', 'diff', '--no-ext-diff', '--no-color'];
    // Unborn repository (no commits yet) has no HEAD → diff against the empty tree by dropping `HEAD`.
    const hasHead = this.exec(rootPath, ['rev-parse', '--verify', '--quiet', 'HEAD']).code === 0;
    const rev = hasHead ? ['HEAD'] : [];

    const nameRes = this.exec(rootPath, [...base, '--name-only', ...rev]);
    if (nameRes.code !== 0) throw this.failure('diff', nameRes);
    const files = nameRes.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const unifiedRes = this.exec(rootPath, [...base, ...rev]);
    if (unifiedRes.code !== 0) throw this.failure('diff', unifiedRes);
    const raw = unifiedRes.stdout;
    const truncated = raw.length > MAX_DIFF_CHARS;
    const unified = truncated ? raw.slice(0, MAX_DIFF_CHARS) : raw;
    return { files, unified, truncated };
  }
}
