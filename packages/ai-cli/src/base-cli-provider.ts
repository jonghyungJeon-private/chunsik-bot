import { NotImplementedError } from '@chunsik/core';
import { Capability } from '@chunsik/core';
import type {
  AiCapabilityDescriptor,
  AiExecutionResult,
  AiProvider,
  AiRequest,
} from '@chunsik/core';

export { Capability };
export type { AiCapabilityDescriptor };

/**
 * SKELETON base for CLI-backed providers. Shares the spawn/availability shape;
 * subclasses only declare `id`, `bin`, and `capabilities`.
 *
 * execute() consumes a fully-rendered `AiRequest` (the provider never sees a
 * `PromptSpec`; rendering happens in the core `PromptRenderer` — ADR-0029): spawn
 * the CLI with `request.prompt`, capture stdout/stderr, and shape the output into an
 * AiExecutionResult (+ Artifacts). NO HTTP API in v1.
 */
export abstract class BaseCliAiProvider implements AiProvider {
  abstract readonly id: string;
  abstract readonly capabilities: readonly AiCapabilityDescriptor[];
  protected abstract readonly bin: string;

  async isAvailable(): Promise<boolean> {
    void this.bin;
    throw new NotImplementedError(`${this.constructor.name}.isAvailable`);
  }

  async execute(_request: AiRequest): Promise<AiExecutionResult> {
    throw new NotImplementedError(`${this.constructor.name}.execute`);
  }
}
