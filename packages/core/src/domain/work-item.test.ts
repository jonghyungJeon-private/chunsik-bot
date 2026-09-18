import { describe, expect, it } from 'vitest';
import { ResourceRef } from './resource-ref';
import {
  WorkItemStatus,
  canTransitionWorkItem,
  transitionWorkItem,
  uniqueResourceRefs,
} from './work-item';
import type { WorkItem } from './work-item';

const createdAt = '2026-09-01T00:00:00.000Z';

function activeWorkItem(): WorkItem {
  return {
    id: 'work-1',
    actorId: 'actor-1',
    projectId: 'project-1',
    resourceRefs: [new ResourceRef({ source: 'jira', externalId: 'CAP-11' })],
    status: WorkItemStatus.ACTIVE,
    origin: 'conversation',
    createdAt,
    updatedAt: createdAt,
  };
}

describe('WorkItem (CAP-011)', () => {
  it('contains only ADR-0075 durable-work ownership fields', () => {
    expect(Object.keys(activeWorkItem()).sort()).toEqual([
      'actorId',
      'createdAt',
      'id',
      'origin',
      'projectId',
      'resourceRefs',
      'status',
      'updatedAt',
    ]);
  });

  it.each([WorkItemStatus.COMPLETED, WorkItemStatus.CANCELED])(
    'transitions ACTIVE to %s without mutating the persisted value',
    (status) => {
      const item = activeWorkItem();
      const updated = transitionWorkItem(item, status, '2026-09-01T01:00:00.000Z');
      expect(updated).toMatchObject({ status, updatedAt: '2026-09-01T01:00:00.000Z' });
      expect(item.status).toBe(WorkItemStatus.ACTIVE);
    },
  );

  it.each([WorkItemStatus.COMPLETED, WorkItemStatus.CANCELED])(
    'keeps %s terminal',
    (status) => {
      expect(canTransitionWorkItem(status, WorkItemStatus.ACTIVE)).toBe(false);
      expect(() =>
        transitionWorkItem(
          { ...activeWorkItem(), status },
          WorkItemStatus.ACTIVE,
          createdAt,
        ),
      ).toThrow('Invalid WorkItem transition');
    },
  );

  it('deduplicates ResourceRef correlations by provider-independent identity', () => {
    const refs = uniqueResourceRefs([
      new ResourceRef({ source: 'jira', externalId: 'CAP-11' }),
      new ResourceRef({ source: 'jira', externalId: 'CAP-11' }),
      new ResourceRef({ source: 'github', externalId: '42' }),
    ]);
    expect(refs.map((ref) => ref.identity)).toEqual(['jira:CAP-11', 'github:42']);
  });
});
