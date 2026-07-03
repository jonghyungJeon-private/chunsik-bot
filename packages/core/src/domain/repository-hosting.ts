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
