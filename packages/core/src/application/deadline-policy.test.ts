import { describe, expect, it } from 'vitest';
import { effectiveProviderTimeoutMs } from './deadline-policy';

describe('effectiveProviderTimeoutMs', () => {
  it('uses the provider budget when request timeout is absent', () => {
    expect(effectiveProviderTimeoutMs(undefined, 900)).toBe(900);
  });

  it('uses the smaller request or provider budget', () => {
    expect(effectiveProviderTimeoutMs(100, 900)).toBe(100);
    expect(effectiveProviderTimeoutMs(1_000, 900)).toBe(900);
  });
});
