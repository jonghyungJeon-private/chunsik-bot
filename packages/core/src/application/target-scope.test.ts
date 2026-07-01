import { describe, expect, it } from 'vitest';
import { extractTargetPathCandidates, normalizeRelativePath } from './target-scope';

describe('extractTargetPathCandidates (Sprint 2o, ADR-0036)', () => {
  it('extracts a project-relative file path mentioned in natural language', () => {
    expect(extractTargetPathCandidates('packages/core/src/application/foo.ts에서 버그 고쳐줘')).toContain(
      'packages/core/src/application/foo.ts',
    );
  });

  it('rejects an absolute path', () => {
    expect(extractTargetPathCandidates('/etc/passwd 고쳐줘')).not.toContain('/etc/passwd');
  });

  it('rejects a traversal path', () => {
    expect(extractTargetPathCandidates('../../etc/passwd 고쳐줘')).toEqual([]);
  });

  it('rejects tokens with no path separator (Node.js, e.g., v1.2.3)', () => {
    const candidates = extractTargetPathCandidates('Node.js 버전 v1.2.3 참고, e.g. 이런 식으로 고쳐줘');
    expect(candidates).not.toContain('Node.js');
    expect(candidates).not.toContain('v1.2.3');
    expect(candidates.some((c) => c.startsWith('e.g'))).toBe(false);
  });

  it('rejects a bare root-level filename (no path separator)', () => {
    expect(extractTargetPathCandidates('foo.ts 고쳐줘')).toEqual([]);
  });

  it('returns no candidates for plain module/area text', () => {
    expect(extractTargetPathCandidates('로그인 처리 부분 수정해줘')).toEqual([]);
  });

  it('returns multiple candidates in order of appearance', () => {
    const candidates = extractTargetPathCandidates(
      'v1.2.3 참고해서 packages/core/src/a.ts 랑 packages/core/src/b.ts 고쳐줘',
    );
    expect(candidates).toEqual(['packages/core/src/a.ts', 'packages/core/src/b.ts']);
  });
});

describe('normalizeRelativePath (Sprint 2o, ADR-0036)', () => {
  it('strips a leading "./"', () => {
    expect(normalizeRelativePath('./packages/foo.ts')).toBe('packages/foo.ts');
  });

  it('collapses duplicate slashes', () => {
    expect(normalizeRelativePath('packages//foo.ts')).toBe('packages/foo.ts');
  });

  it('drops a trailing slash', () => {
    expect(normalizeRelativePath('packages/foo/')).toBe('packages/foo');
  });

  it('treats equivalent forms as equal for exact-match comparison', () => {
    const forms = ['./packages/foo.ts', 'packages/foo.ts', 'packages//foo.ts'];
    const normalized = forms.map(normalizeRelativePath);
    expect(new Set(normalized).size).toBe(1);
  });

  it('does not attempt to resolve ".." — leaves it untouched', () => {
    expect(normalizeRelativePath('../escape.ts')).toBe('../escape.ts');
  });
});
