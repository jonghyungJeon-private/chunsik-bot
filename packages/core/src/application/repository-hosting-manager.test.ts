import { describe, expect, it } from 'vitest';
import { RepositoryHostingManager } from './repository-hosting-manager';
import { ApprovalStatus } from '../domain';
import type {
  ApprovalRef,
  PullRequestCreationInput,
  PullRequestRef,
  PullRequestResult,
  PullRequestStatusPreview,
  RepositoryIdentity,
} from '../domain';
import type { RepositoryHostingProvider } from '../ports';

const PR_REF: PullRequestRef = { provider: 'github', owner: 'acme', repo: 'widgets', pullRequestNumber: 42, pullRequestUrl: 'https://github.com/acme/widgets/pull/42' };
function validStatus(over: Partial<PullRequestStatusPreview> = {}): PullRequestStatusPreview {
  return {
    ref: PR_REF,
    state: 'open',
    headBranch: 'feature/x',
    baseBranch: 'main',
    headCommitHash: 'abc1234',
    isDraft: false,
    checks: { state: 'success', totalCount: 1, successCount: 1, failureCount: 0, pendingCount: 0 },
    reviews: { state: 'approved', approvedCount: 1, changesRequestedCount: 0 },
    observedAt: '2026-07-03T00:00:00.000Z',
    ...over,
  };
}

const IDENTITY: RepositoryIdentity = { provider: 'github', owner: 'acme', repo: 'widgets' };
const HEAD = 'feature/x';
const BASE = 'main';
const COMMIT = 'abc1234';

function approved(): ApprovalRef {
  return { id: 'a1', status: ApprovalStatus.APPROVED, executionPlanRef: { id: 'p1', goal: 'g' } };
}

function validResult(over: Partial<PullRequestResult> = {}): PullRequestResult {
  return {
    provider: 'github',
    owner: 'acme',
    repo: 'widgets',
    pullRequestNumber: 42,
    pullRequestUrl: 'https://github.com/acme/widgets/pull/42',
    pullRequestHeadBranch: HEAD,
    pullRequestBaseBranch: BASE,
    pullRequestCommitHash: COMMIT,
    reused: false,
    ...over,
  };
}

/** Configurable fake provider with a call log — the ONLY thing that implements the port in 3d-B. */
class FakeProvider implements RepositoryHostingProvider {
  kind = 'github';
  calls: string[] = [];
  createInputs: PullRequestCreationInput[] = [];
  repoExists = true;
  branches: Record<string, boolean> = { [HEAD]: true, [BASE]: true };
  openPr: PullRequestResult | null = null;
  findThrows = false;
  createResult: PullRequestResult = validResult();
  createThrows = false;

  async repositoryExists(): Promise<boolean> {
    this.calls.push('repositoryExists');
    return this.repoExists;
  }
  async branchExists(_id: RepositoryIdentity, branch: string): Promise<boolean> {
    this.calls.push(`branchExists:${branch}`);
    return this.branches[branch] ?? false;
  }
  async findOpenPullRequest(): Promise<PullRequestResult | null> {
    this.calls.push('findOpenPullRequest');
    if (this.findThrows) throw new Error('RAW-PROVIDER-SECRET-abc');
    return this.openPr;
  }
  async createPullRequest(input: PullRequestCreationInput): Promise<PullRequestResult> {
    this.calls.push('createPullRequest');
    this.createInputs.push(input);
    if (this.createThrows) throw new Error('RAW-PROVIDER-SECRET-xyz');
    return this.createResult;
  }
  // Sprint 3e: read-only status. Configurable result/throw.
  statusResult: PullRequestStatusPreview = validStatus();
  statusThrows = false;
  async getPullRequestStatus(): Promise<PullRequestStatusPreview> {
    this.calls.push('getPullRequestStatus');
    if (this.statusThrows) throw new Error('RAW-PROVIDER-SECRET-status');
    return this.statusResult;
  }
}

function runStatus(p: FakeProvider, over: Record<string, unknown> = {}) {
  return new RepositoryHostingManager(p).getPullRequestStatus({
    identity: IDENTITY,
    pullRequestRef: PR_REF,
    expectedHeadBranch: HEAD,
    expectedBaseBranch: BASE,
    expectedCommitHash: COMMIT,
    ...over,
  } as Parameters<RepositoryHostingManager['getPullRequestStatus']>[0]);
}

function run(p: FakeProvider, over: Record<string, unknown> = {}) {
  const mgr = new RepositoryHostingManager(p);
  return mgr.createPullRequest({
    identity: IDENTITY,
    headBranch: HEAD,
    baseBranch: BASE,
    title: 'Add widget',
    body: 'body',
    expectedCommitHash: COMMIT,
    approvalRef: approved(),
    ...over,
  } as Parameters<RepositoryHostingManager['createPullRequest']>[0]);
}

