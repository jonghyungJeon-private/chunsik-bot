import { describe, expect, it, vi } from 'vitest';
import {
  ProactiveDelegationDisposition,
  ResourceRef,
  TriggerSourceKind,
  WorkItemStatus,
  agentProfileId,
} from '../domain';
import type { AgentProfile, WorkHandoff, WorkItem } from '../domain';
import type { StorageProvider, WorkHandoffRepository } from '../ports';
import { AgentProfileRegistry } from './agent-profile-registry';
import { ProactiveDelegationFailureCode, ProactiveDelegationService } from './proactive-delegation-service';
import { WorkHandoffManager } from './work-handoff-manager';

const TS = '2026-09-04T00:00:00.000Z';
const profile = (id: string): AgentProfile => ({
  id: agentProfileId(id), displayName: id, role: 'role', purpose: 'purpose', instructions: 'instructions',
});

function integrationHarness(statuses: readonly WorkItemStatus[] = [WorkItemStatus.ACTIVE]) {
  let read = 0;
  const base: WorkItem = {
    id: 'work-1', actorId: 'actor-1', resourceRefs: [], status: WorkItemStatus.ACTIVE,
    origin: 'conversation', createdAt: TS, updatedAt: TS,
  };
  const rows = new Map<string, WorkHandoff>();
  const insert = vi.fn(async (handoff: WorkHandoff) => {
    if (rows.has(handoff.id)) throw new Error('duplicate');
    rows.set(handoff.id, handoff);
    return handoff;
  });
  const repository: WorkHandoffRepository = {
    insert,
    get: async (id) => rows.get(id) ?? null,
    listByWorkItem: async (id) => [...rows.values()].filter((value) => value.workItemId === id),
    listByFromAgent: async (id) => [...rows.values()].filter((value) => value.fromAgentProfileId === id),
    listByToAgent: async (id) => [...rows.values()].filter((value) => value.toAgentProfileId === id),
  };
  const get = vi.fn(async (id: string) => id === base.id
    ? { ...base, status: statuses[Math.min(read++, statuses.length - 1)] ?? WorkItemStatus.ACTIVE }
    : null);
  const save = vi.fn();
  const storage = {
    workItems: { get, save }, artifacts: { get: async () => null },
    executionReceipts: { get: async () => null }, workHandoffs: repository,
  } as unknown as StorageProvider;
  const registry = new AgentProfileRegistry([profile('builder'), profile('reviewer')]);
  const service = new ProactiveDelegationService(storage, registry, new WorkHandoffManager(storage, registry));
  return { service, rows, insert, save };
}

const request = () => ({
  trigger: { kind: TriggerSourceKind.INTERNAL_CONTINUATION, provenanceId: 'continuation-1', observedAt: TS },
  workItemId: 'work-1', fromAgentProfileId: agentProfileId('builder'),
  toAgentProfileId: agentProfileId('reviewer'), objective: 'Review the bounded result.',
  handoffId: 'handoff-1', createdAt: TS,
  resourceRefs: [new ResourceRef({ source: 'jira', externalId: 'M3E-2' })],
});

describe('ProactiveDelegationService non-SQLite integration', () => {
  it('composes canonical reads, registry, evaluation, and real WorkHandoffManager recording', async () => {
    const h = integrationHarness();
    await expect(h.service.evaluate(request())).resolves.toMatchObject({
      disposition: ProactiveDelegationDisposition.DELEGATE,
    });
    expect(h.rows.size).toBe(0);
    const recorded = await h.service.record(request());
    expect(h.rows.get(recorded.id)).toEqual(recorded);
    expect(h.insert).toHaveBeenCalledTimes(1);
    expect(h.save).not.toHaveBeenCalled();
  });

  it('fails closed through the real composition when canonical state becomes stale', async () => {
    const h = integrationHarness([WorkItemStatus.ACTIVE, WorkItemStatus.COMPLETED]);
    await expect(h.service.record(request())).rejects.toMatchObject({
      code: ProactiveDelegationFailureCode.DELEGATION_NOT_ELIGIBLE,
    });
    expect(h.rows.size).toBe(0);
    expect(h.insert).not.toHaveBeenCalled();
  });
});
