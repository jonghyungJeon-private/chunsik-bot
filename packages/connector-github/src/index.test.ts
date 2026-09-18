import { describe, expect, it, vi } from 'vitest';
import { GitHubConnectorProvider } from './index';

describe('GitHubConnectorProvider', () => {
  it('maps a bounded read-only personal-work search through injected auth', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      items: [{ id: 42, title: 'Review this', html_url: 'https://github.com/o/r/pull/42', body: 'Details' }],
    }), { status: 200 }));
    const tokenSource = vi.fn(async () => 'installation-token');
    const provider = new GitHubConnectorProvider({ auth: { kind: 'github-app', tokenSource }, fetchImpl });

    const result = await provider.query({ query: 'personal-work', params: { actorExternalId: 'octocat' } });

    expect(result).toEqual({ source: 'github', items: [{
      id: '42', title: 'Review this', url: 'https://github.com/o/r/pull/42', summary: 'Details',
    }] });
    expect(tokenSource).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/search/issues?q=involves%3Aoctocat%20is%3Aopen%20archived%3Afalse&per_page=100');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('rejects unsupported discovery and missing identity without network access', async () => {
    const fetchImpl = vi.fn();
    const provider = new GitHubConnectorProvider({ auth: { kind: 'pat', token: 'token' }, fetchImpl });
    await expect(provider.query({ query: 'write-something' })).rejects.toThrow(/unsupported/);
    await expect(provider.query({ query: 'personal-work' })).rejects.toThrow(/identity/);
    await expect(provider.query({ query: 'personal-work', params: { actorExternalId: 'octo cat' } })).rejects.toThrow(/invalid/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
