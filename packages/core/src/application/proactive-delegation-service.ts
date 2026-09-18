import {
  ProactiveDelegationDecision,
  ProactiveDelegationDisposition,
  ProactiveDelegationReason,
  TriggerSource,
  WorkItemStatus,
  createWorkHandoff,
  isAgentProfileId,
} from '../domain';
import type {
  AgentProfileId,
  Id,
  IsoTimestamp,
  ResourceRef,
  TriggerSourceInput,
  WorkHandoff,
} from '../domain';
import type { StorageProvider } from '../ports';
import { AgentProfileConfigurationError, type AgentProfileRegistry } from './agent-profile-registry';
import type { WorkHandoffManager } from './work-handoff-manager';

const BOUNDED_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CANONICAL_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export enum ProactiveDelegationFailureCode {
  INVALID_REQUEST = 'INVALID_REQUEST',
  INVALID_TRIGGER = 'INVALID_TRIGGER',
  INVALID_HANDOFF_ID = 'INVALID_HANDOFF_ID',
  INVALID_OBJECTIVE = 'INVALID_OBJECTIVE',
  INVALID_CREATED_AT = 'INVALID_CREATED_AT',
  WORK_ITEM_NOT_FOUND = 'WORK_ITEM_NOT_FOUND',
  SOURCE_AGENT_PROFILE_NOT_FOUND = 'SOURCE_AGENT_PROFILE_NOT_FOUND',
  DESTINATION_AGENT_PROFILE_NOT_FOUND = 'DESTINATION_AGENT_PROFILE_NOT_FOUND',
  SAME_AGENT_PROFILE = 'SAME_AGENT_PROFILE',
  DELEGATION_NOT_ELIGIBLE = 'DELEGATION_NOT_ELIGIBLE',
}

export class ProactiveDelegationError extends Error {
  constructor(readonly code: ProactiveDelegationFailureCode) {
    super(code);
    this.name = 'ProactiveDelegationError';
    Object.freeze(this);
  }
}

export interface ProactiveDelegationRequest {
  readonly trigger: TriggerSourceInput;
  readonly workItemId: Id;
  readonly fromAgentProfileId: AgentProfileId;
  readonly toAgentProfileId: AgentProfileId;
  readonly objective: string;
  readonly handoffId: Id;
  readonly createdAt: IsoTimestamp;
  readonly resourceRefs?: readonly ResourceRef[];
  readonly artifactIds?: readonly Id[];
  readonly executionReceiptIds?: readonly Id[];
}

/** Pure evaluation plus an explicitly separate durable WorkHandoff recording stage. */
export class ProactiveDelegationService {
  constructor(
    private readonly storage: StorageProvider,
    private readonly agentProfiles: AgentProfileRegistry,
    private readonly workHandoffs: WorkHandoffManager,
  ) {}

  async evaluate(request: ProactiveDelegationRequest): Promise<ProactiveDelegationDecision> {
    const validated = validateRequest(request);
    const workItem = await this.storage.workItems.get(validated.workItemId);
    if (!workItem) throw new ProactiveDelegationError(ProactiveDelegationFailureCode.WORK_ITEM_NOT_FOUND);
    resolveProfile(this.agentProfiles, validated.fromAgentProfileId, true);
    resolveProfile(this.agentProfiles, validated.toAgentProfileId, false);

    const outcome = workItem.status === WorkItemStatus.ACTIVE
      ? {
          disposition: ProactiveDelegationDisposition.DELEGATE,
          reason: ProactiveDelegationReason.DELEGATABLE_ACTIVE_WORK_ITEM,
        }
      : workItem.status === WorkItemStatus.COMPLETED
        ? {
            disposition: ProactiveDelegationDisposition.NO_ACTION,
            reason: ProactiveDelegationReason.WORK_ITEM_COMPLETED,
          }
        : {
            disposition: ProactiveDelegationDisposition.NO_ACTION,
            reason: ProactiveDelegationReason.WORK_ITEM_CANCELED,
          };
    return new ProactiveDelegationDecision({
      workItemId: workItem.id,
      fromAgentProfileId: validated.fromAgentProfileId,
      toAgentProfileId: validated.toAgentProfileId,
      trigger: validated.trigger,
      ...outcome,
    });
  }

