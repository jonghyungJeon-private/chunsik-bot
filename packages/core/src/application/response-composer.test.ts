import { describe, expect, it } from 'vitest';
import type { ConversationContext } from '../domain';
import { ResponseComposer } from './response-composer';
import type { CodeChangePreview, CodeDiffPreview, TestResultDetail } from './response-composer';

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

// ── Sprint 2q — AI Code Generation Preview (ADR-0038) ───────────────────────────────────────────

const FORBIDDEN_MUTATION_WORDS = ['적용했어요', '수정했어요', '반영했어요', '변경 완료'];

describe('ResponseComposer.composeCodeGenerationPreview', () => {
  const previewOf = (o: Partial<CodeChangePreview> = {}): CodeChangePreview => ({
    changes: [{ path: 'packages/core/src/application/foo.ts', kind: 'update', excerpt: 'fixed content' }],
    outOfScopeWarnings: [],
    ...o,
  });

  it('states, at least twice, that nothing was applied yet', () => {
    const reply = composer.composeCodeGenerationPreview(CTX, previewOf());
    const notAppliedMentions = (reply.text.match(/적용되지 않|지원하지 않/g) ?? []).length;
    expect(notAppliedMentions).toBeGreaterThanOrEqual(2);
  });

  it('never uses wording that implies a completed mutation', () => {
    const reply = composer.composeCodeGenerationPreview(CTX, previewOf());
    for (const word of FORBIDDEN_MUTATION_WORDS) {
      expect(reply.text).not.toContain(word);
    }
  });

  it('lists the changed file path and a bounded excerpt', () => {
    const reply = composer.composeCodeGenerationPreview(CTX, previewOf());
    expect(reply.text).toContain('packages/core/src/application/foo.ts');
    expect(reply.text).toContain('fixed content');
  });

  it('a delete change is shown without an excerpt', () => {
    const reply = composer.composeCodeGenerationPreview(
      CTX,
      previewOf({ changes: [{ path: 'packages/core/old.ts', kind: 'delete' }] }),
    );
    expect(reply.text).toContain('packages/core/old.ts');
    expect(reply.text).toContain('삭제 제안');
  });

  it('includes the out-of-scope warning line when present, omits it when absent', () => {
    const withWarning = composer.composeCodeGenerationPreview(CTX, previewOf({ outOfScopeWarnings: ['other.ts'] }));
    expect(withWarning.text).toContain('other.ts');
    const withoutWarning = composer.composeCodeGenerationPreview(CTX, previewOf({ outOfScopeWarnings: [] }));
    expect(withoutWarning.text).not.toContain('참고:');
  });

  it('more than the warning cap shows a truncated list with an "외 N개" suffix', () => {
    const manyPaths = Array.from({ length: 8 }, (_, i) => `packages/core/extra-${i}.ts`);
    const reply = composer.composeCodeGenerationPreview(CTX, previewOf({ outOfScopeWarnings: manyPaths }));
    expect(reply.text).toContain('외 3개');
    expect(reply.text).not.toContain('extra-7.ts');
  });

  it('an excerpt containing a run of triple backticks does not break the rendered fence', () => {
    const reply = composer.composeCodeGenerationPreview(
      CTX,
      previewOf({ changes: [{ path: 'foo.ts', kind: 'update', excerpt: 'before\n```\nnested\n```\nafter' }] }),
    );
    // A safe render uses a fence strictly longer than the longest backtick run already present.
    expect(reply.text).toContain('````');
    expect(reply.text).toContain('nested');
  });

  it('stays within the existing message-length bound even with a near-limit excerpt', () => {
    const reply = composer.composeCodeGenerationPreview(
      CTX,
      previewOf({ changes: [{ path: 'foo.ts', kind: 'update', excerpt: 'x'.repeat(5000) }] }),
    );
    expect(reply.text.length).toBeLessThanOrEqual(1900);
  });
});

describe('ResponseComposer.composeCodeGenerationPreviewFailed', () => {
  it('matches the CA-specified wording exactly', () => {
    const reply = composer.composeCodeGenerationPreviewFailed(CTX);
    expect(reply.text).toBe('코드 변경 제안을 생성하지 못했어요.\n파일은 수정되지 않았어요.');
  });

  it('does not imply a file was written or a patch was created', () => {
    const reply = composer.composeCodeGenerationPreviewFailed(CTX);
    for (const word of FORBIDDEN_MUTATION_WORDS) {
      expect(reply.text).not.toContain(word);
    }
  });
});

describe('ResponseComposer.composeCodeGenerationPreviewNoValidChange', () => {
  it('does not claim a successful proposal; states the file was not modified', () => {
    const reply = composer.composeCodeGenerationPreviewNoValidChange(CTX, ['other.ts']);
    expect(reply.text).not.toContain('제안이 준비됐어요');
    expect(reply.text).toContain('수정되지 않았어요');
  });

  it('includes the bounded out-of-scope warning when paths are given', () => {
    const reply = composer.composeCodeGenerationPreviewNoValidChange(CTX, ['other.ts']);
    expect(reply.text).toContain('other.ts');
  });

  it('is distinct from composeCodeGenerationPreviewFailed — generation succeeded, just out of scope', () => {
    const noValidChange = composer.composeCodeGenerationPreviewNoValidChange(CTX, ['other.ts']);
    const failed = composer.composeCodeGenerationPreviewFailed(CTX);
    expect(noValidChange.text).not.toBe(failed.text);
  });
});

// ── Sprint 2r — Unified Diff Preview (ADR-0039) ─────────────────────────────────────────────────

