import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LocalGitProvider,
  parsePorcelain,
  sanitizeGitStderr,
  type GitRunner,
  type GitRunResult,
} from './index';
import { BranchCleanupBlockedError, GitMainSyncBlockedError } from '@chunsik/core';

const created: string[] = [];
afterAll(() => {
  for (const d of created) rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

/** A temp git repo on branch `main` with one optional commit. */
function makeRepo(withCommit = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'chunsik-git-'));
  created.push(dir);
  git(dir, 'init', '-q');
  git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main'); // deterministic branch name
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'Tester');
  git(dir, 'config', 'commit.gpgsign', 'false');
  if (withCommit) {
    writeFileSync(join(dir, 'README.md'), '# hi\n');
    git(dir, 'add', 'README.md');
    git(dir, 'commit', '-q', '-m', 'init');
  }
  return dir;
}

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'chunsik-nogit-'));
  created.push(d);
  return d;
}

/** Records argv for the argument-array assertion. */
function recordingRunner(result: GitRunResult): { runner: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: GitRunner = (args) => {
    calls.push(args);
    return result;
  };
  return { runner, calls };
}

const provider = new LocalGitProvider();

describe('LocalGitProvider — read-only git inspection (CAP-002, ADR-0023)', () => {
  it('isRepository: true inside a repo, false for a plain dir', async () => {
    expect(await provider.isRepository(makeRepo())).toBe(true);
    expect(await provider.isRepository(tempDir())).toBe(false);
    expect(await provider.isRepository('/definitely/not/here/xyz')).toBe(false);
  });

  it('info: returns not-a-repository for a plain dir', async () => {
    const info = await provider.info(tempDir());
    expect(info.isRepository).toBe(false);
    expect(info.branch).toBe('');
    expect(info.detached).toBe(false);
  });

  it('info: branch + headSha for a normal repo', async () => {
    const dir = makeRepo();
    const info = await provider.info(dir);
    expect(info.isRepository).toBe(true);
    expect(info.branch).toBe('main');
    expect(info.detached).toBe(false);
    expect(info.headSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('info: detached HEAD is reported (detached=true, branch empty)', async () => {
    const dir = makeRepo();
    const sha = git(dir, 'rev-parse', 'HEAD').trim();
    git(dir, 'checkout', '-q', sha);
    const info = await provider.info(dir);
    expect(info.detached).toBe(true);
    expect(info.branch).toBe('');
    expect(info.headSha).toBe(sha);
  });

  it('status: clean repo', async () => {
    const status = await provider.status(makeRepo());
    expect(status.clean).toBe(true);
    expect(status.branch).toBe('main');
    expect(status.untracked).toEqual([]);
  });

  it('status: untracked + unstaged + staged files', async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, 'new.txt'), 'x'); // untracked
    writeFileSync(join(dir, 'README.md'), '# changed\n'); // unstaged modification
    writeFileSync(join(dir, 'staged.txt'), 'y');
    git(dir, 'add', 'staged.txt'); // staged add
    const status = await provider.status(dir);
    expect(status.clean).toBe(false);
    expect(status.untracked).toContain('new.txt');
    expect(status.unstaged).toContain('README.md');
    expect(status.staged).toContain('staged.txt');
  });

  it('does NOT expose remote URLs / credentials in info', async () => {
    const dir = makeRepo();
    git(dir, 'remote', 'add', 'origin', 'https://user:secrettoken@github.com/x/y.git');
    const info = await provider.info(dir);
    const blob = JSON.stringify(info);
    expect(blob).not.toContain('secrettoken');
    expect(blob).not.toContain('github.com');
    expect(Object.keys(info)).not.toContain('remote');
    expect(Object.keys(info)).not.toContain('url');
  });

  it('uses argument-array spawn (never a shell string)', async () => {
    const { runner, calls } = recordingRunner({
      code: 0,
      stdout: 'true',
      stderr: '',
      timedOut: false,
      failed: false,
    });
    // isDir guard would short-circuit a fake path, so use a real repo dir.
    await new LocalGitProvider(runner).isRepository(makeRepo());
    expect(calls.length).toBeGreaterThan(0);
    expect(Array.isArray(calls[0])).toBe(true);
    expect(calls[0]).toEqual(['rev-parse', '--is-inside-work-tree']);
  });

  it('status: surfaces a sanitized error on timeout and on spawn failure', async () => {
    const timeout = new LocalGitProvider(() => ({
      code: null,
      stdout: '',
      stderr: '',
      timedOut: true,
      failed: false,
    }));
    await expect(timeout.status(makeRepo())).rejects.toThrow(/timed out/);

    const broken = new LocalGitProvider(() => ({
      code: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      failed: true,
    }));
    await expect(broken.status(makeRepo())).rejects.toThrow(/could not run/);

    const failed = new LocalGitProvider(() => ({
      code: 128,
      stdout: '',
      stderr: 'fatal: not a git repository',
      timedOut: false,
      failed: false,
    }));
    await expect(failed.status(makeRepo())).rejects.toThrow(/exit 128/);
  });
});

