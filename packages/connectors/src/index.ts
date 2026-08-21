import type { ConnectorProvider } from '@chunsik/core';

/**
 * ADR-0072 SCOPE: ConnectorProvider is the canonical v1 READ-ONLY connector
 * seam. V1_CONNECTORS remains the legacy empty seam.
 *
 * Concrete Jira, Slack, and Confluence adapters live in separate packages and
 * are configuration-gated by the composition root in
 * apps/chunsik/src/connector-providers.ts.
 *
 * Write actions for these are deliberately NOT modeled yet and, when added,
 * will be HIGH risk and gated behind approval — never auto-invoked.
 */
export const V1_CONNECTORS: readonly ConnectorProvider[] = [];
