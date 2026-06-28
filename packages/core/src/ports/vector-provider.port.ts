import type { Id, Metadata } from '../domain';

export interface VectorRecord {
  id: Id;
  vector: number[];
  metadata?: Metadata;
}

export interface VectorQueryResult {
  id: Id;
  score: number;
  metadata?: Metadata;
}

/**
 * PORT: semantic memory recall. v1 implementation: LocalVectorProvider.
 *
 * Note: embedding GENERATION is a separate concern (an AiProvider EMBEDDING
 * capability, e.g. via Ollama). This port only stores/queries vectors, so v2
 * can swap to pgvector/Qdrant without core changes.
 */
export interface VectorProvider {
  init(): Promise<void>;
  upsert(collection: string, records: VectorRecord[]): Promise<void>;
  query(collection: string, vector: number[], topK: number): Promise<VectorQueryResult[]>;
  delete(collection: string, ids: Id[]): Promise<void>;
}
