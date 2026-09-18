import type { Metadata } from '../domain';

export interface ConnectorQuery {
  query: string;
  params?: Metadata;
}

export interface ConnectorItem {
  id: string;
  title: string;
  url?: string;
  summary?: string;
  raw?: Metadata;
}

export interface ConnectorResult {
  source: string;
  items: ConnectorItem[];
}

/**
 * PORT: external systems (Jira / Slack / Confluence).
 *
 * ADR-0072 ratifies ConnectorProvider as the canonical v1 READ-ONLY connector
 * boundary. Concrete Jira, Slack, and Confluence adapters live in separate
 * packages and are registered by the composition root only when their required
 * configuration is complete. Write methods are intentionally absent from this
 * interface; any future write seam remains approval-gated and never auto-invoked.
 */
export interface ConnectorProvider {
  /** e.g. "jira" | "slack" | "confluence". */
  readonly source: string;
  /** v1: always true. Write support is a deliberate later decision. */
  readonly readOnly: boolean;

  isAvailable(): Promise<boolean>;
  query(query: ConnectorQuery): Promise<ConnectorResult>;
}
