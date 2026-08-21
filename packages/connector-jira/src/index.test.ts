import { describe, expect, it } from 'vitest';
import {
  JiraConnectorHttpError,
  JiraConnectorProvider,
  type JiraConnectorConfig,
} from './index';

const TOKEN = 'jira-secret-token';

function fakeFetch(status: number, body: unknown): { fetchImpl: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function provider(fetchImpl: typeof fetch, config: Partial<JiraConnectorConfig> = {}): JiraConnectorProvider {
  return new JiraConnectorProvider({
    host: 'example.atlassian.net',
    email: 'dev@example.com',
    apiToken: TOKEN,
    fetchImpl,
    ...config,
  });
}

describe('JiraConnectorProvider', () => {
  it('maps successful Jira results to the existing ConnectorItem shape', async () => {
    const issue = {
      key: 'PROJ-42',
      fields: {
        summary: 'Ship the connector',
        description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Read only.' }] }] },
      },
    };
    const fake = fakeFetch(200, { issues: [issue] });

    const result = await provider(fake.fetchImpl).query({ query: 'project = PROJ' });

    expect(result).toEqual({
      source: 'jira',
      items: [{
        id: 'PROJ-42',
        title: 'Ship the connector',
        url: 'https://example.atlassian.net/browse/PROJ-42',
        summary: 'Read only.',
        raw: { json: JSON.stringify(issue) },
      }],
    });
    expect(fake.calls[0]!.url).toBe('https://example.atlassian.net/rest/api/3/search?jql=project+%3D+PROJ');
    expect(result.items[0]).not.toHaveProperty('content');
    expect(result.items[0]).not.toHaveProperty('metadata');
  });

  it('returns an empty item list for an empty Jira result', async () => {
    const fake = fakeFetch(200, { issues: [] });
    await expect(provider(fake.fetchImpl).query({ query: 'project = NONE' })).resolves.toEqual({ source: 'jira', items: [] });
  });

  it('sends Basic auth without returning or exposing the token', async () => {
    const fake = fakeFetch(200, { issues: [{ key: 'SEC-1', fields: { summary: 'Safe', description: TOKEN } }] });
    const result = await provider(fake.fetchImpl).query({ query: 'key = SEC-1' });

    const headers = new Headers(fake.calls[0]!.init?.headers);
    expect(headers.get('authorization')).toBe(`Basic ${Buffer.from(`dev@example.com:${TOKEN}`).toString('base64')}`);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it.each([
    ['host', { host: ' ' }],
    ['email', { email: '' }],
    ['api token', { apiToken: '   ' }],
  ])('rejects a missing %s at construction', (_label, badConfig) => {
    const fake = fakeFetch(200, { issues: [] });
    expect(() => provider(fake.fetchImpl, badConfig)).toThrow();
  });

  it.each([
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [500, 'SERVER_ERROR'],
    [503, 'SERVER_ERROR'],
  ] as const)('maps HTTP %i to a sanitized typed error', async (status, kind) => {
    const fake = fakeFetch(status, { errorMessages: [`failure ${TOKEN}`] });
    const promise = provider(fake.fetchImpl).query({ query: 'project = PROJ' });

    await expect(promise).rejects.toMatchObject({
      name: 'JiraConnectorHttpError',
      kind,
      status,
    } satisfies Partial<JiraConnectorHttpError>);
    await expect(promise).rejects.not.toThrow(TOKEN);
  });

  it('truncates a plain-text description to 500 characters', async () => {
    const fake = fakeFetch(200, {
      issues: [{ key: 'LONG-1', fields: { summary: 'Long issue', description: 'x'.repeat(700) } }],
    });
    const result = await provider(fake.fetchImpl).query({ query: 'key = LONG-1' });
    expect(result.items[0]!.summary).toHaveLength(500);
  });

  it('bounds serialized raw issue JSON', async () => {
    const fake = fakeFetch(200, {
      issues: [{ key: 'RAW-1', fields: { summary: 'Bounded', custom: 'x'.repeat(25_000) } }],
    });
    const result = await provider(fake.fetchImpl).query({ query: 'key = RAW-1' });
    const rawJson = result.items[0]!.raw?.json;

    expect(typeof rawJson).toBe('string');
    expect((rawJson as string).length).toBeLessThanOrEqual(20_011);
    expect(rawJson).toMatch(/\[truncated\]$/);
  });

  it('handles missing optional fields without inventing provider-neutral fields', async () => {
    const fake = fakeFetch(200, { issues: [{ key: 'MIN-1' }] });
    const result = await provider(fake.fetchImpl).query({ query: 'key = MIN-1' });

    expect(result.items[0]).toMatchObject({
      id: 'MIN-1',
      title: 'MIN-1',
      url: 'https://example.atlassian.net/browse/MIN-1',
    });
    expect(result.items[0]).not.toHaveProperty('summary');
  });

  it('reports configured availability without making a network request', async () => {
    const fake = fakeFetch(200, { issues: [] });
    await expect(provider(fake.fetchImpl).isAvailable()).resolves.toBe(true);
    expect(fake.calls).toHaveLength(0);
  });
});