describe('LocalGitProvider.diff — read-only diff extension (CAP-002, ADR-0044)', () => {
  const okRun = (stdout: string): GitRunResult => ({ code: 0, stdout, stderr: '', timedOut: false, failed: false });

  it('unified shows a tracked modification; files lists the path; not truncated', async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, 'README.md'), '# changed content here\n');
    const diff = await provider.diff(dir);
    expect(diff.files).toContain('README.md');
    expect(diff.unified).toContain('README.md');
    expect(diff.unified).toContain('changed content here');
    expect(diff.truncated).toBe(false);
  });

  it('untracked file is NOT in the unified diff (tracked changes only); status surfaces it', async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, 'brand-new.txt'), 'UNTRACKED_SECRET_CONTENT\n'); // untracked
    const diff = await provider.diff(dir);
    expect(diff.unified).not.toContain('UNTRACKED_SECRET_CONTENT');
    expect(diff.files).not.toContain('brand-new.txt');
    const status = await provider.status(dir);
    expect(status.untracked).toContain('brand-new.txt');
  });

  it('binary file change shows git’s marker only, never binary content', async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([0, 1, 2, 3, 0, 255, 254, 5]));
    git(dir, 'add', 'blob.bin');
    git(dir, 'commit', '-q', '-m', 'add binary');
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([255, 254, 253, 0, 9, 8, 7]));
    const diff = await provider.diff(dir);
    expect(diff.unified).toMatch(/Binary files/);
    expect(diff.files).toContain('blob.bin');
  });

  it('oversized unified output is hard-capped and flagged truncated', async () => {
    const huge = 'x'.repeat(25_000);
    const runner: GitRunner = (args) => {
      if (args.includes('--verify')) return okRun(''); // HEAD exists
      if (args.includes('--name-only')) return okRun('big.ts\n');
      return okRun(huge);
    };
    const diff = await new LocalGitProvider(runner).diff(makeRepo());
    expect(diff.truncated).toBe(true);
    expect(diff.unified.length).toBeLessThanOrEqual(20_000);
    expect(diff.files).toEqual(['big.ts']);
  });

  it('uses argument-array read-only flags with HEAD; never a mutating subcommand', async () => {
    const calls: string[][] = [];
    const runner: GitRunner = (args) => {
      calls.push(args);
      return okRun(''); // rev-parse --verify HEAD → code 0 (HEAD exists)
    };
    await new LocalGitProvider(runner).diff(makeRepo());
    expect(calls).toContainEqual(['--no-pager', 'diff', '--no-ext-diff', '--no-color', '--name-only', 'HEAD']);
    expect(calls).toContainEqual(['--no-pager', 'diff', '--no-ext-diff', '--no-color', 'HEAD']);
    for (const c of calls) {
      for (const forbidden of ['add', 'commit', 'push', 'reset', 'checkout', 'stash', 'branch', 'merge', 'rebase', 'tag']) {
        expect(c).not.toContain(forbidden);
      }
    }
  });

  it('unborn repository (no HEAD) drops the HEAD arg', async () => {
    const calls: string[][] = [];
    const runner: GitRunner = (args) => {
      calls.push(args);
      if (args.includes('--verify')) return { code: 1, stdout: '', stderr: '', timedOut: false, failed: false }; // no HEAD
      return okRun('');
    };
    await new LocalGitProvider(runner).diff(tempDir());
    expect(calls).toContainEqual(['--no-pager', 'diff', '--no-ext-diff', '--no-color', '--name-only']);
    expect(calls).toContainEqual(['--no-pager', 'diff', '--no-ext-diff', '--no-color']);
  });

  it('surfaces a sanitized error when the diff command fails', async () => {
    const failed = new LocalGitProvider((args) =>
      args.includes('--verify')
        ? okRun('')
        : { code: 128, stdout: '', stderr: 'fatal: bad revision', timedOut: false, failed: false },
    );
    await expect(failed.diff(makeRepo())).rejects.toThrow(/exit 128/);
  });
});

