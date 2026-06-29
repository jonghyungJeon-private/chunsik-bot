import { describe, expect, it } from 'vitest';
import { GitManager } from './git-manager';
import { WorkspaceNotSafeError } from '../errors';
import type { GitStatus, RepositoryInfo } from '../domain';
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
