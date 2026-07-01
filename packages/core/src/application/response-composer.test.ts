import { describe, expect, it } from 'vitest';
import type { ConversationContext } from '../domain';
import { ResponseComposer } from './response-composer';
import type { TestResultDetail } from './response-composer';

const CTX: ConversationContext = { platform: 'test', channelId: 'c1', userId: 'u1' };
const composer = new ResponseComposer();

const detailOf = (o: Partial<TestResultDetail> = {}): TestResultDetail => ({
  kind: 'test',
  command: 'pnpm',
  args: ['test'],
  durationMs: 1234,
  stdout: '',
  stderr: '',
  ...o,
});

// ── Sprint 2m — Test Result Detail UX (ADR-0034) ────────────────────────────────────────────────

describe('ResponseComposer.composeTestResult', () => {
  it('success — contains command, duration, exitCode, excerpt', () => {
    const reply = composer.composeTestResult(CTX, { ...detailOf({ exitCode: 0, stdout: 'all green\n' }), passed: true });
    expect(reply.text).toContain('통과');
    expect(reply.text).toContain('pnpm test');
    expect(reply.text).toContain('종료 코드: 0');
    expect(reply.text).toContain('실행 시간: 1.2s');
    expect(reply.text).toContain('all green');
  });

  it('failure — contains command, duration, non-zero exitCode, excerpt', () => {
    const reply = composer.composeTestResult(CTX, {
      ...detailOf({ exitCode: 1, stdout: 'FAIL x.test.ts\n' }),
      passed: false,
    });
    expect(reply.text).toContain('실패');
    expect(reply.text).toContain('종료 코드: 1');
    expect(reply.text).toContain('FAIL x.test.ts');
  });

  it('short output → no truncation notice', () => {
    const reply = composer.composeTestResult(CTX, { ...detailOf({ exitCode: 0, stdout: 'ok\n' }), passed: true });
    expect(reply.text).not.toContain('마지막 부분만');
  });

  it('output >20 lines → tail kept, truncation notice shown', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`);
    const reply = composer.composeTestResult(CTX, {
      ...detailOf({ exitCode: 1, stdout: lines.join('\n') }),
      passed: false,
    });
    expect(reply.text).toContain('line-29');
    expect(reply.text).not.toContain('line-0\n');
    expect(reply.text).toContain('출력이 길어서 마지막 부분만 보여드렸어요.');
  });

  it('one huge line (>1200 chars, ≤20 lines) → char-capped tail kept, truncation notice shown', () => {
    const huge = `${'x'.repeat(2000)}TAIL_MARKER`;
    const reply = composer.composeTestResult(CTX, { ...detailOf({ exitCode: 1, stdout: huge }), passed: false });
    expect(reply.text).toContain('TAIL_MARKER');
    expect(reply.text).toContain('출력이 길어서 마지막 부분만 보여드렸어요.');
  });

  it('adapter-level "…[truncated]" marker → truncation notice shown even without a chat-level cut', () => {
    const reply = composer.composeTestResult(CTX, {
      ...detailOf({ exitCode: 1, stdout: 'short but adapter-capped\n…[truncated]' }),
      passed: false,
    });
    expect(reply.text).toContain('출력이 길어서 마지막 부분만 보여드렸어요.');
  });

  it('stdout preferred over stderr when both are non-empty', () => {
    const reply = composer.composeTestResult(CTX, {
      ...detailOf({ exitCode: 1, stdout: 'STDOUT_MARK', stderr: 'STDERR_MARK' }),
      passed: false,
    });
    expect(reply.text).toContain('STDOUT_MARK');
  });

  it('stdout selected but stderr also non-empty → omitted-stream notice present (does not hide stderr existed)', () => {
    const reply = composer.composeTestResult(CTX, {
      ...detailOf({ exitCode: 1, stdout: 'STDOUT_MARK', stderr: 'STDERR_MARK' }),
      passed: false,
    });
    expect(reply.text).toContain('stderr 출력도 있었지만');
  });

  it('stdout empty → stderr selected and shown, no omitted-stream notice', () => {
    const reply = composer.composeTestResult(CTX, {
      ...detailOf({ exitCode: 1, stdout: '', stderr: 'STDERR_ONLY' }),
      passed: false,
    });
    expect(reply.text).toContain('STDERR_ONLY');
    expect(reply.text).not.toContain('출력도 있었지만');
  });

  it('no output on either stream → graceful "출력이 없어요" line, not an empty block', () => {
    const reply = composer.composeTestResult(CTX, { ...detailOf({ exitCode: 0 }), passed: true });
    expect(reply.text).toContain('출력이 없어요.');
  });

  it('never asserts a completeness/security guarantee about the log', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`);
    const reply = composer.composeTestResult(CTX, {
      ...detailOf({ exitCode: 1, stdout: lines.join('\n') }),
      passed: false,
    });
    expect(reply.text).not.toContain('안전');
    expect(reply.text).not.toContain('완전히 제거');
  });

  it('full rendered text stays under ~1900 chars even at max excerpt size', () => {
    const huge = Array.from({ length: 50 }, (_, i) => 'x'.repeat(100) + i).join('\n');
    const reply = composer.composeTestResult(CTX, { ...detailOf({ exitCode: 1, stdout: huge }), passed: false });
    expect(reply.text.length).toBeLessThanOrEqual(1900);
  });
});