  async record(request: ProactiveDelegationRequest): Promise<WorkHandoff> {
    const first = await this.evaluate(request);
    if (first.disposition !== ProactiveDelegationDisposition.DELEGATE) {
      throw new ProactiveDelegationError(ProactiveDelegationFailureCode.DELEGATION_NOT_ELIGIBLE);
    }
    const revalidated = await this.evaluate(request);
    if (revalidated.disposition !== ProactiveDelegationDisposition.DELEGATE) {
      throw new ProactiveDelegationError(ProactiveDelegationFailureCode.DELEGATION_NOT_ELIGIBLE);
    }
    return this.workHandoffs.recordIdempotent({
      handoffId: request.handoffId,
      workItemId: request.workItemId,
      fromAgentProfileId: request.fromAgentProfileId,
      toAgentProfileId: request.toAgentProfileId,
      objective: request.objective,
      createdAt: request.createdAt,
      resourceRefs: request.resourceRefs,
      artifactIds: request.artifactIds,
      executionReceiptIds: request.executionReceiptIds,
    });
  }
}

function validateRequest(request: ProactiveDelegationRequest): ProactiveDelegationRequest & { trigger: TriggerSource } {
  if (typeof request !== 'object' || request === null || typeof request.workItemId !== 'string'
    || request.workItemId.trim().length === 0 || !isAgentProfileId(request.fromAgentProfileId)
    || !isAgentProfileId(request.toAgentProfileId)) {
    throw new ProactiveDelegationError(ProactiveDelegationFailureCode.INVALID_REQUEST);
  }
  if (request.fromAgentProfileId === request.toAgentProfileId) {
    throw new ProactiveDelegationError(ProactiveDelegationFailureCode.SAME_AGENT_PROFILE);
  }
  let trigger: TriggerSource;
  try { trigger = new TriggerSource(request.trigger); } catch {
    throw new ProactiveDelegationError(ProactiveDelegationFailureCode.INVALID_TRIGGER);
  }
  if (typeof request.handoffId !== 'string' || !BOUNDED_ID.test(request.handoffId)) {
    throw new ProactiveDelegationError(ProactiveDelegationFailureCode.INVALID_HANDOFF_ID);
  }
  if (!isCanonicalTimestamp(request.createdAt)) {
    throw new ProactiveDelegationError(ProactiveDelegationFailureCode.INVALID_CREATED_AT);
  }
  try {
    createWorkHandoff({
      id: request.handoffId,
      workItemId: request.workItemId,
      fromAgentProfileId: request.fromAgentProfileId,
      toAgentProfileId: request.toAgentProfileId,
      objective: request.objective,
      resourceRefs: request.resourceRefs ?? [],
      artifactIds: request.artifactIds ?? [],
      executionReceiptIds: request.executionReceiptIds ?? [],
      createdAt: request.createdAt,
    });
  } catch {
    throw new ProactiveDelegationError(ProactiveDelegationFailureCode.INVALID_OBJECTIVE);
  }
  return { ...request, trigger };
}

function resolveProfile(registry: AgentProfileRegistry, id: AgentProfileId, source: boolean): void {
  try { registry.get(id); } catch (error) {
    if (error instanceof AgentProfileConfigurationError) {
      throw new ProactiveDelegationError(source
        ? ProactiveDelegationFailureCode.SOURCE_AGENT_PROFILE_NOT_FOUND
        : ProactiveDelegationFailureCode.DESTINATION_AGENT_PROFILE_NOT_FOUND);
    }
    throw error;
  }
}

function isCanonicalTimestamp(value: unknown): value is IsoTimestamp {
  if (typeof value !== 'string' || !CANONICAL_UTC_TIMESTAMP.test(value)) return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}
