import type { AiFailureKind } from './domain';

/** Thrown by skeleton methods whose business logic is intentionally deferred. */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`Not implemented yet: ${what}`);
    this.name = 'NotImplementedError';
  }
}

/** No AiProvider could serve the requested capability (none available). */
export class NoProviderAvailableError extends Error {
  constructor(capability: string) {
    super(`No available AiProvider for capability: ${capability}`);
    this.name = 'NoProviderAvailableError';
  }
}

/**
 * A classified AI execution failure (ADR-0015). The provider sets `kind` and a
 * technical `message` (already secret-masked); the core maps the kind to a
 * user-facing message and stores a summary on the TaskRun.
 */
export class AiProviderError extends Error {
  constructor(
    readonly kind: AiFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/** An illegal task status transition was attempted. */
export class InvalidTaskTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Illegal task transition: ${from} -> ${to}`);
    this.name = 'InvalidTaskTransitionError';
  }
}

/** A workspace mutation was attempted while git was dirty / unsafe. */
export class WorkspaceNotSafeError extends Error {
  constructor(detail: string) {
    super(`Workspace not safe to modify: ${detail}`);
    this.name = 'WorkspaceNotSafeError';
  }
}