describe('ResponseComposer.composeTestTimedOut', () => {
  it('does not claim pass/fail, does not show exitCode, does not claim a configured timeout value', () => {
    const reply = composer.composeTestTimedOut(CTX, detailOf({ durationMs: 30_000 }));
    expect(reply.text).not.toContain('통과');
    expect(reply.text).not.toContain('실패');
    expect(reply.text).not.toContain('종료 코드');
    expect(reply.text).not.toContain('configured');
    expect(reply.text).toContain('제한 시간');
    expect(reply.text).toContain('실행 시간: 30.0s');
  });

  it('is distinct from composeTestResult wording', () => {
    const timedOut = composer.composeTestTimedOut(CTX, detailOf({ durationMs: 30_000 }));
    const result = composer.composeTestResult(CTX, { ...detailOf({ exitCode: 1 }), passed: false });
    expect(timedOut.text).not.toBe(result.text);
  });
});

// ── Sprint 2n — Live Code Change Planning (ADR-0035) ────────────────────────────────────────────

describe('ResponseComposer.composeCodeChangeApprovalRequired', () => {
  it('names this as a code-change request, states no file is modified yet, and how to reply', () => {
    const reply = composer.composeCodeChangeApprovalRequired(CTX);
    expect(reply.text).toContain('승인');
    expect(reply.text).toContain('코드 변경');
    expect(reply.text).toContain('수정하지 않');
    expect(reply.text).toContain('"승인"');
    expect(reply.text).toContain('"취소"');
  });

  it('is distinct from the generic composeApprovalRequired wording', () => {
    const generic = composer.composeApprovalRequired(CTX);
    const codeChange = composer.composeCodeChangeApprovalRequired(CTX);
    expect(codeChange.text).not.toBe(generic.text);
  });
});

describe('ResponseComposer.composePlanningOnlyApproved', () => {
  it('never claims completion — no "완료", states planning-only progress', () => {
    const reply = composer.composePlanningOnlyApproved(CTX);
    expect(reply.text).not.toContain('완료');
    expect(reply.text).toContain('승인은 확인했어요');
    expect(reply.text).toContain('계획까지만');
  });

  it('is distinct from composeExecutionResult("COMPLETED")', () => {
    const planningOnly = composer.composePlanningOnlyApproved(CTX);
    const completed = composer.composeExecutionResult(CTX, 'COMPLETED');
    expect(planningOnly.text).not.toBe(completed.text);
  });
});

// ── Sprint 2o — Code Change Scope Collection (ADR-0036) ─────────────────────────────────────────

describe('ResponseComposer.composeTargetScopeClarification', () => {
  it('asks for a file path with a concrete example', () => {
    const reply = composer.composeTargetScopeClarification(CTX);
    expect(reply.text).toContain('파일 경로');
    expect(reply.text).toContain('packages/core/src/application/foo.ts');
  });

  it('instructs the user to re-send the full request together with the path', () => {
    const reply = composer.composeTargetScopeClarification(CTX);
    expect(reply.text).toContain('다시 요청');
    expect(reply.text).toContain('파일에서');
  });

  it('does not present module/area text alone as a sufficient example', () => {
    const reply = composer.composeTargetScopeClarification(CTX);
    expect(reply.text).toContain('아직 부족해요');
    expect(reply.text).not.toMatch(/또는\s*"로그인 처리 부분"/);
  });
});

// ── Sprint 2p — Multi-turn Code Scope Clarification (ADR-0037) ─────────────────────────────────

describe('ResponseComposer.composeScopeClarificationCancelled', () => {
  it('does not claim a plan/patch/execution was created or cancelled', () => {
    const reply = composer.composeScopeClarificationCancelled(CTX);
    expect(reply.text).not.toContain('완료');
    expect(reply.text).not.toContain('계획');
    expect(reply.text).not.toContain('작업을 취소');
  });

  it('states the request itself was dropped and how to try again', () => {
    const reply = composer.composeScopeClarificationCancelled(CTX);
    expect(reply.text).toContain('요청');
    expect(reply.text).toContain('취소');
    expect(reply.text).toContain('파일 경로');
  });

  it('is distinct from the generic composeExecutionResult("CANCELLED") wording', () => {
    const scopeCancel = composer.composeScopeClarificationCancelled(CTX);
    const generic = composer.composeExecutionResult(CTX, 'CANCELLED');
    expect(scopeCancel.text).not.toBe(generic.text);
  });
});
