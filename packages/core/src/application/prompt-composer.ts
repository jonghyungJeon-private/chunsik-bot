import { Capability } from '../domain';
import type { ContextBundle, ContextFile, PromptSpec, Task } from '../domain';
import type { ProjectReadout } from '../ports';

/** Read-only inputs for authoring a code-generation prompt (CAP-008). */
export interface CodeGenerationPromptInput {
  instruction: string;
  targetFiles?: string[];
  contextFiles?: ContextFile[];
}

/**
 * Owns prompt assembly (ADR-0003). Produces a provider-agnostic, layered
 * PromptSpec; rendering to a concrete CLI form is the provider's job. v1
 * (Sprint 1b-1) is minimal but already layered (system/developer/context/task).
 */
export class PromptComposer {
  compose(task: Task, context: ContextBundle, readout?: ProjectReadout): PromptSpec {
    const parts: string[] = [`Current conversation platform: ${task.context.platform}`];
    const connectionTarget = PromptComposer.resolveConnectionTarget(
      context.summary,
      task.context.platform,
    );
    if (connectionTarget) {
      parts.push(`Resolved connection target: ${connectionTarget}`);
    }
    if (context.projectSummary) {
      parts.push(`Active project (background context):\n${context.projectSummary}`);
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

  /**
   * Author a code-generation prompt (CAP-008, ADR-0029). The AI must PROPOSE only —
   * it never applies, runs, or commits — and must emit the structured proposal envelope
   * the `CodeProposalParser` reads (one fenced ```json block). Prompt authorship lives
   * here (prompting layer); `PromptRenderer` renders this to an `AiRequest`.
   */
  composeCodeGeneration(input: CodeGenerationPromptInput): PromptSpec {
    const parts: string[] = [];
    if (input.targetFiles?.length) {
      parts.push(`Target files:\n${input.targetFiles.map((f) => `- ${f}`).join('\n')}`);
    }
    if (input.contextFiles?.length) {
      parts.push(
        `Context files (read-only):\n${input.contextFiles
          .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
          .join('\n\n')}`,
      );
    }
    return {
      system:
        'You are a code generation assistant. PROPOSE code changes only — do NOT apply ' +
        'files, run commands, or commit; another system applies your proposal after human ' +
        'approval. Respond with EXACTLY ONE fenced ```json block and no prose outside it. ' +
        'The JSON must be {"changes":[{"path":"<relative path>","newContent":"<full file ' +
        'content>","delete":false}]}. Use "delete":true (and omit newContent) to remove a ' +
        'file. Provide the COMPLETE new content for each changed file.',
      developer: 'Generate the minimal, correct change set that satisfies the instruction.',
      context: parts.join('\n\n'),
      task: input.instruction,
    };
  }

  private developerFor(capability: Capability): string {
    switch (capability) {
      case Capability.GENERAL_CHAT:
        return (
          'Respond conversationally and briefly to the user. When interpreting connection-status ' +
          'questions, an explicit user-named target (such as a project, workspace, GitHub, repository, ' +
          'or platform) takes priority. If no target is named, interpret an ambiguous connection-status ' +
          'question relative to the current conversation platform. Treat active project/workspace ' +
          'information as background context, not as the connection target unless the user explicitly ' +
          'refers to it. When describing the current conversation-platform connection, say that the ' +
          'message was received and the response is being processed; do not claim outbound delivery ' +
          'succeeded before delivery occurs.'
        );
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

  /**
   * Resolve only connection-status language. Explicit user targets always win;
   * otherwise an ambiguous connection question is anchored to the generic
   * conversation platform. This remains provider/platform neutral: platform is
   * data supplied by the adapter, never a Core-side concrete-platform branch.
   */
  private static resolveConnectionTarget(summary: string, platform: string): string | undefined {
    if (!PromptComposer.isConnectionStatusQuestion(summary)) return undefined;

    if (/(?:GitHub|깃허브)/i.test(summary)) return 'explicit GitHub target';
    if (/(?:\b(?:repository|repo)\b|저장소)/i.test(summary)) return 'explicit repository target';
    if (/(?:workspace|워크스페이스)/i.test(summary)) return 'explicit workspace target';
    if (/(?:project|프로젝트)/i.test(summary)) return 'explicit project target';
    if (/(?:discord|디스코드)/i.test(summary)) return 'explicit Discord target';
    if (/(?:\bbot\b|봇|platform|플랫폼)/i.test(summary)) {
      return `explicit conversation-platform target (${platform})`;
    }

    return `current conversation platform (${platform})`;
  }

  private static isConnectionStatusQuestion(summary: string): boolean {
    return /(?:연결\s*(?:상태|됐|되었|되어|된)|connection\s*status|\bconnected\b)/i.test(summary);
  }

  /** Render the read-only project readout as a prompt section (ADR-0019). */
  private static renderReadout(readout: ProjectReadout): string {
    const files = readout.files
      .map((f) => `### ${f.path}${f.truncated ? ' (truncated)' : ''}\n\`\`\`\n${f.content}\n\`\`\``)
      .join('\n\n');
    return `Project files (read-only):\n#### Tree\n${readout.tree}\n\n${files}`;
  }
}
