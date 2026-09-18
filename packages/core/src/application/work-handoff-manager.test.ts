import { describe, expect, it, vi } from 'vitest';
import {
  AgentProfileRegistry,
  WorkHandoffIdempotencyError,
  WorkHandoffIdempotencyFailureCode,
  WorkHandoffManager,
} from './index';
import {
  ExecutionKind,
  ExecutionReceiptOutcome,
  ResourceRef,
  WorkItemStatus,
  agentProfileId,
} from '../domain';
import type {
  AgentProfile,
  Artifact,
  ExecutionReceipt,
  WorkHandoff,
  WorkItem,
} from '../domain';
import type { StorageProvider, WorkHandoffRepository } from '../ports';

const TS = '2026-09-02T00:00:00.000Z';

function profile(id: string): AgentProfile {
  return {
    id: agentProfileId(id),
    displayName: id,
    role: 'bounded role',
    purpose: 'bounded purpose',
    instructions: 'bounded instructions',
  };
}

function harness() {
  const workItem: WorkItem = {
    id: 'work-1',
    actorId: 'actor-1',
    resourceRefs: [],
    status: WorkItemStatus.ACTIVE,
    origin: 'conversation',
    createdAt: TS,
    updatedAt: TS,
  };
  const artifact: Artifact = {
    id: 'artifact-1',
    kind: 'CODE_DIFF',
    title: 'diff',
    createdAt: TS,
  } as Artifact;
  const receipt: ExecutionReceipt = {
    id: 'receipt-1',
    executionKind: ExecutionKind.COMMAND,
    sourceId: 'command-1',
    executionPlanId: 'plan-1',
    authorization: { kind: 'NOT_REQUIRED' },
    outcome: ExecutionReceiptOutcome.SUCCEEDED,
    recordedAt: TS,
  };
  const rows = new Map<string, WorkHandoff>();
  const repository: WorkHandoffRepository = {
    insert: vi.fn(async (handoff) => {
      if (rows.has(handoff.id)) throw new Error('duplicate');
      rows.set(handoff.id, handoff);
      return handoff;
    }),
    get: async (id) => rows.get(id) ?? null,
    listByWorkItem: async (id) => [...rows.values()].filter((row) => row.workItemId === id),
    listByFromAgent: async (id) => [...rows.values()].filter((row) => row.fromAgentProfileId === id),
    listByToAgent: async (id) => [...rows.values()].filter((row) => row.toAgentProfileId === id),
  };
  const storage = {
    workItems: { get: vi.fn(async (id: string) => id === 'work-1' || id === 'work-2' ? { ...workItem, id } : null) },
    artifacts: { get: vi.fn(async (id: string) => id === artifact.id ? artifact : null) },
    executionReceipts: { get: vi.fn(async (id: string) => id === receipt.id ? receipt : null) },
    workHandoffs: repository,
  } as unknown as StorageProvider;
  const registry = new AgentProfileRegistry([profile('builder'), profile('reviewer'), profile('other')]);
  return { manager: new WorkHandoffManager(storage, registry), storage, repository, rows };
}

const request = () => ({
  workItemId: 'work-1',
  fromAgentProfileId: agentProfileId('builder'),
  toAgentProfileId: agentProfileId('reviewer'),
  objective: '  Review CAP-014. ',
  resourceRefs: [
    new ResourceRef({ source: 'jira', externalId: 'CAP-014' }),
    new ResourceRef({ source: 'jira', externalId: 'CAP-014' }),
  ],
  artifactIds: ['artifact-1', 'artifact-1'],
  executionReceiptIds: ['receipt-1', 'receipt-1'],
});

const recordRequest = () => ({
  ...request(),
  handoffId: 'handoff-1',
  createdAt: TS,
});

