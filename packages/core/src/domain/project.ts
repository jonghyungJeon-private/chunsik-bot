import type { Id, IsoTimestamp, Metadata } from './common';

/**
 * A known codebase Chunsik can operate on. Project memory (rules, stack,
 * commands, conventions) is derived from and attached to this entity.
 */
export interface Project {
  id: Id;
  name: string;
  /** Absolute path to the local clone (v1: LocalCloneWorkspaceProvider). */
  rootPath: string;
  techStack?: string[];
  /** Named commands, e.g. { test: "pnpm test", build: "pnpm build" }. */
  commands?: Record<string, string>;
  conventions?: string;
  createdAt: IsoTimestamp;
  metadata?: Metadata;
}
