import type { Id } from '../domain';
import type { ContinuationContainmentAudit } from './continuation-containment-audit';
import type { TaskRun } from '../domain';

/**
 * R3-A narrow Application seam for durably recording containment evidence on the exact continuation
 * TaskRun. It exists so the receiver/routing composition never has to inject the full TaskManager and
 * never gains a generic metadata-mutation capability (§19). Its implementation delegates into the
 * TaskManager-owned exact-run persistence operations, which in turn use the repository's atomic
 * insert-once / append-once compare-and-set. TaskManager remains the sole TaskRun lifecycle/mutation
 * owner: PERSISTENCE_OWNERSHIP_CHANGE = NO.
 *
 * R3-A wires no production caller: no receiver actually records evidence yet (that is R3-C). This is the
 * contract + delegation only. No container/VM/daemon/network is involved.
 */
export interface ContinuationContainmentEvidenceSink {
  /**
   * Record the immutable binding evidence before any (future) Provider attempt. Insert-once:
   * absent → recorded; identical containmentBindingDigest → idempotent; different → rejected. The exact
   * run must be STARTED. On failure the caller receives a typed error and NO execution authority is
   * implied (the future attempt must not start).
   */
  recordContainmentBindingIfAbsent(
    exactTaskRunId: Id,
    containmentAudit: ContinuationContainmentAudit,
  ): Promise<TaskRun>;
  /**
   * Append optional post-attempt evidence once the (future) attempt boundary is crossed. Append-once;
   * the binding identity is never changed.
   */
  recordContainmentPostEvidenceIfAbsent(
    exactTaskRunId: Id,
    containmentAudit: ContinuationContainmentAudit,
  ): Promise<TaskRun>;
}

export const CONTINUATION_CONTAINMENT_EVIDENCE_SINK = Symbol('CONTINUATION_CONTAINMENT_EVIDENCE_SINK');
