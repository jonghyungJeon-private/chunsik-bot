import { describe, expect, it } from 'vitest';
import { RepositoryIdentityResolver } from './repository-identity-resolver';
import type { RepositoryIdentityConfig } from '../domain';

const resolver = new RepositoryIdentityResolver();

describe('RepositoryIdentityResolver (CAP-010 config subset, ADR-0051, Sprint 3d-A)', () => {
  it('resolves a valid github owner/repo config to a RepositoryIdentity (test 1)', () => {
    const r = resolver.resolve({ provider: 'github', owner: 'acme', repo: 'widgets' });
    expect(r).toEqual({ status: 'resolved', identity: { provider: 'github', owner: 'acme', repo: 'widgets' } });
  });

  it('rejects a provider other than github (test 2)', () => {
    const r = resolver.resolve({ provider: 'gitlab', owner: 'acme', repo: 'widgets' });
    expect(r).toEqual({ status: 'missing', reason: 'unsupported-provider' });
  });

  it('returns not-configured when config is undefined/null (tests 25/29)', () => {
    expect(resolver.resolve(undefined)).toEqual({ status: 'missing', reason: 'not-configured' });
    expect(resolver.resolve(null)).toEqual({ status: 'missing', reason: 'not-configured' });
  });

  it('returns not-configured when both owner and repo are absent (CA change 3)', () => {
    expect(resolver.resolve({ provider: 'github', owner: '', repo: '' })).toEqual({
      status: 'missing',
      reason: 'not-configured',
    });
  });

  it('owner present, repo absent → invalid-repo (test 30)', () => {
    expect(resolver.resolve({ provider: 'github', owner: 'acme', repo: '' })).toEqual({
      status: 'missing',
      reason: 'invalid-repo',
    });
  });

  it('repo present, owner absent → invalid-owner (test 31)', () => {
    expect(resolver.resolve({ provider: 'github', owner: '', repo: 'widgets' })).toEqual({
      status: 'missing',
      reason: 'invalid-owner',
    });
  });

  it('classifies unsafe owner as invalid-owner (tests 5/7/9/11/13/32-34)', () => {
    for (const owner of [' acme', 'own/er', 'https://x', 'ac\nme', 'a'.repeat(40), '-o', 'o-', 'a--b', 'ghp_x']) {
      expect(resolver.resolve({ provider: 'github', owner, repo: 'widgets' })).toEqual({
        status: 'missing',
        reason: 'invalid-owner',
      });
    }
  });

  it('classifies unsafe repo as invalid-repo (tests 6/8/10/12/14/15-18/37/38)', () => {
    for (const repo of [
      'my repo',
      'own/er',
      'https://x',
      'wid\ngets',
      'a'.repeat(101),
      'ghp_abcdef123456',
      'github_pat_abcdef',
      'my-token',
      'secret-repo',
      'chunsik-bot.git',
      '.repo',
    ]) {
      expect(resolver.resolve({ provider: 'github', owner: 'acme', repo })).toEqual({
        status: 'missing',
        reason: 'invalid-repo',
      });
    }
  });

  it('resolved identity has EXACTLY provider/owner/repo — no token, no remoteUrl, no extra keys (tests 20/21/46/47)', () => {
    const r = resolver.resolve({ provider: 'github', owner: 'acme', repo: 'widgets' });
    expect(r.status).toBe('resolved');
    if (r.status !== 'resolved') throw new Error('unreachable');
    expect(Object.keys(r.identity).sort()).toEqual(['owner', 'provider', 'repo']);
    expect(JSON.stringify(r.identity)).not.toMatch(/token|secret|password|remoteurl|url/i);
  });

  it('never copies arbitrary extra keys into the identity (Q5 no-leak)', () => {
    // A config object that smuggles an extra field must not leak it into the resolved identity.
    const smuggled = { provider: 'github', owner: 'acme', repo: 'widgets', token: 'ghp_leak' } as RepositoryIdentityConfig & {
      token: string;
    };
    const r = resolver.resolve(smuggled);
    expect(r.status).toBe('resolved');
    if (r.status !== 'resolved') throw new Error('unreachable');
    expect('token' in r.identity).toBe(false);
    expect(JSON.stringify(r.identity)).not.toContain('ghp_leak');
  });

  it('never throws for malformed input (test 40)', () => {
    const garbage: unknown[] = [
      undefined,
      null,
      {},
      { provider: 123, owner: {}, repo: [] },
      { provider: 'github', owner: null, repo: undefined },
      { owner: 'acme' },
      'not-an-object',
      42,
    ];
    for (const g of garbage) {
      expect(() => resolver.resolve(g as RepositoryIdentityConfig | undefined)).not.toThrow();
    }
  });

  it('has no constructor dependency — no logger can be injected (test 41)', () => {
    expect(RepositoryIdentityResolver.length).toBe(0);
  });

  it('every missing reason is a fixed enum value — never an echoed input (Q5)', () => {
    const reasons = new Set<string>();
    reasons.add((resolver.resolve(undefined) as { reason: string }).reason);
    reasons.add((resolver.resolve({ provider: 'gitlab', owner: 'a', repo: 'b' }) as { reason: string }).reason);
    reasons.add((resolver.resolve({ provider: 'github', owner: 'ghp_x', repo: 'b' }) as { reason: string }).reason);
    reasons.add((resolver.resolve({ provider: 'github', owner: 'a', repo: 'ghp_x' }) as { reason: string }).reason);
    for (const reason of reasons) {
      expect(['not-configured', 'unsupported-provider', 'invalid-owner', 'invalid-repo']).toContain(reason);
    }
  });
});
