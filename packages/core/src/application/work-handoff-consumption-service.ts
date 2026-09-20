import { createWorkHandoff, WorkItemStatus } from '../domain';
import type { AgentProfileId, Id } from '../domain';
import type { StorageProvider } from '../ports';
import { AgentProfileConfigurationError, type AgentProfileRegistry } from './agent-profile-registry';

export enum WorkHandoffConsumptionFailureCode {
  INVALID_HANDOFF_ID = 'INVALID_HANDOFF_ID',
  HANDOFF_NOT_FOUND = 'HANDOFF_NOT_FOUND',
  INVALID_HANDOFF = 'INVALID_HANDOFF',
  WORK_ITEM_NOT_FOUND = 'WORK_ITEM_NOT_FOUND',
  SOURCE_AGENT_PROFILE_NOT_FOUND = 'SOURCE_AGENT_PROFILE_NOT_FOUND',
  DESTINATION_AGENT_PROFILE_NOT_FOUND = 'DESTINATION_AGENT_PROFILE_NOT_FOUND',
  INCONSISTENT_CANONICAL_RELATIONSHIP = 'INCONSISTENT_CANONICAL_RELATIONSHIP',
}

export class WorkHandoffConsumptionError extends Error {
  constructor(readonly code: WorkHandoffConsumptionFailureCode) {
    super(code);
    this.name = 'WorkHandoffConsumptionError';
    Object.freeze(this);
  }
}

export type WorkHandoffConsumptionDecision = Readonly<{
  handoffId: Id;
  workItemId: Id;
  fromAgentProfileId: AgentProfileId;
  toAgentProfileId: AgentProfileId;
} & (
  | { disposition: 'CONTINUE'; reason: 'ACTIVE_WORK_ITEM' }
  | { disposition: 'NO_ACTION'; reason: 'WORK_ITEM_COMPLETED' | 'WORK_ITEM_CANCELED' }
)>;

// Preserve the existing durable WorkHandoff identity contract: canonical non-empty text.
function canonicalId(value: unknown): value is Id {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

/** Read-only eligibility snapshot; never a claim, acknowledgement, or execution permission. */
export class WorkHandoffConsumptionService {
  constructor(
    private readonly storage: {
      workHandoffs: Pick<StorageProvider['workHandoffs'], 'get'>;
      workItems: Pick<StorageProvider['workItems'], 'get'>;
    },
    private readonly agentProfiles: AgentProfileRegistry,
  ) {}

  async evaluate(handoffId: Id): Promise<WorkHandoffConsumptionDecision> {
    const fail = (code: WorkHandoffConsumptionFailureCode): never => {
      throw new WorkHandoffConsumptionError(code);
    };
    const codes = WorkHandoffConsumptionFailureCode;
    if (!canonicalId(handoffId)) fail(codes.INVALID_HANDOFF_ID);
    const loaded = await this.storage.workHandoffs.get(handoffId);
    if (!loaded) return fail(codes.HANDOFF_NOT_FOUND);
    let handoff;
    try {
      handoff = createWorkHandoff(loaded);
      if (!canonicalId(loaded.workItemId) || loaded.id !== handoffId) {
        return fail(codes.INCONSISTENT_CANONICAL_RELATIONSHIP);
      }
    } catch (error) {
      if (error instanceof WorkHandoffConsumptionError) throw error;
      return fail(codes.INVALID_HANDOFF);
    }
    const workItem = await this.storage.workItems.get(handoff.workItemId);
    if (!workItem) return fail(codes.WORK_ITEM_NOT_FOUND);
    if (workItem.id !== handoff.workItemId) return fail(codes.INCONSISTENT_CANONICAL_RELATIONSHIP);
    for (const [id, code] of [
      [handoff.fromAgentProfileId, codes.SOURCE_AGENT_PROFILE_NOT_FOUND],
      [handoff.toAgentProfileId, codes.DESTINATION_AGENT_PROFILE_NOT_FOUND],
    ] as const) {
      try {
        if (this.agentProfiles.get(id).id !== id) fail(codes.INCONSISTENT_CANONICAL_RELATIONSHIP);
      } catch (error) {
        if (error instanceof AgentProfileConfigurationError) return fail(code);
        throw error;
      }
    }
    const identity = {
      handoffId: handoff.id,
      workItemId: workItem.id,
      fromAgentProfileId: handoff.fromAgentProfileId,
      toAgentProfileId: handoff.toAgentProfileId,
    };
    switch (workItem.status) {
      case WorkItemStatus.ACTIVE:
        return Object.freeze({ ...identity, disposition: 'CONTINUE', reason: 'ACTIVE_WORK_ITEM' });
      case WorkItemStatus.COMPLETED:
        return Object.freeze({ ...identity, disposition: 'NO_ACTION', reason: 'WORK_ITEM_COMPLETED' });
      case WorkItemStatus.CANCELED:
        return Object.freeze({ ...identity, disposition: 'NO_ACTION', reason: 'WORK_ITEM_CANCELED' });
      default:
        return fail(codes.INCONSISTENT_CANONICAL_RELATIONSHIP);
    }
  }
}
