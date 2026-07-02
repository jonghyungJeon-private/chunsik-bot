import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import type { GitCommitResult, GitDiff, GitProvider, GitPushResult, GitStatus, RepositoryInfo } from '@chunsik/core';
import { isSafePushBranch, isSafePushRemote } from '@chunsik/core';

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

/**
 * Defensively validate + dedup commit pathspecs (ADR-0046, CA #7) — the provider does not trust caller path
 * strings blindly. Rejects absolute / `..` traversal / empty paths BEFORE any git command runs; deduplicates.
 */
export function assertSafeCommitPaths(files: string[]): string[] {
  if (files.length === 0) throw new Error('git commit requires at least one file');
  const seen = new Set<string>();
  const safe: string[] = [];
  for (const raw of files) {
    const p = typeof raw === 'string' ? raw.trim() : '';
    if (p.length === 0) throw new Error('git commit rejects an empty file path');
    if (/^([a-zA-Z]:[\\/]|[\\/])/.test(p)) throw new Error(`git commit rejects an absolute file path: ${p}`);
    if (p === '..' || p.split(/[\\/]/).includes('..')) throw new Error(`git commit rejects a traversal file path: ${p}`);
    if (!seen.has(p)) {
      seen.add(p);
      safe.push(p);
    }
  }
  return safe;
}

/**
 * Defensively validate a push target (ADR-0048, CA #4/#5) — conservative git ref rules (reusing core
 * `isSafePushRemote`/`isSafePushBranch`) + a SHA-shaped commitHash. Throws BEFORE any git command runs on
 * an unsafe target, so an unsafe branch never reaches argv as `HEAD:<branch>`.
 */
export function assertSafePushTarget(remote: string, branch: string, commitHash: string): void {
  if (!isSafePushRemote(remote)) throw new Error(`git push rejects an unsafe remote: ${remote}`);
  if (!isSafePushBranch(branch)) throw new Error(`git push rejects an unsafe branch: ${branch}`);
  if (!/^[0-9a-f]{7,40}$/i.test(commitHash)) throw new Error('git push rejects an invalid commitHash');
}

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
  let tracking: { upstream?: string; ahead?: number; behind?: number } = {};
  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue;
    if (line.startsWith('## ')) {
      branch = parseBranchLine(line);
      tracking = parseBranchTracking(line);
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
  return {
    clean,
    branch,
    staged,
    unstaged,
    untracked,
    ...(tracking.upstream !== undefined ? { upstream: tracking.upstream } : {}),
    ...(tracking.ahead !== undefined ? { ahead: tracking.ahead } : {}),
    ...(tracking.behind !== undefined ? { behind: tracking.behind } : {}),
  };
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
 * Parse the upstream tracking ref + ahead/behind from a porcelain `## <branch>...<remote>/<branch>
 * [ahead N, behind M]` header (Sprint 2z, ADR-0047). READ-ONLY: this data is ALREADY fetched by
 * `git status --porcelain=v1 -b` — no network fetch, no new git command. When the branch has no
 * `...upstream`, all three are `undefined` (distinct from `0` = in sync). Detached / unborn branches
 * have no upstream.
 */
function parseBranchTracking(line: string): { upstream?: string; ahead?: number; behind?: number } {
  const body = line.slice(3).trim();
  if (body.startsWith('HEAD (no branch)') || body.startsWith('No commits yet on ')) return {};
  const sep = body.indexOf('...');
  if (sep === -1) return {}; // no upstream
  const afterSep = body.slice(sep + 3);
  const bracket = afterSep.indexOf(' [');
  const upstream = (bracket === -1 ? afterSep : afterSep.slice(0, bracket)).trim();
  if (upstream.length === 0) return {};
  let ahead = 0;
  let behind = 0;
  if (bracket !== -1) {
    const track = afterSep.slice(bracket); // " [ahead N, behind M]" / " [ahead N]" / " [behind M]"
    const a = track.match(/ahead (\d+)/);
    const b = track.match(/behind (\d+)/);
    if (a?.[1]) ahead = Number(a[1]);
    if (b?.[1]) behind = Number(b[1]);
  }
  return { upstream, ahead, behind };
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

  /**
   * The ONLY mutating git operation (CAP-002, ADR-0046) — commit EXACTLY the given tracked files with
   * `message`. Argument-array only (no shell), NO separate `git add` (CA #1 — avoids a partial-stage side
   * effect that would persist on commit failure, since Sprint 2y has no rollback): a single
   * `git commit --only -m <message> -- <files>` of the exact pathspecs, then `rev-parse HEAD` for the sha.
   * Paths are validated + de-duped first (CA #7) → throws with NO git command run on an unsafe path. Never
   * runs add/push/reset/checkout/stash/branch/tag/merge/rebase. Approval gating is the manager's job.
   */
  async commitFiles(rootPath: string, files: string[], message: string): Promise<GitCommitResult> {
    const safeFiles = assertSafeCommitPaths(files); // throws (no git run) on absolute/traversal/empty
    // `--only` commits exactly these pathspecs from the working tree, ignoring other index entries; the
    // message is a single argv element (never shell-interpolated); `--` separates the pathspecs.
    const commitRes = this.exec(rootPath, ['--no-pager', 'commit', '--only', '-m', message, '--', ...safeFiles]);
    if (commitRes.code !== 0) throw this.failure('commit', commitRes);
    const headRes = this.exec(rootPath, ['--no-pager', 'rev-parse', 'HEAD']);
    if (headRes.code !== 0) throw this.failure('commit', headRes);
    return { commitHash: headRes.stdout.trim(), committedFiles: safeFiles, message };
  }

  /**
   * The SECOND mutating git operation (CAP-002, ADR-0048) — the first REMOTE mutation. Pushes EXACTLY the
   * current HEAD to `<remote> HEAD:<branch>`. Argument-array only (no shell); a single `git --no-pager push
   * <remote> HEAD:<branch>` — NEVER `--force`/`-f`/`--tags`/`--all`/`-u`/`--set-upstream`/bare `git push`/an
   * arbitrary refspec. The target is conservatively validated first (CA #4/#5) → throws with NO git command
   * run on an unsafe remote/branch/hash. Returns the provider-reported target (NOT independent remote
   * verification). Approval gating is the manager's job.
   */
  async pushApprovedCommit(rootPath: string, remote: string, branch: string, commitHash: string): Promise<GitPushResult> {
    assertSafePushTarget(remote, branch, commitHash); // throws (no git run) on an unsafe target
    // exactly one refspec argv element `HEAD:<branch>` (never a shell string); pushes the current HEAD.
    const res = this.exec(rootPath, ['--no-pager', 'push', remote, `HEAD:${branch}`]);
    if (res.code !== 0) throw this.failure('push', res);
    return { remote, branch, upstreamRef: `${remote}/${branch}`, commitHash };
  }
}
