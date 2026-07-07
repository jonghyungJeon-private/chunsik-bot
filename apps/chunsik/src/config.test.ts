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

describe('loadConfig — GitHub App auth (Sprint 4b, ADR-0061)', () => {
  it('prefers QUOKY_GITHUB_OWNER/REPO and falls back to legacy CHUNSIK_GITHUB_OWNER/REPO', () => {
    expect(loadConfig(env({ QUOKY_GITHUB_OWNER: 'q', QUOKY_GITHUB_REPO: 'r' })).repositoryHosting).toEqual({
      provider: 'github',
      owner: 'q',
      repo: 'r',
    });
    expect(loadConfig(env({ CHUNSIK_GITHUB_OWNER: 'c', CHUNSIK_GITHUB_REPO: 'd' })).repositoryHosting).toEqual({
      provider: 'github',
      owner: 'c',
      repo: 'd',
    });
    // QUOKY_* wins when both are set.
    expect(
      loadConfig(
        env({ QUOKY_GITHUB_OWNER: 'q', QUOKY_GITHUB_REPO: 'r', CHUNSIK_GITHUB_OWNER: 'c', CHUNSIK_GITHUB_REPO: 'd' }),
      ).repositoryHosting,
    ).toEqual({ provider: 'github', owner: 'q', repo: 'r' });
  });

  it('reads QUOKY_GITHUB_APP_ID + QUOKY_GITHUB_APP_PRIVATE_KEY into githubApp; the key never leaks to repositoryHosting', () => {
    const cfg = loadConfig(
      env({
        QUOKY_GITHUB_OWNER: 'q',
        QUOKY_GITHUB_REPO: 'r',
        QUOKY_GITHUB_APP_ID: '123',
        QUOKY_GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----x-----END PRIVATE KEY-----',
      }),
    );
    expect(cfg.githubApp).toEqual({
      appId: '123',
      privateKeyPem: '-----BEGIN PRIVATE KEY-----x-----END PRIVATE KEY-----',
    });
    expect(JSON.stringify(cfg.repositoryHosting)).not.toContain('BEGIN PRIVATE KEY');
  });

  it('leaves githubApp undefined when appId or the private key is missing', () => {
    expect(loadConfig(env({ QUOKY_GITHUB_APP_ID: '123' })).githubApp).toBeUndefined();
    expect(loadConfig(env({ QUOKY_GITHUB_APP_PRIVATE_KEY: 'x' })).githubApp).toBeUndefined();
  });

  it('parses QUOKY_GITHUB_APP_INSTALLATION_ID as a positive integer (else undefined)', () => {
    expect(loadConfig(env({ QUOKY_GITHUB_APP_INSTALLATION_ID: '4242' })).githubAppInstallationId).toBe(4242);
    expect(loadConfig(env({ QUOKY_GITHUB_APP_INSTALLATION_ID: 'nope' })).githubAppInstallationId).toBeUndefined();
  });

  it('derives runtimeEnv: explicit QUOKY_RUNTIME_ENV wins, else NODE_ENV=production → prod, else dev', () => {
    expect(loadConfig(env({ QUOKY_RUNTIME_ENV: 'prod' })).runtimeEnv).toBe('prod');
    expect(loadConfig(env({ QUOKY_RUNTIME_ENV: 'dev', NODE_ENV: 'production' })).runtimeEnv).toBe('dev');
    expect(loadConfig(env({ NODE_ENV: 'production' })).runtimeEnv).toBe('prod');
    expect(loadConfig(env({})).runtimeEnv).toBe('dev');
  });

  it('keeps CHUNSIK_GITHUB_TOKEN as the dev-only PAT (unchanged env)', () => {
    expect(loadConfig(env({ CHUNSIK_GITHUB_TOKEN: 'ghp_x' })).githubToken).toBe('ghp_x');
  });
});
