import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

/** Build a minimal env with only the given keys set (Sprint 3d-A, ADR-0051, CA change 8). */
function env(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return overrides as NodeJS.ProcessEnv;
}

describe('loadConfig — ContextBuilder GENERAL_CHAT defaults', () => {
  it('activates ranking, relevance, token budgeting, and compression explicitly', () => {
    expect(loadConfig(env({})).contextBuilder).toEqual({
      rankingEnabled: true,
      compressionEnabled: true,
      maxTokens: 1024,
      recencyWeight: 0.4,
      relevanceWeight: 0.6,
      compressionConfig: { minimumCharactersPerEntry: 80 },
    });
  });
});

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

describe('loadConfig — dormant Provider routing activation (Stage 2B Slice 5C-I)', () => {
  it('maps missing and exact legacy to legacy', () => {
    expect(loadConfig(env({})).providerRoutingMode).toBe('legacy');
    expect(loadConfig(env({ QUOKY_PROVIDER_ROUTING_MODE: 'legacy' })).providerRoutingMode).toBe('legacy');
  });

  it('accepts only the exact enabled candidate', () => {
    expect(loadConfig(env({ QUOKY_PROVIDER_ROUTING_MODE: 'stage2b-general-chat-v1' })).providerRoutingMode).toBe(
      'stage2b-general-chat-v1',
    );
  });

  it.each(['', ' ', ' legacy ', 'LEGACY', 'Stage2b-general-chat-v1', 'true', '1', 'yes', 'enabled', 'on'])(
    'rejects invalid exact value %j',
    (value) => {
      expect(() => loadConfig(env({ QUOKY_PROVIDER_ROUTING_MODE: value }))).toThrow(
        'PROVIDER_ROUTING_INVALID_MODE',
      );
    },
  );

  it('uses identical parsing in dev and prod', () => {
    for (const runtime of ['dev', 'prod']) {
      expect(
        loadConfig(env({ QUOKY_RUNTIME_ENV: runtime, QUOKY_PROVIDER_ROUTING_MODE: 'legacy' }))
          .providerRoutingMode,
      ).toBe('legacy');
      expect(() =>
        loadConfig(env({ QUOKY_RUNTIME_ENV: runtime, QUOKY_PROVIDER_ROUTING_MODE: 'LEGACY' })),
      ).toThrow('PROVIDER_ROUTING_INVALID_MODE');
    }
  });

  it('does not read a CHUNSIK_PROVIDER_ROUTING_MODE alias', () => {
    expect(loadConfig(env({ CHUNSIK_PROVIDER_ROUTING_MODE: 'stage2b-general-chat-v1' })).providerRoutingMode).toBe(
      'legacy',
    );
  });
});

describe('loadConfig — Actor identity mappings (M3A-1.1)', () => {
  it('parses one or more explicit non-secret Discord-to-work identity mappings', () => {
    const actorIdentityMappings = [
      { actor: { platform: 'discord', externalId: ' discord-1 ' }, identities: { jira: ' account-123 ', github: 'octocat' } },
      { actor: { platform: 'discord', externalId: 'discord-2' }, identities: { github: 'hub-user' } },
    ];
    expect(loadConfig(env({ QUOKY_ACTOR_IDENTITY_MAPPINGS: JSON.stringify(actorIdentityMappings) })).actorIdentityMappings)
      .toEqual([
        { actor: { platform: 'discord', externalId: 'discord-1' }, identities: { jira: 'account-123', github: 'octocat' } },
        { actor: { platform: 'discord', externalId: 'discord-2' }, identities: { github: 'hub-user' } },
      ]);
  });

  it('defaults to no mappings when the variable is absent or blank', () => {
    expect(loadConfig(env({})).actorIdentityMappings).toEqual([]);
    expect(loadConfig(env({ QUOKY_ACTOR_IDENTITY_MAPPINGS: '  ' })).actorIdentityMappings).toEqual([]);
  });

  it.each([
    ['invalid JSON', '{'],
    ['non-array root', '{}'],
    ['blank locator', JSON.stringify([{ actor: { platform: 'discord', externalId: ' ' }, identities: { jira: 'x' } }])],
    ['wrong locator platform', JSON.stringify([{ actor: { platform: 'slack', externalId: 'x' }, identities: { jira: 'x' } }])],
    ['blank Jira identity', JSON.stringify([{ actor: { platform: 'discord', externalId: 'x' }, identities: { jira: ' ' } }])],
    ['invalid GitHub login', JSON.stringify([{ actor: { platform: 'discord', externalId: 'x' }, identities: { github: 'not a login' } }])],
    ['credential-shaped unknown field', JSON.stringify([{ actor: { platform: 'discord', externalId: 'x' }, identities: { jira: 'x', token: 'secret' } }])],
    ['empty identities', JSON.stringify([{ actor: { platform: 'discord', externalId: 'x' }, identities: {} }])],
    ['different same-platform mappings', JSON.stringify([
      { actor: { platform: 'discord', externalId: 'x' }, identities: { jira: 'one' } },
      { actor: { platform: 'discord', externalId: 'x' }, identities: { jira: 'two' } },
    ])],
    ['same target assigned to different locators', JSON.stringify([
      { actor: { platform: 'discord', externalId: 'x' }, identities: { jira: 'one' } },
      { actor: { platform: 'discord', externalId: 'y' }, identities: { jira: 'one' } },
    ])],
  ])('fails closed for %s', (_case, value) => {
    expect(() => loadConfig(env({ QUOKY_ACTOR_IDENTITY_MAPPINGS: value }))).toThrow(/ACTOR_IDENTITY_MAPPING/);
  });
});

