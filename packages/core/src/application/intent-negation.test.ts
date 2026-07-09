import { describe, expect, it } from 'vitest';
import { isNegated, unnegatedMatch } from './intent-negation';

// Sprint 4c-Follow-up (ADR-0062 draft) — the shared negation utility used by IntentClassifier.detectTestRun and
// the ConversationRuntime mutation gates. Negation only REMOVES a trigger; it never creates a positive intent.

/** Test helper: does the first occurrence of `token` in `text` sit under a negation? */
function tokenNegated(text: string, token: string): boolean {
  return isNegated(text, text.toLowerCase().indexOf(token.toLowerCase()), token.length);
}

describe('isNegated (clause-scoped)', () => {
  it('N1: "do not commit" → commit token negated', () => {
    expect(tokenNegated('do not commit', 'commit')).toBe(true);
  });
  it('N2: "커밋하지 마세요" → commit token negated', () => {
    expect(tokenNegated('커밋하지 마세요', '커밋')).toBe(true);
  });
  it('N3: "commit this" → commit token NOT negated', () => {
    expect(tokenNegated('commit this', 'commit')).toBe(false);
  });
  it('N4: "do not push, but please commit" → push negated, commit NOT (clause boundary)', () => {
    expect(tokenNegated('do not push, but please commit', 'push')).toBe(true);
    expect(tokenNegated('do not push, but please commit', 'commit')).toBe(false);
  });
  it('N5: "커밋 없이 진행해" → commit token negated', () => {
    expect(tokenNegated('커밋 없이 진행해', '커밋')).toBe(true);
  });
  it('N6: "do not run tests" → test token negated', () => {
    expect(tokenNegated('do not run tests', 'test')).toBe(true);
  });
  it('N7: "테스트 실행하지 마" → test token negated', () => {
    expect(tokenNegated('테스트 실행하지 마', '테스트')).toBe(true);
  });
  it('generalizes past 하지-마: "PR 만들지 마" → PR token negated', () => {
    expect(tokenNegated('PR 만들지 마', 'PR')).toBe(true);
  });
  it('does not over-suppress a genuine request in a separate clause', () => {
    expect(tokenNegated('커밋하지 마. 그리고 테스트 실행해줘', '테스트')).toBe(false);
  });
  it('does not false-positive on an incidental "지 마" (e.g. "이미지 마감")', () => {
    expect(tokenNegated('이미지 마감을 커밋해줘', '커밋')).toBe(false);
  });
});

describe('unnegatedMatch', () => {
  it('matches a non-negated regex token', () => {
    expect(unnegatedMatch('커밋해줘', [/커밋|\bcommit\b/i])).toBe(true);
  });
  it('suppresses a negated regex token', () => {
    expect(unnegatedMatch('커밋하지 마', [/커밋|\bcommit\b/i])).toBe(false);
  });
  it('matches a non-negated literal word', () => {
    expect(unnegatedMatch('이대로 진행', ['이대로 진행'])).toBe(true);
  });
  it('suppresses a negated literal word', () => {
    expect(unnegatedMatch('적용하지 마', ['적용'])).toBe(false);
  });
  it('returns true when at least one occurrence is non-negated', () => {
    expect(unnegatedMatch('do not commit. but commit this', [/\bcommit\b/i])).toBe(true);
  });
});
