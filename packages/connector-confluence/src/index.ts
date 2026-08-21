import type { ConnectorItem, ConnectorProvider, ConnectorQuery, ConnectorResult, Metadata } from '@chunsik/core';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 250;
const MAX_RESPONSE_LENGTH = 1_000_000;
const TITLE_LIMIT = 200;
const SUMMARY_LIMIT = 500;
const RAW_JSON_LIMIT = 20_000;

export interface ConfluenceConnectorConfig {
  /** Confluence Cloud host, with or without an https:// prefix (for example, example.atlassian.net). */
  host: string;
  token: string;
  /** Injectable for deterministic unit tests. Production defaults to the platform fetch implementation. */
  fetchImpl?: typeof fetch;
  /** Maximum number of values accepted from one REST response. */
  limit?: number;
}

export type ConfluenceListItemsInput = { kind: 'pages' | 'spaces' };

export interface ConfluenceGetItemInput {
  pageId: string;
}

export type ConfluenceConnectorHttpErrorKind =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'SERVER_ERROR'
  | 'HTTP_ERROR';

/** A sanitized Confluence HTTP failure. It never contains response content, credentials, or request headers. */
export class ConfluenceConnectorHttpError extends Error {
  constructor(
    readonly kind: ConfluenceConnectorHttpErrorKind,
    readonly status: number,
  ) {
    super(`confluence connector: query failed (${kind.toLowerCase()})`);
    this.name = 'ConfluenceConnectorHttpError';
  }
}

/** A sanitized transport failure. The underlying fetch error is deliberately not retained. */
export class ConfluenceConnectorRequestError extends Error {
  constructor() {
    super('confluence connector: query request failed');
    this.name = 'ConfluenceConnectorRequestError';
  }
}

/** A sanitized response-shape failure. Raw response content is deliberately not retained. */
export class ConfluenceConnectorResponseError extends Error {
  constructor() {
    super('confluence connector: query returned an unexpected response');
    this.name = 'ConfluenceConnectorResponseError';
  }
}

export class ConfluenceConnectorProvider implements ConnectorProvider {
  readonly id = 'confluence';
  readonly source = this.id;
  readonly readOnly = true;

  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly limit: number;

