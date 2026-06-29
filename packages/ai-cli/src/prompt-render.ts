import type { PromptSpec } from '@chunsik/core';

/**
 * Render a provider-agnostic PromptSpec into a single CLI-ready text block.
 * This is the provider's rendering responsibility (ADR-0003 / ADR-0014); the
 * core never produces provider-specific text.
 */
export function renderPromptSpec(spec: PromptSpec): string {
  return [
    `# System\n${spec.system}`,
    `# Developer\n${spec.developer}`,
    spec.context ? `# Context\n${spec.context}` : '',
    `# Task\n${spec.task}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
