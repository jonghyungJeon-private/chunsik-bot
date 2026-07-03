import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GitHubRepositoryHostingProvider } from './index';
import type { GitHubHostingConfig } from './index';
import type { PullRequestCreationInput, RepositoryIdentity } from '@chunsik/core';

const IDENTITY: RepositoryIdentity = { provider: 'github', owner: 'acme', repo: 'widgets' };
const TOKEN = 'ghp_superSecretTokenValue';

interface Call {
  url: string;
  init: RequestInit;
}

/** Fake `fetch` that records calls and returns a canned `{ status, body }` — NO live network (CA change 16). */
function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body?: unknown }) {
  const calls: Call[] = [];
  const fn = (async (url: unknown, init?: unknown) => {
    const u = String(url);
    const i = (init ?? {}) as RequestInit;
    calls.push({ url: u, init: i });
    const { status, body } = handler(u, i);
    return { status, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function ghPull(over: Record<string, unknown> = {}) {
  return {
    number: 42,
    html_url: 'https://github.com/acme/widgets/pull/42',
    head: { ref: 'feature/x', sha: 'abc1234', repo: { name: 'widgets', owner: { login: 'acme' } } },
    base: { ref: 'main' },
    ...over,
  };
}

function provider(fn: typeof fetch, extra: Partial<GitHubHostingConfig> = {}) {
  return new GitHubRepositoryHostingProvider({ token: TOKEN, fetchImpl: fn, ...extra });
}

const createInput: PullRequestCreationInput = {
  identity: IDENTITY,
  headBranch: 'feature/x',
  baseBranch: 'main',
  title: 'Add widget',
  body: 'body text',
  expectedCommitHash: 'abc1234',
};

describe('GitHubRepositoryHostingProvider (CAP-010 adapter, ADR-0053, Sprint 3d-C)', () => {
  describe('construction (tests 1/2)', () => {
    it('rejects a blank/whitespace token (no fetch)', () => {
      const { fn } = fakeFetch(() => ({ status: 200 }));
      expect(() => provider(fn, { token: '' } as Partial<GitHubHostingConfig>)).toThrow();
      expect(() => new GitHubRepositoryHostingProvider({ token: '   ', fetchImpl: fn })).toThrow();
    });
    it('accepts a non-blank token', () => {
      const { fn } = fakeFetch(() => ({ status: 200 }));
      expect(() => provider(fn)).not.toThrow();
    });
  });

  describe('request headers & base URL (tests 3–8)', () => {
    it('sends exact auth/accept/version/user-agent headers and uses https://api.github.com only', async () => {
      const { fn, calls } = fakeFetch(() => ({ status: 200 }));
      await provider(fn).repositoryExists(IDENTITY);
      const h = calls[0]!.init.headers as Record<string, string>;
      expect(h.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(h.Accept).toBe('application/vnd.github+json');
      expect(h['X-GitHub-Api-Version']).toBe('2022-11-28');
      expect(h['User-Agent']).toBe('chunsik-bot');
      expect(calls[0]!.url.startsWith('https://api.github.com/')).toBe(true);
    });
    it('ignores any custom apiBaseUrl (no override option) — always api.github.com', async () => {
      const { fn, calls } = fakeFetch(() => ({ status: 200 }));
      await provider(fn, { apiBaseUrl: 'https://evil.example.com' } as unknown as Partial<GitHubHostingConfig>).repositoryExists(
        IDENTITY,
      );
      expect(calls[0]!.url.startsWith('https://api.github.com/')).toBe(true);
      expect(calls[0]!.url).not.toContain('evil');
    });
  });

  describe('repositoryExists (tests 9–12)', () => {
    it('GET /repos/{owner}/{repo}; 200 → true', async () => {
      const { fn, calls } = fakeFetch(() => ({ status: 200 }));
      expect(await provider(fn).repositoryExists(IDENTITY)).toBe(true);
      expect(calls[0]!.url).toBe('https://api.github.com/repos/acme/widgets');
      expect(calls[0]!.init.method).toBe('GET');
    });
    it('404 → false', async () => {
      const { fn } = fakeFetch(() => ({ status: 404 }));
      expect(await provider(fn).repositoryExists(IDENTITY)).toBe(false);
    });
    it('401/403 → throws sanitized (no token)', async () => {
      for (const status of [401, 403]) {
        const { fn } = fakeFetch(() => ({ status }));
        await expect(provider(fn).repositoryExists(IDENTITY)).rejects.toThrow(/github hosting/);
      }
    });
  });

  describe('branchExists (tests 13–17)', () => {
    it('GET branches path; encodes a slash branch', async () => {
      const { fn, calls } = fakeFetch(() => ({ status: 200 }));
      expect(await provider(fn).branchExists(IDENTITY, 'feature/x')).toBe(true);
      expect(calls[0]!.url).toBe('https://api.github.com/repos/acme/widgets/branches/feature%2Fx');
    });
    it('404 → false', async () => {
      const { fn } = fakeFetch(() => ({ status: 404 }));
      expect(await provider(fn).branchExists(IDENTITY, 'main')).toBe(false);
    });
    it('401/403 → throws sanitized', async () => {
      const { fn } = fakeFetch(() => ({ status: 403 }));
      await expect(provider(fn).branchExists(IDENTITY, 'main')).rejects.toThrow(/github hosting/);
    });
  });

  describe('findOpenPullRequest (tests 18–25)', () => {
    it('GET pulls with encoded same-repo head + base query', async () => {
      const { fn, calls } = fakeFetch(() => ({ status: 200, body: [] }));
      await provider(fn).findOpenPullRequest(IDENTITY, 'feature/x', 'main');
      expect(calls[0]!.url).toBe(
        'https://api.github.com/repos/acme/widgets/pulls?state=open&head=acme%3Afeature%2Fx&base=main',
      );
    });
    it('404 → throws (not null)', async () => {
      const { fn } = fakeFetch(() => ({ status: 404 }));
      await expect(provider(fn).findOpenPullRequest(IDENTITY, 'feature/x', 'main')).rejects.toThrow();
    });
    it('empty array → null', async () => {
      const { fn } = fakeFetch(() => ({ status: 200, body: [] }));
      expect(await provider(fn).findOpenPullRequest(IDENTITY, 'feature/x', 'main')).toBeNull();
    });
    it('one valid same-repo PR → mapped result', async () => {
      const { fn } = fakeFetch(() => ({ status: 200, body: [ghPull()] }));
      const r = await provider(fn).findOpenPullRequest(IDENTITY, 'feature/x', 'main');
      expect(r).toMatchObject({
        provider: 'github',
        owner: 'acme',
        repo: 'widgets',
        pullRequestNumber: 42,
        pullRequestUrl: 'https://github.com/acme/widgets/pull/42',
        pullRequestHeadBranch: 'feature/x',
        pullRequestBaseBranch: 'main',
        pullRequestCommitHash: 'abc1234',
      });
    });
    it('multiple open PRs → throws ambiguous safe failure', async () => {
      const { fn, calls } = fakeFetch(() => ({ status: 200, body: [ghPull(), ghPull({ number: 43 })] }));
      await expect(provider(fn).findOpenPullRequest(IDENTITY, 'feature/x', 'main')).rejects.toThrow(/ambiguous/);
      expect(calls).toHaveLength(1);
    });
    it('fork PR (cross-repo head) → rejected', async () => {
      const forked = ghPull({ head: { ref: 'feature/x', sha: 'abc1234', repo: { name: 'widgets', owner: { login: 'attacker' } } } });
      const { fn } = fakeFetch(() => ({ status: 200, body: [forked] }));
      await expect(provider(fn).findOpenPullRequest(IDENTITY, 'feature/x', 'main')).rejects.toThrow(/fork/);
    });
    it('missing head.sha → rejected', async () => {
      const bad = ghPull({ head: { ref: 'feature/x', repo: { name: 'widgets', owner: { login: 'acme' } } } });
      const { fn } = fakeFetch(() => ({ status: 200, body: [bad] }));
      await expect(provider(fn).findOpenPullRequest(IDENTITY, 'feature/x', 'main')).rejects.toThrow(/head\.sha/);
    });
  });

  describe('createPullRequest (tests 26–35, 39)', () => {
    it('POST pulls; body contains ONLY title/head/base/body (raw branches)', async () => {
      const { fn, calls } = fakeFetch(() => ({ status: 201, body: ghPull() }));
      await provider(fn).createPullRequest(createInput);
      expect(calls[0]!.url).toBe('https://api.github.com/repos/acme/widgets/pulls');
      expect(calls[0]!.init.method).toBe('POST');
      const body = JSON.parse(String(calls[0]!.init.body));
      expect(Object.keys(body).sort()).toEqual(['base', 'body', 'head', 'title']);
      expect(body.head).toBe('feature/x'); // raw branch, not URL-encoded
      expect(body.base).toBe('main');
      for (const forbidden of ['draft', 'maintainer_can_modify', 'issue', 'labels', 'assignees', 'reviewers', 'milestone']) {
        expect(body).not.toHaveProperty(forbidden);
      }
    });
    it('201 → mapped result', async () => {
      const { fn } = fakeFetch(() => ({ status: 201, body: ghPull() }));
      const r = await provider(fn).createPullRequest(createInput);
      expect(r.pullRequestNumber).toBe(42);
      expect(r.pullRequestCommitHash).toBe('abc1234');
    });
    it('200 → rejected (201 only)', async () => {
      const { fn } = fakeFetch(() => ({ status: 200, body: ghPull() }));
      await expect(provider(fn).createPullRequest(createInput)).rejects.toThrow();
    });
    it('401/403/404/422 → throws sanitized', async () => {
      for (const status of [401, 403, 404, 422]) {
        const { fn } = fakeFetch(() => ({ status }));
        await expect(provider(fn).createPullRequest(createInput)).rejects.toThrow(/github hosting/);
      }
    });
    it('missing/invalid head.sha → rejected', async () => {
      const { fn } = fakeFetch(() => ({ status: 201, body: ghPull({ head: { ref: 'feature/x', sha: 'zzz', repo: { name: 'widgets', owner: { login: 'acme' } } } }) }));
      await expect(provider(fn).createPullRequest(createInput)).rejects.toThrow(/head\.sha/);
    });
    it('PR number 0 / negative / non-integer → rejected (test 32)', async () => {
      for (const number of [0, -1, 4.5]) {
        const { fn } = fakeFetch(() => ({ status: 201, body: ghPull({ number }) }));
        await expect(provider(fn).createPullRequest(createInput)).rejects.toThrow(/PR number/);
      }
    });
    it('invalid html_url / query / fragment / casing → rejected (tests 33–35)', async () => {
      for (const html_url of [
        'https://evil.com/acme/widgets/pull/42',
        'http://github.com/acme/widgets/pull/42',
        'https://github.com/acme/widgets/pull/42?x=1',
        'https://github.com/acme/widgets/pull/42#c',
        'https://github.com/Acme/widgets/pull/42',
      ]) {
        const { fn } = fakeFetch(() => ({ status: 201, body: ghPull({ html_url }) }));
        await expect(provider(fn).createPullRequest(createInput)).rejects.toThrow(/PR URL/);
      }
    });
    it('makes exactly one fetch call per method, even on failure (test 39, no retry)', async () => {
      const { fn, calls } = fakeFetch(() => ({ status: 500 }));
      await expect(provider(fn).createPullRequest(createInput)).rejects.toThrow();
      expect(calls).toHaveLength(1);
    });
  });

  describe('error sanitization (tests 36–38)', () => {
    it('token is never present in a thrown error', async () => {
      const { fn } = fakeFetch(() => ({ status: 403, body: { message: TOKEN } }));
      await provider(fn)
        .repositoryExists(IDENTITY)
        .catch((e: unknown) => expect(String((e as Error).message)).not.toContain(TOKEN));
    });
    it('raw response body is not echoed in the error', async () => {
      const { fn } = fakeFetch(() => ({ status: 500, body: { secret: 'RESP-BODY-SECRET' } }));
      await provider(fn)
        .repositoryExists(IDENTITY)
        .catch((e: unknown) => expect(String((e as Error).message)).not.toContain('RESP-BODY-SECRET'));
    });
    it('request body (title/body) is not echoed in the error', async () => {
      const { fn } = fakeFetch(() => ({ status: 422 }));
      const input = { ...createInput, title: 'REQ-TITLE-SECRET', body: 'REQ-BODY-SECRET' };
      await provider(fn)
        .createPullRequest(input)
        .catch((e: unknown) => {
          const m = String((e as Error).message);
          expect(m).not.toContain('REQ-TITLE-SECRET');
          expect(m).not.toContain('REQ-BODY-SECRET');
        });
    });
  });
});

// ── Source-level absence guards (tests 40–51) ──────────────────────────────────────────────────────────────
function src(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}
/** Strip comments so guards match real CODE, not explanatory prose (e.g. a comment naming forbidden fields). */
function codeOf(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
const adapterSrc = codeOf(src('./index.ts'));
const pkgJson = src('../package.json');
const appModuleSrc = src('../../../apps/chunsik/src/app.module.ts');
const runtimeSrc = src('../../core/src/application/conversation-runtime.ts');
const composerSrc = src('../../core/src/application/response-composer.ts');
const gitProviderPortSrc = src('../../core/src/ports/git-provider.port.ts');
const gitManagerSrc = src('../../core/src/application/git-manager.ts');

describe('Sprint 3d-C absence guards (adapter-only; no octokit / shell / wiring / mutation)', () => {
  it('package has no octokit dependency (tests 41)', () => {
    expect(pkgJson.includes('octokit')).toBe(false);
    expect(pkgJson.includes('@octokit')).toBe(false);
  });
  it('adapter uses no child_process / CommandExecution / shell (tests 42/43)', () => {
    for (const forbidden of ['child_process', 'CommandExecution', 'CommandRunner', 'spawn(', 'execSync', 'require(']) {
      expect(adapterSrc.includes(forbidden)).toBe(false);
    }
  });
  it('adapter reads no env token (token is constructor-local only — CA change 1)', () => {
    expect(adapterSrc.includes('process.env')).toBe(false);
    expect(adapterSrc.includes('CHUNSIK_GITHUB_TOKEN')).toBe(false);
  });
  it('adapter uses only the four allowed endpoints — no merge/deploy/release/reviewer/label/assignee (test 51)', () => {
    for (const forbidden of ['/merge', 'requested_reviewers', 'labels', 'assignees', '/deployments', '/releases', 'reviewer']) {
      expect(adapterSrc.includes(forbidden)).toBe(false);
    }
  });
  // (Sprint 3d-D, ADR-0054 supersedes) The adapter is now wired into app.module and the runtime has PR
  // creation execution + PR_CREATED. The ENDURING invariant kept here: the runtime/composer never IMPORT the
  // adapter package directly — the runtime reaches it only via RepositoryHostingManager (CA change 7).
  it('ConversationRuntime / ResponseComposer never import the GitHub adapter package directly', () => {
    expect(runtimeSrc.includes('repository-hosting-github')).toBe(false);
    expect(runtimeSrc.includes('GitHubRepositoryHostingProvider')).toBe(false);
    expect(composerSrc.includes('repository-hosting-github')).toBe(false);
    expect(composerSrc.includes('GitHubRepositoryHostingProvider')).toBe(false);
  });
  it('Git capability has no PR method (tests 49/50)', () => {
    expect(gitProviderPortSrc.includes('createPullRequest')).toBe(false);
    expect(gitManagerSrc.includes('createPullRequest')).toBe(false);
  });
});