describe('LocalGitProvider.commitFiles — the first git mutation (CAP-002, ADR-0046)', () => {
  /** A runner that returns code 0 for everything and a fixed sha for `rev-parse HEAD`. */
  const commitRunner = (headSha = 'a'.repeat(40)): { runner: GitRunner; calls: string[][] } => {
    const calls: string[][] = [];
    const runner: GitRunner = (args) => {
      calls.push(args);
      if (args.includes('rev-parse')) return { code: 0, stdout: headSha + '\n', stderr: '', timedOut: false, failed: false };
      return { code: 0, stdout: '', stderr: '', timedOut: false, failed: false };
    };
    return { runner, calls };
  };

  it('commits EXACTLY the given tracked file, leaving other changes uncommitted; returns the HEAD sha (CA 44)', async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, 'other.txt'), 'z');
    git(dir, 'add', 'other.txt');
    git(dir, 'commit', '-q', '-m', 'add other');
    writeFileSync(join(dir, 'README.md'), '# changed\n'); // tracked modification — the candidate
    writeFileSync(join(dir, 'other.txt'), 'zz'); // a DIFFERENT tracked modification — must NOT be committed
    const res = await provider.commitFiles(dir, ['README.md'], 'chore: update readme');
    expect(res.commitHash).toMatch(/^[0-9a-f]{40}$/);
    expect(res.committedFiles).toEqual(['README.md']);
    expect(res.message).toBe('chore: update readme');
    const changed = git(dir, 'show', '--name-only', '--pretty=format:', 'HEAD').trim().split('\n').filter(Boolean);
    expect(changed).toEqual(['README.md']); // the new commit touched only README.md
    expect(git(dir, 'status', '--porcelain=v1', '--', 'other.txt')).toContain('other.txt'); // other.txt still pending
  });

  it('runs argv `commit --only -m <msg> -- <files>` then `rev-parse HEAD`; msg is one argv element; `--` precedes paths; NO git add; NO push/reset/checkout/stash/branch/tag/merge/rebase (CA 45–49, 75–82)', async () => {
    const { runner, calls } = commitRunner();
    await new LocalGitProvider(runner).commitFiles('/repo', ['a.ts', 'b.ts'], 'fix: thing with spaces');
    expect(calls[0]).toEqual(['--no-pager', 'commit', '--only', '-m', 'fix: thing with spaces', '--', 'a.ts', 'b.ts']);
    expect(calls[1]).toEqual(['--no-pager', 'rev-parse', 'HEAD']);
    expect(calls[0]?.filter((a) => a === 'fix: thing with spaces')).toHaveLength(1); // message is a single argv element
    const dd = calls[0]?.indexOf('--') ?? -1;
    expect(dd).toBeGreaterThan(-1);
    expect(calls[0]?.slice(dd + 1)).toEqual(['a.ts', 'b.ts']); // pathspecs after `--`
    for (const c of calls) {
      for (const forbidden of ['add', 'push', 'reset', 'checkout', 'stash', 'branch', 'merge', 'rebase', 'tag', 'pull', 'fetch']) {
        expect(c).not.toContain(forbidden);
      }
    }
  });

  it('rejects an unsafe path (absolute / traversal / empty) BEFORE any git command runs (CA 50)', async () => {
    for (const files of [['/etc/passwd'], ['../secret'], ['a/../../x'], ['']]) {
      const { runner, calls } = commitRunner();
      await expect(new LocalGitProvider(runner).commitFiles('/repo', files, 'msg')).rejects.toThrow();
      expect(calls.length, files.join()).toBe(0); // no git ran
    }
  });

  it('de-duplicates repeated pathspecs (CA #7)', async () => {
    const { runner, calls } = commitRunner();
    await new LocalGitProvider(runner).commitFiles('/repo', ['a.ts', 'a.ts'], 'msg');
    const dd = calls[0]?.indexOf('--') ?? -1;
    expect(calls[0]?.slice(dd + 1)).toEqual(['a.ts']);
  });

  it('surfaces a sanitized failure when the commit fails — no fake success', async () => {
    const failing: GitRunner = (args) =>
      args.includes('commit')
        ? { code: 1, stdout: '', stderr: 'nothing to commit', timedOut: false, failed: false }
        : { code: 0, stdout: 'sha', stderr: '', timedOut: false, failed: false };
    await expect(new LocalGitProvider(failing).commitFiles('/repo', ['a.ts'], 'msg')).rejects.toThrow(/exit 1/);
  });
});

