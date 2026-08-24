import {
  ConversationRuntime,
  DefaultMemoryWriter,
  type ConversationRuntimeDeps,
  type MemoryManager,
} from '@chunsik/core';

export type ProductionConversationRuntimeDeps = Omit<ConversationRuntimeDeps, 'memoryWriter'>;

/** Keep the production durable-memory writer choice explicit and independently testable. */
export function createProductionConversationRuntime(
  memory: MemoryManager,
  deps: ProductionConversationRuntimeDeps,
): ConversationRuntime {
  return new ConversationRuntime({
    ...deps,
    memoryWriter: new DefaultMemoryWriter(memory),
  });
}
