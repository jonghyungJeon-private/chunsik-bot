import { NotImplementedError } from '@chunsik/core';
import type {
  ApprovalDecisionHandler,
  ApprovalRequest,
  ConversationContext,
  InboundMessageHandler,
  OutboundMessage,
  PlatformAdapter,
} from '@chunsik/core';

export interface DiscordConfig {
  token: string;
  guildId?: string;
}

/**
 * SKELETON. Implements the PlatformAdapter port for Discord.
 *
 * TODO(impl): add `discord.js` and, inside this class ONLY:
 *   - construct a Client with the needed intents/partials
 *   - on 'messageCreate', map the Discord Message -> domain InboundMessage and
 *     call the stored handler (this is where the anti-corruption mapping lives)
 *   - map OutboundMessage/artifacts -> Discord sends/embeds/files
 *   - render ApprovalRequest as a message with Approve/Deny buttons and map the
 *     button interaction -> domain ApprovalDecision
 *
 * Boundary rule: Discord.js types stay inside this file. Nothing Discord-shaped
 * crosses back into @chunsik/core.
 */
export class DiscordPlatformAdapter implements PlatformAdapter {
  readonly platform = 'discord';

  private messageHandler?: InboundMessageHandler;
  private approvalHandler?: ApprovalDecisionHandler;

  constructor(private readonly config: DiscordConfig) {}

  onMessage(handler: InboundMessageHandler): void {
    this.messageHandler = handler;
  }

  onApprovalDecision(handler: ApprovalDecisionHandler): void {
    this.approvalHandler = handler;
  }

  async start(): Promise<void> {
    void this.config;
    void this.messageHandler;
    void this.approvalHandler;
    throw new NotImplementedError('DiscordPlatformAdapter.start');
  }

  async stop(): Promise<void> {
    throw new NotImplementedError('DiscordPlatformAdapter.stop');
  }

  async sendMessage(_message: OutboundMessage): Promise<void> {
    throw new NotImplementedError('DiscordPlatformAdapter.sendMessage');
  }

  async sendTyping(_context: ConversationContext): Promise<void> {
    throw new NotImplementedError('DiscordPlatformAdapter.sendTyping');
  }

  async requestApproval(_request: ApprovalRequest, _context: ConversationContext): Promise<void> {
    throw new NotImplementedError('DiscordPlatformAdapter.requestApproval');
  }
}
