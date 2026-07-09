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

  // Live Code Change Planning (ADR-0035) — deterministic code-change intent recognition.
  it('routes a bug-fix request to IMPLEMENT_CODE with raw.kind "fix"', async () => {
    const intent = await classifier.classify(msg('이 버그 고쳐줘'));
    expect(intent.type).toBe(IntentType.IMPLEMENT_CODE);
    expect(intent.capability).toBe(Capability.CODE_IMPLEMENTATION);
    expect(intent.requiresWork).toBe(true);
    expect(intent.raw).toEqual({ kind: 'fix' });
  });

  it('routes a "이 부분 수정해줘" request to IMPLEMENT_CODE with raw.kind "change"', async () => {
    const intent = await classifier.classify(msg('이 부분 수정해줘'));
    expect(intent.type).toBe(IntentType.IMPLEMENT_CODE);
    expect(intent.raw).toEqual({ kind: 'change' });
  });

  it('routes "코드 바꿔줘" to IMPLEMENT_CODE with raw.kind "change"', async () => {
    const intent = await classifier.classify(msg('코드 바꿔줘'));
    expect(intent.type).toBe(IntentType.IMPLEMENT_CODE);
    expect(intent.raw).toEqual({ kind: 'change' });
  });

  it('routes a refactor request to IMPLEMENT_CODE with raw.kind "refactor"', async () => {
    const intent = await classifier.classify(msg('이 함수 리팩터링 해줘'));
    expect(intent.type).toBe(IntentType.IMPLEMENT_CODE);
    expect(intent.raw).toEqual({ kind: 'refactor' });
  });

  it('does not shadow RUN_TESTS ("테스트 돌려줘" still classifies as a test run)', async () => {
    const intent = await classifier.classify(msg('테스트 돌려줘'));
    expect(intent.type).toBe(IntentType.RUN_TESTS);
    expect(intent.capability).toBe(Capability.TEST_EXECUTION);
  });

  it('does not shadow PROJECT_ANALYSIS ("이 프로젝트 구조 설명해줘" still classifies as analysis)', async () => {
    const intent = await classifier.classify(msg('이 프로젝트 구조 설명해줘'));
    expect(intent.type).toBe(IntentType.PROJECT_ANALYSIS);
    expect(intent.capability).toBe(Capability.PROJECT_ANALYSIS);
  });
});

// Sprint 4c-Follow-up (ADR-0062 draft) — deterministic PREVIEW intent + negation-aware TEST_EXECUTION detection.
describe('IntentClassifier — preview intent + negated test handling', () => {
  it('routes a Korean "미리보기" request to IMPLEMENT_CODE with raw.kind "preview"', async () => {
    for (const text of [
      '변경 미리보기 만들어줘',
      '코드 변경 미리보기 보여줘',
      '패치 미리보기만 보여줘',
      '파일 변경안 보여줘',
    ]) {
      const intent = await classifier.classify(msg(text));
      expect(intent.type).toBe(IntentType.IMPLEMENT_CODE);
      expect(intent.capability).toBe(Capability.CODE_IMPLEMENTATION);
      expect(intent.raw).toEqual({ kind: 'preview' });
    }
  });

  it('routes an English "diff/patch preview only" request to IMPLEMENT_CODE (preview)', async () => {
    for (const text of ['diff preview only, please', 'show me a patch preview', 'preview the change only']) {
      const intent = await classifier.classify(msg(text));
      expect(intent.type).toBe(IntentType.IMPLEMENT_CODE);
      expect(intent.raw).toEqual({ kind: 'preview' });
    }
  });

  it('routes the explicit /preview command to IMPLEMENT_CODE (preview)', async () => {
    const intent = await classifier.classify(msg('/preview 이 함수 리팩터링 초안 보여줘'));
    expect(intent.type).toBe(IntentType.IMPLEMENT_CODE);
    expect(intent.capability).toBe(Capability.CODE_IMPLEMENTATION);
    expect(intent.raw).toEqual({ kind: 'preview' });
    expect(intent.summary).toBe('이 함수 리팩터링 초안 보여줘');
  });

  it('P7/P8: a preview-only request that prohibits tests/commit/push routes to preview (never RUN_TESTS)', async () => {
    for (const text of [
      'diff preview only. do not run pnpm test. do not commit. do not push.',
      '변경 미리보기만 보여줘. pnpm test 실행하지 마. 커밋하지 마.',
    ]) {
      const intent = await classifier.classify(msg(text));
      expect(intent.type).toBe(IntentType.IMPLEMENT_CODE);
      expect(intent.raw).toEqual({ kind: 'preview' });
    }
  });

  it('N6/N7: a NEGATED test request is NOT classified as RUN_TESTS', async () => {
    for (const text of ['테스트 실행하지 마', 'pnpm test 실행하지 마', 'do not run pnpm test']) {
      const intent = await classifier.classify(msg(text));
      expect(intent.type).not.toBe(IntentType.RUN_TESTS);
    }
  });

  it('R9/R10: a genuine (non-negated) test request still classifies as RUN_TESTS (ADR-0033 unchanged)', async () => {
    for (const text of ['테스트 실행해줘', 'pnpm test 실행해줘', '이 프로젝트 테스트 돌려줘']) {
      const intent = await classifier.classify(msg(text));
      expect(intent.type).toBe(IntentType.RUN_TESTS);
      expect(intent.capability).toBe(Capability.TEST_EXECUTION);
    }
  });
});
