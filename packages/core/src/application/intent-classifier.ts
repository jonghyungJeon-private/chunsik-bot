import { Capability, IntentType } from '../domain';
import type { InboundMessage, Intent } from '../domain';
import type { CapabilityRouter } from './capability-router';

/**
 * Classifies a natural-language message into an Intent.
 *
 * v1 is MINIMAL and deterministic: a "register this project: <path>" message maps
 * to REGISTER_PROJECT (ADR-0018); everything else is general chat that becomes a
 * Task. AI-driven classification arrives later; the `router` is held for it.
 */
export class IntentClassifier {
  constructor(private readonly router: CapabilityRouter) {}

  async classify(message: InboundMessage): Promise<Intent> {
    void this.router;
    const text = message.text.trim();

    const path = IntentClassifier.extractLocalPath(text);
    if (path && /등록|register/i.test(text)) {
      return {
        type: IntentType.REGISTER_PROJECT,
        capability: Capability.READONLY_LOOKUP,
        confidence: 1,
        requiresWork: false,
        summary: `Register project: ${path}`,
        raw: { path },
      };
    }

    return {
      type: IntentType.CHAT,
      capability: Capability.GENERAL_CHAT,
      confidence: 1,
      requiresWork: true,
      summary: text.slice(0, 200) || '(empty message)',
    };
  }

  /** First absolute POSIX path in the text, if any. */
  private static extractLocalPath(text: string): string | undefined {
    const match = text.match(/(\/[^\s]+)/);
    return match ? match[1] : undefined;
  }
}
