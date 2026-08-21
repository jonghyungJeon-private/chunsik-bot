import type { ConnectorProvider } from '@chunsik/core';

/**
 * ADR-0072 SCOPE: ConnectorProvider is the canonical v1 READ-ONLY connector
 * seam. Concrete adapters live in separate packages; the composition root
 * injects this empty list into ConnectorManager pending explicit wiring approval.
 *
 * JiraConnectorProvider (source: 'jira') now exists in @chunsik/connector-jira
 * but is not included in V1_CONNECTORS. Slack and Confluence adapters remain
 * unimplemented.
 *
 * Write actions for these are deliberately NOT modeled yet and, when added,
 * will be HIGH risk and gated behind approval — never auto-invoked.
 */
export const V1_CONNECTORS: readonly ConnectorProvider[] = [];
