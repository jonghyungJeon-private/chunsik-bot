import { NotImplementedError } from '../errors';
import type { ApprovalDecision, InboundMessage } from '../domain';
import type { Logger, PlatformAdapter } from '../ports';
import type { ConversationRuntime, TurnResult } from './conversation-runtime';
import { formatSafeErrorText, safeRequestId, toSafeError } from './safe-error';

/** Everything the facade needs, injected by the composition root. */
export interface ChunsikCoreDeps {
  runtime: ConversationRuntime;
  platform: PlatformAdapter;
  logger: Logger;
}

/**
 * ChunsikCore is the **thin platform-entry facade** (ADR-0032). The full per-message conversation
 * flow lives in {@link ConversationRuntime}; ChunsikCore only delegates to it and performs platform
 * delivery:
 *
 *   Platform Adapter → ChunsikCore (facade) → ConversationRuntime.handle() → OutboundMessage → deliver
 *
 * There is exactly ONE conversation entry — ChunsikCore and ConversationRuntime are never parallel
 * paths. Boundary note: this file imports NOTHING concrete — only ports + the runtime service.
 */
export class ChunsikCore {
  constructor(private readonly deps: ChunsikCoreDeps) {}

  /** Drive one inbound message: typing → runtime turn → deliver the runtime's OutboundMessage. */
  async handleInboundMessage(message: InboundMessage): Promise<void> {
    await this.deps.platform.sendTyping(message.context).catch(() => undefined);
    let result: TurnResult;
    try {
      result = await this.deps.runtime.handle(message);
    } catch (err) {
      // Backstop (Sprint 4c-Follow-up-7, F7-D): runtime.handle() is designed never to throw for an
      // application error, but if it ever does, deliver exactly ONE sanitized error response (never a raw
      // exception) and keep the runtime alive. A delivery failure is logged only — no recursive retry.
      const safe = toSafeError(err);
      this.deps.logger.error('inbound handling failed (backstop)', {
        errorName: err instanceof Error ? err.name : typeof err,
        code: safe.code,
        messageId: message.id,
        stack: err instanceof Error ? err.stack : undefined,
      });
      await this.deps.platform
        .sendMessage({
          context: message.context,
          // The facade backstop cannot prove where the runtime failed, so it MUST default to
          // "possibly applied" — never a false zero-mutation claim (Sprint 4c-Follow-up-7 CA correction).
          text: formatSafeErrorText(safe, {
            requestId: safeRequestId(message.id),
            mutationSafety: 'MAY_HAVE_APPLIED',
          }),
        })
        .catch((deliveryErr) =>
          this.deps.logger.error('error-response delivery failed', {
            errorName: deliveryErr instanceof Error ? deliveryErr.name : typeof deliveryErr,
          }),
        );
      return;
    }
    await this.deps.platform.sendMessage(result.reply);
  }

  /**
   * Approval decisions now arrive as ordinary conversation turns and are routed by
   * `ConversationRuntime` (ADR-0032). This platform-event entry is retained for the inbound
   * wiring's signature and is not part of the turn flow.
   */
  async handleApprovalDecision(_decision: ApprovalDecision): Promise<void> {
    throw new NotImplementedError(
      'ChunsikCore.handleApprovalDecision — approvals are handled as conversation turns (ADR-0032)',
    );
  }
}
