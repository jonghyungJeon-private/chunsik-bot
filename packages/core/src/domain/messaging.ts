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

/** One file's portion of a code-change preview — the COMPLETE unified diff for that path, never clamped
 *  (Sprint 4c-Follow-up-5, F5-A). */
export interface PreviewFile {
  path: string;
  changeKind: 'add' | 'update' | 'delete';
  unifiedDiff: string;
}

/**
 * A COMPLETE structured code-change preview (Sprint 4c-Follow-up-5, F5-A / CA RC2). Produced in core from
 * the CodeProposal → Workspace diff; a PlatformAdapter chooses a delivery strategy (multipart text vs a
 * complete `.diff` attachment) and owns all platform presentation. `canonicalDiff` is the byte-for-byte
 * source of truth for delivery-equality (CA RC3). Platform-neutral: carries NO Discord specifics.
 */
export interface PreviewArtifact {
  /** Display-neutral header/summary prose (apply-boundary framing) — never the diff body. */
  header: string;
  /** Trailing apply-boundary prose shown on the FINAL delivered message/attachment (CA RC9). */
  footer: string;
  files: PreviewFile[];
  /** The complete concatenated canonical diff payload under one newline policy. */
  canonicalDiff: string;
  /** Non-secret filename for the `.diff` attachment fallback. */
  attachmentFilename: string;
}

/** A normalized outbound message the PlatformAdapter renders natively. */
export interface OutboundMessage {
  context: ConversationContext;
  text: string;
  /** Artifacts may be rendered as files, embeds, code blocks, etc. */
  artifacts?: Artifact[];
  replyToMessageId?: Id;
  metadata?: Metadata;
  /** A complete structured code-change preview (Sprint 4c-Follow-up-5, F5-A). When present, a
   *  preview-aware adapter delivers the FULL diff losslessly (multipart or attachment) instead of the
   *  bounded `text`. Preview-unaware adapters fall back to `text`. */
  preview?: PreviewArtifact;
}
