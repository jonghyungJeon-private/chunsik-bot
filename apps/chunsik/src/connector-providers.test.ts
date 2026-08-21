import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectorManager } from '@chunsik/core';

import { loadConfig } from './config';
import { createConnectorProviders } from './connector-providers';

function env(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return overrides as NodeJS.ProcessEnv;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('composition-root connector registration', () => {
  it('omits connectors with missing or partial configuration', () => {
    const manager = new ConnectorManager(
      createConnectorProviders(
        loadConfig(
          env({
            CHUNSIK_JIRA_BASE_URL: 'https://example.atlassian.net',
            CHUNSIK_JIRA_TOKEN: 'jira-token',
            CHUNSIK_SLACK_TOKEN: '   ',
            CHUNSIK_CONFLUENCE_BASE_URL: 'https://example.atlassian.net',
          }),
        ).connectors,
      ),
    );

    expect(manager.list()).toEqual([]);
  });

  it('enumerates and queries all fully configured read-only adapters', async () => {
    const fetchStub = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === '/rest/api/3/search') {
        return Response.json({ issues: [] });
      }
      if (url.pathname === '/api/conversations.list') {
        return Response.json({ ok: true, channels: [], response_metadata: { next_cursor: '' } });
      }
      if (url.pathname === '/wiki/api/v2/pages') {
        return Response.json({ results: [] });
      }
      throw new Error(`unexpected connector request path: ${url.pathname}`);
    });
    vi.stubGlobal('fetch', fetchStub);

    const manager = new ConnectorManager(
      createConnectorProviders(
        loadConfig(
          env({
            CHUNSIK_JIRA_BASE_URL: 'https://jira.example.atlassian.net',
            CHUNSIK_JIRA_EMAIL: 'builder@example.com',
            CHUNSIK_JIRA_TOKEN: 'jira-token',
            CHUNSIK_SLACK_TOKEN: 'slack-token',
            CHUNSIK_CONFLUENCE_BASE_URL: 'https://confluence.example.atlassian.net',
            CHUNSIK_CONFLUENCE_TOKEN: 'confluence-token',
          }),
        ).connectors,
      ),
    );

    expect(manager.list().map((connector) => connector.source)).toEqual(['jira', 'slack', 'confluence']);
    await expect(manager.query('jira', { query: 'project = DEMO' })).resolves.toEqual({ source: 'jira', items: [] });
    await expect(manager.query('slack', { query: '', params: { kind: 'channels' } })).resolves.toEqual({
      source: 'slack',
      items: [],
    });
    await expect(manager.query('confluence', { query: '', params: { kind: 'pages' } })).resolves.toEqual({
      source: 'confluence',
      items: [],
    });
    expect(fetchStub).toHaveBeenCalledTimes(3);
  });
});
