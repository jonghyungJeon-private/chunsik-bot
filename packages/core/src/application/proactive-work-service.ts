import {
  ProactiveWorkDecision,
  ProactiveWorkDisposition,
  ProactiveWorkReason,
  TriggerSource,
  WorkItemStatus,
  isAgentProfileId,
} from '../domain';
import type { AgentProfileId, Id, TriggerSourceInput } from '../domain';
import type { StorageProvider } from '../ports';
import {
  AgentProfileConfigurationError,
  type AgentProfileRegistry,
} from './agent-profile-registry';

export enum ProactiveWorkDecisionFailureCode {
  INVALID_REQUEST = 'INVALID_REQUEST',
  INVALID_TRIGGER = 'INVALID_TRIGGER',
  WORK_ITEM_NOT_FOUND = 'WORK_ITEM_NOT_FOUND',
  AGENT_PROFILE_NOT_FOUND = 'AGENT_PROFILE_NOT_FOUND',
}

export class ProactiveWorkDecisionError extends Error {
  constructor(readonly code: ProactiveWorkDecisionFailureCode) {
    super(code);
    this.name = 'ProactiveWorkDecisionError';
    Object.freeze(this);
  }
}

export interface EvaluateProactiveWorkInput {
  readonly workItemId: Id;
  readonly agentProfileId: AgentProfileId;
  readonly trigger: TriggerSourceInput;
}

/**
 * Read-only M3E-1 decision service. It canonical-loads existing configuration
 * and work state but owns no mutation, handoff, approval, execution, or Provider path.
 */
export class ProactiveWorkService {
  constructor(
    private readonly storage: StorageProvider,
    private readonly agentProfiles: AgentProfileRegistry,
  ) {}

  async evaluate(input: EvaluateProactiveWorkInput): Promise<ProactiveWorkDecision> {
    if (
      typeof input !== 'object'
      || input === null
      || typeof input.workItemId !== 'string'
      || input.workItemId.trim().length === 0
      || !isAgentProfileId(input.agentProfileId)
    ) {
      throw new ProactiveWorkDecisionError(ProactiveWorkDecisionFailureCode.INVALID_REQUEST);
    }

    let trigger: TriggerSource;
    try {
      trigger = new TriggerSource(input.trigger);
    } catch {
      throw new ProactiveWorkDecisionError(ProactiveWorkDecisionFailureCode.INVALID_TRIGGER);
    }

    const workItem = await this.storage.workItems.get(input.workItemId);
    if (!workItem) {
      throw new ProactiveWorkDecisionError(ProactiveWorkDecisionFailureCode.WORK_ITEM_NOT_FOUND);
    }

    try {
      this.agentProfiles.get(input.agentProfileId);
    } catch (error) {
      if (error instanceof AgentProfileConfigurationError) {
        throw new ProactiveWorkDecisionError(
          ProactiveWorkDecisionFailureCode.AGENT_PROFILE_NOT_FOUND,
        );
      }
      throw error;
    }

    const outcome = outcomeFor(workItem.status);
    return new ProactiveWorkDecision({
      workItemId: workItem.id,
      agentProfileId: input.agentProfileId,
      trigger,
      ...outcome,
    });
  }
}

function outcomeFor(status: WorkItemStatus): Pick<
  ProactiveWorkDecision,
  'disposition' | 'reason'
> {
  switch (status) {
    case WorkItemStatus.ACTIVE:
      return {
        disposition: ProactiveWorkDisposition.CONTINUE,
        reason: ProactiveWorkReason.ACTIVE_WORK_ITEM,
      };
    case WorkItemStatus.COMPLETED:
      return {
        disposition: ProactiveWorkDisposition.NO_ACTION,
        reason: ProactiveWorkReason.WORK_ITEM_COMPLETED,
      };
    case WorkItemStatus.CANCELED:
      return {
        disposition: ProactiveWorkDisposition.NO_ACTION,
        reason: ProactiveWorkReason.WORK_ITEM_CANCELED,
      };
    default:
      throw new ProactiveWorkDecisionError(ProactiveWorkDecisionFailureCode.INVALID_REQUEST);
  }
}
