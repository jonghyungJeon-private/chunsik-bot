import { ApprovalStatus } from '../domain';
import {
  MAX_PR_BODY,
  MAX_PR_TITLE,
  isSafeGitHubPullRequestUrl,
  isSafeRepoName,
  isSafeRepoOwner,
  isSupportedHostingProvider,
  normalizePrTitle,
} from '../domain';
import type {
  ApprovalRef,
  PullRequestCreationInput,
  PullRequestResult,
  RepositoryIdentity,
} from '../domain';
import type { RepositoryHostingProvider } from '../ports';
import { isSafePushBranch } from './push-target';

/** SHA-shape guard (mirrors `GitManager.pushApprovedCommit` — Sprint 3a). */
const SHA_SHAPED = /^[0-9a-f]{7,40}$/i;

/**
 * PR creation failed **before any mutating call was made** (approval/input/identity invalid, repository/branch
 * missing, existing-PR lookup unavailable/ambiguous, existing-PR result invalid). Definitively **no** Pull
 * Request was created — a caller may safely say "PR은 만들지 않았어요" (Sprint 3d-D, ADR-0054, CA change 6).
 */
export class RepositoryHostingBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepositoryHostingBlockedError';
  }
}

/**
 * The mutating `createPullRequest` call was **attempted** but could not be completed/verified (request failed
 * after the POST may have reached the provider, or the created result failed integrity). A Pull Request **may**
 * have been created — a caller must **not** claim no PR was created; say "확인하지 못했어요" instead (Sprint
 * 3d-D, ADR-0054, CA change 6).
 */
export class RepositoryHostingUnverifiedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepositoryHostingUnverifiedError';
  }
}

/**
 * Thin orchestration over a {@link RepositoryHostingProvider} — the RepositoryHosting capability skeleton
 * (CAP-010, ADR-0052 — Sprint 3d-B). **Non-mutating in product runtime:** no real provider is bound; only
 * fake providers in unit tests exercise this. A successful unit test means the Manager boundary behaves
 * correctly with a fake provider — it does **not** mean product PR creation works.
 *
 * The Manager owns approval gating, input validation, provider-kind matching, deterministic title
 * normalization, **call ordering**, existing-PR reuse, the manager-owned `reused` flag, and result-integrity
 * validation (incl. `pullRequestCommitHash === expectedCommitHash`). Mirrors `GitManager`'s Ref-gating: the
 * `ApprovalRef` is consumed here and **never** passed to the provider; the provider receives only the bounded
 * {@link PullRequestCreationInput} (no ApprovalRef/token/raw diff/file content/remote). Raw provider errors are
 * never forwarded — the Manager throws bounded, deterministic capability errors only.
 */
export class RepositoryHostingManager {
  constructor(private readonly provider: RepositoryHostingProvider) {}

