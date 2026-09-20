import { describe, expect, it, vi } from 'vitest';
import { agentProfileId, createWorkHandoff, WorkItemStatus } from '../domain';
import type { WorkItem } from '../domain';
import { AgentProfileRegistry } from './agent-profile-registry';
import { WorkHandoffConsumptionService, WorkHandoffConsumptionError } from './work-handoff-consumption-service';

const TS = '2026-09-20T00:00:00.000Z';
function harness() {
  const handoff = createWorkHandoff({ id: 'h1', workItemId: 'w1',
    fromAgentProfileId: agentProfileId('builder'), toAgentProfileId: agentProfileId('reviewer'),
    objective: 'Review', resourceRefs: [], artifactIds: [], executionReceiptIds: [], createdAt: TS });
  const item: WorkItem = { id: 'w1', actorId: 'a1', status: WorkItemStatus.ACTIVE,
    origin: 'conversation', resourceRefs: [], createdAt: TS, updatedAt: TS };
  const getHandoff = vi.fn(async () => handoff as typeof handoff | null);
  const getWork = vi.fn(async () => item as WorkItem | null);
  const registry = new AgentProfileRegistry(['builder', 'reviewer'].map(id => ({
    id: agentProfileId(id), displayName: id, role: id, purpose: id, instructions: id,
  })));
  const service = new WorkHandoffConsumptionService({ workHandoffs: { get: getHandoff },
    workItems: { get: getWork } }, registry);
  return { handoff, item, getHandoff, getWork, service };
}

describe('WorkHandoffConsumptionService', () => {
  it.each([
    [WorkItemStatus.ACTIVE, 'CONTINUE', 'ACTIVE_WORK_ITEM'],
    [WorkItemStatus.COMPLETED, 'NO_ACTION', 'WORK_ITEM_COMPLETED'],
    [WorkItemStatus.CANCELED, 'NO_ACTION', 'WORK_ITEM_CANCELED'],
  ])('evaluates canonical %s without any write seam', async (status, disposition, reason) => {
    const h = harness();
    h.item.status = status;
    const result = await h.service.evaluate('h1');
    expect(result).toEqual({ handoffId: 'h1', workItemId: 'w1', fromAgentProfileId: 'builder',
      toAgentProfileId: 'reviewer', disposition, reason });
    expect(Object.isFrozen(result)).toBe(true);
    expect(await h.service.evaluate('h1')).toEqual(result);
    expect(h.getHandoff).toHaveBeenCalledWith('h1');
    expect(h.getWork).toHaveBeenCalledWith('w1');
  });
  it.each(['', ' ', ' h1', null, 12])('rejects malformed request %s before storage', async id => {
    const h = harness();
    await expect(h.service.evaluate(id as string)).rejects.toMatchObject({ code: 'INVALID_HANDOFF_ID' });
    expect(h.getHandoff).not.toHaveBeenCalled();
  });
  it.each([
    ['missing handoff', 'HANDOFF_NOT_FOUND'],
    ['missing work', 'WORK_ITEM_NOT_FOUND'],
    ['wrong handoff', 'INCONSISTENT_CANONICAL_RELATIONSHIP'],
    ['wrong work', 'INCONSISTENT_CANONICAL_RELATIONSHIP'],
    ['unknown status', 'INCONSISTENT_CANONICAL_RELATIONSHIP'],
    ['bad objective', 'INVALID_HANDOFF'],
    ['same profiles', 'INVALID_HANDOFF'],
    ['missing source', 'SOURCE_AGENT_PROFILE_NOT_FOUND'],
    ['missing destination', 'DESTINATION_AGENT_PROFILE_NOT_FOUND'],
  ])('fails closed for %s', async (scenario, code) => {
    const h = harness();
    if (scenario === 'missing handoff') h.getHandoff.mockResolvedValue(null);
    if (scenario === 'missing work') h.getWork.mockResolvedValue(null);
    if (scenario === 'wrong handoff') h.getHandoff.mockResolvedValue({ ...h.handoff, id: 'other' });
    if (scenario === 'wrong work') h.item.id = 'other';
    if (scenario === 'unknown status') h.item.status = 'UNKNOWN' as WorkItemStatus;
    if (scenario === 'bad objective') h.getHandoff.mockResolvedValue({ ...h.handoff, objective: '' });
    if (scenario === 'same profiles') h.getHandoff.mockResolvedValue({ ...h.handoff, toAgentProfileId: h.handoff.fromAgentProfileId });
    if (scenario === 'missing source') h.getHandoff.mockResolvedValue({ ...h.handoff, fromAgentProfileId: agentProfileId('absent') });
    if (scenario === 'missing destination') h.getHandoff.mockResolvedValue({ ...h.handoff, toAgentProfileId: agentProfileId('absent') });
    await expect(h.service.evaluate('h1')).rejects.toBeInstanceOf(WorkHandoffConsumptionError);
    await expect(h.service.evaluate('h1')).rejects.toMatchObject({ code });
  });
  it('propagates storage failure without inventing an eligibility result', async () => {
    const h = harness();
    const error = new Error('storage unavailable');
    h.getHandoff.mockRejectedValue(error);
    await expect(h.service.evaluate('h1')).rejects.toBe(error);
  });
});
