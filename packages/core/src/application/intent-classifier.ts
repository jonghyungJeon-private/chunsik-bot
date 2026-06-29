import { Capability, IntentType } from '../domain';
import type { InboundMessage, Intent } from '../domain';
import type { CapabilityRouter } from './capability-router';

/**
 * Classifies a natural-language message into an Intent.
 *
 * v1 (Sprint 1b-1) is MINIMAL and deterministic: every message is treated as
 * general chat that becomes a Task, so the full pipeline is exercised. The
 * `router` is held for the future AI-driven classifier (which will ask a
 * provider to label the message) — it must never know which CLI answers.
 */
export class IntentClassifier {
  constructor(private readonly router: CapabilityRouter) {}

  async classify(message: InboundMessage): Promise<Intent> {
    void this.router;
    const summary = message.text.trim().slice(0, 200) || '(empty message)';
    return {
      type: IntentType.CHAT,
      capability: Capability.GENERAL_CHAT,
      confidence: 1,
      requiresWork: true,
      summary,
    };
  }
}
