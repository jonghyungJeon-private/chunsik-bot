import type { Capability, ContextFile, Metadata, PromptSpec, WorkspaceRef } from '../domain';
import type { AiRequest } from '../ports';

/** Non-prompt fields the renderer carries through onto the AiRequest. */
export interface RenderOptions {
  capability: Capability;
  contextFiles?: ContextFile[];
  workspace?: WorkspaceRef;
  timeoutMs?: number;
  metadata?: Metadata;
}

/**
 * Owns prompt RENDERING (CAP-008, ADR-0029): turns a provider-agnostic `PromptSpec`
 * (authored by `PromptComposer`) into a fully-rendered `AiRequest`. This is the layer
 * between authorship and execution —
 *
 *   PromptComposer → PromptSpec → PromptRenderer → AiRequest → AiProvider
 *
 * — so the `AiProvider` adapter never sees a `PromptSpec` (it consumes `AiRequest`
 * only). Rendering used to live in the CLI adapter (`renderPromptSpec`); it is promoted
 * here so every provider (Codex, Ollama, Claude) shares one rendering.
 */
export class PromptRenderer {
  render(spec: PromptSpec, options: RenderOptions): AiRequest {
    return {
      capability: options.capability,
      prompt: PromptRenderer.renderSpec(spec),
      ...(options.contextFiles ? { contextFiles: options.contextFiles } : {}),
      ...(options.workspace ? { workspace: options.workspace } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.metadata ? { metadata: options.metadata } : {}),
    };
  }

  /** Render the layered PromptSpec into a single CLI-ready text block (ADR-0003/0014). */
  private static renderSpec(spec: PromptSpec): string {
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
