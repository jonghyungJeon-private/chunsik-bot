import { isSafeRepoName, isSafeRepoOwner, isSupportedHostingProvider } from '../domain';
import type { RepositoryIdentity, RepositoryIdentityConfig } from '../domain';

/**
 * Why a {@link RepositoryIdentityConfig} did not resolve to a validated {@link RepositoryIdentity}. A fixed
 * enum of reasons — never a raw/echoed input value — so a bad config can never leak a secret into the reason
 * (ADR-0051, Q5).
 */
export type RepositoryIdentityMissingReason =
  | 'not-configured' // no config, or both owner and repo absent (CA change 3)
  | 'unsupported-provider' // provider !== 'github'
  | 'invalid-owner'
  | 'invalid-repo';

/** The result of resolving repository identity — either a validated identity or a SAFE missing result. */
export type RepositoryIdentityResolution =
  | { status: 'resolved'; identity: RepositoryIdentity }
  | { status: 'missing'; reason: RepositoryIdentityMissingReason };

/**
 * Turns a possibly-absent/invalid {@link RepositoryIdentityConfig} into a validated {@link RepositoryIdentity}
 * or a **safe missing result** — the detection path a future PR-creation execution sprint (3d-C) maps to a
 * "저장소가 설정되지 않았어요" response (ADR-0051, Q8). Sprint 3d-A does not consume the resolution in any
 * conversation flow.
 *
 * Properties (ADR-0051, CA changes 5/7):
 * - **Pure**: no I/O, no logger dependency (constructor takes no args), never mutates.
 * - **Never throws** — returns `{ status: 'missing' }` for any malformed input.
 * - Builds identity from **exactly** `provider`/`owner`/`repo` — never copies arbitrary keys, so an incidental
 *   token-ish extra field can never leak into the identity.
 */
export class RepositoryIdentityResolver {
  resolve(config: RepositoryIdentityConfig | undefined | null): RepositoryIdentityResolution {
    if (!config) return { status: 'missing', reason: 'not-configured' };
    const owner = typeof config.owner === 'string' ? config.owner : '';
    const repo = typeof config.repo === 'string' ? config.repo : '';
    // CA change 3: both absent → not-configured; one present → invalid-owner / invalid-repo (below).
    if (owner.length === 0 && repo.length === 0) return { status: 'missing', reason: 'not-configured' };
    if (!isSupportedHostingProvider(config.provider)) return { status: 'missing', reason: 'unsupported-provider' };
    if (!isSafeRepoOwner(owner)) return { status: 'missing', reason: 'invalid-owner' };
    if (!isSafeRepoName(repo)) return { status: 'missing', reason: 'invalid-repo' };
    // Copy ONLY provider/owner/repo — never spread `config` (Q5 no-leak).
    return { status: 'resolved', identity: { provider: 'github', owner, repo } };
  }
}