  async createPullRequest(input: {
    identity: RepositoryIdentity;
    headBranch: string;
    baseBranch: string;
    title: string;
    body: string;
    expectedCommitHash: string;
    approvalRef: ApprovalRef;
  }): Promise<PullRequestResult> {
    const { identity, headBranch, baseBranch, body, expectedCommitHash, approvalRef } = input;

    // ── Backstop validation BEFORE any provider call (mirrors GitManager). All → BlockedError (no mutation). ─
    if (approvalRef.status !== ApprovalStatus.APPROVED) {
      throw new RepositoryHostingBlockedError(
        `repository hosting: PR creation requires an APPROVED approval (got ${approvalRef.status})`,
      );
    }
    // provider.kind must match identity.provider (CA change 1 / Q10) — a mismatched composition must not run.
    if (this.provider.kind !== identity.provider) {
      throw new RepositoryHostingBlockedError('repository hosting: provider kind does not match identity provider');
    }
    if (!isSupportedHostingProvider(identity.provider)) {
      throw new RepositoryHostingBlockedError('repository hosting: unsupported hosting provider');
    }
    if (!isSafeRepoOwner(identity.owner) || !isSafeRepoName(identity.repo)) {
      throw new RepositoryHostingBlockedError('repository hosting: unsafe repository identity');
    }
    if (!isSafePushBranch(headBranch)) throw new RepositoryHostingBlockedError('repository hosting: unsafe head branch');
    if (!isSafePushBranch(baseBranch)) throw new RepositoryHostingBlockedError('repository hosting: unsafe base branch');
    if (headBranch === baseBranch) {
      throw new RepositoryHostingBlockedError('repository hosting: head and base branch must differ');
    }
    // Deterministic title normalization (CA change 2) — the provider receives the normalized title.
    const title = normalizePrTitle(input.title);
    if (title.length === 0) throw new RepositoryHostingBlockedError('repository hosting: PR title is empty after normalization');
    if (title.length > MAX_PR_TITLE) throw new RepositoryHostingBlockedError('repository hosting: PR title exceeds bound');
    if (typeof body !== 'string' || body.length > MAX_PR_BODY) {
      throw new RepositoryHostingBlockedError('repository hosting: PR body exceeds bound');
    }
    if (!SHA_SHAPED.test(expectedCommitHash)) {
      throw new RepositoryHostingBlockedError('repository hosting: invalid expectedCommitHash');
    }

    const providerInput: PullRequestCreationInput = {
      identity,
      headBranch,
      baseBranch,
      title,
      body,
      expectedCommitHash,
    };

    // ── Ordered read-only hosting-state checks (call ordering, Q6). All failures → BlockedError (no mutation). ─
    if (!(await this.repositoryExists(identity))) {
      throw new RepositoryHostingBlockedError('repository hosting: repository not found on hosting provider');
    }
    if (!(await this.branchExists(identity, headBranch))) {
      throw new RepositoryHostingBlockedError('repository hosting: head branch not found on hosting provider');
    }
    if (!(await this.branchExists(identity, baseBranch))) {
      throw new RepositoryHostingBlockedError('repository hosting: base branch not found on hosting provider');
    }

    // Existing-open-PR lookup (Q8/Q9). If the provider cannot answer (throws) → BLOCK by default (no create).
    let existing: PullRequestResult | null;
    try {
      existing = await this.provider.findOpenPullRequest(identity, headBranch, baseBranch);
    } catch {
      throw new RepositoryHostingBlockedError('repository hosting: could not determine existing pull requests; creation blocked');
    }
    if (existing) {
      // Validate the existing result the same as a new one; commit hash must match expected (CA change 4).
      // An invalid existing result is a pre-mutation BLOCK (no create attempted) — CA change 6.
      try {
        this.assertResultIntegrity(existing, identity, headBranch, baseBranch, expectedCommitHash);
      } catch (err) {
        throw new RepositoryHostingBlockedError(
          err instanceof Error ? err.message : 'repository hosting: existing PR result invalid',
        );
      }
      return { ...existing, reused: true }; // manager-owned reused (CA change 3)
    }

    // ── Single mutating call (only if all checks passed and no existing PR). Failures here → UnverifiedError. ─
    let created: PullRequestResult;
    try {
      created = await this.provider.createPullRequest(providerInput);
    } catch {
      // The POST may have reached the provider — a PR may exist. Do NOT claim it wasn't created.
      throw new RepositoryHostingUnverifiedError('repository hosting: PR creation could not be completed/verified');
    }
    try {
      this.assertResultIntegrity(created, identity, headBranch, baseBranch, expectedCommitHash);
    } catch (err) {
      // Creation was attempted (POST returned) but the result failed integrity — ambiguous, not "no PR".
      throw new RepositoryHostingUnverifiedError(
        err instanceof Error ? err.message : 'repository hosting: PR creation result could not be verified',
      );
    }
    return { ...created, reused: false }; // manager-owned reused (CA change 3)
  }

  private async repositoryExists(identity: RepositoryIdentity): Promise<boolean> {
    try {
      return await this.provider.repositoryExists(identity);
    } catch {
      throw new RepositoryHostingBlockedError('repository hosting: could not verify repository existence');
    }
  }

  private async branchExists(identity: RepositoryIdentity, branch: string): Promise<boolean> {
    try {
      return await this.provider.branchExists(identity, branch);
    } catch {
      throw new RepositoryHostingBlockedError('repository hosting: could not verify branch existence');
    }
  }

  /**
   * Validate a PROVIDER-REPORTED result against the request. Not independent hosting verification — it only
   * checks the provider response is internally consistent with what was asked, incl. `pullRequestCommitHash
   * === expectedCommitHash` (CA change 4). Any mismatch fails safe (throws; no fallback create).
   */
  private assertResultIntegrity(
    r: PullRequestResult,
    identity: RepositoryIdentity,
    headBranch: string,
    baseBranch: string,
    expectedCommitHash: string,
  ): void {
    if (r.provider !== identity.provider || r.owner !== identity.owner || r.repo !== identity.repo) {
      throw new Error('repository hosting: result identity mismatch');
    }
    if (r.pullRequestHeadBranch !== headBranch) throw new Error('repository hosting: result head branch mismatch');
    if (r.pullRequestBaseBranch !== baseBranch) throw new Error('repository hosting: result base branch mismatch');
    if (!Number.isInteger(r.pullRequestNumber) || r.pullRequestNumber <= 0) {
      throw new Error('repository hosting: result PR number invalid');
    }
    if (!SHA_SHAPED.test(r.pullRequestCommitHash)) throw new Error('repository hosting: result commit hash invalid');
    if (r.pullRequestCommitHash !== expectedCommitHash) {
      throw new Error('repository hosting: result commit hash does not match expected');
    }
    if (!isSafeGitHubPullRequestUrl(r.pullRequestUrl, identity, r.pullRequestNumber)) {
      throw new Error('repository hosting: result PR URL invalid');
    }
  }
}
