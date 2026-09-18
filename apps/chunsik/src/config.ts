import { readFileSync } from 'node:fs';
import type { ContextBuilderConfig, RepositoryIdentityConfig } from '@chunsik/core';
import { parseProviderRoutingMode } from './provider-routing/provider-routing-activation';
import type { ProviderRoutingMode } from './provider-routing/provider-routing-activation';

/**
 * Reads runtime configuration from the environment. This is the ONLY place
 * env vars are read; everything downstream receives typed config objects.
 */
export interface ChunsikConfig {
  discord: { token: string; guildId?: string };
  storage: { dbPath: string };
  vector: { storePath: string };
  workspace: { workspaceRoot: string };
  ai: { claudeBin: string; codexBin: string; ollamaBin: string; ollamaModel: string };
  connectors: {
    jira?: { host: string; email: string; apiToken: string };
    slack?: { token: string };
    confluence?: { host: string; token: string };
  };
  /**
   * Repository identity for hosting operations (Sprint 3d-A, ADR-0051). RAW/unvalidated here; validated by
   * `RepositoryIdentityResolver` at the composition root. `undefined` when unset (the safe missing path).
   * `provider` is FIXED to `'github'`. Owner/repo prefer the NEW `QUOKY_GITHUB_OWNER`/`QUOKY_GITHUB_REPO`
   * (Sprint 4b, ADR-0061) and fall back to legacy `CHUNSIK_GITHUB_OWNER`/`CHUNSIK_GITHUB_REPO`.
   */
  repositoryHosting?: RepositoryIdentityConfig;
  /**
   * Dev-only PAT for the RepositoryHosting adapter (Sprint 3d-D, ADR-0054; **legacy** env `CHUNSIK_GITHUB_TOKEN`).
   * Adapter-local: never enters `@chunsik/core`, `ConversationRuntime`, an anchor, a reason, a response, or a log.
   * Per ADR-0061 (§13), the PAT path is **dev-only** — rejected in a non-dev runtime by the composition root.
   */
  githubToken?: string;
  /**
   * GitHub App auth (Sprint 4b, ADR-0061) — adapter-local. `appId` (non-secret) + `privateKeyPem` (SECRET,
   * resolved from `QUOKY_GITHUB_APP_PRIVATE_KEY` or the file at `QUOKY_GITHUB_APP_PRIVATE_KEY_PATH`). The private
   * key is passed ONLY to `@quoky/github-app-auth` at the composition root; it never enters `@chunsik/core`,
   * `ConversationRuntime`, an anchor, an approval reason, a response, or a log. `undefined` when appId or key is
   * absent → App auth is "not configured" (fail-safe).
   */
  githubApp?: { appId: string; privateKeyPem: string };
  /** Optional explicit installation id (`QUOKY_GITHUB_APP_INSTALLATION_ID`) — skips owner/repo resolution. */
  githubAppInstallationId?: number;
  /**
   * Runtime mode gating the dev-only PAT fallback (Sprint 4b, ADR-0061 §10.2). Explicit `QUOKY_RUNTIME_ENV`
   * (`'dev'`/`'prod'`) wins; otherwise derived from `NODE_ENV` (`production` → `'prod'`, else `'dev'`).
   */
  runtimeEnv: 'dev' | 'prod';
  /** Dormant Stage 2B routing activation. Missing is exactly equivalent to `legacy`. */
  providerRoutingMode: ProviderRoutingMode;
  /** GENERAL_CHAT context selection policy, consumed only by the composition root. */
  contextBuilder: ContextBuilderConfig;
  /**
   * Non-secret, operator-owned links from an existing Discord Actor to personal-work identities.
   * Parsed and validated at the application boundary; credentials and connector tenancy do not belong here.
   */
  actorIdentityMappings: ActorIdentityMapping[];
}

