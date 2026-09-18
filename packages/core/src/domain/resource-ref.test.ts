import { describe, expect, it } from 'vitest';
import { ResourceRef } from './resource-ref';

describe('ResourceRef', () => {
  it('uses source + externalId as stable value identity', () => {
    const left = new ResourceRef({ source: 'jira', externalId: 'ABC-12' });
    const same = new ResourceRef({ source: 'jira', externalId: 'ABC-12' });
    const otherSource = new ResourceRef({ source: 'github', externalId: 'ABC-12' });

    expect(left.equals(same)).toBe(true);
    expect(left.equals(otherSource)).toBe(false);
    expect(left.identity).toBe('jira:ABC-12');
  });

  it('normalizes surrounding whitespace and rejects incomplete identities', () => {
    expect(new ResourceRef({ source: ' jira ', externalId: ' ABC-12 ' })).toEqual(
      new ResourceRef({ source: 'jira', externalId: 'ABC-12' }),
    );
    expect(() => new ResourceRef({ source: '', externalId: 'ABC-12' })).toThrow(/source/);
    expect(() => new ResourceRef({ source: 'jira', externalId: ' ' })).toThrow(/externalId/);
  });
});
