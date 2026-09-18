import { describe, expect, it, vi } from 'vitest';
import {
  ProactiveDelegationDisposition,
  ProactiveDelegationReason,
  TriggerSourceKind,
  WorkItemStatus,
  agentProfileId,
} from '../domain';
import type { AgentProfile, WorkItem } from '../domain';
import type { StorageProvider } from '../ports';
import { AgentProfileRegistry } from './agent-profile-registry';
import {
  ProactiveDelegationError,
  ProactiveDelegationFailureCode,
  ProactiveDelegationService,
} from './proactive-delegation-service';
import type { WorkHandoffManager } from './work-handoff-manager';

const TS = '2026-09-04T00:00:00.000Z';
const profile = (id: string): AgentProfile => ({
  id: agentProfileId(id), displayName: id, role: 'role', purpose: 'purpose', instructions: 'instructions',
});
const item = (status: WorkItemStatus): WorkItem => ({
  id: 'work-1', actorId: 'actor-1', resourceRefs: [], status, origin: 'conversation', createdAt: TS, updatedAt: TS,
});
const request = () => ({
  trigger: { kind: TriggerSourceKind.INTERNAL_CONTINUATION, provenanceId: 'continuation-1', observedAt: TS },
  workItemId: 'work-1',
  fromAgentProfileId: agentProfileId('builder'),
  toAgentProfileId: agentProfileId('reviewer'),
  objective: 'Review bounded work.',
  handoffId: 'handoff-1',
  createdAt: TS,
});

function harness(statuses: readonly WorkItemStatus[] = [WorkItemStatus.ACTIVE]) {
  let reads = 0;
  const get = vi.fn(async (id: string) => id === 'work-1'
    ? item(statuses[Math.min(reads++, statuses.length - 1)] ?? WorkItemStatus.ACTIVE)
    : null);
  const save = vi.fn();
  const insert = vi.fn();
  const recordIdempotent = vi.fn(async () => ({ id: 'handoff-1' }));
  const storage = { workItems: { get, save }, workHandoffs: { insert } } as unknown as StorageProvider;
  const registry = new AgentProfileRegistry([profile('builder'), profile('reviewer')]);
  const service = new ProactiveDelegationService(
    storage,
    registry,
    { recordIdempotent } as unknown as WorkHandoffManager,
  );
  return { service, get, save, insert, recordIdempotent };
}

describe('ProactiveDelegationService', () => {
  it.each([
    [WorkItemStatus.ACTIVE, ProactiveDelegationDisposition.DELEGATE, ProactiveDelegationReason.DELEGATABLE_ACTIVE_WORK_ITEM],
    [WorkItemStatus.COMPLETED, ProactiveDelegationDisposition.NO_ACTION, ProactiveDelegationReason.WORK_ITEM_COMPLETED],
    [WorkItemStatus.CANCELED, ProactiveDelegationDisposition.NO_ACTION, ProactiveDelegationReason.WORK_ITEM_CANCELED],
  ])('evaluates %s deterministically', async (status, disposition, reason) => {
    const h = harness([status]);
    await expect(h.service.evaluate(request())).resolves.toMatchObject({ disposition, reason });
    expect(h.save).not.toHaveBeenCalled();
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.recordIdempotent).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown work', { workItemId: 'missing' }, ProactiveDelegationFailureCode.WORK_ITEM_NOT_FOUND],
    ['unknown source', { fromAgentProfileId: agentProfileId('missing') }, ProactiveDelegationFailureCode.SOURCE_AGENT_PROFILE_NOT_FOUND],
    ['unknown destination', { toAgentProfileId: agentProfileId('missing') }, ProactiveDelegationFailureCode.DESTINATION_AGENT_PROFILE_NOT_FOUND],
    ['same agent', { toAgentProfileId: agentProfileId('builder') }, ProactiveDelegationFailureCode.SAME_AGENT_PROFILE],
    ['malformed trigger', { trigger: { ...request().trigger, observedAt: 'bad' } }, ProactiveDelegationFailureCode.INVALID_TRIGGER],
    ['malformed handoff id', { handoffId: 'bad id' }, ProactiveDelegationFailureCode.INVALID_HANDOFF_ID],
    ['invalid objective', { objective: ' ' }, ProactiveDelegationFailureCode.INVALID_OBJECTIVE],
    ['invalid createdAt', { createdAt: 'tomorrow' }, ProactiveDelegationFailureCode.INVALID_CREATED_AT],
  ])('fails closed for %s', async (_label, override, code) => {
    const h = harness();
    await expect(h.service.evaluate({ ...request(), ...override })).rejects.toEqual(
      new ProactiveDelegationError(code),
    );
    expect(h.recordIdempotent).not.toHaveBeenCalled();
  });

  it('separates evaluate from record and records exactly once after revalidation', async () => {
    const h = harness();
    await h.service.evaluate(request());
    expect(h.recordIdempotent).not.toHaveBeenCalled();
    await h.service.record(request());
    expect(h.recordIdempotent).toHaveBeenCalledTimes(1);
  });

  it.each([WorkItemStatus.COMPLETED, WorkItemStatus.CANCELED])(
    'fails closed when ACTIVE becomes %s before the record-time effect',
    async (stale) => {
      const h = harness([WorkItemStatus.ACTIVE, stale]);
      await expect(h.service.record(request())).rejects.toEqual(
        new ProactiveDelegationError(ProactiveDelegationFailureCode.DELEGATION_NOT_ELIGIBLE),
      );
      expect(h.recordIdempotent).not.toHaveBeenCalled();
      expect(h.save).not.toHaveBeenCalled();
    },
  );
});
