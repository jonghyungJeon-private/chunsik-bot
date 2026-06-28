import type {
  ApprovalDecision,
  ApprovalRequest,
  ConversationContext,
  InboundMessage,
  OutboundMessage,
} from '../domain';

/**
 * The inbound side of a platform. Implementations translate native events
 * (Discord today, Telegram later) into normalized domain messages.
 */
export type InboundMessageHandler = (message: InboundMessage) => Promise<void>;
export type ApprovalDecisionHandler = (decision: ApprovalDecision) => Promise<void>;

/**
 * PORT: the user-facing surface. v1 implementation: DiscordPlatformAdapter.
 *
 * Boundary rule: NO platform-native type (e.g. Discord.js Message) may appear
 * in this interface. Everything is expressed in domain terms.
 */
export interface PlatformAdapter {
  /** Stable platform id, e.g. "discord". */
  readonly platform: string;

  /** Connect/login and begin receiving events. */
  start(): Promise<void>;
  /** Disconnect gracefully. */
  stop(): Promise<void>;

  /** Register the handler the core uses to receive normalized messages. */
  onMessage(handler: InboundMessageHandler): void;
  /** Register the handler invoked when a user approves/denies an action. */
  onApprovalDecision(handler: ApprovalDecisionHandler): void;

  /** Send a normalized reply; the adapter renders artifacts natively. */
  sendMessage(message: OutboundMessage): Promise<void>;
  /** Optional UX nicety: show a typing/working indicator. */
  sendTyping(context: ConversationContext): Promise<void>;
  /** Render an approval prompt (e.g. buttons) for a HIGH/CRITICAL action. */
  requestApproval(request: ApprovalRequest, context: ConversationContext): Promise<void>;
}
