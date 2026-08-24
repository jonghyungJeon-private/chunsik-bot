import type { MemoryRetrievalRequest, RetrievedMemory } from '../domain';

/**
 * Storage-neutral durable recall boundary. Implementations own bounded hybrid
 * scoring across relevance, recency, importance, scope, authority, and redundancy.
 */
export interface MemoryRetriever {
  retrieve(query: MemoryRetrievalRequest): Promise<RetrievedMemory[]>;
}
