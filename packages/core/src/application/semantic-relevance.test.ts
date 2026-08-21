import { describe, expect, it } from 'vitest';
import { extractSemanticKeywords, scoreSemanticRelevance } from './semantic-relevance';

describe('semantic relevance', () => {
  it('extracts unique case-insensitive Unicode keywords in encounter order', () => {
    expect(extractSemanticKeywords('Context, context BUILDER! 춘식 봇 42')).toEqual([
      'context',
      'builder',
      '춘식',
      '봇',
      '42',
    ]);
  });

  it('scores query keyword coverage within the bounded 0-1 range', () => {
    expect(scoreSemanticRelevance('context ranking budget', 'Ranking the context history')).toBe(
      2 / 3,
    );
    expect(scoreSemanticRelevance('context ranking', 'CONTEXT ranking context')).toBe(1);
    expect(scoreSemanticRelevance('context ranking', 'unrelated memory')).toBe(0);
  });

  it('does not let duplicate keywords inflate either side of the score', () => {
    expect(scoreSemanticRelevance('context context ranking', 'context context context')).toBe(0.5);
  });

  it.each([
    ['', 'candidate'],
    ['!!!', 'candidate'],
    ['query', ''],
    ['query', '---'],
  ])('returns zero for empty keyword input %#', (query, candidate) => {
    expect(scoreSemanticRelevance(query, candidate)).toBe(0);
  });
});