export interface ActorIdentityMapping {
  actor: { platform: 'discord'; externalId: string };
  identities: { jira?: string; github?: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ChunsikConfig {
  // Owner/repo prefer the new QUOKY_* env, falling back to legacy CHUNSIK_* (Sprint 4b, ADR-0061 N3/N4).
  const owner = env.QUOKY_GITHUB_OWNER ?? env.CHUNSIK_GITHUB_OWNER;
  const repo = env.QUOKY_GITHUB_REPO ?? env.CHUNSIK_GITHUB_REPO;

  return {
    discord: {
      token: env.DISCORD_BOT_TOKEN ?? '',
      guildId: env.DISCORD_GUILD_ID,
    },
    storage: { dbPath: env.CHUNSIK_DB_PATH ?? './data/chunsik.db' },
    vector: { storePath: env.CHUNSIK_VECTOR_PATH ?? './data/vectors' },
    workspace: { workspaceRoot: env.CHUNSIK_WORKSPACE_ROOT ?? process.cwd() },
    ai: {
      claudeBin: env.CLAUDE_CLI_BIN ?? 'claude',
      codexBin: env.CODEX_CLI_BIN ?? 'codex',
      ollamaBin: env.OLLAMA_CLI_BIN ?? 'ollama',
      ollamaModel: env.OLLAMA_MODEL ?? 'llama3.1',
    },
    connectors: {
      jira: resolveJiraConnector(env),
      slack: resolveSlackConnector(env),
      confluence: resolveConfluenceConnector(env),
    },
    // Provider fixed to 'github'. Undefined when both owner and repo are absent; a single one present yields a raw
    // config the resolver classifies (invalid-owner / invalid-repo). No provider/token env var is read here.
    repositoryHosting: owner || repo ? { provider: 'github', owner: owner ?? '', repo: repo ?? '' } : undefined,
    // Sprint 3d-D (legacy): adapter-local dev-only PAT. Undefined when unset.
    githubToken: env.CHUNSIK_GITHUB_TOKEN,
    // Sprint 4b (ADR-0061): GitHub App auth (adapter-local). Undefined unless BOTH appId and a private key resolve.
    githubApp: resolveGithubApp(env),
    githubAppInstallationId: parseInstallationId(env.QUOKY_GITHUB_APP_INSTALLATION_ID),
    runtimeEnv: resolveRuntimeEnv(env),
    providerRoutingMode: parseProviderRoutingMode(env.QUOKY_PROVIDER_ROUTING_MODE),
    contextBuilder: {
      rankingEnabled: true,
      compressionEnabled: true,
      maxTokens: 1024,
      recencyWeight: 0.4,
      relevanceWeight: 0.6,
      compressionConfig: { minimumCharactersPerEntry: 80 },
    },
    actorIdentityMappings: parseActorIdentityMappings(env.QUOKY_ACTOR_IDENTITY_MAPPINGS),
  };
}

function parseActorIdentityMappings(raw: string | undefined): ActorIdentityMapping[] {
  if (raw === undefined || raw.trim().length === 0) return [];

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('ACTOR_IDENTITY_MAPPINGS_INVALID_JSON');
  }
  if (!Array.isArray(value)) throw new Error('ACTOR_IDENTITY_MAPPINGS_MUST_BE_ARRAY');

  const mappings = value.map((entry, index) => parseActorIdentityMapping(entry, index));
  const configured = new Map<string, string>();
  const assignedTargets = new Map<string, string>();
  for (const mapping of mappings) {
    const locator = `${mapping.actor.platform}\u0000${mapping.actor.externalId}`;
    for (const platform of ['jira', 'github'] as const) {
      const externalId = mapping.identities[platform];
      if (externalId === undefined) continue;
      const platformKey = `${locator}\u0000${platform}`;
      const existing = configured.get(platformKey);
      if (existing !== undefined && existing !== externalId) {
        throw new Error(`ACTOR_IDENTITY_MAPPINGS_CONFLICTING_${platform.toUpperCase()}`);
      }
      configured.set(platformKey, externalId);

      const targetKey = `${platform}\u0000${externalId}`;
      const assigned = assignedTargets.get(targetKey);
      if (assigned !== undefined && assigned !== locator) {
        throw new Error('ACTOR_IDENTITY_MAPPINGS_TARGET_ASSIGNED_TO_MULTIPLE_ACTORS');
      }
      assignedTargets.set(targetKey, locator);
    }
  }
  return mappings;
}

function parseActorIdentityMapping(value: unknown, index: number): ActorIdentityMapping {
  const entry = requireRecord(value, `ACTOR_IDENTITY_MAPPING_${index}_INVALID`);
  requireOnlyKeys(entry, ['actor', 'identities'], `ACTOR_IDENTITY_MAPPING_${index}_UNKNOWN_FIELD`);
  const actor = requireRecord(entry.actor, `ACTOR_IDENTITY_MAPPING_${index}_ACTOR_INVALID`);
  requireOnlyKeys(actor, ['platform', 'externalId'], `ACTOR_IDENTITY_MAPPING_${index}_ACTOR_UNKNOWN_FIELD`);
  if (actor.platform !== 'discord') throw new Error(`ACTOR_IDENTITY_MAPPING_${index}_ACTOR_PLATFORM_INVALID`);
  const actorExternalId = requireNonBlank(actor.externalId, `ACTOR_IDENTITY_MAPPING_${index}_ACTOR_EXTERNAL_ID_INVALID`);

  const identities = requireRecord(entry.identities, `ACTOR_IDENTITY_MAPPING_${index}_IDENTITIES_INVALID`);
  requireOnlyKeys(identities, ['jira', 'github'], `ACTOR_IDENTITY_MAPPING_${index}_IDENTITIES_UNKNOWN_FIELD`);
  const jira = identities.jira === undefined
    ? undefined
    : requireNonBlank(identities.jira, `ACTOR_IDENTITY_MAPPING_${index}_JIRA_INVALID`);
  const github = identities.github === undefined
    ? undefined
    : requireNonBlank(identities.github, `ACTOR_IDENTITY_MAPPING_${index}_GITHUB_INVALID`);
  if (github !== undefined && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(github)) {
    throw new Error(`ACTOR_IDENTITY_MAPPING_${index}_GITHUB_INVALID`);
  }
  if (jira === undefined && github === undefined) {
    throw new Error(`ACTOR_IDENTITY_MAPPING_${index}_IDENTITIES_EMPTY`);
  }
  return {
    actor: { platform: 'discord', externalId: actorExternalId },
    identities: { ...(jira === undefined ? {} : { jira }), ...(github === undefined ? {} : { github }) },
  };
}

function requireRecord(value: unknown, error: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(error);
  return value as Record<string, unknown>;
}

function requireOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], error: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error(error);
}

