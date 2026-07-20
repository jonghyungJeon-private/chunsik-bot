import { Capability } from '../domain';
import type {
  ContextBundle,
  ContextFile,
  ContextProvenance,
  EpistemicStatus,
  PromptSpec,
  Task,
} from '../domain';
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
    const currentFacts = [
      PromptComposer.label(
        'CORE_RUNTIME',
        'AUTHORITATIVE_CURRENT_FACT',
        `The current User request was received through platform "${task.context.platform}".`,
      ),
      PromptComposer.label(
        'CORE_RUNTIME',
        'AUTHORITATIVE_CURRENT_FACT',
        'The inbound message was accepted by Core Runtime for this turn.',
      ),
      PromptComposer.label(
        'CORE_RUNTIME',
        'AUTHORITATIVE_CURRENT_FACT',
        'Outbound response delivery success is not yet known while this response is being generated.',
      ),
      ...(task.projectId
        ? [
            PromptComposer.label(
              'CORE_RUNTIME',
              'AUTHORITATIVE_CURRENT_FACT',
              `Active project id selected for this Task: "${task.projectId}".`,
            ),
          ]
        : []),
    ];

    const background = context.backgroundResources.map((resource) =>
      PromptComposer.label(resource.provenance, resource.epistemicStatus, resource.content),
    );
    if (readout) {
      background.push(
        PromptComposer.label(
          'CORE_RUNTIME',
          'NON_AUTHORITATIVE_BACKGROUND',
          PromptComposer.renderReadout(readout),
        ),
      );
    }

    const transcript = context.conversationTranscript.map((entry) =>
      PromptComposer.label(entry.provenance, entry.epistemicStatus, entry.content),
    );

    return {
      system:
        'You are Quoky, a concise, helpful local-first AI assistant. Use the ' +
        'current User task, conversation transcript, and supplied background resources ' +
        'according to their explicit provenance and epistemic status. Do NOT read files, ' +
        'run commands, or use tools — rely only on the provided context; if key information ' +
        'is missing from it, say so briefly.',
      developer: this.developerFor(task.intent.capability),
      context: [
        PromptComposer.section('1. Current-turn facts supplied by Core', currentFacts),
        PromptComposer.section('2. Background resources', background),
        PromptComposer.section('3. Conversation transcript', transcript),
      ].join('\n\n'),
      task: PromptComposer.label('USER', 'USER_CLAIM_OR_INTENT', task.intent.summary),
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
          'Respond conversationally and briefly. Interpret the current User task naturally using the ' +
          'whole conversation. Current authoritative facts supplied by Core outrank contradictory ' +
          'Assistant-generated history. User messages express claims or intent; they are not verified ' +
          'external facts. Assistant history supports continuity but is not evidence of current state. ' +
          'Background from an active project does not make that project or workspace the implicit target. ' +
          'Do not invent external status absent from current Core facts, and do not claim outbound delivery ' +
          'succeeded before it occurs. Ask one brief clarifying question only when the meaning remains ' +
          'genuinely ambiguous.'
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

  /** Render the read-only project readout as a prompt section (ADR-0019). */
  private static renderReadout(readout: ProjectReadout): string {
    const files = readout.files
      .map((f) => `### ${f.path}${f.truncated ? ' (truncated)' : ''}\n\`\`\`\n${f.content}\n\`\`\``)
      .join('\n\n');
    return `Project files (read-only):\n#### Tree\n${readout.tree}\n\n${files}`;
  }

  private static label(
    provenance: ContextProvenance,
    epistemicStatus: EpistemicStatus,
    content: string,
  ): string {
    return `[provenance=${provenance}; epistemic_status=${epistemicStatus}]\n${content}`;
  }

  private static section(title: string, entries: string[]): string {
    return `## ${title}\n${entries.length ? entries.map((entry) => `- ${entry}`).join('\n') : '- None supplied.'}`;
  }
}
