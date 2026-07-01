import type {
  ApprovalRequest,
  Artifact,
  ConversationContext,
  OutboundMessage,
} from '../domain';
import type { AiExecutionResult } from '../ports';

/**
 * The terminal/halt status of an execution turn (Conversation Runtime, ADR-0032). Kept as a
 * narrow local union so ResponseComposer does not depend on the orchestrator module; the runtime
 * passes the Execution Orchestrator's `ExecutionOutcome.status` (a superset) through unchanged.
 */
export type ExecutionReplyStatus =
  | 'COMPLETED'
  | 'AWAITING_APPROVAL'
  | 'DENIED'
  | 'STOPPED_ON_FAILURE'
  | 'CANCELLED';

/**
 * Turns an execution result (or an approval prompt) into a normalized
 * OutboundMessage. The PlatformAdapter renders it natively. v1 implements a
 * straightforward pass-through; richer formatting per ArtifactKind is a TODO.
 *
 * Note: it deliberately never includes which provider was selected — the user
 * should not normally see that.
 */
export class ResponseComposer {
  compose(
    context: ConversationContext,
    result: AiExecutionResult,
    artifacts: Artifact[] = [],
  ): OutboundMessage {
    const text = result.text.trim() || '(빈 응답이에요. 다시 시도해 주세요.)';
    return {
      context,
      text,
      ...(artifacts.length ? { artifacts } : {}),
    };
  }

  composeApprovalNotice(context: ConversationContext, request: ApprovalRequest): OutboundMessage {
    return {
      context,
      text: `이 작업은 승인이 필요해요 (${request.riskLevel}):\n${request.reason}\n진행하려면 "승인", 그만두려면 "취소"라고 답해 주세요.`,
    };
  }

  /**
   * Generic "this needs approval" prompt for when only a reference (not the full `ApprovalRequest`)
   * is at hand — e.g. a fresh execution that halted at `AWAITING_APPROVAL` (Conversation Runtime,
   * ADR-0032). Keeps all user-facing text inside ResponseComposer.
   */
  composeApprovalRequired(context: ConversationContext): OutboundMessage {
    return {
      context,
      text: '이 작업은 승인이 필요해요. 진행하려면 "승인", 그만두려면 "취소"라고 답해 주세요.',
    };
  }

  /**
   * Map a finished/halted execution turn to a natural reply (Conversation Runtime, ADR-0032). The
   * runtime never builds reply text itself — it hands the outcome status (and any produced
   * artifacts) here. AWAITING_APPROVAL is handled by {@link composeApprovalNotice}, not here.
   */
  composeExecutionResult(
    context: ConversationContext,
    status: ExecutionReplyStatus,
    artifacts: Artifact[] = [],
  ): OutboundMessage {
    const text =
      status === 'COMPLETED'
        ? '요청하신 작업을 완료했어요.'
        : status === 'DENIED'
          ? '승인이 거절되어 작업을 진행하지 않았어요.'
          : status === 'CANCELLED'
            ? '작업을 취소했어요.'
            : '작업을 진행하던 중 문제가 생겨서 멈췄어요. 다시 시도해 주세요.'; // STOPPED_ON_FAILURE
    return { context, text, ...(artifacts.length ? { artifacts } : {}) };
  }

  /** A user-facing failure reply (ADR-0015). Never includes technical detail. */
  composeError(context: ConversationContext, userMessage: string): OutboundMessage {
    return { context, text: userMessage };
  }

  /**
   * A **product test result** (Live Test Execution, ADR-0033). A failing test (exit ≠ 0) is the
   * project's result — NOT a bot/system error — so it is phrased as such. The runtime passes only
   * the facts (`passed`, `kind`); the wording lives here.
   */
  composeTestResult(
    context: ConversationContext,
    passed: boolean,
    kind: 'test' | 'typecheck' = 'test',
  ): OutboundMessage {
    const label = kind === 'typecheck' ? '타입체크' : '테스트';
    const text = passed
      ? `${label}가 모두 통과했어요. ✅`
      : `${label}에서 실패가 있었어요. 결과를 확인해 주세요. ❌`;
    return { context, text };
  }

  /** No active project — guide the user to register one first (ADR-0033). */
  composeNeedsProject(context: ConversationContext): OutboundMessage {
    return {
      context,
      text: '먼저 사용할 프로젝트를 등록해 주세요. (예: "이 프로젝트 등록해줘: /path/to/project")',
    };
  }

  /** The active project's workspace could not be opened (ADR-0033). */
  composeWorkspaceUnavailable(context: ConversationContext): OutboundMessage {
    return { context, text: '프로젝트 작업 공간을 열 수 없었어요. 프로젝트 경로를 확인해 주세요.' };
  }

  /** The command could not be run (timeout / refused / system error) — not a test result (ADR-0033). */
  composeCommandUnavailable(context: ConversationContext): OutboundMessage {
    return { context, text: '명령을 실행할 수 없었어요. 잠시 후 다시 시도해 주세요.' };
  }
}
