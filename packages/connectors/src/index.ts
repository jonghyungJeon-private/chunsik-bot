import type { ConnectorProvider } from '@chunsik/core';

/**
 * ADR-0072 SCOPE: ConnectorProvider is the canonical v1 READ-ONLY connector
 * seam. Concrete adapters live in separate packages; the composition root
 * injects this empty list into ConnectorManager pending explicit wiring approval.
 *
 * JiraConnectorProvider (source: 'jira') and SlackConnectorProvider (source:
 * 'slack') now exist in separate adapter packages but are not included in
 * V1_CONNECTORS. The Confluence adapter remains unimplemented.
 *
 * Write actions for these are deliberately NOT modeled yet and, when added,
 * will be HIGH risk and gated behind approval — never auto-invoked.
 */
export const V1_CONNECTORS: readonly ConnectorProvider[] = [];
