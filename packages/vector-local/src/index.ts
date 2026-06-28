import { NotImplementedError } from '@chunsik/core';
import type { Id, VectorProvider, VectorQueryResult, VectorRecord } from '@chunsik/core';

/**
 * SKELETON. Implements VectorProvider as a local store.
 *
 * TODO(impl): persist vectors locally (e.g. a JSON/sqlite-vss file under
 * data/vectors) and implement cosine top-K. Embedding GENERATION is NOT here —
 * it is an AiProvider EMBEDDING capability (e.g. Ollama). v2 can swap to
 * pgvector/Qdrant behind this same port.
 */
export class LocalVectorProvider implements VectorProvider {
  constructor(private readonly storePath: string) {}

  async init(): Promise<void> {
    // No-op lifecycle in v1: the store is created lazily on first upsert.
    // The actual upsert/query/delete operations remain unimplemented.
    void this.storePath;
  }

  async upsert(_collection: string, _records: VectorRecord[]): Promise<void> {
    throw new NotImplementedError('LocalVectorProvider.upsert');
  }

  async query(_collection: string, _vector: number[], _topK: number): Promise<VectorQueryResult[]> {
    throw new NotImplementedError('LocalVectorProvider.query');
  }

  async delete(_collection: string, _ids: Id[]): Promise<void> {
    throw new NotImplementedError('LocalVectorProvider.delete');
  }
}
