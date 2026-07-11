/**
 * Safe, sanitized mapping of a thrown error to a USER-FACING message + stable code (Sprint 4c-Follow-up-7,
 * F7-D). The raw exception message and stack trace are NEVER exposed to the user — only a narrow,
 * deterministic set of known application errors is mapped to a fixed Korean message + safe code; everything
 * else collapses to a generic INTERNAL_ERROR. Callers keep the full exception in internal logs.
 *
 * This never reads `err.message` into the output (a raw message could carry a path, token, SQL, or provider
 * payload), so no secret or implementation detail can leak through the user-visible response.
 */

export interface SafeError {
  /** Stable, non-secret machine code shown to the user and used in tests. */
  code: string;
  /** Fixed, user-safe Korean description. Never the raw exception text. */
  message: string;
}

/** Optional non-secret context added to the rendered message (CA §4). */
export interface SafeErrorContext {
  stage?: string;
  requestId?: string;
}

const UNKNOWN: SafeError = { code: 'INTERNAL_ERROR', message: '알 수 없는 내부 오류가 발생했어요.' };

/** Narrow, ordered, deterministic mapping by error NAME (never by raw message). */
const RULES: ReadonlyArray<{ test: (name: string) => boolean; safe: SafeError }> = [
  {
    test: (n) => n === 'InvalidTaskTransitionError',
    safe: { code: 'TASK_TRANSITION_ERROR', message: '작업 상태를 변경하는 과정에서 허용되지 않은 상태 전이가 발생했어요.' },
  },
  {
    test: (n) => /approval/i.test(n),
    safe: { code: 'APPROVAL_STATE_ERROR', message: '승인 상태를 확인하는 과정에서 오류가 발생했어요.' },
  },
  {
    test: (n) => n === 'WorkspaceNotSafeError' || /workspace|apply/i.test(n),
    safe: { code: 'WORKSPACE_APPLY_ERROR', message: '변경 사항을 적용하는 과정에서 오류가 발생했어요.' },
  },
  {
    test: (n) => /intent|classif|routing/i.test(n),
    safe: { code: 'INTENT_ROUTING_ERROR', message: '요청 유형을 판단하는 과정에서 오류가 발생했어요.' },
  },
];

/** Map any thrown value to a sanitized {code, message}. Unknown → generic INTERNAL_ERROR. */
export function toSafeError(err: unknown): SafeError {
  const name = err instanceof Error ? err.name : '';
  for (const rule of RULES) {
    if (rule.test(name)) return rule.safe;
  }
  return UNKNOWN;
}

/**
 * Render the user-visible error response text (CA §1/§4). Includes a clear failure statement, the sanitized
 * message, an explicit "no change applied" confirmation, the safe code, and optional stage/requestId. Never
 * includes raw exception text or a stack trace.
 */
export function formatSafeErrorText(safe: SafeError, ctx: SafeErrorContext = {}): string {
  const lines = ['요청을 처리하는 중 오류가 발생했어요.', '', '오류 메시지:', safe.message];
  if (ctx.stage) lines.push('', '처리 단계:', ctx.stage);
  lines.push('', '아직 어떤 변경도 적용되지 않았어요.', `오류 코드: ${safe.code}`);
  if (ctx.requestId) lines.push(`요청 ID: ${ctx.requestId}`);
  return lines.join('\n');
}

/** A short, non-secret correlation id derived from a platform message id (never a secret). */
export function safeRequestId(messageId: string | undefined): string | undefined {
  if (!messageId) return undefined;
  const tail = String(messageId).replace(/[^A-Za-z0-9]/g, '').slice(-6);
  return tail ? `req-${tail}` : undefined;
}
