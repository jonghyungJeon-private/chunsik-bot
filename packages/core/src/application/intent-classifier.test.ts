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

// ── Sprint 4c-Follow-up-6 (F6-A/B/C) — clause-scoped, negation-aware test-run routing ──────────────
describe('IntentClassifier — Follow-up-6 routing matrix (Gate 4B FAIL fix)', () => {
  const SCENARIO_C = [
    '다음 파일을 새로 만들어줘.',
    '',
    '경로:',
    'docs/uat/github-app-auth-smoke.md',
    '',
    '내용:',
    '# GitHub App Auth UAT',
    '',
    '- marker: quoky-dev app auth smoke test',
    '',
    '조건:',
    '- preview only',
    '- 파일을 실제로 만들거나 수정하지 말 것',
    '- workspace apply 하지 말 것',
    '- 테스트 실행하지 말 것',
    '- git commit/push/PR 하지 말 것',
  ].join('\n');

  it('the EXACT Gate 4B Scenario C request classifies as CODE_IMPLEMENTATION (never RUN_TESTS)', async () => {
    const intent = await classifier.classify(msg(SCENARIO_C));
    expect(intent.type).toBe(IntentType.IMPLEMENT_CODE);
    expect(intent.capability).toBe(Capability.CODE_IMPLEMENTATION);
    expect(intent.type).not.toBe(IntentType.RUN_TESTS);
  });

  it('a create-file request whose CONTENT merely contains the word "test" is NOT a test run (the exact defect)', async () => {
    const intent = await classifier.classify(
      msg('파일 생성:\ndocs/x.md\n내용:\n- marker: smoke test\n조건:\n- preview only\n- 테스트 실행하지 말 것'),
    );
    expect(intent.type).toBe(IntentType.IMPLEMENT_CODE);
  });

  it('cross-clause noun/verb never infers RUN_TESTS (test noun in clause A, action verb in clause B)', async () => {
    // "test" only in a content line; "실행" only in a negated condition — must not combine into RUN_TESTS.
    const intent = await classifier.classify(msg('- marker: smoke test\n- 뭔가 실행하지 마'));
    expect(intent.type).not.toBe(IntentType.RUN_TESTS);
  });

  it('CA §2 required outcomes', async () => {
    // positive
    for (const t of ['테스트 실행해줘', 'pnpm test 실행해줘']) {
      expect((await classifier.classify(msg(t))).type, t).toBe(IntentType.RUN_TESTS);
    }
    // negated → not RUN_TESTS
    for (const t of ['테스트 실행하지 말 것', '테스트는 돌리지 마']) {
      expect((await classifier.classify(msg(t))).type, t).not.toBe(IntentType.RUN_TESTS);
    }
    // mixed create/code + negated test → CODE_IMPLEMENTATION
    for (const t of ['파일을 만들어줘. 테스트는 실행하지 마.', '코드를 수정해줘. pnpm test는 돌리지 마.']) {
      expect((await classifier.classify(msg(t))).type, t).toBe(IntentType.IMPLEMENT_CODE);
    }
  });

  it('an explicit create-file request routes to CODE_IMPLEMENTATION even without a preview phrase', async () => {
    const intent = await classifier.classify(msg('docs/x.md 파일을 만들어줘'));
    expect(intent.type).toBe(IntentType.IMPLEMENT_CODE);
  });

  it('a negated create ("파일 만들지 마") does not force CODE_IMPLEMENTATION via the create signal', async () => {
    const intent = await classifier.classify(msg('그 파일 만들지 마'));
    expect(intent.type).not.toBe(IntentType.IMPLEMENT_CODE);
  });

  // F6 QA regressions (independent QA falsification): the classifier create-signal must be request-shaped, and
  // a create verb ending in "해줘" must not be consumed as a test-run action.
  it('a DESCRIPTIVE/past create phrase is NOT forced to CODE_IMPLEMENTATION ("이 파일이 어떻게 만들어졌는지 알려줘")', async () => {
    const intent = await classifier.classify(msg('이 파일이 어떻게 만들어졌는지 알려줘'));
    expect(intent.type).not.toBe(IntentType.IMPLEMENT_CODE);
    expect(intent.type).not.toBe(IntentType.RUN_TESTS);
  });

  it('a "create a test file" request routes to CODE_IMPLEMENTATION, never RUN_TESTS ("테스트 파일 생성해줘")', async () => {
    for (const t of ['테스트 파일 생성해줘', '테스트 파일 만들어줘']) {
      const intent = await classifier.classify(msg(t));
      expect(intent.type, t).toBe(IntentType.IMPLEMENT_CODE);
      expect(intent.type, t).not.toBe(IntentType.RUN_TESTS);
    }
  });

  it('a genuine test run with an explicit run verb still classifies as RUN_TESTS (no over-tightening)', async () => {
    for (const t of ['테스트 돌려줘', '테스트 실행해줘', '이 프로젝트 테스트 실행해줘']) {
      expect((await classifier.classify(msg(t))).type, t).toBe(IntentType.RUN_TESTS);
    }
  });
});

// ── Sprint 4c-Follow-up-7 (F7-B) — preview-request routing coverage (Gate 5 live turn-1 misroute fix) ──
describe('IntentClassifier — Follow-up-7 preview-request routing (Gate 5 turn-1 fix)', () => {
  const GATE5_PREVIEW_REQUEST = [
    '현재 활성 프로젝트의 아래 기존 파일에 대한 패치 변경안을 미리보기로 보여줘.',
    '',
    '파일:',
    'gate5/apply-smoke.txt',
    '',
    '현재 내용:',
    'gate5 apply smoke',
    'marker: PENDING',
    '',
    '변경 후 내용:',
    'gate5 apply smoke',
    'marker: quoky-gate5-workspace-apply',
    '',
    '조건:',
    '- 지금은 preview만 보여줄 것',
    '- 실제 파일에는 적용하지 말 것',
    '- workspace apply 하지 말 것',
    '- 테스트나 명령을 실행하지 말 것',
    '- git add/commit/push/PR 하지 말 것',
  ].join('\n');

  it('the EXACT Gate 5 live preview request routes to CODE_IMPLEMENTATION (preview), NOT GENERAL_CHAT (the turn-1 defect)', async () => {
    const intent = await classifier.classify(msg(GATE5_PREVIEW_REQUEST));
    expect(intent.type).toBe(IntentType.IMPLEMENT_CODE);
    expect(intent.capability).toBe(Capability.CODE_IMPLEMENTATION);
    expect(intent.raw).toEqual({ kind: 'preview' });
    expect(intent.type).not.toBe(IntentType.CHAT);
  });

  it('the broadened preview phrasings all route to IMPLEMENT_CODE (preview)', async () => {
    for (const t of ['패치 변경안을 미리보기로 보여줘', '코드 변경안 미리보기', '파일 변경안을 미리보기로 보여줘', '변경안을 미리보기로 보여줘']) {
      const intent = await classifier.classify(msg(t));
      expect(intent.type, t).toBe(IntentType.IMPLEMENT_CODE);
      expect(intent.raw, t).toEqual({ kind: 'preview' });
    }
  });
});
