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
}

export function loadConfig(): ChunsikConfig {
  const env = process.env;
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
  };
}
