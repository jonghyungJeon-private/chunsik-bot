import { Client, Events, GatewayIntentBits } from 'discord.js';
import type { Message } from 'discord.js';
import { NotImplementedError, now } from '@chunsik/core';
import { deliverChunks, FILE_ATTACHMENT_CHUNK_THRESHOLD } from './delivery';

export { chunkText, deliverChunks, DISCORD_SAFE_LIMIT, FILE_ATTACHMENT_CHUNK_THRESHOLD } from './delivery';
export type { DeliveryReport, ChunkSender } from './delivery';
import type {
  ApprovalDecisionHandler,
  ApprovalRequest,
  ConversationContext,
  InboundMessage,
  InboundMessageHandler,
  Logger,
  OutboundMessage,
  PlatformAdapter,
} from '@chunsik/core';

export interface DiscordConfig {
  token: string;
  /** If set, ignore messages from other guilds (useful for local dev). */
  guildId?: string;
}

/** Discord typing indicator lasts ~10s; refresh under that while we work. */
const TYPING_REFRESH_MS = 8_000;
/** Safety cap so a typing loop can never leak (≈ covers the 120s CLI timeout). */
const TYPING_MAX_TICKS = 16;

/**
 * PlatformAdapter for Discord. discord.js types stay INSIDE this file; only
 * normalized domain messages cross back into the core.
 *
 * Sprint 1a: receive / send / typing are implemented. `requestApproval` is out
 * of scope (no approval UI yet) and remains unimplemented.
 *
 * Note: reading message text requires the privileged **Message Content Intent**
 * to be enabled for the bot in the Discord Developer Portal.
 */
export class DiscordPlatformAdapter implements PlatformAdapter {
  readonly platform = 'discord';

  private client?: Client;
  private messageHandler?: InboundMessageHandler;
  private approvalHandler?: ApprovalDecisionHandler;
  /** Active self-refreshing typing loops, keyed by target channel/thread id. */
  private readonly typingTimers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(
    private readonly config: DiscordConfig,
    private readonly logger: Logger,
  ) {}

  onMessage(handler: InboundMessageHandler): void {
    this.messageHandler = handler;
  }

  onApprovalDecision(handler: ApprovalDecisionHandler): void {
    this.approvalHandler = handler;
  }

  async start(): Promise<void> {
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
    this.client = client;

    client.on(Events.MessageCreate, (message) => {
      void this.handleMessageCreate(message);
    });

    await client.login(this.config.token);
  }

  async stop(): Promise<void> {
    for (const timer of this.typingTimers.values()) clearInterval(timer);
    this.typingTimers.clear();
    await this.client?.destroy();
    this.client = undefined;
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    const target = message.context.threadId ?? message.context.channelId;
    // The response is arriving — stop the "is typing…" loop for this target.
    this.clearTyping(target);
    const channel = await this.fetchChannel(target);
    if (!channel?.isSendable()) {
      this.logger.warn('send skipped: channel not sendable', { channelId: target });
      return;
    }

    const report = await deliverChunks(message.text, async (chunk) => {
      await channel.send(chunk);
    });

    if (!report.ok) {
      // Send failure (ADR-0016): record + log (masked). Partial delivery is reported,
      // not retried, to avoid duplicate messages. The AI run itself is unaffected.
      this.logger.error('message delivery failed', {
        channelId: target,
        sent: report.sent,
        totalChunks: report.totalChunks,
        error: report.error,
      });
      return;
    }
    if (report.totalChunks > 1) {
      this.logger.info('message delivered in chunks', {
        channelId: target,
        chunks: report.totalChunks,
        fileAttachmentThresholdHit: report.totalChunks > FILE_ATTACHMENT_CHUNK_THRESHOLD,
      });
    }
  }

  async sendTyping(context: ConversationContext): Promise<void> {
    const target = context.threadId ?? context.channelId;
    await this.pumpTyping(target);

    // Keep "is typing…" alive during long runs by refreshing under the ~10s TTL.
    // Cleared by the next sendMessage to this target, or after a safety cap.
    if (!this.typingTimers.has(target)) {
      let ticks = 0;
      const timer = setInterval(() => {
        ticks += 1;
        if (ticks >= TYPING_MAX_TICKS) {
          this.clearTyping(target);
          return;
        }
        void this.pumpTyping(target);
      }, TYPING_REFRESH_MS);
      timer.unref?.();
      this.typingTimers.set(target, timer);
    }
  }

  /** Send a single Discord typing indicator for a target (best-effort). */
  private async pumpTyping(target: string): Promise<void> {
    const channel = await this.fetchChannel(target);
    if (channel && channel.isTextBased() && 'sendTyping' in channel) {
      await channel.sendTyping().catch(() => undefined);
    }
  }

  /** Stop the refreshing typing loop for a target, if any. */
  private clearTyping(target: string): void {
    const timer = this.typingTimers.get(target);
    if (timer) {
      clearInterval(timer);
      this.typingTimers.delete(target);
    }
  }

  async requestApproval(_request: ApprovalRequest, _context: ConversationContext): Promise<void> {
    // Out of scope for Sprint 1a (no approval UI yet). See ADR-0010 / risk policy.
    void this.approvalHandler;
    throw new NotImplementedError('DiscordPlatformAdapter.requestApproval');
  }

  private async handleMessageCreate(message: Message): Promise<void> {
    try {
      if (message.author.bot) return;
      if (this.config.guildId && message.guildId && message.guildId !== this.config.guildId) {
        return;
      }
      const handler = this.messageHandler;
      if (!handler) return;
      this.logger.info('message received', {
        messageId: message.id,
        channelId: message.channelId,
        userId: message.author.id,
      });
      await handler(this.toInbound(message));
    } catch (err) {
      this.logger.error('message handling failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Translate a Discord Message into a normalized InboundMessage. */
  private toInbound(message: Message): InboundMessage {
    const inThread = message.channel.isThread();
    const channelId = inThread ? (message.channel.parentId ?? message.channelId) : message.channelId;
    const threadId = inThread ? message.channelId : undefined;

    const context: ConversationContext = {
      platform: this.platform,
      channelId,
      userId: message.author.id,
      ...(message.guildId ? { spaceId: message.guildId } : {}),
      ...(threadId ? { threadId } : {}),
    };

    return {
      id: message.id,
      context,
      text: message.content,
      receivedAt: now(),
    };
  }

  private async fetchChannel(id: string) {
    if (!this.client) return null;
    return this.client.channels.fetch(id).catch(() => null);
  }
}
