import { describe, expect, it } from 'vitest';
import { RiskPolicy } from './risk-policy';
import { Capability, IntentType, RiskLevel } from '../domain';

describe('RiskPolicy', () => {
  const rp = new RiskPolicy();

  it('rates conversational capabilities LOW and local code MEDIUM', () => {
    expect(rp.assessCapability(Capability.GENERAL_CHAT)).toBe(RiskLevel.LOW);
    expect(rp.assessCapability(Capability.CODE_IMPLEMENTATION)).toBe(RiskLevel.MEDIUM);
  });

  it('escalates external/destructive commands', () => {
    expect(rp.assessCommand('git push origin main')).toBe(RiskLevel.HIGH);
    expect(rp.assessCommand('rm -rf /tmp/x')).toBe(RiskLevel.CRITICAL);
    expect(rp.assessCommand('ls -la')).toBe(RiskLevel.MEDIUM);
  });

  it('requires approval only for HIGH and CRITICAL', () => {
    expect(rp.requiresApproval(RiskLevel.LOW)).toBe(false);
    expect(rp.requiresApproval(RiskLevel.MEDIUM)).toBe(false);
    expect(rp.requiresApproval(RiskLevel.HIGH)).toBe(true);
    expect(rp.requiresApproval(RiskLevel.CRITICAL)).toBe(true);
  });

  it('assessIntent derives from capability', () => {
    expect(
      rp.assessIntent({
        type: IntentType.CHAT,
        capability: Capability.GENERAL_CHAT,
        confidence: 1,
        requiresWork: true,
        summary: 'hi',
      }),
    ).toBe(RiskLevel.LOW);
  });
});
