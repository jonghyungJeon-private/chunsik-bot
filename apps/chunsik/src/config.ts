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
   * Repository identity for FUTURE PR creation (Sprint 3d-A, ADR-0051). RAW/unvalidated here; validated by
   * `RepositoryIdentityResolver` at the composition root. `undefined` when unset (the safe missing path).
   * `provider` is FIXED to `'github'` — no `CHUNSIK_GITHUB_PROVIDER` and no token env var is read here (an
   * auth token is adapter-local, sourced inside the hosting adapter in a later sprint, never in this config).
   */
  repositoryHosting?: RepositoryIdentityConfig;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ChunsikConfig {
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
    // Sprint 3d-A: read ONLY CHUNSIK_GITHUB_OWNER / CHUNSIK_GITHUB_REPO; provider is fixed to 'github'.
    // Undefined when both are absent; a single one present yields a raw config the resolver classifies
    // (invalid-owner / invalid-repo). No provider/token env var is read.
    repositoryHosting:
      env.CHUNSIK_GITHUB_OWNER || env.CHUNSIK_GITHUB_REPO
        ? { provider: 'github', owner: env.CHUNSIK_GITHUB_OWNER ?? '', repo: env.CHUNSIK_GITHUB_REPO ?? '' }
        : undefined,
  };
}