describe('RepositoryHostingManager (CAP-010 skeleton, ADR-0052, Sprint 3d-B)', () => {
  describe('port shape (tests 6–9)', () => {
    it('a conformant provider has repositoryExists/branchExists/findOpenPullRequest/createPullRequest', () => {
      const p = new FakeProvider();
      for (const m of ['repositoryExists', 'branchExists', 'findOpenPullRequest', 'createPullRequest']) {
        expect(typeof (p as unknown as Record<string, unknown>)[m]).toBe('function');
      }
    });
  });

  describe('approval + input validation (tests 10–18, 61, 65)', () => {
    it('rejects a non-APPROVED ApprovalRef before any provider call (test 10)', async () => {
      const p = new FakeProvider();
      await expect(run(p, { approvalRef: { ...approved(), status: ApprovalStatus.PENDING } })).rejects.toThrow();
      expect(p.calls).toEqual([]);
    });
    it('rejects provider.kind mismatch before any provider call (test 61)', async () => {
      const p = new FakeProvider();
      p.kind = 'gitlab';
      await expect(run(p)).rejects.toThrow();
      expect(p.calls).toEqual([]);
    });
    it('rejects an unsafe identity (test 11)', async () => {
      const p = new FakeProvider();
      await expect(run(p, { identity: { provider: 'github', owner: 'bad owner', repo: 'widgets' } })).rejects.toThrow();
      expect(p.calls).toEqual([]);
    });
    it('rejects an unsafe head branch (test 12)', async () => {
      const p = new FakeProvider();
      await expect(run(p, { headBranch: 'bad branch' })).rejects.toThrow();
      expect(p.calls).toEqual([]);
    });
    it('rejects an unsafe base branch (test 13)', async () => {
      const p = new FakeProvider();
      await expect(run(p, { baseBranch: 'bad:base' })).rejects.toThrow();
      expect(p.calls).toEqual([]);
    });
    it('rejects head == base (test 14)', async () => {
      const p = new FakeProvider();
      await expect(run(p, { headBranch: 'main', baseBranch: 'main' })).rejects.toThrow();
      expect(p.calls).toEqual([]);
    });
    it('rejects an empty (or whitespace-only) title (tests 15, 65)', async () => {
      const p = new FakeProvider();
      await expect(run(p, { title: '   ' })).rejects.toThrow();
      expect(p.calls).toEqual([]);
    });
    it('rejects a too-long title (test 16)', async () => {
      const p = new FakeProvider();
      await expect(run(p, { title: 'a'.repeat(201) })).rejects.toThrow();
      expect(p.calls).toEqual([]);
    });
    it('rejects a too-long body (test 17)', async () => {
      const p = new FakeProvider();
      await expect(run(p, { body: 'a'.repeat(8001) })).rejects.toThrow();
      expect(p.calls).toEqual([]);
    });
    it('rejects an invalid expectedCommitHash (test 18)', async () => {
      const p = new FakeProvider();
      await expect(run(p, { expectedCommitHash: 'nothex!' })).rejects.toThrow();
      expect(p.calls).toEqual([]);
    });
  });

  describe('title normalization (tests 62/63/64/66)', () => {
    it('normalizes surrounding + repeated whitespace and passes the normalized title to the provider', async () => {
      const p = new FakeProvider();
      await run(p, { title: '  Add    widget\n\ttitle  ' });
      expect(p.createInputs[0]?.title).toBe('Add widget title');
    });
    it('success path requires provider.kind === identity.provider (test 62)', async () => {
      const p = new FakeProvider(); // kind 'github' === identity.provider
      const r = await run(p);
      expect(r.reused).toBe(false);
      expect(p.calls).toContain('createPullRequest');
    });
  });

  describe('call ordering & no-mutation-on-failure (tests 19–25, 30)', () => {
    it('calls repositoryExists → branchExists(head) → branchExists(base) → findOpenPullRequest → createPullRequest (tests 19/21/23/25/30)', async () => {
      const p = new FakeProvider();
      await run(p);
      expect(p.calls).toEqual([
        'repositoryExists',
        `branchExists:${HEAD}`,
        `branchExists:${BASE}`,
        'findOpenPullRequest',
        'createPullRequest',
      ]);
      expect(p.calls.filter((c) => c === 'createPullRequest')).toHaveLength(1);
    });
    it('does not create when repositoryExists is false (test 20)', async () => {
      const p = new FakeProvider();
      p.repoExists = false;
      await expect(run(p)).rejects.toThrow();
      expect(p.calls).toEqual(['repositoryExists']);
    });
    it('does not create when the head branch is missing (test 22)', async () => {
      const p = new FakeProvider();
      p.branches[HEAD] = false;
      await expect(run(p)).rejects.toThrow();
      expect(p.calls).not.toContain('createPullRequest');
      expect(p.calls).not.toContain('findOpenPullRequest');
    });
    it('does not create when the base branch is missing (test 24)', async () => {
      const p = new FakeProvider();
      p.branches[BASE] = false;
      await expect(run(p)).rejects.toThrow();
      expect(p.calls).not.toContain('createPullRequest');
    });
  });

  describe('existing-PR reuse & non-idempotent block (tests 26–29, 67)', () => {
    it('existing open PR skips createPullRequest and returns reused: true (tests 26/28)', async () => {
      const p = new FakeProvider();
      p.openPr = validResult({ reused: false });
      const r = await run(p);
      expect(r.reused).toBe(true);
      expect(p.calls).not.toContain('createPullRequest');
    });
    it('returns reused: true even if the provider result says reused: false (test 67)', async () => {
      const p = new FakeProvider();
      p.openPr = validResult({ reused: false });
      const r = await run(p);
      expect(r.reused).toBe(true);
    });
    it('existing open PR with integrity mismatch fails safe and does not create (test 27)', async () => {
      const p = new FakeProvider();
      p.openPr = validResult({ pullRequestHeadBranch: 'other' });
      await expect(run(p)).rejects.toThrow();
      expect(p.calls).not.toContain('createPullRequest');
    });
    it('blocks by default when findOpenPullRequest throws (unsupported) — no create (test 29)', async () => {
      const p = new FakeProvider();
      p.findThrows = true;
      await expect(run(p)).rejects.toThrow();
      expect(p.calls).not.toContain('createPullRequest');
    });
  });

  describe('manager-owned reused on create path (test 68)', () => {
    it('returns reused: false even if the provider create result says reused: true', async () => {
      const p = new FakeProvider();
      p.createResult = validResult({ reused: true });
      const r = await run(p);
      expect(r.reused).toBe(false);
    });
  });

  describe('result integrity (tests 35–41, 69, 70)', () => {
    it('head mismatch fails safe (test 35)', async () => {
      const p = new FakeProvider();
      p.createResult = validResult({ pullRequestHeadBranch: 'nope' });
      await expect(run(p)).rejects.toThrow();
    });
    it('base mismatch fails safe (test 36)', async () => {
      const p = new FakeProvider();
      p.createResult = validResult({ pullRequestBaseBranch: 'nope' });
      await expect(run(p)).rejects.toThrow();
    });
    it('owner/repo mismatch fails safe (test 37)', async () => {
      const p = new FakeProvider();
      p.createResult = validResult({ owner: 'evil' });
      await expect(run(p)).rejects.toThrow();
    });
    it('invalid URL fails safe (test 38)', async () => {
      const p = new FakeProvider();
      p.createResult = validResult({ pullRequestUrl: 'https://github.com/acme/widgets/pull/42?x=1' });
      await expect(run(p)).rejects.toThrow();
    });
    it('invalid PR number fails safe (test 39)', async () => {
      const p = new FakeProvider();
      p.createResult = validResult({ pullRequestNumber: 0 });
      await expect(run(p)).rejects.toThrow();
    });
    it('invalid commit hash fails safe (test 40)', async () => {
      const p = new FakeProvider();
      p.createResult = validResult({ pullRequestCommitHash: 'zzz' });
      await expect(run(p)).rejects.toThrow();
    });
    it('commit hash not matching expectedCommitHash fails safe — create path (test 70)', async () => {
      const p = new FakeProvider();
      p.createResult = validResult({ pullRequestCommitHash: 'def5678' });
      await expect(run(p)).rejects.toThrow();
    });
    it('commit hash not matching expectedCommitHash fails safe — existing-PR path, no create (test 69)', async () => {
      const p = new FakeProvider();
      p.openPr = validResult({ pullRequestCommitHash: 'def5678' });
      await expect(run(p)).rejects.toThrow();
      expect(p.calls).not.toContain('createPullRequest');
    });
    it('returns the provider-reported result on success (test 41)', async () => {
      const p = new FakeProvider();
      const r = await run(p);
      expect(r).toMatchObject({
        provider: 'github',
        owner: 'acme',
        repo: 'widgets',
        pullRequestNumber: 42,
        pullRequestUrl: 'https://github.com/acme/widgets/pull/42',
        pullRequestHeadBranch: HEAD,
        pullRequestBaseBranch: BASE,
        pullRequestCommitHash: COMMIT,
        reused: false,
      });
    });
  });

  describe('provider input hygiene (tests 31–34)', () => {
    it('provider never receives an ApprovalRef / token / raw diff / file content', async () => {
      const p = new FakeProvider();
      await run(p);
      const inp = p.createInputs[0]!;
      expect(Object.keys(inp).sort()).toEqual([
        'baseBranch',
        'body',
        'expectedCommitHash',
        'headBranch',
        'identity',
        'title',
      ]);
      const keys = Object.keys(inp);
      expect(keys).not.toContain('approvalRef');
      expect(keys).not.toContain('token');
      expect(keys).not.toContain('diff');
      expect(keys).not.toContain('fileContent');
      expect(keys).not.toContain('pushedRemote');
    });
  });

  describe('error wrapping (test 71)', () => {
    it('does not forward a raw provider error message from findOpenPullRequest', async () => {
      const p = new FakeProvider();
      p.findThrows = true;
      await expect(run(p)).rejects.toThrow(/repository hosting/);
      await run(p).catch((e: unknown) => {
        expect(String((e as Error).message)).not.toContain('RAW-PROVIDER-SECRET');
      });
    });
    it('does not forward a raw provider error message from createPullRequest', async () => {
      const p = new FakeProvider();
      p.createThrows = true;
      await run(p).catch((e: unknown) => {
        expect(String((e as Error).message)).not.toContain('RAW-PROVIDER-SECRET');
      });
    });
  });

  describe('getPullRequestStatus (read-only, Sprint 3e, ADR-0055)', () => {
    it('validates PullRequestRef before the provider call (tests 61–63)', async () => {
      const mismatchRef = new FakeProvider();
      await expect(runStatus(mismatchRef, { pullRequestRef: { ...PR_REF, owner: 'evil' } })).rejects.toThrow();
      expect(mismatchRef.calls).not.toContain('getPullRequestStatus');
      const badUrl = new FakeProvider();
      await expect(runStatus(badUrl, { pullRequestRef: { ...PR_REF, pullRequestUrl: 'https://evil.com/x/y/pull/42' } })).rejects.toThrow();
      expect(badUrl.calls).not.toContain('getPullRequestStatus');
      const badNum = new FakeProvider();
      await expect(runStatus(badNum, { pullRequestRef: { ...PR_REF, pullRequestNumber: 0 } })).rejects.toThrow();
      expect(badNum.calls).not.toContain('getPullRequestStatus');
    });
    it('rejects provider.kind mismatch before the provider call', async () => {
      const p = new FakeProvider();
      p.kind = 'gitlab';
      await expect(runStatus(p)).rejects.toThrow();
      expect(p.calls).not.toContain('getPullRequestStatus');
    });
    it('returns the provider-reported status on a matching result', async () => {
      const p = new FakeProvider();
      const s = await runStatus(p);
      expect(p.calls).toContain('getPullRequestStatus');
      expect(s.state).toBe('open');
      expect(s.checks.successCount).toBe(1);
      expect(s.observedAt).toBe('2026-07-03T00:00:00.000Z');
    });
    it('fails safe on result ref/head/base/commit mismatch (tests 16–19/81–84)', async () => {
      for (const bad of [
        validStatus({ ref: { ...PR_REF, pullRequestNumber: 43, pullRequestUrl: 'https://github.com/acme/widgets/pull/43' } }),
        validStatus({ headBranch: 'other' }),
        validStatus({ baseBranch: 'develop' }),
        validStatus({ headCommitHash: 'def5678' }),
      ]) {
        const p = new FakeProvider();
        p.statusResult = bad;
        await expect(runStatus(p)).rejects.toThrow();
      }
    });
    it('rejects negative/non-integer check counts', async () => {
      const p = new FakeProvider();
      p.statusResult = validStatus({ checks: { state: 'unknown', totalCount: -1, successCount: 0, failureCount: 0, pendingCount: 0 } });
      await expect(runStatus(p)).rejects.toThrow();
    });
    it('does not forward a raw provider error message on read failure', async () => {
      const p = new FakeProvider();
      p.statusThrows = true;
      await runStatus(p).catch((e: unknown) => {
        expect(String((e as Error).message)).toMatch(/repository hosting/);
        expect(String((e as Error).message)).not.toContain('RAW-PROVIDER-SECRET');
      });
    });
    it('never mutates — no create/commit/push style calls during a status read', async () => {
      const p = new FakeProvider();
      await runStatus(p);
      expect(p.calls).toEqual(['getPullRequestStatus']);
    });
  });
});
