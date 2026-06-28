import { NotImplementedError } from '@chunsik/core';
import { Capability } from '@chunsik/core';
import type {
  AiCapabilityDescriptor,
  AiExecutionRequest,
  AiExecutionResult,
  AiProvider,
} from '@chunsik/core';

export { Capability };
export type { AiCapabilityDescriptor };

/**
 * SKELETON base for CLI-backed providers. Shares the spawn/availability shape;
 * subclasses only declare `id`, `bin`, and `capabilities`.
 *
 * TODO(impl): isAvailable() -> probe that the binary exists and is authed.
 * execute() -> write `request.contextFiles` into `request.workspace`, spawn the
 * CLI with `request.prompt` in that cwd, capture stdout/stderr, and shape the
 * output into an AiExecutionResult (+ Artifacts for diffs/patches/logs).
 * NO HTTP API in v1.
 */
export abstract class BaseCliAiProvider implements AiProvider {
  abstract readonly id: string;
  abstract readonly capabilities: readonly AiCapabilityDescriptor[];
  protected abstract readonly bin: string;

  async isAvailable(): Promise<boolean> {
    void this.bin;
    throw new NotImplementedError(`${this.constructor.name}.isAvailable`);
  }

  async execute(_request: AiExecutionRequest): Promise<AiExecutionResult> {
    throw new NotImplementedError(`${this.constructor.name}.execute`);
  }
}
