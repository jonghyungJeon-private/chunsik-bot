import type {
  ApprovalRequest,
  Artifact,
  ConversationContext,
  OutboundMessage,
} from '../domain';
import type { AiExecutionResult } from '../ports';

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
      text: `This action needs your approval (${request.riskLevel}):\n${request.reason}`,
    };
  }

  /** A user-facing failure reply (ADR-0015). Never includes technical detail. */
  composeError(context: ConversationContext, userMessage: string): OutboundMessage {
    return { context, text: userMessage };
  }
}
