/**
 * Repository Hosting domain — identity configuration subset (CAP-010, ADR-0051, Sprint 3d-A).
 *
 * This is the **config-only** subset of the future Repository Hosting capability (ADR-0050): the safe,
 * reviewed source of `provider/owner/repo` a FUTURE PR-creation execution sprint (3d-C) will consume. Sprint
 * 3d-A performs **no** hosting mutation, holds **no** auth token, calls **no** GitHub API, and never exposes a
 * git remote URL — `RepositoryInfo` (CAP-002, ADR-0023) intentionally excludes remote URLs and is unchanged.
 * github.com only; GitHub Enterprise is deferred.
 */

/** Supported hosting providers. `github` only for the first implementation; GitHub Enterprise deferred. */
export type RepositoryHostingProviderKind = 'github';

/** Owner (GitHub login) max length. */
export const MAX_REPO_OWNER = 39;
/** Repository name max length. */
export const MAX_REPO_NAME = 100;

/**
 * A validated, safe repository identity for future PR creation. By construction it carries **no token** and
 * **no remote URL** — it has only `provider`/`owner`/`repo`, so a secret cannot be represented as identity
 * (ADR-0051, Q5). Small immutable value object (mirrors the V2 value-object style).
 */
export interface RepositoryIdentity {
  provider: RepositoryHostingProviderKind;
  owner: string;
  repo: string;
}

/**
 * RAW, pre-validation configuration shape read from the environment (or a future config source). Same three
 * fields as {@link RepositoryIdentity} but UNVALIDATED — it is never handed to Repository Hosting directly; it
 * must pass through `RepositoryIdentityResolver` first (ADR-0051, Q4). `provider` is a plain string here and
 * is validated by the resolver. **No token field.**
 */
export interface RepositoryIdentityConfig {
  provider: string;
  owner: string;
  repo: string;
}

/** True when `p` is a supported hosting provider (`github` only for 3d-A; GHE deferred). */
export function isSupportedHostingProvider(p: unknown): p is RepositoryHostingProviderKind {
  return p === 'github';
}

/**
 * Conservative secret/token detector (ADR-0051, CA change 1). Case-insensitive. Rejects known GitHub token
 * prefixes and obvious credential-like substrings so a token-shaped string can never be accepted as an
 * `owner`/`repo`. **False rejection is acceptable** for identity config (a repo literally named e.g.
 * "token-service" is conservatively rejected — configure it differently).
 */
const SECRET_PREFIXES = ['ghp_', 'github_pat_', 'gho_', 'ghu_', 'ghs_', 'ghr_'];
const SECRET_SUBSTRINGS = ['token', 'secret', 'password', 'pat_'];
export function looksLikeSecret(value: string): boolean {
  const v = value.toLowerCase();
  return SECRET_PREFIXES.some((p) => v.startsWith(p)) || SECRET_SUBSTRINGS.some((s) => v.includes(s));
}

/**
 * Safe GitHub owner (login): 1..39 chars, alphanumeric with single, non-leading, non-trailing, non-consecutive
 * hyphens (`/^[A-Za-z0-9](?:-?[A-Za-z0-9])*$/`). Rejects whitespace/control/`/`/`:`/`@`/`.` and every URL
 * character by construction, plus token-shaped values (ADR-0051, CA changes 1/4).
 */
export function isSafeRepoOwner(s: unknown): s is string {
  return (
    typeof s === 'string' &&
    s.length <= MAX_REPO_OWNER &&
    /^[A-Za-z0-9](?:-?[A-Za-z0-9])*$/.test(s) &&
    !looksLikeSecret(s)
  );
}

/**
 * Safe GitHub repository name (conservative for product config): 1..100 chars from `[A-Za-z0-9._-]`; never
 * `.`/`..`; **no leading dot** (CA change 6); **no `.git` suffix** (CA change 5); not token-shaped (CA change
 * 1). Rejects whitespace/control/`/`/`:`/`@` and URL characters by construction.
 */
export function isSafeRepoName(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(s)) return false;
  if (s === '.' || s === '..') return false;
  if (s.startsWith('.')) return false; // CA change 6 — no leading dot for product config
  if (/\.git$/i.test(s)) return false; // CA change 5 — no ".git" suffix (remote-URL/path confusion signal)
  if (looksLikeSecret(s)) return false; // CA change 1 — token-shaped value
  return true;
}

// ─── Sprint 3d-B (ADR-0052) — RepositoryHosting SKELETON types ──────────────────────────────────────────────
// The non-mutating shape a FUTURE PR-creation execution sprint (3d-C+) will use. No adapter, no GitHub API, no
// PR creation exists in 3d-B — only these types + a port + a manager, exercised by fake providers in tests.

/** Bounded PR subject (non-empty required after normalization). */
export const MAX_PR_TITLE = 200;
/** Bounded PR body. */
export const MAX_PR_BODY = 8000;

