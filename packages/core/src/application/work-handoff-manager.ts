import {
  MAX_WORK_HANDOFF_OBJECTIVE_CHARACTERS,
  createWorkHandoff,
  isAgentProfileId,
} from '../domain';
import type { AgentProfileId, Id, IsoTimestamp, ResourceRef, WorkHandoff } from '../domain';
import type { StorageProvider } from '../ports';
import { now } from '../util/clock';
import { newId } from '../util/id';
import type { AgentProfileRegistry } from './agent-profile-registry';

export interface CreateWorkHandoffInput {
  readonly workItemId: Id;
  readonly fromAgentProfileId: AgentProfileId;
  readonly toAgentProfileId: AgentProfileId;
  readonly objective: string;
  readonly resourceRefs?: readonly ResourceRef[];
  readonly artifactIds?: readonly Id[];
  readonly executionReceiptIds?: readonly Id[];
}

export interface RecordWorkHandoffInput extends CreateWorkHandoffInput {
  readonly handoffId: Id;
  readonly createdAt: IsoTimestamp;
}

export enum WorkHandoffIdempotencyFailureCode {
  CONFLICT = 'WORK_HANDOFF_IDEMPOTENCY_CONFLICT',
}

export class WorkHandoffIdempotencyError extends Error {
  constructor(readonly code: WorkHandoffIdempotencyFailureCode) {
    super(code);
    this.name = 'WorkHandoffIdempotencyError';
    Object.freeze(this);
  }
}

function validateRequest(input: CreateWorkHandoffInput): void {
  if (typeof input !== 'object' || input === null) {
    throw new Error('WorkHandoff request must be an object');
  }
  if (typeof input.objective !== 'string' || input.objective.trim().length === 0) {
    throw new Error('WorkHandoff objective must be non-empty');
  }
  if (input.objective.trim().length > MAX_WORK_HANDOFF_OBJECTIVE_CHARACTERS) {
    throw new Error(
      `WorkHandoff objective must be at most ${MAX_WORK_HANDOFF_OBJECTIVE_CHARACTERS} characters`,
    );
  }
  if (typeof input.workItemId !== 'string' || input.workItemId.trim().length === 0) {
    throw new Error('WorkHandoff workItemId must be non-empty');
  }
  if (!isAgentProfileId(input.fromAgentProfileId)) {
    throw new Error('Invalid WorkHandoff fromAgentProfileId');
  }
  if (!isAgentProfileId(input.toAgentProfileId)) {
    throw new Error('Invalid WorkHandoff toAgentProfileId');
  }
  for (const [field, value] of [
    ['resourceRefs', input.resourceRefs],
    ['artifactIds', input.artifactIds],
    ['executionReceiptIds', input.executionReceiptIds],
  ] as const) {
    if (value !== undefined && !Array.isArray(value)) {
      throw new Error(`WorkHandoff ${field} must be an array`);
    }
  }
  for (const id of [...(input.artifactIds ?? []), ...(input.executionReceiptIds ?? [])]) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error('WorkHandoff reference ids must be non-empty');
    }
  }
  for (const ref of input.resourceRefs ?? []) {
    if (typeof ref !== 'object' || ref === null) {
      throw new Error('WorkHandoff resourceRefs must contain ResourceRef values');
    }
  }
}

function uniqueIds(values: readonly Id[]): readonly Id[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

/** CAP-014 owner for validation and insert-once durable handoff provenance. */
export class WorkHandoffManager {
  constructor(
    private readonly storage: StorageProvider,
    private readonly agentProfiles: AgentProfileRegistry,
  ) {}

  async create(input: CreateWorkHandoffInput): Promise<WorkHandoff> {
    return this.createCanonical(input, newId(), now());
  }

  async recordIdempotent(input: RecordWorkHandoffInput): Promise<WorkHandoff> {
    const candidate = await this.buildCanonical(input, input.handoffId, input.createdAt);
    const existing = await this.storage.workHandoffs.get(candidate.id);
    if (existing) return requireSemanticEquality(existing, candidate);

    try {
      return await this.storage.workHandoffs.insert(candidate);
    } catch (error) {
      const concurrent = await this.storage.workHandoffs.get(candidate.id);
      if (!concurrent) throw error;
      return requireSemanticEquality(concurrent, candidate);
    }
  }

  private async createCanonical(
    input: CreateWorkHandoffInput,
    id: Id,
    createdAt: IsoTimestamp,
  ): Promise<WorkHandoff> {
    const handoff = await this.buildCanonical(input, id, createdAt);
    return this.storage.workHandoffs.insert(handoff);
  }

  private async buildCanonical(
    input: CreateWorkHandoffInput,
    id: Id,
    createdAt: IsoTimestamp,
  ): Promise<WorkHandoff> {
    validateRequest(input);
    const workItem = await this.storage.workItems.get(input.workItemId);
    if (!workItem) throw new Error(`WorkItem not found: ${input.workItemId}`);

    this.agentProfiles.get(input.fromAgentProfileId);
    this.agentProfiles.get(input.toAgentProfileId);
    if (input.fromAgentProfileId === input.toAgentProfileId) {
      throw new Error('WorkHandoff source and destination AgentProfiles must differ');
    }

    const artifactIds = uniqueIds(input.artifactIds ?? []);
    for (const artifactId of artifactIds) {
      if (!await this.storage.artifacts.get(artifactId)) {
        throw new Error(`Artifact not found: ${artifactId}`);
      }
    }
    const executionReceiptIds = uniqueIds(input.executionReceiptIds ?? []);
    for (const receiptId of executionReceiptIds) {
      if (!await this.storage.executionReceipts.get(receiptId)) {
        throw new Error(`ExecutionReceipt not found: ${receiptId}`);
      }
    }

    const handoff = createWorkHandoff({
      id,
      workItemId: workItem.id,
      fromAgentProfileId: input.fromAgentProfileId,
      toAgentProfileId: input.toAgentProfileId,
      objective: input.objective,
      resourceRefs: input.resourceRefs ?? [],
      artifactIds,
      executionReceiptIds,
      createdAt,
    });
    return handoff;
  }
}

function requireSemanticEquality(existing: WorkHandoff, candidate: WorkHandoff): WorkHandoff {
  const canonical = createWorkHandoff(existing);
  if (JSON.stringify(canonical) !== JSON.stringify(candidate)) {
    throw new WorkHandoffIdempotencyError(WorkHandoffIdempotencyFailureCode.CONFLICT);
  }
  return canonical;
}
