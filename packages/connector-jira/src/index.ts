import type { ConnectorItem, ConnectorProvider, ConnectorQuery, ConnectorResult, Metadata } from '@chunsik/core';

const DESCRIPTION_LIMIT = 500;
const RAW_JSON_LIMIT = 20_000;

export interface JiraConnectorConfig {
  /** Jira Cloud host, with or without an https:// prefix (for example, example.atlassian.net). */
  host: string;
  email: string;
  apiToken: string;
  /** Injectable for deterministic unit tests. Production defaults to the platform fetch implementation. */
  fetchImpl?: typeof fetch;
}

export type JiraConnectorHttpErrorKind =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'SERVER_ERROR'
  | 'HTTP_ERROR';

/** A sanitized Jira HTTP failure. It never contains response content, credentials, or request headers. */
export class JiraConnectorHttpError extends Error {
  constructor(
    readonly kind: JiraConnectorHttpErrorKind,
    readonly status: number,
  ) {
    super(`jira connector: query failed (${kind.toLowerCase()})`);
    this.name = 'JiraConnectorHttpError';
  }
}

/** A sanitized transport failure. The underlying fetch error is deliberately not retained. */
export class JiraConnectorRequestError extends Error {
  constructor() {
    super('jira connector: query request failed');
    this.name = 'JiraConnectorRequestError';
  }
}

/** A sanitized response-shape failure. Raw response content is deliberately not retained. */
export class JiraConnectorResponseError extends Error {
  constructor() {
    super('jira connector: query returned an unexpected response');
    this.name = 'JiraConnectorResponseError';
  }
}

interface JiraIssue {
  key?: unknown;
  fields?: {
    summary?: unknown;
    description?: unknown;
  };
}

export class JiraConnectorProvider implements ConnectorProvider {
  readonly source = 'jira';
  readonly readOnly = true;

  private readonly baseUrl: string;
  private readonly authorization: string;
  private readonly apiToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: JiraConnectorConfig) {
    const host = requireNonEmpty(config?.host, 'host');
    const email = requireNonEmpty(config?.email, 'email');
    const apiToken = requireNonEmpty(config?.apiToken, 'api token');

    this.baseUrl = normalizeHost(host);
    this.authorization = `Basic ${Buffer.from(`${email}:${apiToken}`, 'utf8').toString('base64')}`;
    this.apiToken = apiToken;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async query(input: ConnectorQuery): Promise<ConnectorResult> {
    const jql = input?.query === 'personal-work'
      ? personalWorkJql(input.params?.actorExternalId)
      : requireNonEmpty(input?.query, 'query');
    const url = new URL('/rest/api/3/search', this.baseUrl);
    url.searchParams.set('jql', jql);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: this.authorization,
        },
      });
    } catch {
      throw new JiraConnectorRequestError();
    }

    if (!response.ok) throw mapHttpError(response.status);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new JiraConnectorResponseError();
    }

    if (!isRecord(payload) || !Array.isArray(payload.issues)) {
      throw new JiraConnectorResponseError();
    }

    const items = payload.issues.map((issue) => this.mapIssue(issue));
    return { source: this.source, items };
  }

  private mapIssue(value: unknown): ConnectorItem {
    if (!isRecord(value) || typeof value.key !== 'string' || value.key.trim().length === 0) {
      throw new JiraConnectorResponseError();
    }

    const issue = value as JiraIssue;
    const key = issue.key as string;
    const fields = isRecord(issue.fields) ? issue.fields : undefined;
    const rawTitle = typeof fields?.summary === 'string' && fields.summary.trim().length > 0 ? fields.summary : key;
    const title = this.redactToken(rawTitle);
    const description = this.redactToken(extractDescription(fields?.description));
    const item: ConnectorItem = {
      id: key,
      title,
      url: `${this.baseUrl}/browse/${encodeURIComponent(key)}`,
      raw: this.serializeRaw(value),
    };
    if (description.length > 0) item.summary = description.slice(0, DESCRIPTION_LIMIT);
    return item;
  }

  private serializeRaw(issue: unknown): Metadata {
    let json: string;
    try {
      json = JSON.stringify(issue) ?? '{}';
    } catch {
      json = '{}';
    }
    json = this.redactToken(json);
    if (json.length > RAW_JSON_LIMIT) json = `${json.slice(0, RAW_JSON_LIMIT)}[truncated]`;
    return { json };
  }

  private redactToken(value: string): string {
    return value.split(this.apiToken).join('[redacted]');
  }
}

function personalWorkJql(actorExternalId: unknown): string {
  const identity = requireNonEmpty(actorExternalId, 'actor identity');
  return `assignee = "${identity.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" AND resolution = Unresolved`;
}

function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`jira connector: a non-empty ${label} is required`);
  }
  return value.trim();
}

function normalizeHost(host: string): string {
  const candidate = host.startsWith('https://') ? host : `https://${host}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('jira connector: host must be a valid Jira Cloud host');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('jira connector: host must be an https host without credentials, port, path, query, or fragment');
  }
  return url.origin;
}

function mapHttpError(status: number): JiraConnectorHttpError {
  if (status === 401) return new JiraConnectorHttpError('UNAUTHORIZED', status);
  if (status === 403) return new JiraConnectorHttpError('FORBIDDEN', status);
  if (status === 404) return new JiraConnectorHttpError('NOT_FOUND', status);
  if (status >= 500) return new JiraConnectorHttpError('SERVER_ERROR', status);
  return new JiraConnectorHttpError('HTTP_ERROR', status);
}

function extractDescription(value: unknown): string {
  if (typeof value === 'string') return value;
  const parts: string[] = [];
  collectText(value, parts);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function collectText(value: unknown, parts: string[]): void {
  if (Array.isArray(value)) {
    for (const child of value) collectText(child, parts);
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.text === 'string') parts.push(value.text);
  if (Array.isArray(value.content)) collectText(value.content, parts);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