describe('WorkHandoffManager (CAP-014)', () => {
  it('canonical-loads references, normalizes the value, and inserts exactly once', async () => {
    const h = harness();
    const handoff = await h.manager.create(request());

    expect(h.storage.workItems.get).toHaveBeenCalledWith('work-1');
    expect(h.storage.artifacts.get).toHaveBeenCalledTimes(1);
    expect(h.storage.executionReceipts.get).toHaveBeenCalledTimes(1);
    expect(h.repository.insert).toHaveBeenCalledTimes(1);
    expect(handoff).toMatchObject({
      workItemId: 'work-1',
      fromAgentProfileId: 'builder',
      toAgentProfileId: 'reviewer',
      objective: 'Review CAP-014.',
      artifactIds: ['artifact-1'],
      executionReceiptIds: ['receipt-1'],
    });
    expect(handoff.resourceRefs.map((ref) => ref.identity)).toEqual(['jira:CAP-014']);
  });

  it.each([
    ['unknown WorkItem', { workItemId: 'missing' }, /WorkItem not found/],
    ['unknown source profile', { fromAgentProfileId: agentProfileId('unknown') }, /Unknown AgentProfile/],
    ['unknown destination profile', { toAgentProfileId: agentProfileId('unknown') }, /Unknown AgentProfile/],
    ['same profile', { toAgentProfileId: agentProfileId('builder') }, /must differ/],
    ['unknown Artifact', { artifactIds: ['missing'] }, /Artifact not found/],
    ['unknown ExecutionReceipt', { executionReceiptIds: ['missing'] }, /ExecutionReceipt not found/],
  ])('fails closed for %s without inserting', async (_name, override, expected) => {
    const h = harness();
    await expect(h.manager.create({ ...request(), ...override })).rejects.toThrow(expected);
    expect(h.repository.insert).not.toHaveBeenCalled();
  });

  it('rejects an invalid bounded request before storage lookup', async () => {
    const h = harness();
    await expect(h.manager.create({ ...request(), objective: ' ' })).rejects.toThrow(/non-empty/);
    await expect(h.manager.create({ ...request(), workItemId: '' })).rejects.toThrow(/workItemId/);
    await expect(h.manager.create({
      ...request(),
      fromAgentProfileId: 'invalid profile' as ReturnType<typeof agentProfileId>,
    })).rejects.toThrow(/fromAgentProfileId/);
    await expect(h.manager.create({ ...request(), artifactIds: [''] })).rejects.toThrow(/reference ids/);
    expect(h.storage.workItems.get).not.toHaveBeenCalled();
  });

  it('records once and returns the existing canonical value for an identical retry', async () => {
    const h = harness();
    const first = await h.manager.recordIdempotent(recordRequest());
    const retry = await h.manager.recordIdempotent(recordRequest());
    expect(retry).toEqual(first);
    expect(h.repository.insert).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['workItemId', { workItemId: 'work-2' }],
    ['agent', { toAgentProfileId: agentProfileId('other') }],
    ['objective', { objective: 'Different' }],
    ['resource refs', { resourceRefs: [] }],
    ['artifact refs', { artifactIds: [] }],
    ['receipt refs', { executionReceiptIds: [] }],
    ['createdAt', { createdAt: '2026-09-02T00:00:01.000Z' }],
  ])('fails closed for same-id conflicting %s', async (_label, override) => {
    const h = harness();
    h.rows.set('handoff-1', {
      id: 'handoff-1', workItemId: 'work-1', fromAgentProfileId: agentProfileId('builder'),
      toAgentProfileId: agentProfileId('reviewer'), objective: 'Review CAP-014.',
      resourceRefs: [new ResourceRef({ source: 'jira', externalId: 'CAP-014' })],
      artifactIds: ['artifact-1'], executionReceiptIds: ['receipt-1'], createdAt: TS,
    });
    await expect(h.manager.recordIdempotent({ ...recordRequest(), ...override })).rejects.toEqual(
      new WorkHandoffIdempotencyError(WorkHandoffIdempotencyFailureCode.CONFLICT),
    );
    expect(h.repository.insert).not.toHaveBeenCalled();
  });

  it('allows a different handoffId for a legitimate second delegation', async () => {
    const h = harness();
    await h.manager.recordIdempotent(recordRequest());
    await h.manager.recordIdempotent({ ...recordRequest(), handoffId: 'handoff-2' });
    expect(h.repository.insert).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])('reconciles an insert collision with semantic equality=%s', async (equal) => {
    const h = harness();
    const candidate = {
      id: 'handoff-1', workItemId: 'work-1', fromAgentProfileId: agentProfileId('builder'),
      toAgentProfileId: agentProfileId('reviewer'), objective: equal ? 'Review CAP-014.' : 'Conflict',
      resourceRefs: [new ResourceRef({ source: 'jira', externalId: 'CAP-014' })],
      artifactIds: ['artifact-1'], executionReceiptIds: ['receipt-1'], createdAt: TS,
    };
    vi.mocked(h.repository.insert).mockImplementationOnce(async () => {
      h.rows.set('handoff-1', candidate);
      throw new Error('unique collision');
    });
    if (equal) await expect(h.manager.recordIdempotent(recordRequest())).resolves.toEqual(candidate);
    else await expect(h.manager.recordIdempotent(recordRequest())).rejects.toEqual(
      new WorkHandoffIdempotencyError(WorkHandoffIdempotencyFailureCode.CONFLICT),
    );
    expect(h.repository.insert).toHaveBeenCalledTimes(1);
  });
});