function requireNonBlank(value: unknown, error: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(error);
  return value.trim();
}

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function resolveJiraConnector(
  env: NodeJS.ProcessEnv,
): { host: string; email: string; apiToken: string } | undefined {
  const host = nonBlank(env.CHUNSIK_JIRA_BASE_URL);
  const email = nonBlank(env.CHUNSIK_JIRA_EMAIL);
  const apiToken = nonBlank(env.CHUNSIK_JIRA_TOKEN);
  return host && email && apiToken ? { host, email, apiToken } : undefined;
}

function resolveSlackConnector(env: NodeJS.ProcessEnv): { token: string } | undefined {
  const token = nonBlank(env.CHUNSIK_SLACK_TOKEN);
  return token ? { token } : undefined;
}

function resolveConfluenceConnector(env: NodeJS.ProcessEnv): { host: string; token: string } | undefined {
  const host = nonBlank(env.CHUNSIK_CONFLUENCE_BASE_URL);
  const token = nonBlank(env.CHUNSIK_CONFLUENCE_TOKEN);
  return host && token ? { host, token } : undefined;
}

/**
 * Resolve the GitHub App config (Sprint 4b, ADR-0061). Requires a non-blank `QUOKY_GITHUB_APP_ID` AND a private key
 * from `QUOKY_GITHUB_APP_PRIVATE_KEY` (inline PEM) or `QUOKY_GITHUB_APP_PRIVATE_KEY_PATH` (a file read here).
 * Returns `undefined` on any missing/unreadable input — the safe "not configured" path (never throws; a bad key
 * path must not crash unrelated flows). The private key value is never logged.
 */
function resolveGithubApp(env: NodeJS.ProcessEnv): { appId: string; privateKeyPem: string } | undefined {
  const appId = (env.QUOKY_GITHUB_APP_ID ?? '').trim();
  if (appId.length === 0) return undefined;

  let privateKeyPem = env.QUOKY_GITHUB_APP_PRIVATE_KEY;
  if ((privateKeyPem === undefined || privateKeyPem.trim().length === 0) && env.QUOKY_GITHUB_APP_PRIVATE_KEY_PATH) {
    try {
      privateKeyPem = readFileSync(env.QUOKY_GITHUB_APP_PRIVATE_KEY_PATH, 'utf8');
    } catch {
      privateKeyPem = undefined; // unreadable key file → not configured (fail-safe)
    }
  }
  if (privateKeyPem === undefined || privateKeyPem.trim().length === 0) return undefined;
  return { appId, privateKeyPem };
}

/** Parse a positive-integer installation id, or `undefined` when absent/invalid. */
function parseInstallationId(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return undefined;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

/** Explicit `QUOKY_RUNTIME_ENV` wins; otherwise `NODE_ENV=production` → 'prod', else 'dev'. */
function resolveRuntimeEnv(env: NodeJS.ProcessEnv): 'dev' | 'prod' {
  if (env.QUOKY_RUNTIME_ENV === 'dev') return 'dev';
  if (env.QUOKY_RUNTIME_ENV === 'prod') return 'prod';
  return env.NODE_ENV === 'production' ? 'prod' : 'dev';
}