/**
 * Input to `RepositoryHostingManager.createPullRequest` — assembled (future) from a live `PR_APPROVED` anchor +
 * a configured {@link RepositoryIdentity}. Bounded/sanitized fields ONLY. Deliberately has **no** `ApprovalRef`
 * (that is Manager input, not provider input), **no** token, **no** raw diff, **no** file content, **no** GitHub
 * SDK type, **no** git remote URL, and **no** `pushedRemote` (upstream/remote context belongs to the prior Git
 * push anchor, not to a hosting-provider input) — Sprint 3d-B CA changes 6/7, Q2.
 */
export interface PullRequestCreationInput {
  identity: RepositoryIdentity;
  headBranch: string;
  baseBranch: string;
  title: string;
  body: string;
  expectedCommitHash: string;
}

/**
 * PROVIDER-REPORTED pull-request creation/open result — **NOT an independent verification** beyond what the
 * provider returned (mirrors `GitPushResult`, ADR-0048). The Manager validates its integrity against the
 * request (incl. `pullRequestCommitHash === expectedCommitHash`) and finalizes {@link PullRequestResult.reused}
 * by the taken path; it must not overclaim (Q3).
 */
export interface PullRequestResult {
  provider: RepositoryHostingProviderKind;
  owner: string;
  repo: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  pullRequestHeadBranch: string;
  pullRequestBaseBranch: string;
  pullRequestCommitHash: string;
  /** Manager-owned path semantic: `true` via the existing-open-PR path, `false` via the create path — the
   *  provider-reported value is not trusted (Q3/CA change 3). */
  reused: boolean;
}

/** Durable, repository-scoped handle (a PR number is meaningless without provider/owner/repo — Q4). */
export interface PullRequestRef {
  provider: RepositoryHostingProviderKind;
  owner: string;
  repo: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
}

/** Pure derivation of a {@link PullRequestRef} from a {@link PullRequestResult} (mirrors `executionPlanRef`). */
export function pullRequestRef(r: PullRequestResult): PullRequestRef {
  return {
    provider: r.provider,
    owner: r.owner,
    repo: r.repo,
    pullRequestNumber: r.pullRequestNumber,
    pullRequestUrl: r.pullRequestUrl,
  };
}

/**
 * Deterministic PR-title normalization (Sprint 3d-B, CA change 2): collapse every whitespace run to a single
 * space and trim. Returns `''` for a non-string or all-whitespace input (the Manager rejects an empty result).
 * The provider receives the NORMALIZED title, never the raw one.
 */
export function normalizePrTitle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * PR-URL validation (Sprint 3d-B, CA changes 8/9, Q11). Accepts ONLY the canonical github.com PR URL for the
 * given identity + number: `https://github.com/<owner>/<repo>/pull/<number>` — https only, github.com host,
 * exact path, exact owner/repo casing, **no** credentials/userinfo, **no** query string, **no** fragment, **no**
 * percent-encoding, bounded length. GitHub Enterprise is deferred. Implemented as an exact string match against
 * the canonical URL (the identity's owner/repo are already validated safe), with explicit `@`/`?`/`#`/`%` guards
 * documenting the rejected shapes.
 */
export function isSafeGitHubPullRequestUrl(
  url: unknown,
  identity: RepositoryIdentity,
  prNumber: number,
): boolean {
  if (typeof url !== 'string') return false;
  if (url.length === 0 || url.length > 300) return false; // bounded
  if (url.includes('@') || url.includes('?') || url.includes('#') || url.includes('%')) return false; // no creds/query/fragment/percent-encoding
  if (!Number.isInteger(prNumber) || prNumber <= 0) return false;
  return url === `https://github.com/${identity.owner}/${identity.repo}/pull/${prNumber}`;
}

// ─── Sprint 3e (ADR-0055) — read-only Pull Request STATUS PREVIEW types ─────────────────────────────────────
// Point-in-time, provider-reported, bounded status of an existing PR_CREATED PR. NOT a durable verified /
// safe-to-merge state, NOT merge/deploy/release. No raw provider response / token / check logs / review body /
// file paths / diff / file content is ever represented here.

export type PullRequestState = 'open' | 'closed' | 'merged' | 'unknown';
export type PullRequestChecksState = 'success' | 'failure' | 'pending' | 'neutral' | 'skipped' | 'unknown';
export type PullRequestReviewState = 'approved' | 'changes_requested' | 'commented' | 'none' | 'unknown';

/**
 * A bounded, provider-reported, point-in-time PR status observation (Sprint 3e, ADR-0055). `observedAt` is
 * generated internally by the adapter at read time (never caller/user-supplied). All counts are non-negative
 * integers. This is NOT a durable guarantee; it can change immediately after the response.
 */
export interface PullRequestStatusPreview {
  ref: PullRequestRef;
  state: PullRequestState;
  headBranch: string;
  baseBranch: string;
  headCommitHash: string;
  isDraft?: boolean;
  checks: {
    state: PullRequestChecksState;
    totalCount: number;
    successCount: number;
    failureCount: number;
    pendingCount: number;
  };
  reviews?: {
    state: PullRequestReviewState;
    approvedCount?: number;
    changesRequestedCount?: number;
  };
  /** ISO timestamp generated internally at status-read time (adapter/provider clock) — never from user input. */
  observedAt: string;
}
