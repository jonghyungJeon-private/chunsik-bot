import { describe, expect, it } from 'vitest';
import { agentProfileId } from './agent-profile';
import { ResourceRef } from './resource-ref';
import {
  MAX_WORK_HANDOFF_OBJECTIVE_CHARACTERS,
  createWorkHandoff,
} from './work-handoff';
import type { WorkHandoff } from './work-handoff';

const input = (overrides: Partial<WorkHandoff> = {}): WorkHandoff => ({
  id: 'handoff-1',
  workItemId: 'work-1',
  fromAgentProfileId: agentProfileId('builder'),
  toAgentProfileId: agentProfileId('reviewer'),
  objective: '  Review the bounded implementation.  ',
  resourceRefs: [
    new ResourceRef({ source: 'jira', externalId: 'CAP-014' }),
    new ResourceRef({ source: 'jira', externalId: 'CAP-014' }),
    new ResourceRef({ source: 'github', externalId: '80' }),
  ],
  artifactIds: ['artifact-1', 'artifact-1', 'artifact-2'],
  executionReceiptIds: ['receipt-1', 'receipt-1', 'receipt-2'],
  createdAt: '2026-09-02T00:00:00.000Z',
  ...overrides,
});

describe('WorkHandoff (CAP-014)', () => {
  it('normalizes objective and deduplicates references in input order', () => {
    const handoff = createWorkHandoff(input());

    expect(handoff.objective).toBe('Review the bounded implementation.');
    expect(handoff.resourceRefs.map((ref) => ref.identity)).toEqual([
      'jira:CAP-014',
      'github:80',
    ]);
    expect(handoff.artifactIds).toEqual(['artifact-1', 'artifact-2']);
    expect(handoff.executionReceiptIds).toEqual(['receipt-1', 'receipt-2']);
  });

  it('rejects same-agent, empty, and oversized objectives', () => {
    expect(() => createWorkHandoff(input({ toAgentProfileId: agentProfileId('builder') })))
      .toThrow(/must differ/);
    expect(() => createWorkHandoff(input({ objective: '  ' }))).toThrow(/non-empty/);
    expect(() => createWorkHandoff(input({
      objective: 'x'.repeat(MAX_WORK_HANDOFF_OBJECTIVE_CHARACTERS + 1),
    }))).toThrow(/at most 2000/);
  });

  it('defensively copies and freezes caller-owned arrays and ResourceRef-shaped objects', () => {
    const mutableRef = { source: 'jira', externalId: 'CAP-014' } as ResourceRef;
    const resourceRefs = [mutableRef];
    const artifactIds = ['artifact-1'];
    const executionReceiptIds = ['receipt-1'];
    const handoff = createWorkHandoff(input({ resourceRefs, artifactIds, executionReceiptIds }));

    mutableRef.externalId = 'changed';
    resourceRefs.push(new ResourceRef({ source: 'github', externalId: '80' }));
    artifactIds.push('artifact-2');
    executionReceiptIds.push('receipt-2');

    expect(handoff.resourceRefs[0]?.identity).toBe('jira:CAP-014');
    expect(handoff.artifactIds).toEqual(['artifact-1']);
    expect(handoff.executionReceiptIds).toEqual(['receipt-1']);
    expect(Object.isFrozen(handoff)).toBe(true);
    expect(Object.isFrozen(handoff.resourceRefs)).toBe(true);
    expect(Object.isFrozen(handoff.artifactIds)).toBe(true);
    expect(Object.isFrozen(handoff.executionReceiptIds)).toBe(true);
  });
});
