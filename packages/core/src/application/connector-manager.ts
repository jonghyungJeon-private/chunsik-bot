import type { ConnectorProvider, ConnectorQuery, ConnectorResult } from '../ports';

/**
 * Registry over ConnectorProviders. v1 ships ZERO connectors — this exists only
 * to define the extension seam. When Jira/Slack/Confluence arrive (read-only
 * first), they are injected here without any core change.
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
      // v1: no connectors registered. Return an empty, well-formed result.
      return { source, items: [] };
    }
    return connector.query(query);
  }
}
