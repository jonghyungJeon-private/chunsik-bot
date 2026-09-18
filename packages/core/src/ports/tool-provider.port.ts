import type { ToolDescriptor, ToolInvocation, ToolResult } from '../domain';

/**
 * Protocol-neutral boundary for provider-local discovery and one invocation.
 * Product policy, approval, routing, persistence, history, and protocol state
 * remain outside providers (ADR-0076).
 */
export interface ToolProvider {
  readonly source: string;

  isAvailable(): Promise<boolean>;
  listTools(): readonly ToolDescriptor[];
  invoke(request: ToolInvocation): Promise<ToolResult>;
}
