import { newId } from '../util/id';
import { now } from '../util/clock';
import {
  WorkItemStatus,
  transitionWorkItem,
  uniqueResourceRefs,
} from '../domain';
import type { Id, ResourceRef, WorkItem, WorkItemOrigin } from '../domain';
import type { StorageProvider } from '../ports';

export interface CreateWorkItemInput {
  actorId: Id;
  projectId?: Id;
  resourceRefs?: readonly ResourceRef[];
  origin: WorkItemOrigin;
}

/** CAP-011 application owner for durable WorkItem creation, reads and lifecycle. */
export class WorkManager {
  constructor(private readonly storage: StorageProvider) {}

  async create(input: CreateWorkItemInput): Promise<WorkItem> {
    const timestamp = now();
    const workItem: WorkItem = {
      id: newId(),
      actorId: input.actorId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      resourceRefs: uniqueResourceRefs(input.resourceRefs ?? []),
      status: WorkItemStatus.ACTIVE,
      origin: input.origin,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    return this.storage.workItems.save(workItem);
  }

  async get(id: Id): Promise<WorkItem | null> {
    return this.storage.workItems.get(id);
  }

  async listByActor(actorId: Id): Promise<WorkItem[]> {
    return this.storage.workItems.listByActor(actorId);
  }

  async listByResource(resource: ResourceRef): Promise<WorkItem[]> {
    return this.storage.workItems.listByResource(resource);
  }

  async transition(id: Id, status: WorkItemStatus): Promise<WorkItem> {
    const canonical = await this.storage.workItems.get(id);
    if (!canonical) throw new Error(`WorkItem not found: ${id}`);
    return this.storage.workItems.save(transitionWorkItem(canonical, status, now()));
  }
}