describe('LocalGitProvider.pushApprovedCommit — the first REMOTE mutation (CAP-002, ADR-0048)', () => {
  /** A recording runner that succeeds (code 0) for the single push call. */
  const pushRunner = (): { runner: GitRunner; calls: string[][] } => {
    const calls: string[][] = [];
    const runner: GitRunner = (args) => {
      calls.push(args);
      return { code: 0, stdout: '', stderr: '', timedOut: false, failed: false };
    };
    return { runner, calls };
  };

  it('runs exactly `push <remote> HEAD:<branch>` (one refspec argv element), argument-array only; NEVER --force/-f/--tags/--all/-u/--set-upstream/bare-push or any other mutating subcommand; returns the provider-reported approved target (CA 59–64, 79–82, 114–125)', async () => {
    const { runner, calls } = pushRunner();
    const sha = 'a'.repeat(40);
    const res = await new LocalGitProvider(runner).pushApprovedCommit('/repo', 'origin', 'main', sha);
    expect(calls).toHaveLength(1); // exactly one git command
    expect(Array.isArray(calls[0])).toBe(true); // argument-array, never a shell string
    expect(calls[0]).toEqual(['--no-pager', 'push', 'origin', 'HEAD:main']); // the current HEAD → approved branch
    expect(calls[0]?.filter((a) => a.startsWith('HEAD:'))).toEqual(['HEAD:main']); // exactly one refspec element
    for (const forbidden of [
      '--force', '-f', '--force-with-lease', '--tags', '--all', '-u', '--set-upstream', '--mirror', '--delete',
      'add', 'commit', 'reset', 'checkout', 'stash', 'branch', 'merge', 'rebase', 'tag', 'pull', 'fetch',
    ]) {
      expect(calls[0], forbidden).not.toContain(forbidden);
    }
    expect(res).toEqual({ remote: 'origin', branch: 'main', upstreamRef: 'origin/main', commitHash: sha }); // provider-reported target
  });

  it('rejects an unsafe remote / branch / commitHash BEFORE any git command runs — an unsafe branch never reaches argv as HEAD:<branch> (CA 65–67)', async () => {
    const bad: Array<[string, string, string]> = [
      ['--upload-pack=evil', 'main', 'a'.repeat(40)], // unsafe remote (leading-dash option injection)
      ['origin', 'evil:ref', 'a'.repeat(40)], // unsafe branch (extra refspec colon)
      ['origin', 'main', 'not-a-sha'], // invalid (non-SHA) commitHash
    ];
    for (const [remote, branch, hash] of bad) {
      const { runner, calls } = pushRunner();
      await expect(new LocalGitProvider(runner).pushApprovedCommit('/repo', remote, branch, hash)).rejects.toThrow();
      expect(calls.length, `${remote}|${branch}|${hash}`).toBe(0); // NO git command ran
      expect(calls.flat(), branch).not.toContain(`HEAD:${branch}`); // the unsafe branch never reached argv
    }
  });

  it('allows a slashed branch → argv `push origin HEAD:feature/x`, upstream origin/feature/x (CA 68)', async () => {
    const { runner, calls } = pushRunner();
    const res = await new LocalGitProvider(runner).pushApprovedCommit('/repo', 'origin', 'feature/x', 'b'.repeat(40));
    expect(calls[0]).toEqual(['--no-pager', 'push', 'origin', 'HEAD:feature/x']);
    expect(res.branch).toBe('feature/x');
    expect(res.upstreamRef).toBe('origin/feature/x');
  });

  it('rejects an unsafe branch (colon / whitespace / control / leading-dash / leading-slash / ".." / "@{" / ".lock" / trailing-slash / "//" / ~^?*[\\) — no git runs (CA 69–74)', async () => {
    for (const branch of ['a:b', 'a b', 'a\tb', '-lead', '/lead', 'a..b', 'a@{0}', 'feat.lock', 'trail/', 'a//b', 'a~b', 'a^b', 'a?b', 'a*b', 'a[b', 'a\\b', '']) {
      const { runner, calls } = pushRunner();
      await expect(new LocalGitProvider(runner).pushApprovedCommit('/repo', 'origin', branch, 'c'.repeat(40))).rejects.toThrow(/unsafe branch/);
      expect(calls.length, JSON.stringify(branch)).toBe(0);
    }
  });

  it('rejects an unsafe remote (leading-dash / colon / slash / whitespace / control / empty) — no git runs (CA 75–78)', async () => {
    for (const remote of ['-force', 'ori:gin', 'ori/gin', 'ori gin', 'ori\tgin', '']) {
      const { runner, calls } = pushRunner();
      await expect(new LocalGitProvider(runner).pushApprovedCommit('/repo', remote, 'main', 'd'.repeat(40))).rejects.toThrow(/unsafe remote/);
      expect(calls.length, JSON.stringify(remote)).toBe(0);
    }
  });

  it('surfaces a sanitized failure when the push fails — no fake success, credentials masked', async () => {
    const failing: GitRunner = (args) =>
      args.includes('push')
        ? { code: 1, stdout: '', stderr: 'fatal: unable to access https://user:sekrettoken@github.com/x/y.git', timedOut: false, failed: false }
        : { code: 0, stdout: '', stderr: '', timedOut: false, failed: false };
    const err: Error = await new LocalGitProvider(failing)
      .pushApprovedCommit('/repo', 'origin', 'main', 'e'.repeat(40))
      .then(() => { throw new Error('expected push to reject'); }, (e: Error) => e);
    expect(err.message).toMatch(/git push failed \(exit 1\)/);
    expect(err.message).not.toContain('sekrettoken');
  });
});

