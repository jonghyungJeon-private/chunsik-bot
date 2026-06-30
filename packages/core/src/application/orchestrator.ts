import { NotImplementedError } from '../errors';
import type { ApprovalDecision, InboundMessage } from '../domain';
import type { Logger, PlatformAdapter } from '../ports';
import type { ConversationRuntime } from './conversation-runtime';

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
    const result = await this.deps.runtime.handle(message);
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
