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
