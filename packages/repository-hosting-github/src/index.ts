import { isSafeGitHubPullRequestUrl } from '@chunsik/core';
import type {
  PullRequestChecksState,
  PullRequestCreationInput,
  PullRequestRef,
  PullRequestResult,
  PullRequestReviewState,
  PullRequestState,
  PullRequestStatusPreview,
  RepositoryHostingProvider,
  RepositoryIdentity,
} from '@chunsik/core';

/**
 * GitHub RepositoryHosting adapter (CAP-010, ADR-0053 — Sprint 3d-C, **adapter-only**).
 *
 * Implements the `RepositoryHostingProvider` port against the **github.com** GitHub REST API using the Node 22
 * built-in `fetch` (no octokit; no gh/hub/curl/CommandExecution/shell). GitHub Enterprise is deferred — the API
 * base is FIXED to `https://api.github.com` with no override.
 *
 * **Not wired into product runtime in 3d-C** (no `app.module` binding); `createPullRequest` is a real GitHub
 * mutation *if called*, but no product path reaches it and every unit test injects a fake `fetch` (no live
 * network). Actual runtime PR-creation execution is deferred to Sprint 3d-D. The token is **adapter-local**
 * (constructor config only) and never appears in errors/logs.
 */

/** Fixed GitHub API base (github.com only; Enterprise deferred — no override). */
const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const USER_AGENT = 'chunsik-bot';
const SHA_SHAPED = /^[0-9a-f]{7,40}$/i;

export interface GitHubHostingConfig {
  /** GitHub token — adapter-local ONLY (used solely as an `Authorization: Bearer` value). Never logged,
   *  never returned, never placed in an error. */
  token: string;
  /** Injectable `fetch` for testability (default: global `fetch`). Unit tests pass a fake — no live network. */
  fetchImpl?: typeof fetch;
  /** Optional per-request timeout (ms) via `AbortSignal.timeout`. Omitted in tests so they never wait. */
  timeoutMs?: number;
}

/** GitHub REST shapes the adapter reads — everything else is ignored (no raw diff / file content / secrets). */
interface GitHubPull {
  number?: unknown;
  html_url?: unknown;
  head?: { ref?: unknown; sha?: unknown; repo?: { name?: unknown; owner?: { login?: unknown } } };
  base?: { ref?: unknown };
}

export class GitHubRepositoryHostingProvider implements RepositoryHostingProvider {
  readonly kind = 'github';
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs?: number;

  constructor(config: GitHubHostingConfig) {
    const token = typeof config?.token === 'string' ? config.token.trim() : '';
    if (token.length === 0) throw new Error('github hosting: a non-empty token is required');
    this.token = token;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs;
  }

  async repositoryExists(identity: RepositoryIdentity): Promise<boolean> {
    const res = await this.request('repositoryExists', 'GET', `/repos/${enc(identity.owner)}/${enc(identity.repo)}`);
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    throw this.statusError('repositoryExists', res.status);
  }

  async branchExists(identity: RepositoryIdentity, branch: string): Promise<boolean> {
    // The whole branch name is a single path segment; slashes are encoded (CA change 5). branchExists proves
    // only that the branch endpoint returned 200 — it does NOT verify commit reachability, and the branch
    // commit SHA is intentionally not read/exposed here (CA change 8).
    const res = await this.request(
      'branchExists',
      'GET',
      `/repos/${enc(identity.owner)}/${enc(identity.repo)}/branches/${enc(branch)}`,
    );
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    throw this.statusError('branchExists', res.status);
  }

  async findOpenPullRequest(
    identity: RepositoryIdentity,
    headBranch: string,
    baseBranch: string,
  ): Promise<PullRequestResult | null> {
    // Same-repository head only (forks unsupported): head = "<owner>:<headBranch>", encoded for the query.
    const head = `${identity.owner}:${headBranch}`;
    const query = `state=open&head=${encodeURIComponent(head)}&base=${encodeURIComponent(baseBranch)}`;
    const res = await this.request(
      'findOpenPullRequest',
      'GET',
      `/repos/${enc(identity.owner)}/${enc(identity.repo)}/pulls?${query}`,
    );
    if (res.status !== 200) throw this.statusError('findOpenPullRequest', res.status); // 404 → throw, NOT "no PR"
    const arr = await this.json(res, 'findOpenPullRequest');
    if (!Array.isArray(arr)) throw this.parseError('findOpenPullRequest');
    if (arr.length === 0) return null;
    if (arr.length > 1) throw new Error('github hosting: multiple open pull requests match head/base (ambiguous)');
    return this.mapPull(arr[0] as GitHubPull, identity, 'findOpenPullRequest');
  }

