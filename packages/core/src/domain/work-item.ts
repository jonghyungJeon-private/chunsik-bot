import type { Id, IsoTimestamp } from './common';
import type { ResourceRef } from './resource-ref';

/** High-level durable-work lifecycle only (ADR-0075). */
export enum WorkItemStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELED = 'CANCELED',
}

/** Typed creation source; never a generic metadata or trigger-state container. */
export type WorkItemOrigin = 'conversation' | 'connector' | 'trigger';

/**
 * CAP-011 durable personal-work aggregate (ADR-0075).
 *
 * It owns identity, Actor ownership, an optional Project reference, external
 * ResourceRef correlation, high-level lifecycle and origin. Execution,
 * approval, provider, conversation and workflow state remain outside it.
 */
export interface WorkItem {
  readonly id: Id;
  readonly actorId: Id;
  readonly projectId?: Id;
  readonly resourceRefs: readonly ResourceRef[];
  readonly status: WorkItemStatus;
  readonly origin: WorkItemOrigin;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

const TRANSITIONS: Readonly<Record<WorkItemStatus, readonly WorkItemStatus[]>> = {
  [WorkItemStatus.ACTIVE]: [WorkItemStatus.COMPLETED, WorkItemStatus.CANCELED],
  [WorkItemStatus.COMPLETED]: [],
  [WorkItemStatus.CANCELED]: [],
};

export function canTransitionWorkItem(from: WorkItemStatus, to: WorkItemStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Return a new aggregate value; persisted WorkItems are never mutated in place. */
export function transitionWorkItem(
  item: WorkItem,
  to: WorkItemStatus,
  updatedAt: IsoTimestamp,
): WorkItem {
  if (!canTransitionWorkItem(item.status, to)) {
    throw new Error(`Invalid WorkItem transition: ${item.status} -> ${to}`);
  }
  return { ...item, status: to, updatedAt };
}

/** Deduplicate correlations by stable ResourceRef identity while preserving order. */
export function uniqueResourceRefs(refs: readonly ResourceRef[]): readonly ResourceRef[] {
  const identities = new Set<string>();
  return refs.filter((ref) => {
    if (identities.has(ref.identity)) return false;
    identities.add(ref.identity);
    return true;
  });
}
