import { readFileSync } from 'node:fs';
import type { RepositoryIdentityConfig } from '@chunsik/core';

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
    // Provider fixed to 'github'. Undefined when both owner and repo are absent; a single one present yields a raw
    // config the resolver classifies (invalid-owner / invalid-repo). No provider/token env var is read here.
    repositoryHosting: owner || repo ? { provider: 'github', owner: owner ?? '', repo: repo ?? '' } : undefined,
    // Sprint 3d-D (legacy): adapter-local dev-only PAT. Undefined when unset.
    githubToken: env.CHUNSIK_GITHUB_TOKEN,
    // Sprint 4b (ADR-0061): GitHub App auth (adapter-local). Undefined unless BOTH appId and a private key resolve.
    githubApp: resolveGithubApp(env),
    githubAppInstallationId: parseInstallationId(env.QUOKY_GITHUB_APP_INSTALLATION_ID),
    runtimeEnv: resolveRuntimeEnv(env),
  };
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
