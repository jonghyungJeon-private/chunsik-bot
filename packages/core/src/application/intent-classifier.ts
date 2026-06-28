import { NotImplementedError } from '../errors';
import type { InboundMessage, Intent } from '../domain';
import type { CapabilityRouter } from './capability-router';

/**
 * Classifies a natural-language message into an Intent (type + capability +
 * whether it requires a Task). This is MODEL-DRIVEN cognition and is therefore
 * a deliberate stub in v1.
 *
 * Intended design: route a GENERAL_CHAT/READONLY_LOOKUP capability to an
 * AiProvider via the CapabilityRouter, ask it to label the message against the
 * Capability enum, and map the label onto an Intent. The classifier MUST NOT
 * know which concrete CLI answered.
 */
export class IntentClassifier {
  constructor(private readonly router: CapabilityRouter) {}

  async classify(_message: InboundMessage): Promise<Intent> {
    throw new NotImplementedError('IntentClassifier.classify');
  }
}
