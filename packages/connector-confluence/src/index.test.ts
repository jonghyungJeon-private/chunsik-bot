import { describe, expect, it } from 'vitest';
import {
  ConfluenceConnectorProvider,
  type ConfluenceConnectorConfig,
  type ConfluenceConnectorHttpError,
} from './index';

const TOKEN = 'confluence-secret-token';

function fakeFetch(...responses: Array<{ status: number; body: unknown }>): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const response = responses.shift();
    if (!response) throw new Error('unexpected fake fetch call');
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function provider(fetchImpl: typeof fetch, config: Partial<ConfluenceConnectorConfig> = {}): ConfluenceConnectorProvider {
  return new ConfluenceConnectorProvider({
    host: 'example.atlassian.net',
    token: TOKEN,
    fetchImpl,
    ...config,
  });
}

describe('ConfluenceConnectorProvider', () => {
  it('lists pages with Bearer authentication', async () => {
    const page = { id: '42', title: 'Delivery plan', spaceId: '7', _links: { webui: '/wiki/spaces/ENG/pages/42' } };
    const fake = fakeFetch({ status: 200, body: { results: [page], _links: { next: '/wiki/api/v2/pages?cursor=next' } } });

    const result = await provider(fake.fetchImpl).listItems({ kind: 'pages' });

    expect(result).toEqual({
      source: 'confluence',
      items: [{
        id: '42',
        title: 'Delivery plan',
        url: 'https://example.atlassian.net/wiki/spaces/ENG/pages/42',
        raw: { json: JSON.stringify(page) },
      }],
    });
    expect(fake.calls[0]!.url).toBe('https://example.atlassian.net/wiki/api/v2/pages?limit=100');
    expect(new Headers(fake.calls[0]!.init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(fake.calls).toHaveLength(1);
  });

  it('lists spaces', async () => {
    const space = {
      id: '7',
      key: 'ENG',
      name: 'Engineering',
      description: { plain: { value: 'Engineering handbook' } },
      _links: { webui: '/wiki/spaces/ENG' },
    };
    const fake = fakeFetch({ status: 200, body: { results: [space] } });

    const result = await provider(fake.fetchImpl).listItems({ kind: 'spaces' });

    expect(result.items[0]).toEqual({
      id: '7',
      title: 'Engineering',
      url: 'https://example.atlassian.net/wiki/spaces/ENG',
      summary: 'Engineering handbook',
      raw: { json: JSON.stringify(space) },
    });
    expect(fake.calls[0]!.url).toBe('https://example.atlassian.net/wiki/api/v2/spaces?limit=100');
  });

  it('retrieves a single page by id', async () => {
    const page = {
      id: '42',
      title: 'Delivery plan',
      body: { storage: { value: `<p>Ship safely ${TOKEN}</p>` } },
    };
    const fake = fakeFetch({ status: 200, body: page });

    const item = await provider(fake.fetchImpl).getItem({ pageId: '42' });

    expect(item).toMatchObject({
      id: '42',
      title: 'Delivery plan',
      url: 'https://example.atlassian.net/wiki/pages/viewpage.action?pageId=42',
      summary: 'Ship safely [redacted]',
    });
    expect(JSON.stringify(item)).not.toContain(TOKEN);
    expect(fake.calls[0]!.url).toBe('https://example.atlassian.net/wiki/api/v2/pages/42?body-format=storage');
  });

  it.each([
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [500, 'SERVER_ERROR'],
  ] as const)('maps HTTP %i to a sanitized typed error', async (status, kind) => {
    const fake = fakeFetch({ status, body: { message: `failure ${TOKEN}` } });
    const promise = provider(fake.fetchImpl).listItems({ kind: 'pages' });

    await expect(promise).rejects.toMatchObject({
      name: 'ConfluenceConnectorHttpError',
      kind,
      status,
    } satisfies Partial<ConfluenceConnectorHttpError>);
    await expect(promise).rejects.not.toThrow(TOKEN);
  });

  it.each(['pages', 'spaces'] as const)('returns an empty result for an empty %s response', async (kind) => {
    const fake = fakeFetch({ status: 200, body: { results: [] } });
    await expect(provider(fake.fetchImpl).listItems({ kind })).resolves.toEqual({ source: 'confluence', items: [] });
  });

  it('respects the configured single-page limit and caps parsed results', async () => {
    const fake = fakeFetch({
      status: 200,
      body: {
        results: [
          { id: '1', title: 'One' },
          { id: '2', title: 'Two' },
          { id: '3', title: 'Three' },
        ],
        _links: { next: '/wiki/api/v2/pages?cursor=unused' },
      },
    });

    const result = await provider(fake.fetchImpl, { limit: 2 }).listItems({ kind: 'pages' });

    expect(result.items.map(({ id }) => id)).toEqual(['1', '2']);
    expect(fake.calls[0]!.url).toBe('https://example.atlassian.net/wiki/api/v2/pages?limit=2');
    expect(fake.calls).toHaveLength(1);
  });

  it('never includes the token in mapped titles, summaries, raw values, or errors', async () => {
    const fake = fakeFetch({
      status: 200,
      body: { results: [{ id: 'safe', title: `Title ${TOKEN}`, body: { storage: { value: TOKEN } } }] },
    });
    const result = await provider(fake.fetchImpl).listItems({ kind: 'pages' });
    expect(JSON.stringify(result)).not.toContain(TOKEN);

    const rejectingFetch = (async () => { throw new Error(TOKEN); }) as typeof fetch;
    await expect(provider(rejectingFetch).listItems({ kind: 'pages' })).rejects.not.toThrow(TOKEN);
  });

  it('supports the canonical ConnectorProvider query method', async () => {
    const fake = fakeFetch({ status: 200, body: { id: '42', title: 'Via query' } });
    const result = await provider(fake.fetchImpl).query({ query: '42', params: { kind: 'page' } });
    expect(result.items[0]?.title).toBe('Via query');
  });

  it('rejects oversized responses before mapping values', async () => {
    const fake = fakeFetch({ status: 200, body: { results: [], padding: 'x'.repeat(1_000_000) } });
    await expect(provider(fake.fetchImpl).listItems({ kind: 'pages' })).rejects.toMatchObject({
      name: 'ConfluenceConnectorResponseError',
    });
  });
});
