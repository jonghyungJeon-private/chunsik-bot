import type { ContinuationBinding, Id, Task, WorkHandoff, WorkItem } from '../domain';

/** Effect-time compare-and-insert. No lifecycle or execution ownership. */
export interface ContinuationBindingRepository {
  get(handoffId: Id): Promise<ContinuationBinding | null>;
  /**
   * Atomically verify complete canonical snapshots and ACTIVE/PENDING state.
   * Initial admission requires zero TaskRuns. Exact replay returns the original record;
   * handoff/task uniqueness conflicts fail closed. Never overwrite or partially write.
   */
  admit(expected: Readonly<{ handoff: WorkHandoff; workItem: WorkItem; task: Task }>): Promise<ContinuationBinding>;
}