describe('ResponseComposer.composeCodeDiffPreview', () => {
  const diffPreviewOf = (o: Partial<CodeDiffPreview> = {}): CodeDiffPreview => ({
    changes: [
      {
        path: 'packages/core/src/application/foo.ts',
        kind: 'update',
        unified: '--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-old\n+new\n',
        binary: false,
      },
    ],
    outOfScopeWarnings: [],
    ...o,
  });

  it('states, at least twice, that nothing was applied yet', () => {
    const reply = composer.composeCodeDiffPreview(CTX, diffPreviewOf());
    const notAppliedMentions = (reply.text.match(/적용되지 않|지원하지 않/g) ?? []).length;
    expect(notAppliedMentions).toBeGreaterThanOrEqual(2);
  });

  it('never uses wording that implies a completed mutation', () => {
    const reply = composer.composeCodeDiffPreview(CTX, diffPreviewOf());
    for (const word of FORBIDDEN_MUTATION_WORDS) {
      expect(reply.text).not.toContain(word);
    }
  });

  it('lists the changed file path and the unified diff text', () => {
    const reply = composer.composeCodeDiffPreview(CTX, diffPreviewOf());
    expect(reply.text).toContain('packages/core/src/application/foo.ts');
    expect(reply.text).toContain('-old');
    expect(reply.text).toContain('+new');
  });

  it('a delete change is labeled "(삭제 제안)"', () => {
    const reply = composer.composeCodeDiffPreview(
      CTX,
      diffPreviewOf({
        changes: [{ path: 'packages/core/old.ts', kind: 'delete', unified: '--- a/old.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n', binary: false }],
      }),
    );
    expect(reply.text).toContain('packages/core/old.ts');
    expect(reply.text).toContain('삭제 제안');
  });

  it('a binary change renders a "diff를 표시할 수 없어요" notice, no code fence, and reaffirms not-modified (CA Round 1 Required Change #4)', () => {
    const reply = composer.composeCodeDiffPreview(
      CTX,
      diffPreviewOf({ changes: [{ path: 'image.png', kind: 'update', unified: '', binary: true }] }),
    );
    expect(reply.text).toContain('diff를 표시할 수 없어요');
    expect(reply.text).toContain('image.png');
    expect(reply.text).not.toContain('```');
    expect(reply.text).toContain('수정되지 않았어요');
  });

  it('an empty unified diff (size-skipped) renders a "diff를 표시할 수 없어요" notice — never a fabricated diff (CA Round 1 Required Change #4)', () => {
    const reply = composer.composeCodeDiffPreview(
      CTX,
      diffPreviewOf({ changes: [{ path: 'huge.ts', kind: 'update', unified: '', binary: false }] }),
    );
    expect(reply.text).toContain('diff를 표시할 수 없어요');
    expect(reply.text).toContain('huge.ts');
    expect(reply.text).not.toContain('```');
  });

  it('includes the out-of-scope warning line when present, omits it when absent', () => {
    const withWarning = composer.composeCodeDiffPreview(CTX, diffPreviewOf({ outOfScopeWarnings: ['other.ts'] }));
    expect(withWarning.text).toContain('other.ts');
    const withoutWarning = composer.composeCodeDiffPreview(CTX, diffPreviewOf({ outOfScopeWarnings: [] }));
    expect(withoutWarning.text).not.toContain('참고:');
  });

  it('a diff text containing a run of triple backticks does not break the rendered fence', () => {
    const reply = composer.composeCodeDiffPreview(
      CTX,
      diffPreviewOf({
        changes: [{ path: 'foo.ts', kind: 'update', unified: 'before\n```\nnested\n```\nafter', binary: false }],
      }),
    );
    expect(reply.text).toContain('````');
    expect(reply.text).toContain('nested');
  });

  it('a diff exceeding the per-file line/char cap is clamped with a truncation notice (CA Round 1 Required Change #2)', () => {
    const hugeUnified = Array.from({ length: 200 }, (_, i) => `-line ${i}`).join('\n');
    const reply = composer.composeCodeDiffPreview(
      CTX,
      diffPreviewOf({ changes: [{ path: 'foo.ts', kind: 'update', unified: hugeUnified, binary: false }] }),
    );
    expect(reply.text).toContain('일부만 보여드렸어요');
    expect(reply.text).not.toContain('line 199'); // well past the 40-line cap
  });

  it('many large diffs together still preserve the not-applied/not-modified wording and stay within the message budget (CA Round 1 Required Change #2)', () => {
    const bigUnified = Array.from({ length: 60 }, (_, i) => `-line ${i}`).join('\n');
    const reply = composer.composeCodeDiffPreview(
      CTX,
      diffPreviewOf({
        changes: Array.from({ length: 5 }, (_, i) => ({
          path: `packages/core/file-${i}.ts`,
          kind: 'update' as const,
          unified: bigUnified,
          binary: false,
        })),
      }),
    );
    expect(reply.text.length).toBeLessThanOrEqual(1900);
    expect(reply.text).toContain('파일은 수정되지 않았어요');
    expect(reply.text).toContain('아직 실제로 적용되지 않았어요');
    expect(reply.text).toContain('이 제안을 실제로 적용하는 기능은 아직 지원하지 않아요');
    expect(reply.text).toContain('생략했어요'); // not every file's diff fit — the omission is noted, not silent
  });

  it('stays within the existing message-length bound even with a near-limit single diff', () => {
    const reply = composer.composeCodeDiffPreview(
      CTX,
      diffPreviewOf({ changes: [{ path: 'foo.ts', kind: 'update', unified: 'x'.repeat(5000), binary: false }] }),
    );
    expect(reply.text.length).toBeLessThanOrEqual(1900);
  });
});
