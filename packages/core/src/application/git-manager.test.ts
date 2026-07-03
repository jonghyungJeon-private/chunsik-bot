import { describe, expect, it, vi } from 'vitest';
import {
  BranchCleanupBlockedError,
  BranchCleanupUnverifiedError,
  GitManager,
  GitMainSyncBlockedError,
  GitMainSyncUnverifiedError,
} from './git-manager';
import { WorkspaceNotSafeError } from '../errors';
import { ApprovalStatus } from '../domain';
import type { ApprovalRef, GitBranchCleanupResult, GitCommitResult, GitMainSyncResult, GitStatus, RepositoryInfo } from '../domain';
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

describe('GitManager.syncMain (CAP-002, ADR-0058 — post-merge local main fast-forward)', () => {
  const EXPECTED = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'; // expected remote main tip (== mergeCommitHash)
  const PREV = '0000000abcabcabcabcabcabcabcabcabcabc000'; // local main before sync (CAS base)
  const syncResult = (over: Partial<GitMainSyncResult> = {}): GitMainSyncResult => ({
    branch: 'main',
    syncMode: 'ref-only',
    workingTreeUpdated: false,
    syncedCommitHash: EXPECTED,
    previousMainCommit: PREV,
    alreadyUpToDate: false,
    ...over,
  });
  const cleanStatus = (over: Partial<GitStatus> = {}): GitStatus => ({
    clean: true,
    branch: 'feature/x',
    staged: [],
    unstaged: [],
    untracked: [],
    ...over,
  });
  const syncFF = vi.fn(async () => syncResult());
  function syncProvider(over: Partial<GitProvider> = {}): GitProvider {
    return fakeProvider({
      async isRepository() {
        return true;
      },
      async status() {
        return cleanStatus();
      },
      async info(rootPath: string): Promise<RepositoryInfo> {
        return { isRepository: true, rootPath, branch: 'feature/x', headSha: 'abc', detached: false };
      },
      async getLocalRefCommit() {
        return { commitHash: PREV };
      },
      async getRemoteRefCommit() {
        return { commitHash: EXPECTED };
      },
      syncMainFastForward: syncFF,
      ...over,
    } as Partial<GitProvider>);
  }
  const runSync = (p: GitProvider, over: Record<string, unknown> = {}) =>
    new GitManager(p).syncMain({ rootPath: '/repo', remote: 'origin', branch: 'main', expectedRemoteCommit: EXPECTED, ...over } as Parameters<GitManager['syncMain']>[0]);

  it('happy path: preflight passes → single syncMainFastForward call with the observed previous commit', async () => {
    syncFF.mockClear();
    const r = await runSync(syncProvider());
    expect(syncFF).toHaveBeenCalledTimes(1);
    expect(syncFF).toHaveBeenCalledWith('/repo', 'origin', 'main', EXPECTED, PREV); // CAS base passed
    expect(r.syncedCommitHash).toBe(EXPECTED);
    expect(r.previousMainCommit).toBe(PREV);
  });

  it('unsafe input (rootPath / remote / branch / expected SHA) → Blocked, no provider read/mutation', async () => {
    for (const over of [{ rootPath: '  ' }, { remote: 'bad remote' }, { branch: 'bad branch' }, { expectedRemoteCommit: 'not-a-sha!' }]) {
      const ff = vi.fn(async () => syncResult());
      await expect(runSync(syncProvider({ syncMainFastForward: ff }), over)).rejects.toBeInstanceOf(GitMainSyncBlockedError);
      expect(ff).not.toHaveBeenCalled();
    }
  });

  it('not a repository → Blocked, no mutation', async () => {
    const ff = vi.fn(async () => syncResult());
    await expect(runSync(syncProvider({ async isRepository() { return false; }, syncMainFastForward: ff }))).rejects.toBeInstanceOf(GitMainSyncBlockedError);
    expect(ff).not.toHaveBeenCalled();
  });

  it('dirty / staged / untracked / unmerged working tree → Blocked, no mutation (CA 5/6/7)', async () => {
    const dirties: Partial<GitStatus>[] = [
      { clean: false, unstaged: ['a'] },
      { staged: ['b'] },
      { untracked: ['c'] },
      { hasUnmergedPaths: true },
    ];
    for (const s of dirties) {
      const ff = vi.fn(async () => syncResult());
      await expect(runSync(syncProvider({ async status() { return cleanStatus(s); }, syncMainFastForward: ff }))).rejects.toBeInstanceOf(GitMainSyncBlockedError);
      expect(ff).not.toHaveBeenCalled();
    }
  });

  it('detached HEAD → Blocked, no mutation (CA 21)', async () => {
    const ff = vi.fn(async () => syncResult());
    await expect(
      runSync(syncProvider({ async info(rootPath: string) { return { isRepository: true, rootPath, branch: '', detached: true }; }, syncMainFastForward: ff })),
    ).rejects.toBeInstanceOf(GitMainSyncBlockedError);
    expect(ff).not.toHaveBeenCalled();
  });

  it('no local main → Blocked, no mutation (CA — local main must exist)', async () => {
    const ff = vi.fn(async () => syncResult());
    await expect(runSync(syncProvider({ async getLocalRefCommit() { return null; }, syncMainFastForward: ff }))).rejects.toBeInstanceOf(GitMainSyncBlockedError);
    expect(ff).not.toHaveBeenCalled();
  });

  it('remote main read failure → Blocked BEFORE mutation (CA 8)', async () => {
    const ff = vi.fn(async () => syncResult());
    await expect(runSync(syncProvider({ async getRemoteRefCommit() { throw new Error('offline'); }, syncMainFastForward: ff }))).rejects.toBeInstanceOf(GitMainSyncBlockedError);
    expect(ff).not.toHaveBeenCalled();
  });

  it('remote main tip != expected merge commit → Blocked, no mutation (CA 9)', async () => {
    const ff = vi.fn(async () => syncResult());
    await expect(runSync(syncProvider({ async getRemoteRefCommit() { return { commitHash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }; }, syncMainFastForward: ff }))).rejects.toBeInstanceOf(GitMainSyncBlockedError);
    expect(ff).not.toHaveBeenCalled();
  });

  it('phase-aware (CA change 2): provider Blocked → Blocked; Unverified → Unverified; unknown → Unverified', async () => {
    const blocked = syncProvider({ async syncMainFastForward() { throw new GitMainSyncBlockedError('non-ff'); } });
    await expect(runSync(blocked)).rejects.toBeInstanceOf(GitMainSyncBlockedError); // NOT blanket-converted (CA 23)
    const unverified = syncProvider({ async syncMainFastForward() { throw new GitMainSyncUnverifiedError('mid-update'); } });
    await expect(runSync(unverified)).rejects.toBeInstanceOf(GitMainSyncUnverifiedError); // CA 24
    const generic = syncProvider({ async syncMainFastForward() { throw new Error('boom'); } });
    await expect(runSync(generic)).rejects.toBeInstanceOf(GitMainSyncUnverifiedError); // conservative
  });

  it('result integrity: syncedCommitHash != expected → Unverified', async () => {
    const bad = syncProvider({ async syncMainFastForward() { return syncResult({ syncedCommitHash: 'feedfeedfeedfeedfeedfeedfeedfeedfeedfeed' }); } });
    await expect(runSync(bad)).rejects.toBeInstanceOf(GitMainSyncUnverifiedError);
  });
});

