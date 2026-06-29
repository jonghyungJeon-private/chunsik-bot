import { Capability } from '../domain';
import type { ContextBundle, PromptSpec, Task } from '../domain';

/**
 * Owns prompt assembly (ADR-0003). Produces a provider-agnostic, layered
 * PromptSpec; rendering to a concrete CLI form is the provider's job. v1
 * (Sprint 1b-1) is minimal but already layered (system/developer/context/task).
 */
export class PromptComposer {
  compose(task: Task, context: ContextBundle): PromptSpec {
    return {
      system: 'You are Chunsik, a concise and helpful local-first AI assistant.',
      developer: this.developerFor(task.intent.capability),
      context: context.recentMessages.length
        ? `Recent conversation:\n${context.recentMessages.map((m) => `- ${m}`).join('\n')}`
        : '',
      task: context.summary,
    };
  }

  private developerFor(capability: Capability): string {
    switch (capability) {
      case Capability.GENERAL_CHAT:
        return 'Respond conversationally and briefly to the user.';
      case Capability.SUMMARIZATION:
        return 'Summarize the provided content faithfully and concisely.';
      default:
        return 'Help the user accomplish their request.';
    }
  }
}
