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
