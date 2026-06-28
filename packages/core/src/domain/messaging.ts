import type { Id, IsoTimestamp, Metadata } from './common';
import type { Artifact } from './artifact';

/**
 * The conversation surface a message belongs to, expressed in GENERIC terms.
 *
 * IMPORTANT: these are plain strings, never Discord.js objects. This is the
 * boundary that keeps platform specifics (Discord today, Telegram later) out
 * of the core. A PlatformAdapter is responsible for translating its native
 * channel/guild/thread objects into this shape.
 */
export interface ConversationContext {
  /** Platform identifier, e.g. "discord". */
  platform: string;
  /** Generic "space" id — a Discord guild today, a Telegram chat later. */
  spaceId?: string;
  channelId: string;
  threadId?: string;
  userId: string;
}

export interface Attachment {
  id: Id;
  name: string;
  mimeType?: string;
  /** Remote URL as seen by the platform. */
  url?: string;
  /** Path once downloaded into the local workspace (filled in later). */
  localPath?: string;
}

/** A normalized inbound message from any PlatformAdapter. */
export interface InboundMessage {
  id: Id;
  context: ConversationContext;
  text: string;
  attachments?: Attachment[];
  receivedAt: IsoTimestamp;
  metadata?: Metadata;
}

/** A normalized outbound message the PlatformAdapter renders natively. */
export interface OutboundMessage {
  context: ConversationContext;
  text: string;
  /** Artifacts may be rendered as files, embeds, code blocks, etc. */
  artifacts?: Artifact[];
  replyToMessageId?: Id;
  metadata?: Metadata;
}
