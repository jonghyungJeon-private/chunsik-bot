import { isAgentProfileId } from './agent-profile';
import type { AgentProfileId } from './agent-profile';
import type { Id, IsoTimestamp } from './common';
import { ResourceRef } from './resource-ref';

export const MAX_WORK_HANDOFF_OBJECTIVE_CHARACTERS = 2_000;

/**
 * Immutable CAP-014 provenance that one configured AgentProfile handed bounded
 * work context to another. It grants no authority and owns no work lifecycle.
 */
export interface WorkHandoff {
  readonly id: Id;
  readonly workItemId: Id;
  readonly fromAgentProfileId: AgentProfileId;
  readonly toAgentProfileId: AgentProfileId;
  readonly objective: string;
  readonly resourceRefs: readonly ResourceRef[];
  readonly artifactIds: readonly Id[];
  readonly executionReceiptIds: readonly Id[];
  readonly createdAt: IsoTimestamp;
}

function requireText(value: unknown, field: string, maximum?: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`WorkHandoff ${field} must be non-empty`);
  }
  const normalized = value.trim();
  if (maximum !== undefined && normalized.length > maximum) {
    throw new Error(`WorkHandoff ${field} must be at most ${maximum} characters`);
  }
  return normalized;
}

function uniqueIds(values: readonly Id[], field: string): readonly Id[] {
  if (!Array.isArray(values)) throw new Error(`WorkHandoff ${field} must be an array`);
  const seen = new Set<string>();
  const result: Id[] = [];
  for (const value of values) {
    const id = requireText(value, field);
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return Object.freeze(result);
}

function uniqueImmutableResourceRefs(values: readonly ResourceRef[]): readonly ResourceRef[] {
  if (!Array.isArray(values)) throw new Error('WorkHandoff resourceRefs must be an array');
  const seen = new Set<string>();
  const result: ResourceRef[] = [];
  for (const value of values) {
    if (typeof value !== 'object' || value === null) {
      throw new Error('WorkHandoff resourceRefs must contain ResourceRef values');
    }
    const copy = new ResourceRef({ source: value.source, externalId: value.externalId });
    if (!seen.has(copy.identity)) {
      seen.add(copy.identity);
      result.push(copy);
    }
  }
  return Object.freeze(result);
}

/** Validate, normalize, defensively copy, and freeze one handoff value. */
export function createWorkHandoff(input: WorkHandoff): WorkHandoff {
  const id = requireText(input.id, 'id');
  const workItemId = requireText(input.workItemId, 'workItemId');
  if (!isAgentProfileId(input.fromAgentProfileId)) {
    throw new Error('Invalid WorkHandoff fromAgentProfileId');
  }
  if (!isAgentProfileId(input.toAgentProfileId)) {
    throw new Error('Invalid WorkHandoff toAgentProfileId');
  }
  const fromAgentProfileId = input.fromAgentProfileId;
  const toAgentProfileId = input.toAgentProfileId;
  if (fromAgentProfileId === toAgentProfileId) {
    throw new Error('WorkHandoff source and destination AgentProfiles must differ');
  }

  return Object.freeze({
    id,
    workItemId,
    fromAgentProfileId,
    toAgentProfileId,
    objective: requireText(
      input.objective,
      'objective',
      MAX_WORK_HANDOFF_OBJECTIVE_CHARACTERS,
    ),
    resourceRefs: uniqueImmutableResourceRefs(input.resourceRefs),
    artifactIds: uniqueIds(input.artifactIds, 'artifactIds'),
    executionReceiptIds: uniqueIds(input.executionReceiptIds, 'executionReceiptIds'),
    createdAt: requireText(input.createdAt, 'createdAt'),
  });
}
