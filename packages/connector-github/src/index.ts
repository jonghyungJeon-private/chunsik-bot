import type { ConnectorItem, ConnectorProvider, ConnectorQuery, ConnectorResult } from '@chunsik/core';

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';

export type GitHubConnectorAuth =
  | { kind: 'github-app'; tokenSource: () => Promise<string> }
  | { kind: 'pat'; token: string };

export interface GitHubConnectorConfig {
  auth: GitHubConnectorAuth;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class GitHubConnectorProvider implements ConnectorProvider {
  readonly source = 'github';
  readonly readOnly = true;

  private readonly auth: GitHubConnectorAuth;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs?: number;

  constructor(config: GitHubConnectorConfig) {
    if (config?.auth?.kind === 'pat') {
      const token = config.auth.token.trim();
      if (!token) throw new Error('github connector: a non-empty token is required');
      this.auth = { kind: 'pat', token };
    } else if (config?.auth?.kind === 'github-app' && typeof config.auth.tokenSource === 'function') {
      this.auth = config.auth;
    } else {
      throw new Error('github connector: a valid auth config is required');
    }
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async query(input: ConnectorQuery): Promise<ConnectorResult> {
    if (input.query !== 'personal-work') {
      throw new Error('github connector: unsupported query');
    }
    const actorExternalId = input.params?.actorExternalId;
    if (typeof actorExternalId !== 'string' || actorExternalId.trim().length === 0) {
      throw new Error('github connector: actor identity is required');
    }
    const q = `involves:${githubQualifier(actorExternalId)} is:open archived:false`;
    const token = await this.currentToken();
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent': 'chunsik-bot',
    };
    const init: RequestInit = { method: 'GET', headers };
    if (this.timeoutMs !== undefined) init.signal = AbortSignal.timeout(this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${GITHUB_API_BASE}/search/issues?q=${encodeURIComponent(q)}&per_page=100`, init);
    } catch {
      throw new Error('github connector: query request failed');
    }
    if (!response.ok) throw new Error(`github connector: query failed with status ${response.status}`);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error('github connector: query returned an unexpected response');
    }
    if (!isRecord(payload) || !Array.isArray(payload.items)) {
      throw new Error('github connector: query returned an unexpected response');
    }
    return { source: this.source, items: payload.items.map(mapItem) };
  }

  private async currentToken(): Promise<string> {
    const token = this.auth.kind === 'pat' ? this.auth.token : await this.auth.tokenSource();
    if (!token) throw new Error('github connector: auth source returned an empty token');
    return token;
  }
}

function mapItem(value: unknown): ConnectorItem {
  if (!isRecord(value) || typeof value.id !== 'number' || typeof value.title !== 'string' || typeof value.html_url !== 'string') {
    throw new Error('github connector: query returned an unexpected item');
  }
  return {
    id: String(value.id),
    title: value.title,
    url: value.html_url,
    ...(typeof value.body === 'string' && value.body.trim() ? { summary: value.body.slice(0, 500) } : {}),
  };
}

function githubQualifier(value: string): string {
  const identity = value.trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(identity)) {
    throw new Error('github connector: actor identity is invalid');
  }
  return identity;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
