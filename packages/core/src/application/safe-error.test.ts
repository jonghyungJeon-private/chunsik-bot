import { describe, expect, it } from 'vitest';
import { InvalidTaskTransitionError, WorkspaceNotSafeError } from '../errors';
import { formatSafeErrorText, safeRequestId, toSafeError } from './safe-error';

describe('safe-error (Sprint 4c-Follow-up-7, F7-D)', () => {
  it('maps InvalidTaskTransitionError to the sanitized message + TASK_TRANSITION_ERROR (never the raw text)', () => {
    const err = new InvalidTaskTransitionError('PENDING', 'RUNNING');
    const safe = toSafeError(err);
    expect(safe.code).toBe('TASK_TRANSITION_ERROR');
    expect(safe.message).toBe('작업 상태를 변경하는 과정에서 허용되지 않은 상태 전이가 발생했어요.');
    // the raw exception text must NOT appear anywhere in the safe mapping
    expect(safe.message).not.toContain('Illegal task transition');
    expect(safe.message).not.toContain('PENDING');
  });

  it('maps the known error categories deterministically (by Error name)', () => {
    expect(toSafeError(new WorkspaceNotSafeError('dirty')).code).toBe('WORKSPACE_APPLY_ERROR');
    const approvalErr = new Error('x');
    approvalErr.name = 'ApprovalStateError';
    expect(toSafeError(approvalErr).code).toBe('APPROVAL_STATE_ERROR');
    const routingErr = new Error('y');
    routingErr.name = 'IntentRoutingError';
    expect(toSafeError(routingErr).code).toBe('INTENT_ROUTING_ERROR');
  });

  it('collapses an unknown error to a generic INTERNAL_ERROR with no raw detail', () => {
    const safe = toSafeError(new Error('connect ECONNREFUSED 10.0.0.1:5432 password=hunter2 /abs/secret/key.pem'));
    expect(safe.code).toBe('INTERNAL_ERROR');
    expect(safe.message).toBe('알 수 없는 내부 오류가 발생했어요.');
    // no leakage of the raw message (host/port/password/path)
    expect(safe.message).not.toMatch(/ECONNREFUSED|password|hunter2|\.pem|10\.0\.0\.1/);
  });

  it('formatSafeErrorText includes the failure statement, mapped message, no-change line, and code', () => {
    const text = formatSafeErrorText({ code: 'TASK_TRANSITION_ERROR', message: '작업 상태를 변경하는 과정에서 허용되지 않은 상태 전이가 발생했어요.' });
    expect(text).toContain('요청을 처리하는 중 오류가 발생했어요.');
    expect(text).toContain('작업 상태를 변경하는 과정에서 허용되지 않은 상태 전이가 발생했어요.');
    expect(text).toContain('아직 어떤 변경도 적용되지 않았어요.');
    expect(text).toContain('오류 코드: TASK_TRANSITION_ERROR');
    // must NOT carry the raw exception text or a stack trace
    expect(text).not.toContain('Illegal task transition: PENDING -> RUNNING');
    expect(text).not.toMatch(/\bat \w+.*\(.*:\d+:\d+\)/); // no stack frames
  });

  it('includes optional non-secret stage + requestId when provided', () => {
    const text = formatSafeErrorText(
      { code: 'INTENT_ROUTING_ERROR', message: '요청 유형을 판단하는 과정에서 오류가 발생했어요.' },
      { stage: 'intent-routing', requestId: 'req-ab12cd' },
    );
    expect(text).toContain('처리 단계:\nintent-routing');
    expect(text).toContain('요청 ID: req-ab12cd');
  });

  it('safeRequestId derives a short non-secret id (or undefined)', () => {
    expect(safeRequestId('1525545479990153367')).toBe('req-153367');
    expect(safeRequestId(undefined)).toBeUndefined();
  });
});
