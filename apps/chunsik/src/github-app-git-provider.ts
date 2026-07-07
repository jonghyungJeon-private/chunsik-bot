import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitMainSyncBlockedError, GitMainSyncUnverifiedError } from '@chunsik/core';
import type {
  GitBranchCleanupResult,
  GitCommitResult,
  GitDiff,
  GitMainSyncResult,
  GitProvider,
  GitPushResult,
  GitStatus,
  RepositoryInfo,
} from '@chunsik/core';
import type { GitRunResult, GitRunner } from '@chunsik/git-local';

/**
 * One-shot `GIT_ASKPASS` script (ADR-0061 Q3 / RC1). git invokes it when it needs HTTPS credentials: it returns the
 * username `x-access-token` and, for the password prompt, the token from the **child** process env `$GIT_APP_TOKEN`.
 * The script contains **no token literal** — the secret lives only in the child env, never in this file.
 */
const ASKPASS_SCRIPT = `#!/bin/sh
case "$1" in
  Username*) printf '%s' 'x-access-token' ;;
  *) printf '%s' "$GIT_APP_TOKEN" ;;
esac
`;

export interface GitHubAppGitProviderDeps {
  /**
   * Build a `LocalGitProvider` bound to a specific `GitRunner`. The composition root supplies
   * `(runner) => new LocalGitProvider(runner)`; injected so this decorator carries no dependency on the git-local
   * package's class and stays unit-testable.
   */
  makeLocalGit: (runner?: GitRunner) => GitProvider;
  /** Mint (or return a cached) short-lived installation token for the target repo. Adapter-local; never stored here. */
  tokenSource: () => Promise<string>;
}

/**
 * **Composition-root `GitProvider` decorator (CAP-002 App-auth git credentialing; ADR-0061 Q3/Q4/Q5).**
 *
 * Wraps an **unchanged** `LocalGitProvider`. Local operations delegate directly. The three remote-touching
 * operations (`pushApprovedCommit` / `getRemoteRefCommit` / `syncMainFastForward`) mint a short-lived installation
 * token **first (async)**, then run the inner op through a **one-shot `GIT_ASKPASS`** runner whose token lives ONLY
 * in the child process env — so the token never enters argv, a remote URL, `.git/config`, `.git`, logs, or this
 * object's persistent state. `process.env` is never mutated (a fresh child env per invocation), the per-invocation
 * temp helper is removed in a `finally`, and two concurrent invocations use distinct temp dirs + envs (RC3).
 *
 * This preserves ADR-0023/RC2: `LocalGitProvider` and the `GitProvider` port are unchanged — the credential is
 * supplied by this wrapper, outside git-local.
 */
export class GitHubAppGitProvider implements GitProvider {
  private readonly localGit: GitProvider;

  constructor(private readonly deps: GitHubAppGitProviderDeps) {
    this.localGit = deps.makeLocalGit();
  }

  get kind(): string {
    return this.localGit.kind;
  }

  // ── Local operations — delegated unchanged (no credential needed) ─────────────────────────────────────────
  isRepository(rootPath: string): Promise<boolean> {
    return this.localGit.isRepository(rootPath);
  }

  info(rootPath: string): Promise<RepositoryInfo> {
    return this.localGit.info(rootPath);
  }

  status(rootPath: string): Promise<GitStatus> {
    return this.localGit.status(rootPath);
  }

  diff(rootPath: string): Promise<GitDiff> {
    return this.localGit.diff(rootPath);
  }

  commitFiles(rootPath: string, files: string[], message: string): Promise<GitCommitResult> {
    return this.localGit.commitFiles(rootPath, files, message);
  }

  getLocalRefCommit(rootPath: string, branch: string): Promise<{ commitHash: string } | null> {
    return this.localGit.getLocalRefCommit(rootPath, branch);
  }

  isAncestor(rootPath: string, ancestor: string, descendant: string): Promise<boolean> {
    return this.localGit.isAncestor(rootPath, ancestor, descendant);
  }

  deleteMergedLocalBranch(
    rootPath: string,
    branch: string,
    expectedBranchCommit: string,
  ): Promise<GitBranchCleanupResult> {
    return this.localGit.deleteMergedLocalBranch(rootPath, branch, expectedBranchCommit);
  }

  // ── Remote-touching operations — App token supplied ephemerally via one-shot GIT_ASKPASS ─────────────────
  pushApprovedCommit(rootPath: string, remote: string, branch: string, commitHash: string): Promise<GitPushResult> {
    return this.withAppCredential((git) => git.pushApprovedCommit(rootPath, remote, branch, commitHash));
  }

  getRemoteRefCommit(rootPath: string, remote: string, branch: string): Promise<{ commitHash: string }> {
    return this.withAppCredential((git) => git.getRemoteRefCommit(rootPath, remote, branch));
  }

  async syncMainFastForward(
    rootPath: string,
    remote: string,
    branch: string,
    expectedRemoteCommit: string,
    expectedPreviousCommit: string,
  ): Promise<GitMainSyncResult> {
    try {
      return await this.withAppCredential((git) =>
        git.syncMainFastForward(rootPath, remote, branch, expectedRemoteCommit, expectedPreviousCommit),
      );
    } catch (err) {
      // A typed error from the inner LocalGitProvider (Blocked/Unverified) is preserved as-is. Any other failure
      // (credential mint / askpass setup) happened BEFORE the inner git ran → pre-mutation → Blocked ("not synced").
      if (err instanceof GitMainSyncBlockedError || err instanceof GitMainSyncUnverifiedError) throw err;
      throw new GitMainSyncBlockedError('git main sync: could not obtain App credentials; not synchronized');
    }
  }

  /**
   * Mint the token (async, BEFORE any git spawn), materialize a one-shot `GIT_ASKPASS` in a unique temp dir, run the
   * inner op through a `LocalGitProvider` whose `GitRunner` spawns git with the token in the **child** env only, then
   * remove the temp dir in a `finally` (best-effort — never masks the op's result). `process.env` is not mutated.
   */
  private async withAppCredential<T>(op: (git: GitProvider) => Promise<T>): Promise<T> {
    const token = await this.deps.tokenSource(); // may throw (pre-op) — propagated to the caller
    const dir = mkdtempSync(join(tmpdir(), 'quoky-askpass-'));
    const askpassPath = join(dir, 'askpass.sh');
    try {
      writeFileSync(askpassPath, ASKPASS_SCRIPT, { mode: 0o700 });
      const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        GIT_ASKPASS: askpassPath,
        GIT_APP_TOKEN: token,
        GIT_TERMINAL_PROMPT: '0',
      };
      const runner: GitRunner = (args, opts) => credentialedRun(args, opts, childEnv);
      return await op(this.deps.makeLocalGit(runner));
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup; never mask the operation's result/error
      }
    }
  }
}

/**
 * A `GitRunner` that mirrors git-local's `defaultGitRunner` (argument-array `spawnSync`, no shell, timeout, cwd) but
 * spawns with an explicit **child** env carrying the credential (ADR-0061 Q3). The token is never in argv.
 */
function credentialedRun(
  args: string[],
  opts: { cwd: string; timeoutMs: number },
  env: NodeJS.ProcessEnv,
): GitRunResult {
  const res = spawnSync('git', args, { cwd: opts.cwd, timeout: opts.timeoutMs, encoding: 'utf8', env });
  const timedOut = !!(res.error && (res.error as NodeJS.ErrnoException).code === 'ETIMEDOUT');
  return {
    code: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    timedOut,
    failed: !!res.error && !timedOut,
  };
}
