import { ArtifactKind, Capability, newId, now } from '@chunsik/core';
import type {
  AiCapabilityDescriptor,
  AiExecutionRequest,
  AiExecutionResult,
  AiProvider,
  Artifact,
  PromptSpec,
} from '@chunsik/core';

/**
 * Sprint 1b-1 ONLY — a deterministic AiProvider test double. It renders the
 * PromptSpec (proving the provider's render responsibility) and returns a fixed
 * acknowledgement instead of calling any model. Sprint 1b-2 replaces it with the
 * real ClaudeCliProvider. No network, no CLI, no API.
 */
export class PlaceholderAiProvider implements AiProvider {
  readonly id = 'placeholder';
  readonly capabilities: readonly AiCapabilityDescriptor[] = [
    { capability: Capability.GENERAL_CHAT, priority: 100 },
    { capability: Capability.SUMMARIZATION, priority: 100 },
  ];

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async execute(request: AiExecutionRequest): Promise<AiExecutionResult> {
    const rendered = request.promptSpec
      ? this.render(request.promptSpec)
      : (request.prompt ?? '');

    const text = '🐹 (Sprint 1b-1 placeholder) 메시지를 처리했어요. 실제 AI 응답은 1b-2에서 연결됩니다.';

    const artifact: Artifact = {
      id: newId(),
      kind: ArtifactKind.MARKDOWN_REPORT,
      title: 'placeholder-response',
      content: text,
      createdAt: now(),
      metadata: { renderedPromptChars: rendered.length },
    };

    return { text, artifacts: [artifact] };
  }

  /** Same rendering shape the real CLI provider will use in 1b-2. */
  private render(spec: PromptSpec): string {
    return [
      `# System\n${spec.system}`,
      `# Developer\n${spec.developer}`,
      spec.context ? `# Context\n${spec.context}` : '',
      `# Task\n${spec.task}`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }
}