describe('parsePorcelain', () => {
  it('parses branch, staged, unstaged, untracked', () => {
    const out = parsePorcelain(['## main...origin/main [ahead 1]', 'M  a.ts', ' M b.ts', '?? c.ts'].join('\n'));
    expect(out.branch).toBe('main');
    expect(out.staged).toEqual(['a.ts']);
    expect(out.unstaged).toEqual(['b.ts']);
    expect(out.untracked).toEqual(['c.ts']);
    expect(out.clean).toBe(false);
  });

  it('reports detached "(no branch)" and clean trees', () => {
    expect(parsePorcelain('## HEAD (no branch)').branch).toBe('HEAD');
    expect(parsePorcelain('## main').clean).toBe(true);
  });

  // ── Sprint 2z (ADR-0047): upstream / ahead / behind from the `-b` header (read-only, no fetch) ──
  it('parses upstream + ahead + behind from "## main...origin/main [ahead 2, behind 1]"', () => {
    const out = parsePorcelain('## main...origin/main [ahead 2, behind 1]');
    expect(out.upstream).toBe('origin/main');
    expect(out.ahead).toBe(2);
    expect(out.behind).toBe(1);
  });

  it('in-sync upstream "## main...origin/main" → upstream set, ahead 0, behind 0', () => {
    const out = parsePorcelain('## main...origin/main');
    expect(out.upstream).toBe('origin/main');
    expect(out.ahead).toBe(0);
    expect(out.behind).toBe(0);
  });

  it('ahead-only "## main...origin/main [ahead 3]" → ahead 3, behind 0', () => {
    const out = parsePorcelain('## main...origin/main [ahead 3]');
    expect(out.ahead).toBe(3);
    expect(out.behind).toBe(0);
  });

  it('no upstream "## main" → upstream/ahead/behind all undefined (NOT 0) (CA 12)', () => {
    const out = parsePorcelain('## main');
    expect(out.upstream).toBeUndefined();
    expect(out.ahead).toBeUndefined();
    expect(out.behind).toBeUndefined();
  });

  it('detached / unborn have no upstream', () => {
    expect(parsePorcelain('## HEAD (no branch)').upstream).toBeUndefined();
    expect(parsePorcelain('## No commits yet on main').upstream).toBeUndefined();
  });

  it('a slashed upstream branch "## wip...origin/feature/x [ahead 1]" keeps the full upstream', () => {
    const out = parsePorcelain('## wip...origin/feature/x [ahead 1]');
    expect(out.upstream).toBe('origin/feature/x');
    expect(out.ahead).toBe(1);
    expect(out.behind).toBe(0);
  });
});

