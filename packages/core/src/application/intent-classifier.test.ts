import { describe, expect, it } from 'vitest';
import { IntentClassifier } from './intent-classifier';
import { Capability, IntentType } from '../domain';
import type { InboundMessage } from '../domain';
import type { CapabilityRouter } from './capability-router';

const classifier = new IntentClassifier({} as unknown as CapabilityRouter);

function msg(text: string): InboundMessage {
  return { text, context: {} } as unknown as InboundMessage;
}

describe('IntentClassifier.classify (v1 deterministic)', () => {
  it('routes a structure/analysis question to PROJECT_ANALYSIS (ADR-0019)', async () => {
    for (const text of [
      '이 프로젝트가 어떤 구조인지 짧게 설명해줘',
      '이 레포 구조 분석해줘',
      'explain the structure of this repo',
      '패키지 구조 설명해줘',
    ]) {
      const intent = await classifier.classify(msg(text));
      expect(intent.type).toBe(IntentType.PROJECT_ANALYSIS);
      expect(intent.capability).toBe(Capability.PROJECT_ANALYSIS);
      expect(intent.requiresWork).toBe(true);
    }
  });

  it('routes a registration command to REGISTER_PROJECT, not analysis', async () => {
    const intent = await classifier.classify(msg('이 프로젝트 등록해줘: /tmp/repo'));
    expect(intent.type).toBe(IntentType.REGISTER_PROJECT);
    expect(intent.raw).toEqual({ path: '/tmp/repo' });
  });

  it('falls back to general chat for an ordinary question', async () => {
    const intent = await classifier.classify(msg('춘식아 안녕?'));
    expect(intent.type).toBe(IntentType.CHAT);
    expect(intent.capability).toBe(Capability.GENERAL_CHAT);
  });
});
