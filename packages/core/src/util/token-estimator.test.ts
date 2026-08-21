import { describe, expect, it } from 'vitest';
import { ESTIMATED_CHARACTERS_PER_TOKEN, estimateTokenCount } from './token-estimator';

describe('estimateTokenCount', () => {
  it('returns zero for empty content', () => {
    expect(estimateTokenCount('')).toBe(0);
  });

  it('rounds partial tokens up using the deterministic character ratio', () => {
    expect(ESTIMATED_CHARACTERS_PER_TOKEN).toBe(4);
    expect(estimateTokenCount('a')).toBe(1);
    expect(estimateTokenCount('abcd')).toBe(1);
    expect(estimateTokenCount('abcde')).toBe(2);
  });

  it('uses JavaScript character length consistently for non-ASCII content', () => {
    expect(estimateTokenCount('한글테스트')).toBe(2);
  });
});
