import { describe, expect, it } from 'vitest';
import {
  ProactiveWorkDisposition,
  ProactiveWorkReason,
  TriggerSourceKind,
  WorkItemStatus,
  agentProfileId,
} from '../domain';
import type { AgentProfile, WorkItem } from '../domain';
import type { StorageProvider, WorkItemRepository } from '../ports';
import { AgentProfileRegistry } from './agent-profile-registry';
import { ProactiveWorkService } from './proactive-work-service';

const TS = '2026-09-03T00:00:00.000Z';

describe('ProactiveWorkService application integration', () => {
  it('uses canonical in-memory WorkItem storage and registry lookup without persistence mutation', async () => {
    const canonical: WorkItem = {
      id: 'work-canonical',
      actorId: 'actor-1',
      resourceRefs: [],
      status: WorkItemStatus.ACTIVE,
      origin: 'conversation',
      createdAt: TS,
      updatedAt: TS,
    };
    const rows = new Map([[canonical.id, canonical]]);
    let writes = 0;
    const repository: WorkItemRepository = {
      async get(id) { return rows.get(id) ?? null; },
      async save(item) { writes++; rows.set(item.id, item); return item; },
      async delete(id) { writes++; rows.delete(id); },
      async list() { return [...rows.values()]; },
      async listByActor(actorId) {
        return [...rows.values()].filter((item) => item.actorId === actorId);
      },
      async listByResource(resource) {
        return [...rows.values()].filter((item) =>
          item.resourceRefs.some((ref) => ref.equals(resource)));
      },
    };
    const storage = { workItems: repository } as unknown as StorageProvider;
    const profile: AgentProfile = {
      id: agentProfileId('integration-agent'),
      displayName: 'Integration Agent',
      role: 'reader',
      purpose: 'Exercise the read-only application seam.',
      instructions: 'Do not mutate durable state.',
    };
    const registry = new AgentProfileRegistry([profile]);
    const service = new ProactiveWorkService(storage, registry);

    const decision = await service.evaluate({
      workItemId: canonical.id,
      agentProfileId: profile.id,
      trigger: {
        kind: TriggerSourceKind.INTERNAL_CONTINUATION,
        provenanceId: 'integration:continuation-1',
        observedAt: TS,
      },
    });

    expect(decision.disposition).toBe(ProactiveWorkDisposition.CONTINUE);
    expect(decision.reason).toBe(ProactiveWorkReason.ACTIVE_WORK_ITEM);
    expect(decision.workItemId).toBe(canonical.id);
    expect(registry.get(profile.id)).toEqual(profile);
    expect(rows.get(canonical.id)).toBe(canonical);
    expect(writes).toBe(0);
  });
});
