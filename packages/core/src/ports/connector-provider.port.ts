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
 * boundary. Concrete Jira and Slack adapters exist in separate packages but
 * remain unwired; only Confluence remains unimplemented. Write methods are
 * intentionally absent from this interface and will be added under the
 * HIGH-risk approval gate, never auto-invoked.
 */
export interface ConnectorProvider {
  /** e.g. "jira" | "slack" | "confluence". */
  readonly source: string;
  /** v1: always true. Write support is a deliberate later decision. */
  readonly readOnly: boolean;

  isAvailable(): Promise<boolean>;
  query(query: ConnectorQuery): Promise<ConnectorResult>;
}
