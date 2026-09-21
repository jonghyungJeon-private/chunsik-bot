import path from 'node:path';
import { config as loadDotEnv } from 'dotenv';

export interface LocalEnvironmentOptions {
  envFilePath?: string;
}

/**
 * Loads repository-local operator configuration before the composition root is evaluated.
 * Existing process environment values always win over values from `.env.local`.
 */
export function loadLocalEnvironment(options: LocalEnvironmentOptions = {}): void {
  const envFilePath = options.envFilePath ?? path.resolve(__dirname, '../../../.env.local');
  const result = loadDotEnv({ path: envFilePath, override: false });

  if (result.error && (result.error as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw new Error('Failed to load local environment file.');
  }
}