describe('loadConfig — static AgentProfile configuration (M3E-6H, ADR-0089)', () => {
  const profile = {
    id: 'receiver', displayName: 'Receiver', role: 'implementer',
    purpose: 'continue delegated work', instructions: 'Follow the handoff objective.',
  };

  it('defaults to no profiles when the variable is absent or blank, keeping continuation fail-closed', () => {
    expect(loadConfig(env({})).agentProfiles).toEqual([]);
    expect(loadConfig(env({ QUOKY_AGENT_PROFILES: '   ' })).agentProfiles).toEqual([]);
  });

  it('accepts an explicit empty array without activating anything', () => {
    expect(loadConfig(env({ QUOKY_AGENT_PROFILES: '[]' })).agentProfiles).toEqual([]);
  });

  it('parses one profile using exactly the five existing domain fields', () => {
    expect(loadConfig(env({ QUOKY_AGENT_PROFILES: JSON.stringify([profile]) })).agentProfiles).toEqual([profile]);
  });

  it('parses multiple profiles deterministically and preserves exact ids', () => {
    const second = { ...profile, id: 'source', displayName: 'Source' };
    const parsed = loadConfig(env({ QUOKY_AGENT_PROFILES: JSON.stringify([second, profile]) })).agentProfiles;
    expect(parsed.map((entry) => entry.id)).toEqual(['receiver', 'source']);
    expect(parsed).toEqual([profile, second]);
  });

  it('freezes each parsed profile so no caller can mutate configuration', () => {
    const [parsed] = loadConfig(env({ QUOKY_AGENT_PROFILES: JSON.stringify([profile]) })).agentProfiles;
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it.each([
    ['invalid JSON', '{'],
    ['non-array root', '{}'],
    ['entry wrong type', JSON.stringify(['receiver'])],
    ['null entry', JSON.stringify([null])],
    ['missing required field', JSON.stringify([{ ...profile, instructions: undefined }])],
    ['wrong field type', JSON.stringify([{ ...profile, role: 7 }])],
    ['blank required field', JSON.stringify([{ ...profile, purpose: '   ' }])],
    ['invalid id shape', JSON.stringify([{ ...profile, id: 'not a valid id' }])],
    ['duplicate id', JSON.stringify([profile, { ...profile, displayName: 'Other' }])],
    ['provider pin unknown field', JSON.stringify([{ ...profile, providerId: 'claude' }])],
    ['credential-shaped unknown field', JSON.stringify([{ ...profile, apiKey: 'shhh' }])],
    ['tool allowlist unknown field', JSON.stringify([{ ...profile, tools: ['shell'] }])],
    ['capability grant unknown field', JSON.stringify([{ ...profile, capabilities: ['CODE_GENERATION'] }])],
    ['approval grant unknown field', JSON.stringify([{ ...profile, approved: true }])],
    ['executable path unknown field', JSON.stringify([{ ...profile, executablePath: '/bin/sh' }])],
    ['oversized instructions', JSON.stringify([{ ...profile, instructions: 'x'.repeat(16_385) }])],
    ['too many entries', JSON.stringify(Array.from({ length: 65 }, (_unused, index) => ({ ...profile, id: `p${index}` })))],
  ])('fails closed for %s', (_case, value) => {
    expect(() => loadConfig(env({ QUOKY_AGENT_PROFILES: value }))).toThrow(/AGENT_PROFILE/);
  });

  it('fails closed on an oversized payload without parsing it', () => {
    expect(() => loadConfig(env({ QUOKY_AGENT_PROFILES: `"${'x'.repeat(1_048_576)}"` })))
      .toThrow('AGENT_PROFILES_PAYLOAD_TOO_LARGE');
  });

  it('never echoes raw instructions, secret-like content or the payload in configuration errors', () => {
    const leaky = JSON.stringify([{
      ...profile, instructions: 'SENTINEL-INSTRUCTIONS-DO-NOT-ECHO', apiKey: 'SENTINEL-SECRET-VALUE',
    }]);
    try {
      loadConfig(env({ QUOKY_AGENT_PROFILES: leaky }));
      throw new Error('expected configuration to fail closed');
    } catch (error) {
      const text = `${(error as Error).message}${(error as Error).stack ?? ''}`;
      expect(text).toContain('AGENT_PROFILE_0_UNKNOWN_FIELD');
      expect(text).not.toContain('SENTINEL-INSTRUCTIONS-DO-NOT-ECHO');
      expect(text).not.toContain('SENTINEL-SECRET-VALUE');
      expect(text).not.toContain(leaky);
    }
  });

  it('reports the failing configuration key with a bounded index and reason', () => {
    const value = JSON.stringify([profile, { ...profile, id: 'second', role: 5 }]);
    expect(() => loadConfig(env({ QUOKY_AGENT_PROFILES: value }))).toThrow('AGENT_PROFILE_1_ROLE_INVALID');
  });
});

describe('Product namespace environment compatibility', () => {
  const values = {
    DB_PATH: '/fixture/data.db', VECTOR_PATH: '/fixture/vectors', WORKSPACE_ROOT: '/fixture/work',
    GITHUB_OWNER: 'canonical-owner', GITHUB_REPO: 'canonical-repo', GITHUB_TOKEN: 'fixture-pat',
    JIRA_BASE_URL: 'https://jira.example.test', JIRA_EMAIL: 'fixture@example.test', JIRA_TOKEN: 'fixture-jira',
    SLACK_TOKEN: 'fixture-slack', CONFLUENCE_BASE_URL: 'https://confluence.example.test',
    CONFLUENCE_TOKEN: 'fixture-confluence',
  };
  const expected = {
    storage: { dbPath: values.DB_PATH }, vector: { storePath: values.VECTOR_PATH },
    workspace: { workspaceRoot: values.WORKSPACE_ROOT },
    repositoryHosting: { provider: 'github', owner: values.GITHUB_OWNER, repo: values.GITHUB_REPO },
    githubToken: values.GITHUB_TOKEN,
    connectors: {
      jira: { host: values.JIRA_BASE_URL, email: values.JIRA_EMAIL, apiToken: values.JIRA_TOKEN },
      slack: { token: values.SLACK_TOKEN },
      confluence: { host: values.CONFLUENCE_BASE_URL, token: values.CONFLUENCE_TOKEN },
    },
  };
  const named = (prefix: string, entries: Record<string, string>) =>
    Object.fromEntries(Object.entries(entries).map(([key, value]) => [`${prefix}_${key}`, value]));

  it.each(['QUOKY', 'CHUNSIK'])('accepts %s-only configuration for every migrated setting', (prefix) => {
    expect(loadConfig(named(prefix, values))).toMatchObject(expected);
  });

  it('prefers every canonical value when both namespaces are defined', () => {
    const legacy = Object.fromEntries(Object.keys(values).map(key => [key, 'legacy-value']));
    expect(loadConfig({ ...named('CHUNSIK', legacy), ...named('QUOKY', values) })).toMatchObject(expected);
  });

  it('preserves defaults when both namespaces are absent', () => {
    expect(loadConfig({})).toMatchObject({
      storage: { dbPath: './data/chunsik.db' }, vector: { storePath: './data/vectors' },
      workspace: { workspaceRoot: process.cwd() },
      githubToken: undefined, repositoryHosting: undefined,
      connectors: { jira: undefined, slack: undefined, confluence: undefined },
    });
  });

  it('does not resurrect legacy values when canonical settings are explicitly empty', () => {
    const empty = Object.fromEntries(Object.keys(values).map(key => [key, '']));
    expect(loadConfig({ ...named('CHUNSIK', values), ...named('QUOKY', empty) })).toMatchObject({
      storage: { dbPath: '' }, vector: { storePath: '' }, workspace: { workspaceRoot: '' },
      githubToken: '', repositoryHosting: undefined,
      connectors: { jira: undefined, slack: undefined, confluence: undefined },
    });
  });

  it('keeps existing App settings and runtime mode alongside the canonical dev PAT', () => {
    expect(loadConfig({ ...named('QUOKY', values), QUOKY_RUNTIME_ENV: 'prod',
      QUOKY_GITHUB_APP_ID: '123', QUOKY_GITHUB_APP_PRIVATE_KEY: 'synthetic-fixture-key',
      QUOKY_GITHUB_APP_INSTALLATION_ID: '456',
    })).toMatchObject({ githubToken: values.GITHUB_TOKEN, runtimeEnv: 'prod',
      githubApp: { appId: '123', privateKeyPem: 'synthetic-fixture-key' }, githubAppInstallationId: 456 });
    // Authentication selection/rejection remains at the existing composition boundary.
  });
});
