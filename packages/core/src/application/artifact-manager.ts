import { newId } from '../util/id';
import { now } from '../util/clock';
import type { Artifact, ArtifactKind, Id, Metadata } from '../domain';
import type { StorageProvider } from '../ports';

/** Persists AI outputs as first-class Artifacts. */
export class ArtifactManager {
  constructor(private readonly storage: StorageProvider) {}

  async create(input: {
    kind: ArtifactKind;
    title: string;
    content?: string;
    uri?: string;
    mimeType?: string;
    taskId?: Id;
    taskRunId?: Id;
    metadata?: Metadata;
  }): Promise<Artifact> {
    const artifact: Artifact = {
      id: newId(),
      kind: input.kind,
      title: input.title,
      createdAt: now(),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.uri ? { uri: input.uri } : {}),
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.taskRunId ? { taskRunId: input.taskRunId } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    return this.storage.artifacts.save(artifact);
  }

  /** Persist a batch of artifacts produced by a run; returns their ids. */
  async persistAll(taskId: Id, taskRunId: Id, artifacts: Artifact[]): Promise<Id[]> {
    const saved = await Promise.all(
      artifacts.map((a) => this.storage.artifacts.save({ ...a, taskId, taskRunId })),
    );
    return saved.map((a) => a.id);
  }
}