describe('GitManager.deleteMergedLocalBranch (CAP-002, ADR-0059 — post-merge local branch cleanup)', () => {
  const MAIN = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'; // expected local main == syncedMainCommit
  const TIP = '0000000abcabcabcabcabcabcabcabcabcabc000'; // target branch tip
  const TARGET = 'feature/login';
  const delFn = vi.fn(async (): Promise<GitBranchCleanupResult> => ({ branch: TARGET, deleted: true, alreadyAbsent: false, deletedCommitHash: TIP }));
  function cleanupProvider(over: Partial<GitProvider> = {}): GitProvider {
    return fakeProvider({
      async isRepository() {
        return true;
      },
      async status(): Promise<GitStatus> {
        return { clean: true, branch: 'feature/x', staged: [], unstaged: [], untracked: [] }; // not on target
      },
      async info(rootPath: string): Promise<RepositoryInfo> {
        return { isRepository: true, rootPath, branch: 'feature/x', headSha: 'abc', detached: false };
      },
      async getLocalRefCommit(_root: string, branch: string) {
        return { commitHash: branch === 'main' ? MAIN : TIP };
      },
      async isAncestor() {
        return true; // merged
      },
      deleteMergedLocalBranch: delFn,
      ...over,
    } as Partial<GitProvider>);
  }
  const runCleanup = (p: GitProvider, over: Record<string, unknown> = {}) =>
    new GitManager(p).deleteMergedLocalBranch({ rootPath: '/repo', branch: TARGET, expectedMainCommit: MAIN, ...over } as Parameters<GitManager['deleteMergedLocalBranch']>[0]);

  it('happy path: preflight passes → single delete with the observed target tip as expectedBranchCommit (CA 23)', async () => {
    delFn.mockClear();
    const r = await runCleanup(cleanupProvider());
    expect(delFn).toHaveBeenCalledTimes(1);
    expect(delFn).toHaveBeenCalledWith('/repo', TARGET, TIP); // CAS base = observed target tip (CA change 2)
    expect(r.deleted).toBe(true);
  });

  it('unsafe input (rootPath / branch / main / expected SHA) → Blocked, no read/delete', async () => {
    for (const over of [{ rootPath: '  ' }, { branch: 'bad branch' }, { branch: 'main' }, { expectedMainCommit: 'nope' }]) {
      const del = vi.fn(async () => ({ branch: TARGET, deleted: true, alreadyAbsent: false }));
      await expect(runCleanup(cleanupProvider({ deleteMergedLocalBranch: del }), over)).rejects.toBeInstanceOf(BranchCleanupBlockedError);
      expect(del).not.toHaveBeenCalled();
    }
  });

  it('target currently checked out → Blocked, no delete (CA 8)', async () => {
    const del = vi.fn(async () => ({ branch: TARGET, deleted: true, alreadyAbsent: false }));
    await expect(
      runCleanup(cleanupProvider({ async info(rootPath: string) { return { isRepository: true, rootPath, branch: TARGET, detached: false }; }, deleteMergedLocalBranch: del })),
    ).rejects.toBeInstanceOf(BranchCleanupBlockedError);
    expect(del).not.toHaveBeenCalled();
  });

  it('local main missing / != expectedMainCommit → Blocked, no delete (CA change 4 / test 24)', async () => {
    const del = vi.fn(async () => ({ branch: TARGET, deleted: true, alreadyAbsent: false }));
    const moved = cleanupProvider({ async getLocalRefCommit(_r: string, b: string) { return b === 'main' ? { commitHash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' } : { commitHash: TIP }; }, deleteMergedLocalBranch: del });
    await expect(runCleanup(moved)).rejects.toBeInstanceOf(BranchCleanupBlockedError);
    expect(del).not.toHaveBeenCalled();
    const gone = cleanupProvider({ async getLocalRefCommit(_r: string, b: string) { return b === 'main' ? null : { commitHash: TIP }; }, deleteMergedLocalBranch: del });
    await expect(runCleanup(gone)).rejects.toBeInstanceOf(BranchCleanupBlockedError);
  });

  it('target branch absent → idempotent { deleted:false, alreadyAbsent:true }, no delete call (CA 10)', async () => {
    const del = vi.fn(async () => ({ branch: TARGET, deleted: true, alreadyAbsent: false }));
    const absent = cleanupProvider({ async getLocalRefCommit(_r: string, b: string) { return b === 'main' ? { commitHash: MAIN } : null; }, deleteMergedLocalBranch: del });
    const r = await runCleanup(absent);
    expect(r.deleted).toBe(false);
    expect(r.alreadyAbsent).toBe(true);
    expect(del).not.toHaveBeenCalled();
  });

  it('target not merged into main → Blocked, no delete (CA 9)', async () => {
    const del = vi.fn(async () => ({ branch: TARGET, deleted: true, alreadyAbsent: false }));
    await expect(runCleanup(cleanupProvider({ async isAncestor() { return false; }, deleteMergedLocalBranch: del }))).rejects.toBeInstanceOf(BranchCleanupBlockedError);
    expect(del).not.toHaveBeenCalled();
  });

  it('phase-aware: provider Blocked → Blocked; Unverified → Unverified; unknown → Unverified (CA 12/13)', async () => {
    const blocked = cleanupProvider({ async deleteMergedLocalBranch() { throw new BranchCleanupBlockedError('moved'); } });
    await expect(runCleanup(blocked)).rejects.toBeInstanceOf(BranchCleanupBlockedError);
    const unverified = cleanupProvider({ async deleteMergedLocalBranch() { throw new BranchCleanupUnverifiedError('mid'); } });
    await expect(runCleanup(unverified)).rejects.toBeInstanceOf(BranchCleanupUnverifiedError);
    const generic = cleanupProvider({ async deleteMergedLocalBranch() { throw new Error('boom'); } });
    await expect(runCleanup(generic)).rejects.toBeInstanceOf(BranchCleanupUnverifiedError);
  });

  it('result integrity: branch mismatch / not-deleted → Unverified', async () => {
    const wrongBranch = cleanupProvider({ async deleteMergedLocalBranch() { return { branch: 'other', deleted: true, alreadyAbsent: false }; } });
    await expect(runCleanup(wrongBranch)).rejects.toBeInstanceOf(BranchCleanupUnverifiedError);
    const notDeleted = cleanupProvider({ async deleteMergedLocalBranch() { return { branch: TARGET, deleted: false, alreadyAbsent: false }; } });
    await expect(runCleanup(notDeleted)).rejects.toBeInstanceOf(BranchCleanupUnverifiedError);
  });
});
