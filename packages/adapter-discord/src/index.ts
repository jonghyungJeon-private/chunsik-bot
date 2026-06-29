import { Client, Events, GatewayIntentBits } from 'discord.js';
import type { Message } from 'discord.js';
import { NotImplementedError, now } from '@chunsik/core';
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
    await this.client?.destroy();
    this.client = undefined;
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    const target = message.context.threadId ?? message.context.channelId;
    const channel = await this.fetchChannel(target);
    if (channel?.isSendable()) {
      await channel.send(message.text);
    }
  }

  async sendTyping(context: ConversationContext): Promise<void> {
    const target = context.threadId ?? context.channelId;
    const channel = await this.fetchChannel(target);
    if (channel && channel.isTextBased() && 'sendTyping' in channel) {
      await channel.sendTyping();
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
