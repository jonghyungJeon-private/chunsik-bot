import { describe, expect, it } from 'vitest';
import {
  SlackConnectorProvider,
  type SlackConnectorConfig,
  type SlackConnectorHttpError,
} from './index';

const TOKEN = 'slack-secret-token';

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

function provider(fetchImpl: typeof fetch, config: Partial<SlackConnectorConfig> = {}): SlackConnectorProvider {
  return new SlackConnectorProvider({ token: TOKEN, fetchImpl, ...config });
}

describe('SlackConnectorProvider', () => {
  it('lists channels with Bearer authentication', async () => {
    const fake = fakeFetch({
      status: 200,
      body: { ok: true, channels: [{ id: 'C123', name: 'general', purpose: { value: 'Team updates' } }] },
    });

    const result = await provider(fake.fetchImpl).listItems({ kind: 'channels' });

    expect(result).toEqual({
      source: 'slack',
      items: [{
        id: 'C123',
        title: '#general',
        summary: 'Team updates',
        raw: { kind: 'channel', channelId: 'C123' },
      }],
    });
    expect(fake.calls[0]!.url).toBe('https://slack.com/api/conversations.list?limit=100');
    expect(new Headers(fake.calls[0]!.init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('retrieves message history', async () => {
    const fake = fakeFetch({
      status: 200,
      body: { ok: true, messages: [{ ts: '1000.001', text: `Status update ${TOKEN}` }] },
    });

    const result = await provider(fake.fetchImpl).listItems({ kind: 'messages', channelId: 'C123' });

    expect(result.items[0]).toEqual({
      id: 'C123:1000.001',
      title: 'Status update [redacted]',
      summary: 'Status update [redacted]',
      raw: { kind: 'message', channelId: 'C123', ts: '1000.001' },
    });
    expect(fake.calls[0]!.url).toBe('https://slack.com/api/conversations.history?channel=C123&limit=100');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('retrieves thread replies and resolves a single item', async () => {
    const body = {
      ok: true,
      messages: [
        { ts: '1000.001', text: 'Parent' },
        { ts: '1000.002', text: 'Reply' },
      ],
    };
    const fake = fakeFetch({ status: 200, body }, { status: 200, body });
    const slack = provider(fake.fetchImpl);

    const thread = await slack.listItems({ kind: 'thread', channelId: 'C123', threadTs: '1000.001' });
    const item = await slack.getItem({ channelId: 'C123', ts: '1000.001' });

    expect(thread.items.map(({ id }) => id)).toEqual(['C123:1000.001', 'C123:1000.002']);
    expect(item?.title).toBe('Parent');
    expect(fake.calls[0]!.url).toBe('https://slack.com/api/conversations.replies?channel=C123&ts=1000.001&limit=100');
  });

  it.each([
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
  ] as const)('maps auth HTTP %i to a sanitized typed error', async (status, kind) => {
    const fake = fakeFetch({ status, body: { ok: false, error: `${kind} ${TOKEN}` } });
    const promise = provider(fake.fetchImpl).listItems({ kind: 'channels' });

    await expect(promise).rejects.toMatchObject({
      name: 'SlackConnectorHttpError',
      kind,
      status,
    } satisfies Partial<SlackConnectorHttpError>);
    await expect(promise).rejects.not.toThrow(TOKEN);
  });

  it('maps rate limiting without retrying', async () => {
    const fake = fakeFetch({ status: 429, body: { ok: false, error: 'ratelimited' } });
    await expect(provider(fake.fetchImpl).listItems({ kind: 'channels' })).rejects.toMatchObject({
      kind: 'RATE_LIMITED',
      status: 429,
    });
    expect(fake.calls).toHaveLength(1);
  });

  it('maps Slack not-found responses', async () => {
    const fake = fakeFetch({ status: 200, body: { ok: false, error: 'channel_not_found' } });
    await expect(provider(fake.fetchImpl).listItems({ kind: 'messages', channelId: 'missing' })).rejects.toMatchObject({
      kind: 'NOT_FOUND',
      status: 200,
    });
  });

  it.each([
    [{ ok: true, channels: [] }, { kind: 'channels' } as const],
    [{ ok: true, messages: [] }, { kind: 'messages', channelId: 'C123' } as const],
  ])('returns an empty result for an empty Slack response', async (body, input) => {
    const fake = fakeFetch({ status: 200, body });
    await expect(provider(fake.fetchImpl).listItems(input)).resolves.toEqual({ source: 'slack', items: [] });
  });

  it('follows bounded cursor pagination and caps output', async () => {
    const fake = fakeFetch(
      {
        status: 200,
        body: { ok: true, channels: [{ id: 'C1', name: 'one' }], response_metadata: { next_cursor: 'next' } },
      },
      {
        status: 200,
        body: { ok: true, channels: [{ id: 'C2', name: 'two' }], response_metadata: { next_cursor: 'unused' } },
      },
    );

    const result = await provider(fake.fetchImpl, { maxItems: 2, maxPages: 2 }).listItems({ kind: 'channels' });

    expect(result.items.map(({ id }) => id)).toEqual(['C1', 'C2']);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.url).toContain('cursor=next');
  });

  it('supports the canonical ConnectorProvider query method', async () => {
    const fake = fakeFetch({ status: 200, body: { ok: true, messages: [{ ts: '1000.001', text: 'Via query' }] } });
    const result = await provider(fake.fetchImpl).query({ query: '', params: { kind: 'messages', channelId: 'C123' } });
    expect(result.items[0]?.title).toBe('Via query');
  });

  it('disconnects without a network request and reconnects locally', async () => {
    const fake = fakeFetch({ status: 200, body: { ok: true, channels: [] } });
    const slack = provider(fake.fetchImpl);
    await slack.disconnect();
    await expect(slack.isAvailable()).resolves.toBe(false);
    await expect(slack.listItems()).rejects.toThrow('disconnected');
    expect(fake.calls).toHaveLength(0);
    await slack.connect();
    await expect(slack.isAvailable()).resolves.toBe(true);
  });
});