  constructor(config: ConfluenceConnectorConfig) {
    this.baseUrl = normalizeHost(requireNonEmpty(config?.host, 'host'));
    this.token = requireNonEmpty(config?.token, 'token');
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.limit = boundedLimit(config?.limit);
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async query(input: ConnectorQuery): Promise<ConnectorResult> {
    const kind = input?.params?.kind;
    if (kind === undefined || kind === 'pages') return this.listItems({ kind: 'pages' });
    if (kind === 'spaces') return this.listItems({ kind: 'spaces' });
    if (kind === 'page') {
      const pageId = requireNonEmpty(input.params?.pageId ?? input.query, 'pageId');
      const item = await this.getItem({ pageId });
      return { source: this.source, items: [item] };
    }
    throw new Error('confluence connector: unsupported query kind');
  }

  async listItems(input: ConfluenceListItemsInput = { kind: 'pages' }): Promise<ConnectorResult> {
    const kind = input?.kind;
    if (kind !== 'pages' && kind !== 'spaces') {
      throw new Error('confluence connector: unsupported item kind');
    }

    const url = new URL(`/wiki/api/v2/${kind}`, this.baseUrl);
    url.searchParams.set('limit', String(this.limit));
    const payload = await this.requestJson(url);
    if (!isRecord(payload) || !Array.isArray(payload.results)) throw new ConfluenceConnectorResponseError();

    const values = payload.results.slice(0, this.limit);
    const items = values
      .map((value) => kind === 'pages' ? this.mapPage(value) : this.mapSpace(value))
      .filter(isConnectorItem);
    return { source: this.source, items };
  }

  async getItem(input: ConfluenceGetItemInput): Promise<ConnectorItem> {
    const pageId = requireNonEmpty(input?.pageId, 'pageId');
    const url = new URL(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}`, this.baseUrl);
    url.searchParams.set('body-format', 'storage');
    const item = this.mapPage(await this.requestJson(url));
    if (!item) throw new ConfluenceConnectorResponseError();
    return item;
  }

  private async requestJson(url: URL): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
      });
    } catch {
      throw new ConfluenceConnectorRequestError();
    }
    if (!response.ok) throw mapHttpError(response.status);

    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_LENGTH) {
      throw new ConfluenceConnectorResponseError();
    }

    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new ConfluenceConnectorResponseError();
    }
    if (text.length > MAX_RESPONSE_LENGTH) throw new ConfluenceConnectorResponseError();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ConfluenceConnectorResponseError();
    }
  }

  private mapPage(value: unknown): ConnectorItem | undefined {
    if (!isRecord(value) || typeof value.id !== 'string' || value.id.trim().length === 0) return undefined;
    const id = value.id.trim();
    const rawTitle = typeof value.title === 'string' && value.title.trim().length > 0 ? value.title.trim() : id;
    const item: ConnectorItem = {
      id,
      title: redactToken(rawTitle, this.token).slice(0, TITLE_LIMIT),
      url: itemUrl(value, this.baseUrl, `/wiki/pages/viewpage.action?pageId=${encodeURIComponent(id)}`),
      raw: serializeRaw(value, this.token),
    };
    const summary = extractPageSummary(value, this.token);
    if (summary.length > 0) item.summary = summary.slice(0, SUMMARY_LIMIT);
    return item;
  }

  private mapSpace(value: unknown): ConnectorItem | undefined {
    if (!isRecord(value) || typeof value.id !== 'string' || value.id.trim().length === 0) return undefined;
    const id = value.id.trim();
    const rawTitle = typeof value.name === 'string' && value.name.trim().length > 0 ? value.name.trim() : id;
    const item: ConnectorItem = {
      id,
      title: redactToken(rawTitle, this.token).slice(0, TITLE_LIMIT),
      url: itemUrl(value, this.baseUrl, `/wiki/spaces/${encodeURIComponent(id)}`),
      raw: serializeRaw(value, this.token),
    };
    const description = isRecord(value.description) ? value.description : undefined;
    const plainDescription = isRecord(description?.plain) ? description.plain : undefined;
    const descriptionText = typeof plainDescription?.value === 'string' ? plainDescription.value : '';
    const summary = redactToken(descriptionText.replace(/\s+/g, ' ').trim(), this.token);
    if (summary.length > 0) item.summary = summary.slice(0, SUMMARY_LIMIT);
    return item;
  }
}

function itemUrl(value: Record<string, unknown>, baseUrl: string, fallbackPath: string): string {
  const links = isRecord(value._links) ? value._links : undefined;
  const webui = typeof links?.webui === 'string' ? links.webui : '';
  if (webui.startsWith('/') && !webui.startsWith('//')) return new URL(webui, baseUrl).toString();
  return new URL(fallbackPath, baseUrl).toString();
}

function extractPageSummary(value: Record<string, unknown>, token: string): string {
  const body = isRecord(value.body) ? value.body : undefined;
  const storage = isRecord(body?.storage) ? body.storage : undefined;
  const raw = typeof storage?.value === 'string' ? storage.value : '';
  return redactToken(raw.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(), token);
}

function serializeRaw(value: unknown, token: string): Metadata {
  let json: string;
  try {
    json = JSON.stringify(value) ?? '{}';
  } catch {
    json = '{}';
  }
  json = redactToken(json, token);
  if (json.length > RAW_JSON_LIMIT) json = `${json.slice(0, RAW_JSON_LIMIT)}[truncated]`;
  return { json };
}

function normalizeHost(host: string): string {
  const candidate = host.startsWith('https://') ? host : `https://${host}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('confluence connector: host must be a valid Confluence Cloud host');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('confluence connector: host must be an https host without credentials, port, path, query, or fragment');
  }
  return url.origin;
}

function boundedLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_LIMIT) {
    throw new Error(`confluence connector: limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  return value as number;
}

function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`confluence connector: a non-empty ${label} is required`);
  }
  return value.trim();
}

function mapHttpError(status: number): ConfluenceConnectorHttpError {
  if (status === 401) return new ConfluenceConnectorHttpError('UNAUTHORIZED', status);
  if (status === 403) return new ConfluenceConnectorHttpError('FORBIDDEN', status);
  if (status === 404) return new ConfluenceConnectorHttpError('NOT_FOUND', status);
  if (status >= 500) return new ConfluenceConnectorHttpError('SERVER_ERROR', status);
  return new ConfluenceConnectorHttpError('HTTP_ERROR', status);
}

function redactToken(value: string, token: string): string {
  return value.split(token).join('[redacted]');
}

function isConnectorItem(value: ConnectorItem | undefined): value is ConnectorItem {
  return value !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
