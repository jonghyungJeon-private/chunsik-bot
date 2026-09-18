import { describe, expect, it } from 'vitest';
import {
  ProactiveDelegationDecision,
  ProactiveDelegationDisposition,
  ProactiveDelegationReason,
} from './proactive-delegation-decision';
import { TriggerSource, TriggerSourceKind } from './trigger-source';
import { agentProfileId } from './agent-profile';

describe('ProactiveDelegationDecision', () => {
  it('is immutable and accepts only lifecycle-consistent outcomes', () => {
    const decision = new ProactiveDelegationDecision({
      workItemId: 'work-1',
      fromAgentProfileId: agentProfileId('builder'),
      toAgentProfileId: agentProfileId('reviewer'),
      trigger: new TriggerSource({
        kind: TriggerSourceKind.INTERNAL_CONTINUATION,
        provenanceId: 'continuation-1',
        observedAt: '2026-09-04T00:00:00.000Z',
      }),
      disposition: ProactiveDelegationDisposition.DELEGATE,
      reason: ProactiveDelegationReason.DELEGATABLE_ACTIVE_WORK_ITEM,
    });
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.trigger)).toBe(true);
    expect(() => new ProactiveDelegationDecision({
      ...decision,
      disposition: ProactiveDelegationDisposition.NO_ACTION,
    })).toThrow(/outcome/);
  });
});