  async createPullRequest(input: PullRequestCreationInput): Promise<PullRequestResult> {
    // Minimal, explicit body ONLY — no draft/maintainer_can_modify/issue/labels/assignees/reviewers/milestone
    // (CA change 12). Raw branch strings go in the JSON body (never URL-concatenated).
    const body = { title: input.title, head: input.headBranch, base: input.baseBranch, body: input.body };
    const res = await this.request(
      'createPullRequest',
      'POST',
      `/repos/${enc(input.identity.owner)}/${enc(input.identity.repo)}/pulls`,
      body,
    );
    if (res.status !== 201) throw this.statusError('createPullRequest', res.status); // 201 only (CA change 11)
    const obj = await this.json(res, 'createPullRequest');
    return this.mapPull(obj as GitHubPull, input.identity, 'createPullRequest');
  }

  async getPullRequestStatus(input: {
    identity: RepositoryIdentity;
    pullRequestRef: PullRequestRef;
    expectedHeadBranch: string;
    expectedBaseBranch: string;
    expectedCommitHash: string;
  }): Promise<PullRequestStatusPreview> {
    // READ-ONLY, bounded GETs (CA changes 4/11): one GET per resource, fixed per_page, NO pagination/retry.
    const { identity, pullRequestRef } = input;
    const owner = enc(identity.owner);
    const repo = enc(identity.repo);
    const number = pullRequestRef.pullRequestNumber;

    // 1. GET the pull request.
    const pullRes = await this.request('getPullRequestStatus', 'GET', `/repos/${owner}/${repo}/pulls/${number}`);
    if (pullRes.status !== 200) throw this.statusError('getPullRequestStatus', pullRes.status);
    const pull = (await this.json(pullRes, 'getPullRequestStatus')) as GitHubPull & {
      state?: unknown;
      merged?: unknown;
      draft?: unknown;
    };
    const headRef = pull?.head?.ref;
    const baseRef = pull?.base?.ref;
    const headSha = pull?.head?.sha;
    if (typeof headRef !== 'string' || typeof baseRef !== 'string' || typeof headSha !== 'string') {
      throw new Error('github hosting: getPullRequestStatus returned invalid pull fields');
    }
    const state: PullRequestState =
      pull?.merged === true ? 'merged' : pull?.state === 'open' ? 'open' : pull?.state === 'closed' ? 'closed' : 'unknown';

    // 2. GET check-runs for the head sha (check-runs only for 3e; legacy commit statuses may be unrepresented).
    const checkRes = await this.request(
      'getPullRequestStatus',
      'GET',
      `/repos/${owner}/${repo}/commits/${enc(headSha)}/check-runs?per_page=100`,
    );
    if (checkRes.status !== 200) throw this.statusError('getPullRequestStatus', checkRes.status);
    const checkBody = (await this.json(checkRes, 'getPullRequestStatus')) as {
      total_count?: unknown;
      check_runs?: Array<{ status?: unknown; conclusion?: unknown }>;
    };
    const runs = Array.isArray(checkBody?.check_runs) ? checkBody.check_runs : [];
    let successCount = 0;
    let failureCount = 0;
    let pendingCount = 0;
    for (const r of runs) {
      if (r?.status !== 'completed') pendingCount += 1;
      else if (r?.conclusion === 'success') successCount += 1;
      else if (r?.conclusion === 'failure' || r?.conclusion === 'timed_out' || r?.conclusion === 'cancelled' || r?.conclusion === 'action_required')
        failureCount += 1;
      // neutral/skipped contribute to totalCount but neither success nor failure.
    }
    const totalCount = runs.length;
    const checksState: PullRequestChecksState =
      totalCount === 0 ? 'unknown' : failureCount > 0 ? 'failure' : pendingCount > 0 ? 'pending' : successCount > 0 ? 'success' : 'neutral';

    // 3. GET reviews (latest signal per reviewer).
    const reviewRes = await this.request(
      'getPullRequestStatus',
      'GET',
      `/repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`,
    );
    if (reviewRes.status !== 200) throw this.statusError('getPullRequestStatus', reviewRes.status);
    const reviewArr = (await this.json(reviewRes, 'getPullRequestStatus')) as Array<{
      state?: unknown;
      user?: { login?: unknown };
    }>;
    const latestByUser = new Map<string, string>();
    for (const rv of Array.isArray(reviewArr) ? reviewArr : []) {
      const login = typeof rv?.user?.login === 'string' ? rv.user.login : '';
      const s = typeof rv?.state === 'string' ? rv.state : '';
      if (s === 'APPROVED' || s === 'CHANGES_REQUESTED' || s === 'COMMENTED') latestByUser.set(login, s); // ignore DISMISSED/PENDING
    }
    let approvedCount = 0;
    let changesRequestedCount = 0;
    let commented = 0;
    for (const s of latestByUser.values()) {
      if (s === 'APPROVED') approvedCount += 1;
      else if (s === 'CHANGES_REQUESTED') changesRequestedCount += 1;
      else if (s === 'COMMENTED') commented += 1;
    }
    const reviewsState: PullRequestReviewState =
      changesRequestedCount > 0 ? 'changes_requested' : approvedCount > 0 ? 'approved' : commented > 0 ? 'commented' : 'none';

    return {
      ref: pullRequestRef,
      state,
      headBranch: headRef,
      baseBranch: baseRef,
      headCommitHash: headSha,
      isDraft: pull?.draft === true,
      checks: { state: checksState, totalCount, successCount, failureCount, pendingCount },
      reviews: { state: reviewsState, approvedCount, changesRequestedCount },
      // observedAt is generated internally at read time — never caller/user-supplied (CA change 3).
      observedAt: new Date().toISOString(),
    };
  }

