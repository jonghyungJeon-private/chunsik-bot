import {
  ContextBuilder,
  DefaultMemoryRetriever,
  type ContextBuilderConfig,
  type MemoryManager,
  type MemoryRepository,
  type StorageProvider,
} from '@chunsik/core';

/**
 * Construct the production ContextBuilder while preserving the storage provider's
 * post-init repository ownership. Nest creates application services before
 * SqliteStorageProvider.init(), so each operation must resolve `memories` lazily.
 */
export function createProductionContextBuilder(
  memory: MemoryManager,
  storage: StorageProvider,
  config: ContextBuilderConfig,
): ContextBuilder {
  const repository: MemoryRepository = {
    get: (id) => storage.memories.get(id),
    save: (record) => storage.memories.save(record),
    delete: (id) => storage.memories.delete(id),
    list: () => storage.memories.list(),
    findByScope: (scope, type) => storage.memories.findByScope(scope, type),
    findDurableCandidates: (query) => storage.memories.findDurableCandidates(query),
  };

  return new ContextBuilder(memory, config, new DefaultMemoryRetriever(repository));
}
