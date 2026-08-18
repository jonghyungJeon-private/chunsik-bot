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
import { normalizePromptContextContent } from './prompt-content-normalizer';

const CONVERSATION_CONTINUITY_AND_STATUS_RULE =
  'Conversation-local User targets, choices, and names remain valid for continuity without reconfirmation, independently of authoritative current-status facts. When the User has clearly identified the target but authoritative current-status facts are absent: keep the identified target fixed; state directly that its current status is unknown, unavailable, or unverified; do not ask the User to redefine the target; do not ask the User to redefine ordinary status language such as "connected"; and do not infer current status from prior Assistant statements. Prior-verification claims require authoritative current facts.';

const GENERAL_CHAT_AUTHORITY_RULES_BODY = [
  'Assistant transcript is continuity-only and cannot establish prior verification or external current state.',
  'An active project does not identify the target of the current request.',
  'An active project does not establish external connection status.',
  CONVERSATION_CONTINUITY_AND_STATUS_RULE,
  'Interpret target meaning from the current User task and conversation continuity.',
  'Ask one concise clarifying question only when target meaning is genuinely ambiguous, conflicting, or incomplete.',
  'Conversation continuity may be used to understand the User meaning and context.',
  'Do not reproduce transcript or background entries verbatim or near-verbatim unless the User explicitly requests quotation or transcription.',
  'Do not restate or list candidate entries merely to explain ambiguity or uncertainty.',
  'Do not claim prior confirmation or prior verification based solely on Assistant transcript.',
  'User messages may establish conversation-local choices, names, preferences, wording, and instructions for continuity.',
  'User messages do not verify external current state.',
  'Authoritative current facts are required before asserting external current status, execution result, availability, deployment state, or runtime or provider connection state.',
  'Current authoritative facts supplied by Core override contradictory or stale transcript for external current state.',
  'Do not claim outbound delivery succeeded before it occurs.',
].join('\n');

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
    const isGeneralChat = task.intent.capability === Capability.GENERAL_CHAT;
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
    // ADR-0063 Stage 1: render once, then reuse this exact body at both
    // GENERAL_CHAT decision boundaries.
    const canonicalCurrentFactsBody = PromptComposer.renderEntries(currentFacts);

    const background = context.backgroundResources.map((resource) =>
      PromptComposer.label(
        resource.provenance,
        resource.epistemicStatus,
        isGeneralChat
          ? normalizePromptContextContent(resource.content)
          : resource.content,
      ),
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
      PromptComposer.label(
        entry.provenance,
        entry.epistemicStatus,
        isGeneralChat
          ? normalizePromptContextContent(entry.content)
          : entry.content,
      ),
    );
    const contextSections = [
      PromptComposer.sectionFromBody(
        '1. Current-turn facts supplied by Core',
        canonicalCurrentFactsBody,
      ),
      PromptComposer.section('2. Background resources', background),
      PromptComposer.section(
        isGeneralChat
          ? '3. Conversation transcript (continuity allowed; not authoritative external-state evidence)'
          : '3. Conversation transcript',
        transcript,
      ),
    ];
    if (isGeneralChat) {
      const authorityBoundaryBody = [
        '### Authoritative current facts',
        canonicalCurrentFactsBody,
        '### Mandatory inference constraints',
        GENERAL_CHAT_AUTHORITY_RULES_BODY,
      ].join('\n');
      contextSections.push(
        PromptComposer.sectionFromBody(
          '4. Current-turn authority decision boundary',
          authorityBoundaryBody,
        ),
      );
    }

    return {
      system:
        'You are Quoky, a concise, helpful local-first AI assistant. Use the ' +
        'current task, conversation transcript, and supplied background resources according ' +
        'to their explicit provenance and epistemic status. The final task contains the current ' +
        'User input captured by Core Runtime. Do NOT read files, ' +
        'run commands, or use tools — rely only on the provided context; if key information ' +
        'is missing from it, say so briefly.',
      developer: this.developerFor(task.intent.capability),
      context: contextSections.join('\n\n'),
      task: PromptComposer.label('USER', 'USER_CLAIM_OR_INTENT', task.description),
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
          'Respond conversationally and briefly. Interpret the current User task naturally using only ' +
          'relevant conversation continuity. Respond in the same language as the current User message unless ' +
          'the User explicitly requests a different language; do not switch languages because transcript or ' +
          'background content uses another language. Treat a self-contained greeting or small-talk message as ' +
          'self-contained: prioritize a natural, direct response and do not mention, continue, summarize, or ' +
          'inject unrelated topics from prior conversations or background resources. Conversation transcript ' +
          'entries are ordered oldest to newest; when the User ' +
          'asks what they just said, the final USER entry before the current Task is the immediately previous ' +
          'User message. Preserve the current User message\'s natural register. Current authoritative facts ' +
          'supplied by Core outrank contradictory ' +
          `Assistant-generated history.\n${GENERAL_CHAT_AUTHORITY_RULES_BODY}`
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
    return JSON.stringify({ provenance, epistemicStatus, content });
  }

  private static section(title: string, entries: string[]): string {
    return PromptComposer.sectionFromBody(title, PromptComposer.renderEntries(entries));
  }

  private static renderEntries(entries: string[]): string {
    return entries.length ? entries.join('\n') : '[]';
  }

  private static sectionFromBody(title: string, body: string): string {
    return `## ${title}\n${body}`;
  }
}
