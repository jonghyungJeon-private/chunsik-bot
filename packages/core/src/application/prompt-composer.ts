import { Capability } from '../domain';
import type { ContextBundle, PromptSpec, Task } from '../domain';
import type { ProjectReadout } from '../ports';

/**
 * Owns prompt assembly (ADR-0003). Produces a provider-agnostic, layered
 * PromptSpec; rendering to a concrete CLI form is the provider's job. v1
 * (Sprint 1b-1) is minimal but already layered (system/developer/context/task).
 */
export class PromptComposer {
  compose(task: Task, context: ContextBundle, readout?: ProjectReadout): PromptSpec {
    const parts: string[] = [];
    if (context.projectSummary) {
      parts.push(`Active project:\n${context.projectSummary}`);
    }
    if (readout) {
      parts.push(PromptComposer.renderReadout(readout));
    }
    if (context.recentMessages.length) {
      parts.push(`Recent conversation:\n${context.recentMessages.map((m) => `- ${m}`).join('\n')}`);
    }
    return {
      system:
        'You are Chunsik, a concise, helpful local-first AI assistant. Use the ' +
        'conversation and any provided context (such as an "Active project" summary) ' +
        'together with your own knowledge to answer. Do NOT read files, run commands, ' +
        'or use tools — rely only on the provided context; if key information is ' +
        'missing from it, say so briefly.',
      developer: this.developerFor(task.intent.capability),
      context: parts.join('\n\n'),
      task: context.summary,
    };
  }

  private developerFor(capability: Capability): string {
    switch (capability) {
      case Capability.GENERAL_CHAT:
        return 'Respond conversationally and briefly to the user.';
      case Capability.SUMMARIZATION:
        return 'Summarize the provided content faithfully and concisely.';
      case Capability.PROJECT_ANALYSIS:
        return (
          'Analyze the project from the provided files and tree only. Summarize the ' +
          'architecture, the apps/packages and their roles, the tech stack, and key ' +
          'conventions. Be concise and do not invent files you were not shown.'
        );
      default:
        return 'Help the user accomplish their request.';
    }
  }

  /** Render the read-only project readout as a prompt section (ADR-0019). */
  private static renderReadout(readout: ProjectReadout): string {
    const files = readout.files
      .map((f) => `### ${f.path}${f.truncated ? ' (truncated)' : ''}\n\`\`\`\n${f.content}\n\`\`\``)
      .join('\n\n');
    return `Project files (read-only):\n#### Tree\n${readout.tree}\n\n${files}`;
  }
}
