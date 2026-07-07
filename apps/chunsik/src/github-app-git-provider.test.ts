import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { GitMainSyncBlockedError, GitMainSyncUnverifiedError } from '@chunsik/core';
import type { GitProvider } from '@chunsik/core';
import { GitHubAppGitProvider } from './github-app-git-provider';

/** A fake `GitProvider` that records calls and returns canned results (NEVER spawns git). */
function fakeGit(overrides: Partial<GitProvider> = {}): GitProvider & { calls: string[] } {
  const calls: string[] = [];
  const rec = (m: string): void => {
    calls.push(m);
  };
  const base: GitProvider = {
    kind: 'local-git',
    isRepository: async () => {
      rec('isRepository');
      return true;
    },
    info: async (rootPath) => {
      rec('info');
      return { isRepository: true, rootPath, branch: 'main', detached: false };
    },
    status: async () => {
      rec('status');
      return { clean: true, branch: 'main', staged: [], unstaged: [], untracked: [] };
    },
    diff: async () => {
      rec('diff');
      return { files: [], unified: '', truncated: false };
    },
    commitFiles: async (_rootPath, files, message) => {
      rec('commitFiles');
      return { commitHash: 'abc1234', committedFiles: files, message };
    },
    pushApprovedCommit: async (_rootPath, remote, branch, commitHash) => {
      rec('pushApprovedCommit');
      return { remote, branch, upstreamRef: `${remote}/${branch}`, commitHash };
    },
    getRemoteRefCommit: async () => {
      rec('getRemoteRefCommit');
      return { commitHash: 'abc1234' };
    },
    getLocalRefCommit: async () => {
      rec('getLocalRefCommit');
      return { commitHash: 'abc1234' };
    },
    syncMainFastForward: async () => {
      rec('syncMainFastForward');
      return {
        branch: 'main',
        syncMode: 'ref-only',
        workingTreeUpdated: false,
        syncedCommitHash: 'abc1234',
        previousMainCommit: 'def5678',
        alreadyUpToDate: false,
      };
    },
    isAncestor: async () => {
      rec('isAncestor');
      return true;
    },
    deleteMergedLocalBranch: async (_rootPath, branch) => {
      rec('deleteMergedLocalBranch');
      return { branch, deleted: true, alreadyAbsent: false, deletedCommitHash: 'abc1234' };
    },
  };
  const merged = { ...base, ...overrides } as GitProvider;
  return Object.assign(merged, { calls });
}

function tmpAskpassCount(): number {
  return readdirSync(tmpdir()).filter((n) => n.startsWith('quoky-askpass-')).length;
}

const SHA40 = 'a'.repeat(40);
const SHA40B = 'b'.repeat(40);

describe('GitHubAppGitProvider (Sprint 4b, ADR-0061)', () => {
  it('delegates LOCAL operations to LocalGitProvider WITHOUT minting a token', async () => {
    const fake = fakeGit();
    const tokenSource = vi.fn(async () => 'ghs_shouldNotBeMinted');
    const p = new GitHubAppGitProvider({ makeLocalGit: () => fake, tokenSource });

    await p.status('/repo');
    await p.commitFiles('/repo', ['a.ts'], 'msg');
    await p.info('/repo');
    await p.deleteMergedLocalBranch('/repo', 'feature/x', SHA40);

    expect(tokenSource).not.toHaveBeenCalled();
    expect(fake.calls).toEqual(['status', 'commitFiles', 'info', 'deleteMergedLocalBranch']);
  });

  it('mints a token for a REMOTE op and delegates, without mutating process.env or leaving temp dirs', async () => {
    const fake = fakeGit();
    const tokenSource = vi.fn(async () => 'ghs_sentinelToken');
    const p = new GitHubAppGitProvider({ makeLocalGit: () => fake, tokenSource });

    const envBefore = JSON.stringify(process.env);
    const dirsBefore = tmpAskpassCount();
    const res = await p.pushApprovedCommit('/repo', 'origin', 'uat/x', 'abc1234');

    expect(res.branch).toBe('uat/x');
    expect(tokenSource).toHaveBeenCalledTimes(1);
    expect(fake.calls).toContain('pushApprovedCommit');
    // Secret boundary: the token never leaks into the parent process env, and the one-shot dir is cleaned up.
    expect(JSON.stringify(process.env)).toBe(envBefore);
    expect(process.env.GIT_APP_TOKEN).toBeUndefined();
    expect(process.env.GIT_ASKPASS).toBeUndefined();
    expect(tmpAskpassCount()).toBe(dirsBefore);
  });

  it('cleans up the one-shot askpass dir even when the inner git op throws', async () => {
    const fake = fakeGit({
      pushApprovedCommit: async () => {
        throw new Error('push exploded');
      },
    });
    const p = new GitHubAppGitProvider({ makeLocalGit: () => fake, tokenSource: async () => 'ghs_tok' });

    const dirsBefore = tmpAskpassCount();
    await expect(p.pushApprovedCommit('/repo', 'origin', 'uat/x', 'abc1234')).rejects.toThrow('push exploded');
    expect(tmpAskpassCount()).toBe(dirsBefore);
    expect(process.env.GIT_APP_TOKEN).toBeUndefined();
  });

  it('maps a credential-acquisition failure on syncMainFastForward to Blocked (not synced)', async () => {
    const fake = fakeGit();
    const tokenSource = async (): Promise<string> => {
      throw new Error('mint failed');
    };
    const p = new GitHubAppGitProvider({ makeLocalGit: () => fake, tokenSource });
    await expect(p.syncMainFastForward('/repo', 'origin', 'main', SHA40, SHA40B)).rejects.toBeInstanceOf(
      GitMainSyncBlockedError,
    );
  });

  it('preserves a typed GitMainSyncUnverifiedError raised by the inner provider', async () => {
    const fake = fakeGit({
      syncMainFastForward: async () => {
        throw new GitMainSyncUnverifiedError('boom');
      },
    });
    const p = new GitHubAppGitProvider({ makeLocalGit: () => fake, tokenSource: async () => 'ghs_tok' });
    await expect(p.syncMainFastForward('/repo', 'origin', 'main', SHA40, SHA40B)).rejects.toBeInstanceOf(
      GitMainSyncUnverifiedError,
    );
  });
});
