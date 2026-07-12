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

/**
 * Whether a mutation could have been applied by the time the turn failed (Sprint 4c-Follow-up-7 CA
 * correction). The user-visible failure text MUST NOT claim "no change applied" unless the failing path is
 * provably read-only / failed before any mutation port was invoked.
 *
 * - `CONFIRMED_NOT_APPLIED` — the failing path is provably non-mutating (e.g. the read-only preview/plan
 *   flow that stops at the approval gate, where the actual apply is a separate later turn). Safe to state
 *   that nothing was applied.
 * - `MAY_HAVE_APPLIED` — the runtime cannot prove where it failed (any generic/backstop catch). NEVER claim
 *   rollback or zero mutation; use the conservative "state cannot be verified" wording instead.
 */
export type MutationSafety = 'CONFIRMED_NOT_APPLIED' | 'MAY_HAVE_APPLIED';

/** Optional non-secret context added to the rendered message (CA §4). */
export interface SafeErrorContext {
  stage?: string;
  requestId?: string;
  /**
   * Mutation-certainty of the failing path. Omitted defaults to the conservative `MAY_HAVE_APPLIED`, so any
   * generic backstop that cannot prove non-mutation renders the "cannot verify" wording (never a false
   * zero-mutation claim). Only a provably read-only boundary should pass `CONFIRMED_NOT_APPLIED`.
   */
  mutationSafety?: MutationSafety;
}

/** Confirmed-non-mutation wording — used ONLY when non-mutation is provable (read-only / pre-mutation). */
const CONFIRMED_NOT_APPLIED_LINES = ['아직 어떤 변경도 적용되지 않았어요.'] as const;

/** Conservative wording when the runtime cannot prove whether a mutation was applied (generic backstop). */
const MAY_HAVE_APPLIED_LINES = [
  '변경 적용 여부를 확인할 수 없어요.',
  '추가 작업을 진행하기 전에 현재 상태를 확인해주세요.',
] as const;

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
 * Render the user-visible error response text (CA §1/§4; Follow-up-7 mutation-certainty correction). Includes
 * a clear failure statement, the sanitized message, a mutation-certainty line, the safe code, and optional
 * stage/requestId. The mutation-certainty line is chosen by {@link SafeErrorContext.mutationSafety}: an
 * explicit "no change applied" confirmation ONLY for a provably non-mutating path (`CONFIRMED_NOT_APPLIED`),
 * otherwise the conservative "state cannot be verified" wording. When `mutationSafety` is omitted it defaults
 * to `MAY_HAVE_APPLIED`, so no caller can accidentally emit a false zero-mutation claim. Never includes raw
 * exception text or a stack trace.
 */
export function formatSafeErrorText(safe: SafeError, ctx: SafeErrorContext = {}): string {
  const lines = ['요청을 처리하는 중 오류가 발생했어요.', '', '오류 메시지:', safe.message];
  if (ctx.stage) lines.push('', '처리 단계:', ctx.stage);
  const mutationLines =
    ctx.mutationSafety === 'CONFIRMED_NOT_APPLIED' ? CONFIRMED_NOT_APPLIED_LINES : MAY_HAVE_APPLIED_LINES;
  lines.push('', ...mutationLines, `오류 코드: ${safe.code}`);
  if (ctx.requestId) lines.push(`요청 ID: ${ctx.requestId}`);
  return lines.join('\n');
}

/** A short, non-secret correlation id derived from a platform message id (never a secret). */
export function safeRequestId(messageId: string | undefined): string | undefined {
  if (!messageId) return undefined;
  const tail = String(messageId).replace(/[^A-Za-z0-9]/g, '').slice(-6);
  return tail ? `req-${tail}` : undefined;
}
