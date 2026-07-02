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
});

describe('sanitizeGitStderr', () => {
  it('masks embedded URL credentials and truncates', () => {
    const masked = sanitizeGitStderr('fatal: https://user:abcd1234token@github.com/x/y.git not found');
    expect(masked).not.toContain('abcd1234token');
    expect(masked).toContain('***@');
  });
});
