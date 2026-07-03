import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

/** Build a minimal env with only the given keys set (Sprint 3d-A, ADR-0051, CA change 8). */
function env(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return overrides as NodeJS.ProcessEnv;
}

describe('loadConfig — repositoryHosting (Sprint 3d-A, ADR-0051, CA change 8)', () => {
  it('reads CHUNSIK_GITHUB_OWNER / CHUNSIK_GITHUB_REPO into repositoryHosting; provider fixed github (test 42)', () => {
    const cfg = loadConfig(env({ CHUNSIK_GITHUB_OWNER: 'acme', CHUNSIK_GITHUB_REPO: 'widgets' }));
    expect(cfg.repositoryHosting).toEqual({ provider: 'github', owner: 'acme', repo: 'widgets' });
  });

  it('leaves repositoryHosting undefined when both owner and repo are absent (test 45)', () => {
    expect(loadConfig(env({})).repositoryHosting).toBeUndefined();
  });

  it('does not read CHUNSIK_GITHUB_PROVIDER — provider is always github (test 44)', () => {
    const cfg = loadConfig(
      env({ CHUNSIK_GITHUB_OWNER: 'acme', CHUNSIK_GITHUB_REPO: 'widgets', CHUNSIK_GITHUB_PROVIDER: 'gitlab' }),
    );
    expect(cfg.repositoryHosting?.provider).toBe('github');
  });

  it('reads no token env var into repositoryHosting — only provider/owner/repo keys (tests 43/52/54)', () => {
    const cfg = loadConfig(
      env({
        CHUNSIK_GITHUB_OWNER: 'acme',
        CHUNSIK_GITHUB_REPO: 'widgets',
        CHUNSIK_GITHUB_TOKEN: 'ghp_shouldNotAppear',
        GITHUB_TOKEN: 'ghp_alsoNot',
      }),
    );
    expect(Object.keys(cfg.repositoryHosting ?? {}).sort()).toEqual(['owner', 'provider', 'repo']);
    expect(JSON.stringify(cfg.repositoryHosting)).not.toContain('ghp_');
    expect(JSON.stringify(cfg.repositoryHosting ?? {})).not.toMatch(/token/i);
  });

  it('creates raw config when only one of owner/repo is present (resolver later classifies validity)', () => {
    expect(loadConfig(env({ CHUNSIK_GITHUB_OWNER: 'acme' })).repositoryHosting).toEqual({
      provider: 'github',
      owner: 'acme',
      repo: '',
    });
    expect(loadConfig(env({ CHUNSIK_GITHUB_REPO: 'widgets' })).repositoryHosting).toEqual({
      provider: 'github',
      owner: '',
      repo: 'widgets',
    });
  });
});

describe('loadConfig — githubToken (Sprint 3d-D, ADR-0054, CA change 3/6)', () => {
  it('reads CHUNSIK_GITHUB_TOKEN into githubToken (adapter-local, never into repositoryHosting)', () => {
    const cfg = loadConfig(env({ CHUNSIK_GITHUB_OWNER: 'acme', CHUNSIK_GITHUB_REPO: 'widgets', CHUNSIK_GITHUB_TOKEN: 'ghp_secret' }));
    expect(cfg.githubToken).toBe('ghp_secret');
    // the token never leaks into the identity config
    expect(JSON.stringify(cfg.repositoryHosting)).not.toContain('ghp_secret');
    expect(Object.keys(cfg.repositoryHosting ?? {}).sort()).toEqual(['owner', 'provider', 'repo']);
  });
  it('leaves githubToken undefined when unset', () => {
    expect(loadConfig(env({ CHUNSIK_GITHUB_OWNER: 'acme', CHUNSIK_GITHUB_REPO: 'widgets' })).githubToken).toBeUndefined();
  });
});
