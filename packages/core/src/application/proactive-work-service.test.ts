import { describe, expect, it, vi } from 'vitest';
import {
  ProactiveWorkDisposition,
  ProactiveWorkReason,
  TriggerSourceKind,
  WorkItemStatus,
  agentProfileId,
} from '../domain';
import type { AgentProfile, WorkItem } from '../domain';
import type { StorageProvider } from '../ports';
import { AgentProfileRegistry } from './agent-profile-registry';
import {
  ProactiveWorkDecisionError,
  ProactiveWorkDecisionFailureCode,
  ProactiveWorkService,
} from './proactive-work-service';

const TS = '2026-09-03T00:00:00.000Z';

function profile(): AgentProfile {
  return {
    id: agentProfileId('builder'),
    displayName: 'Builder',
    role: 'implementation specialist',
    purpose: 'Continue bounded work.',
    instructions: 'Stay within the approved scope.',
  };
}

function workItem(status: WorkItemStatus): WorkItem {
  return {
    id: 'work-1',
    actorId: 'actor-1',
    resourceRefs: [],
    status,
    origin: 'conversation',
    createdAt: TS,
    updatedAt: TS,
  };
}

function request() {
  return {
    workItemId: 'work-1',
    agentProfileId: agentProfileId('builder'),
    trigger: {
      kind: TriggerSourceKind.INTERNAL_CONTINUATION,
      provenanceId: 'work-1:continuation-1',
      observedAt: TS,
    },
  };
}

function harness(status: WorkItemStatus = WorkItemStatus.ACTIVE) {
  const canonical = workItem(status);
  const workItemGet = vi.fn(async (id: string) => id === canonical.id ? canonical : null);
  const workItemSave = vi.fn();
  const handoffInsert = vi.fn();
  const storage = {
    workItems: { get: workItemGet, save: workItemSave },
    workHandoffs: { insert: handoffInsert },
  } as unknown as StorageProvider;
  const approval = vi.fn();
  const execution = vi.fn();
  const provider = vi.fn();
  const service = new ProactiveWorkService(storage, new AgentProfileRegistry([profile()]));
  return {
    service,
    workItemGet,
    workItemSave,
    handoffInsert,
    approval,
    execution,
    provider,
  };
}

describe('ProactiveWorkService', () => {
  it.each([
    [WorkItemStatus.ACTIVE, ProactiveWorkDisposition.CONTINUE, ProactiveWorkReason.ACTIVE_WORK_ITEM],
    [
      WorkItemStatus.COMPLETED,
      ProactiveWorkDisposition.NO_ACTION,
      ProactiveWorkReason.WORK_ITEM_COMPLETED,
    ],
    [
      WorkItemStatus.CANCELED,
      ProactiveWorkDisposition.NO_ACTION,
      ProactiveWorkReason.WORK_ITEM_CANCELED,
    ],
  ])('maps canonical %s state to a bounded decision', async (status, disposition, reason) => {
    const h = harness(status);
    const decision = await h.service.evaluate(request());

    expect(h.workItemGet).toHaveBeenCalledWith('work-1');
    expect(decision).toMatchObject({
      workItemId: 'work-1',
      agentProfileId: 'builder',
      disposition,
      reason,
    });
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.trigger)).toBe(true);
  });

  it('fails closed for an unknown WorkItem', async () => {
    const h = harness();
    await expect(h.service.evaluate({ ...request(), workItemId: 'missing' })).rejects.toEqual(
      new ProactiveWorkDecisionError(ProactiveWorkDecisionFailureCode.WORK_ITEM_NOT_FOUND),
    );
  });

  it('fails closed for an unknown AgentProfile', async () => {
    const h = harness();
    await expect(h.service.evaluate({
      ...request(),
      agentProfileId: agentProfileId('unknown'),
    })).rejects.toEqual(
      new ProactiveWorkDecisionError(ProactiveWorkDecisionFailureCode.AGENT_PROFILE_NOT_FOUND),
    );
  });

  it('fails closed for a malformed TriggerSource before canonical lookup', async () => {
    const h = harness();
    await expect(h.service.evaluate({
      ...request(),
      trigger: { ...request().trigger, observedAt: 'not-a-time' },
    })).rejects.toEqual(
      new ProactiveWorkDecisionError(ProactiveWorkDecisionFailureCode.INVALID_TRIGGER),
    );
    expect(h.workItemGet).not.toHaveBeenCalled();
  });

  it('is deterministic for identical canonical state and supplied input', async () => {
    const h = harness();
    const first = await h.service.evaluate(request());
    const second = await h.service.evaluate(request());

    expect(second).toEqual(first);
  });

  it('has no WorkItem write, WorkHandoff, Approval, execution, or Provider side effect', async () => {
    const h = harness();
    await h.service.evaluate(request());

    expect(h.workItemSave).not.toHaveBeenCalled();
    expect(h.handoffInsert).not.toHaveBeenCalled();
    expect(h.approval).not.toHaveBeenCalled();
    expect(h.execution).not.toHaveBeenCalled();
    expect(h.provider).not.toHaveBeenCalled();
  });
});
