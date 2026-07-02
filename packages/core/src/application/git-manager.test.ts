import { describe, expect, it, vi } from 'vitest';
import { GitManager } from './git-manager';
import { WorkspaceNotSafeError } from '../errors';
import { ApprovalStatus } from '../domain';
import type { ApprovalRef, GitCommitResult, GitStatus, RepositoryInfo } from '../domain';
import type { GitProvider } from '../ports';

function fakeProvider(over: Partial<GitProvider> = {}): GitProvider {
  return {
    kind: 'fake-git',
    async isRepository() {
      return true;
    },
    async info(rootPath: string): Promise<RepositoryInfo> {
      return { isRepository: true, rootPath, branch: 'main', headSha: 'abc', detached: false };
    },
    async status(): Promise<GitStatus> {
      return { clean: true, branch: 'main', staged: [], unstaged: [], untracked: [] };
    },
    ...over,
  } as GitProvider;
}

const planRef = { id: 'plan-1', goal: 'do x' };
const approvedRef: ApprovalRef = { id: 'appr-1', status: ApprovalStatus.APPROVED, executionPlanRef: planRef };
const commitInput = (over: Partial<{ rootPath: string; files: string[]; message: string; approvalRef: ApprovalRef }> = {}) =>
  ({ rootPath: '/repo', files: ['a.ts'], message: 'chore: update a.ts', approvalRef: approvedRef, ...over });

describe('GitManager (CAP-002, read-only)', () => {
  it('delegates isRepository / info / status to the provider', async () => {
    const mgr = new GitManager(fakeProvider());
    expect(await mgr.isRepository('/tmp/r')).toBe(true);
    expect((await mgr.info('/tmp/r')).branch).toBe('main');
    expect((await mgr.status('/tmp/r')).clean).toBe(true);
  });

  it('isClean reflects status.clean', async () => {
    const dirty = fakeProvider({
      async status() {
        return { clean: false, branch: 'main', staged: [], unstaged: ['a'], untracked: [] };
      },
    });
    expect(await new GitManager(fakeProvider()).isClean('/tmp/r')).toBe(true);
    expect(await new GitManager(dirty).isClean('/tmp/r')).toBe(false);
  });

  it('requireClean passes on a clean tree and throws on a dirty one', async () => {
    await expect(new GitManager(fakeProvider()).requireClean('/tmp/r')).resolves.toBeUndefined();
    const dirty = fakeProvider({
      async status() {
        return { clean: false, branch: 'main', staged: [], unstaged: ['a'], untracked: ['b'] };
      },
    });
    await expect(new GitManager(dirty).requireClean('/tmp/r')).rejects.toBeInstanceOf(
      WorkspaceNotSafeError,
    );
  });
});

describe('GitManager.commitFiles (CAP-002, ADR-0046 — Ref-gated first git mutation)', () => {
  const commitProvider = (result?: GitCommitResult) => {
    const commitFiles = vi.fn(
      async (rootPath: string, files: string[], message: string): Promise<GitCommitResult> =>
        result ?? { commitHash: 'a'.repeat(40), committedFiles: files, message },
    );
    return { provider: fakeProvider({ commitFiles }), commitFiles };
  };

  it('delegates to the provider with cleaned files on a valid APPROVED input', async () => {
    const { provider, commitFiles } = commitProvider();
    const res = await new GitManager(provider).commitFiles(commitInput({ files: [' a.ts '] }));
    expect(commitFiles).toHaveBeenCalledTimes(1);
    expect(commitFiles).toHaveBeenCalledWith('/repo', ['a.ts'], 'chore: update a.ts'); // trimmed
    expect(res.committedFiles).toEqual(['a.ts']);
  });

  it('rejects a non-APPROVED approvalRef (CA 39)', async () => {
    const { provider, commitFiles } = commitProvider();
    await expect(
      new GitManager(provider).commitFiles(
        commitInput({ approvalRef: { id: 'a', status: ApprovalStatus.PENDING, executionPlanRef: planRef } }),
      ),
    ).rejects.toThrow(/APPROVED/);
    expect(commitFiles).not.toHaveBeenCalled();
  });

  it('rejects empty files (CA 40)', async () => {
    const { provider, commitFiles } = commitProvider();
    await expect(new GitManager(provider).commitFiles(commitInput({ files: [] }))).rejects.toThrow(/at least one file/);
    expect(commitFiles).not.toHaveBeenCalled();
  });

  it('rejects duplicate files (CA 41)', async () => {
    const { provider, commitFiles } = commitProvider();
    await expect(new GitManager(provider).commitFiles(commitInput({ files: ['a.ts', 'a.ts'] }))).rejects.toThrow(/duplicate/);
    expect(commitFiles).not.toHaveBeenCalled();
  });

  it('rejects an unsafe path — absolute / traversal / empty (CA 42)', async () => {
    const { provider, commitFiles } = commitProvider();
    for (const files of [['/etc/passwd'], ['../secret'], ['']]) {
      await expect(new GitManager(provider).commitFiles(commitInput({ files }))).rejects.toThrow(/unsafe file path/);
    }
    expect(commitFiles).not.toHaveBeenCalled();
  });

  it('rejects an invalid message — empty / multiline / overlong (CA 43)', async () => {
    const { provider, commitFiles } = commitProvider();
    for (const message of ['', 'a\nb', 'x'.repeat(121)]) {
      await expect(new GitManager(provider).commitFiles(commitInput({ message }))).rejects.toThrow(/invalid message/);
    }
    expect(commitFiles).not.toHaveBeenCalled();
  });

  it('rejects an empty rootPath', async () => {
    const { provider, commitFiles } = commitProvider();
    await expect(new GitManager(provider).commitFiles(commitInput({ rootPath: '  ' }))).rejects.toThrow(/rootPath/);
    expect(commitFiles).not.toHaveBeenCalled();
  });
});