describe('LocalGitProvider.status argv stays read-only (Sprint 2z, ADR-0047, CA 82)', () => {
  it('status uses exactly `status --porcelain=v1 -b`; no mutating subcommand', async () => {
    const calls: string[][] = [];
    const runner: GitRunner = (args) => {
      calls.push(args);
      return { code: 0, stdout: '## main...origin/main [ahead 1]\n', stderr: '', timedOut: false, failed: false };
    };
    const status = await new LocalGitProvider(runner).status('/repo');
    expect(calls).toContainEqual(['status', '--porcelain=v1', '-b']);
    expect(status.upstream).toBe('origin/main');
    for (const c of calls) {
      for (const forbidden of ['push', 'commit', 'add', 'reset', 'checkout', 'stash', 'branch', 'merge', 'rebase', 'tag']) {
        expect(c).not.toContain(forbidden);
      }
    }
  });
});

describe('sanitizeGitStderr', () => {
  it('masks embedded URL credentials and truncates', () => {
    const masked = sanitizeGitStderr('fatal: https://user:abcd1234token@github.com/x/y.git not found');
    expect(masked).not.toContain('abcd1234token');
    expect(masked).toContain('***@');
  });
});

describe('LocalGitProvider — post-merge local main sync (CAP-002, ADR-0058, Sprint 3h)', () => {
  /** A remote repo (on main, one commit A) + a clone; returns paths and commit A. */
  function makeRemoteAndClone(): { remote: string; local: string; A: string } {
    const remote = makeRepo(); // main @ A ("init")
    const A = git(remote, 'rev-parse', 'HEAD').trim();
    const parent = mkdtempSync(join(tmpdir(), 'chunsik-clone-'));
    created.push(parent);
    const local = join(parent, 'local');
    git(parent, 'clone', '-q', remote, 'local');
    git(local, 'config', 'user.email', 't@example.com');
    git(local, 'config', 'user.name', 'Tester');
    git(local, 'config', 'commit.gpgsign', 'false');
    return { remote, local, A };
  }
  /** Add commit B to the remote's main; returns B. */
  function commitOnRemoteMain(remote: string): string {
    writeFileSync(join(remote, 'f2.txt'), 'x\n');
    git(remote, 'add', 'f2.txt');
    git(remote, 'commit', '-q', '-m', 'B');
    return git(remote, 'rev-parse', 'HEAD').trim();
  }

  it('getRemoteRefCommit reads the remote main tip and does NOT move local main', async () => {
    const { remote, local, A } = makeRemoteAndClone();
    const B = commitOnRemoteMain(remote);
    const observed = await provider.getRemoteRefCommit(local, 'origin', 'main');
    expect(observed.commitHash).toBe(B);
    expect(git(local, 'rev-parse', 'refs/heads/main').trim()).toBe(A); // unchanged (read-only)
  });

  it('getLocalRefCommit returns the local main tip, or null for a nonexistent branch', async () => {
    const { local, A } = makeRemoteAndClone();
    expect((await provider.getLocalRefCommit(local, 'main'))?.commitHash).toBe(A);
    expect(await provider.getLocalRefCommit(local, 'nope-branch')).toBeNull();
  });

  it('checked-out-main mode: fast-forwards the checked-out main + working tree (workingTreeUpdated true)', async () => {
    const { remote, local, A } = makeRemoteAndClone();
    const B = commitOnRemoteMain(remote);
    const r = await provider.syncMainFastForward(local, 'origin', 'main', B, A);
    expect(r.syncMode).toBe('checked-out-main');
    expect(r.workingTreeUpdated).toBe(true);
    expect(r.alreadyUpToDate).toBe(false);
    expect(r.syncedCommitHash).toBe(B);
    expect(r.previousMainCommit).toBe(A);
    expect(git(local, 'rev-parse', 'refs/heads/main').trim()).toBe(B); // local main moved to B
  });

  it('ref-only mode: fast-forwards refs/heads/main only, leaving the current checkout untouched (workingTreeUpdated false)', async () => {
    const { remote, local, A } = makeRemoteAndClone();
    const B = commitOnRemoteMain(remote);
    git(local, 'checkout', '-q', '-b', 'feature'); // current branch != main
    const r = await provider.syncMainFastForward(local, 'origin', 'main', B, A);
    expect(r.syncMode).toBe('ref-only');
    expect(r.workingTreeUpdated).toBe(false);
    expect(r.syncedCommitHash).toBe(B);
    expect(git(local, 'rev-parse', 'refs/heads/main').trim()).toBe(B); // local main ref moved
    expect(git(local, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('feature'); // checkout unchanged
  });

  it('non-fast-forward → GitMainSyncBlockedError (no force/reset), local main untouched', async () => {
    const { remote, local, A } = makeRemoteAndClone();
    const B = commitOnRemoteMain(remote);
    // diverge local main to C (a child of A that is not an ancestor of B)
    writeFileSync(join(local, 'local-only.txt'), 'y\n');
    git(local, 'add', 'local-only.txt');
    git(local, 'commit', '-q', '-m', 'C');
    const C = git(local, 'rev-parse', 'refs/heads/main').trim();
    await expect(provider.syncMainFastForward(local, 'origin', 'main', B, C)).rejects.toBeInstanceOf(GitMainSyncBlockedError);
    expect(git(local, 'rev-parse', 'refs/heads/main').trim()).toBe(C); // unchanged
  });

  it('fetched-tip mismatch (expected != actual remote) → GitMainSyncBlockedError before any ref move', async () => {
    const { remote, local, A } = makeRemoteAndClone();
    commitOnRemoteMain(remote);
    const wrong = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    await expect(provider.syncMainFastForward(local, 'origin', 'main', wrong, A)).rejects.toBeInstanceOf(GitMainSyncBlockedError);
    expect(git(local, 'rev-parse', 'refs/heads/main').trim()).toBe(A);
  });

  it('CAS mismatch (local main != expectedPreviousCommit) → GitMainSyncBlockedError', async () => {
    const { remote, local } = makeRemoteAndClone();
    const B = commitOnRemoteMain(remote);
    const wrongPrev = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    await expect(provider.syncMainFastForward(local, 'origin', 'main', B, wrongPrev)).rejects.toBeInstanceOf(GitMainSyncBlockedError);
  });

  it('already up to date (no new remote commit) → alreadyUpToDate, no ref move', async () => {
    const { local, A } = makeRemoteAndClone();
    const r = await provider.syncMainFastForward(local, 'origin', 'main', A, A);
    expect(r.alreadyUpToDate).toBe(true);
    expect(r.workingTreeUpdated).toBe(false);
    expect(r.syncedCommitHash).toBe(A);
    expect(git(local, 'rev-parse', 'refs/heads/main').trim()).toBe(A);
  });

  it('argv guard: sync uses ls-remote / fetch / merge --ff-only|update-ref only — NEVER --force/-f/reset --hard/push/branch delete', async () => {
    const { remote, local, A } = makeRemoteAndClone();
    const B = commitOnRemoteMain(remote);
    // Wrap the real runner to capture every argv the sync emits.
    const seen: string[][] = [];
    const recording: GitRunner = (args, opts) => {
      seen.push(args);
      // delegate to a real spawn so behavior is real
      const r = spawnSync('git', args, { cwd: opts.cwd, timeout: opts.timeoutMs, encoding: 'utf8' });
      return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', timedOut: false, failed: !!r.error };
    };
    await new LocalGitProvider(recording).getRemoteRefCommit(local, 'origin', 'main');
    await new LocalGitProvider(recording).syncMainFastForward(local, 'origin', 'main', B, A);
    const flat = seen.map((a) => a.join(' '));
    for (const bad of ['--force', ' -f', 'reset --hard', 'reset', 'push', 'branch -d', 'branch -D', '--hard']) {
      expect(flat.some((c) => c.includes(bad)), bad).toBe(false);
    }
    expect(flat.some((c) => c.includes('ls-remote'))).toBe(true);
    expect(flat.some((c) => c.startsWith('--no-pager fetch') || c.includes(' fetch '))).toBe(true);
    expect(flat.some((c) => c.includes('merge --ff-only') || c.includes('update-ref'))).toBe(true);
  });
});

describe('LocalGitProvider — post-merge local branch cleanup (CAP-002, ADR-0059, Sprint 3i)', () => {
  /** A repo with main @ M (merge commit) and a merged feature branch @ F (F ancestor of M). */
  function makeRepoWithMergedFeature(): { dir: string; main: string; feature: string; F: string } {
    const dir = makeRepo(); // main @ A
    git(dir, 'checkout', '-q', '-b', 'feature');
    writeFileSync(join(dir, 'feat.txt'), 'x\n');
    git(dir, 'add', 'feat.txt');
    git(dir, 'commit', '-q', '-m', 'F');
    const F = git(dir, 'rev-parse', 'refs/heads/feature').trim();
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'merge', '--no-ff', '-m', 'merge feature', 'feature');
    const main = git(dir, 'rev-parse', 'refs/heads/main').trim();
    return { dir, main, feature: F, F };
  }

  it('isAncestor: merged feature tip is an ancestor of main; main is not an ancestor of the feature', async () => {
    const { dir, main, F } = makeRepoWithMergedFeature();
    expect(await provider.isAncestor(dir, F, main)).toBe(true);
    expect(await provider.isAncestor(dir, main, F)).toBe(false);
  });

  it('deleteMergedLocalBranch: CAS-deletes the local feature ref (update-ref -d), leaving main + checkout untouched', async () => {
    const { dir, main, F } = makeRepoWithMergedFeature(); // currently on main
    const r = await provider.deleteMergedLocalBranch(dir, 'feature', F);
    expect(r.deleted).toBe(true);
    expect(r.alreadyAbsent).toBe(false);
    expect(r.deletedCommitHash).toBe(F);
    const gone = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/feature'], { cwd: dir, encoding: 'utf8' });
    expect(gone.status).not.toBe(0); // feature deleted
    expect(git(dir, 'rev-parse', 'refs/heads/main').trim()).toBe(main); // main untouched
  });

  it('does NOT require HEAD==main and does not switch checkout (CA 25/26)', async () => {
    const { dir, F } = makeRepoWithMergedFeature();
    git(dir, 'checkout', '-q', '-b', 'other'); // current branch != main, != feature
    await provider.deleteMergedLocalBranch(dir, 'feature', F);
    expect(git(dir, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('other'); // checkout unchanged
    const check = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/feature'], { cwd: dir, encoding: 'utf8' });
    expect(check.status).not.toBe(0); // feature deleted
  });

  it('CAS mismatch (expectedBranchCommit != actual tip) → GitMainSync? no — BranchCleanupBlockedError, branch NOT deleted', async () => {
    const { dir, F } = makeRepoWithMergedFeature();
    // add another commit to feature so its tip != F
    git(dir, 'checkout', '-q', 'feature');
    writeFileSync(join(dir, 'feat2.txt'), 'y\n');
    git(dir, 'add', 'feat2.txt');
    git(dir, 'commit', '-q', '-m', 'F2');
    git(dir, 'checkout', '-q', 'main');
    await expect(provider.deleteMergedLocalBranch(dir, 'feature', F)).rejects.toBeInstanceOf(BranchCleanupBlockedError);
    expect(git(dir, 'rev-parse', '--verify', '--quiet', 'refs/heads/feature').trim()).not.toBe(''); // still present
  });

  it('absent target branch → BranchCleanupBlockedError (pre-delete; manager handles absent as idempotent upstream)', async () => {
    const { dir, F } = makeRepoWithMergedFeature();
    await expect(provider.deleteMergedLocalBranch(dir, 'no-such-branch', F)).rejects.toBeInstanceOf(BranchCleanupBlockedError);
  });

  it('rejects main / unsafe branch defensively (never deletes main)', async () => {
    const { dir, main } = makeRepoWithMergedFeature();
    await expect(provider.deleteMergedLocalBranch(dir, 'main', main)).rejects.toBeInstanceOf(BranchCleanupBlockedError);
    await expect(provider.deleteMergedLocalBranch(dir, 'bad branch', main)).rejects.toBeInstanceOf(BranchCleanupBlockedError);
    expect(git(dir, 'rev-parse', '--verify', '--quiet', 'refs/heads/main').trim()).toBe(main); // main intact
  });

  it('argv guard: cleanup uses update-ref -d only — NEVER branch -d/-D/--force/push', async () => {
    const { dir, F } = makeRepoWithMergedFeature();
    const seen: string[][] = [];
    const recording: GitRunner = (args, opts) => {
      seen.push(args);
      const r = spawnSync('git', args, { cwd: opts.cwd, timeout: opts.timeoutMs, encoding: 'utf8' });
      return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', timedOut: false, failed: !!r.error };
    };
    await new LocalGitProvider(recording).deleteMergedLocalBranch(dir, 'feature', F);
    const flat = seen.map((a) => a.join(' '));
    for (const bad of ['branch -d', 'branch -D', '--force', ' -f', 'push', 'reset --hard']) {
      expect(flat.some((c) => c.includes(bad)), bad).toBe(false);
    }
    expect(flat.some((c) => c.includes('update-ref -d'))).toBe(true);
  });
});
