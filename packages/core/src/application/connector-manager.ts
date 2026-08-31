import type { ConnectorProvider, ConnectorQuery, ConnectorResult } from '../ports';

/**
 * Registry over ConnectorProviders. Jira, Slack, and Confluence read adapters
 * are injected by the composition root when their configuration is complete;
 * Core remains independent of every concrete connector.
 */
export class ConnectorManager {
  constructor(private readonly connectors: readonly ConnectorProvider[] = []) {}

  list(): readonly ConnectorProvider[] {
    return this.connectors;
  }

  has(source: string): boolean {
    return this.connectors.some((c) => c.source === source);
  }

  async query(source: string, query: ConnectorQuery): Promise<ConnectorResult> {
    const connector = this.connectors.find((c) => c.source === source);
    if (!connector) {
      // A connector may be absent because its configuration is incomplete.
      return { source, items: [] };
    }
    return connector.query(query);
  }
}
