import type { Id, IsoTimestamp, Metadata } from './common';
import type { ArtifactKind } from './enums';

/**
 * A structured output of an AI run. Treated as first-class, not plain text,
 * so the ResponseComposer and (later) connectors can render each kind
 * appropriately — a CODE_DIFF as a diff, a TEST_LOG as a collapsible log, etc.
 */
export interface Artifact {
  id: Id;
  taskId?: Id;
  taskRunId?: Id;
  kind: ArtifactKind;
  title: string;
  /** Inline content; for large outputs `uri` may point at a stored file. */
  content?: string;
  uri?: string;
  mimeType?: string;
  metadata?: Metadata;
  createdAt: IsoTimestamp;
}
