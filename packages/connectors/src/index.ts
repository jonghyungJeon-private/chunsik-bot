import type { ConnectorProvider } from '@chunsik/core';

/**
 * v1 SCOPE: ZERO connectors. This package exists only to mark the extension
 * seam. The composition root injects this (empty) list into ConnectorManager.
 *
 * When connectors are added they go HERE, implementing ConnectorProvider, and
 * are READ-ONLY first (`readOnly: true`). Examples to come:
 *   - JiraConnectorProvider       (source: 'jira')
 *   - SlackConnectorProvider      (source: 'slack')
 *   - ConfluenceConnectorProvider (source: 'confluence')
 *
 * Write actions for these are deliberately NOT modeled yet and, when added,
 * will be HIGH risk and gated behind approval — never auto-invoked.
 */
export const V1_CONNECTORS: readonly ConnectorProvider[] = [];
