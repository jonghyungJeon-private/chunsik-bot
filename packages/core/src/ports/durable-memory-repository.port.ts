import type { DurableMemory, DurableMemoryScope, Id, IsoTimestamp } from '../domain';

/** Storage-neutral source-of-truth repository for promoted durable memory. */
export interface DurableMemoryRepository {
  save(memory: DurableMemory): Promise<DurableMemory>;
  get(id: Id): Promise<DurableMemory | null>;
  findByScope(scope: DurableMemoryScope, limit: number): Promise<DurableMemory[]>;
  update(memory: DurableMemory): Promise<DurableMemory>;
  softDelete(id: Id, deletedAt: IsoTimestamp): Promise<boolean>;
}