  /** Map a GitHub PR object to a provider-reported PullRequestResult, rejecting fork/invalid results. */
  private mapPull(item: GitHubPull, identity: RepositoryIdentity, op: string): PullRequestResult {
    // Same-repository only — fork PRs rejected (CA change 7).
    if (item?.head?.repo?.owner?.login !== identity.owner || item?.head?.repo?.name !== identity.repo) {
      throw new Error(`github hosting: ${op} rejected a cross-repository (fork) pull request`);
    }
    const number = item?.number;
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) {
      throw new Error(`github hosting: ${op} returned an invalid PR number`);
    }
    const headSha = item?.head?.sha;
    if (typeof headSha !== 'string' || !SHA_SHAPED.test(headSha)) {
      throw new Error(`github hosting: ${op} returned an invalid head.sha`);
    }
    const url = item?.html_url;
    if (typeof url !== 'string' || !isSafeGitHubPullRequestUrl(url, identity, number)) {
      throw new Error(`github hosting: ${op} returned an invalid PR URL`);
    }
    const headRef = item?.head?.ref;
    const baseRef = item?.base?.ref;
    if (typeof headRef !== 'string' || typeof baseRef !== 'string') {
      throw new Error(`github hosting: ${op} returned invalid head/base refs`);
    }
    return {
      provider: 'github',
      owner: identity.owner,
      repo: identity.repo,
      pullRequestNumber: number,
      pullRequestUrl: url,
      pullRequestHeadBranch: headRef,
      pullRequestBaseBranch: baseRef,
      pullRequestCommitHash: headSha,
      reused: false, // manager finalizes the path-derived flag
    };
  }

  /** Single `fetch` per call (no retry — CA change 13). Sanitized failures (no token/body/headers). */
  private async request(
    op: string,
    method: 'GET' | 'POST',
    path: string,
    jsonBody?: unknown,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent': USER_AGENT,
    };
    const init: RequestInit = { method, headers };
    if (jsonBody !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(jsonBody);
    }
    if (this.timeoutMs !== undefined) init.signal = AbortSignal.timeout(this.timeoutMs);
    try {
      return await this.fetchImpl(`${GITHUB_API_BASE}${path}`, init);
    } catch {
      // Never echo the request/body/token or the raw cause.
      throw new Error(`github hosting: ${op} request failed`);
    }
  }

  /** Bounded, deterministic status error — never includes the token or the raw response body (CA change 15). */
  private statusError(op: string, status: number): Error {
    if (status === 401 || status === 403) return new Error(`github hosting: ${op} unavailable (authorization failed)`);
    return new Error(`github hosting: ${op} failed with status ${status}`);
  }

  private parseError(op: string): Error {
    return new Error(`github hosting: ${op} returned an unexpected response`);
  }

  private async json(res: Response, op: string): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw this.parseError(op);
    }
  }
}

/** Encode a single REST path segment (owner/repo/branch); encodes `/` in branch names too (CA change 5). */
function enc(segment: string): string {
  return encodeURIComponent(segment);
}
