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
 * v1 SCOPE: this is an EXTENSION POINT ONLY. No concrete connector ships in v1.
 * When connectors arrive they are READ-ONLY first (`readOnly: true`); write
 * methods are intentionally absent from this interface and will be added under
 * the HIGH-risk approval gate, never auto-invoked.
 */
export interface ConnectorProvider {
  /** e.g. "jira" | "slack" | "confluence". */
  readonly source: string;
  /** v1: always true. Write support is a deliberate later decision. */
  readonly readOnly: boolean;

  isAvailable(): Promise<boolean>;
  query(query: ConnectorQuery): Promise<ConnectorResult>;
}
