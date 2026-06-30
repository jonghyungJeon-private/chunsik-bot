/**
 * Dependency-injection tokens for the ports.
 *
 * TypeScript interfaces do not exist at runtime, so the composition root (the
 * NestJS app) cannot inject them by type. It binds a concrete implementation
 * to one of these tokens instead. The core depends only on the token + the
 * interface — never on a concrete class.
 *
 * `AI_PROVIDERS` and `CONNECTOR_PROVIDERS` are intentionally plural: the core
 * receives the full SET and selects among them by capability/availability.
 */
export const PLATFORM_ADAPTER = Symbol('PlatformAdapter');
export const STORAGE_PROVIDER = Symbol('StorageProvider');
export const QUEUE_PROVIDER = Symbol('QueueProvider');
export const VECTOR_PROVIDER = Symbol('VectorProvider');
export const WORKSPACE_PROVIDER = Symbol('WorkspaceProvider');
export const GIT_PROVIDER = Symbol('GitProvider');
export const WORKSPACE_WRITER = Symbol('WorkspaceWriter');
export const EXECUTION_PLANNER = Symbol('ExecutionPlanner');
export const AI_PROVIDERS = Symbol('AiProviders');
export const CONNECTOR_PROVIDERS = Symbol('ConnectorProviders');
