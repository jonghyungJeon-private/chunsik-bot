import { ConfluenceConnectorProvider } from '@quoky/connector-confluence';
import { JiraConnectorProvider } from '@quoky/connector-jira';
import { SlackConnectorProvider } from '@quoky/connector-slack';
import type { ConnectorProvider, Logger } from '@quoky/core';

import type { QuokyConfig } from './config';

function registerConnector(
  connectors: ConnectorProvider[],
  source: string,
  create: () => ConnectorProvider,
  logger: Logger,
): void {
  try {
    connectors.push(create());
  } catch (error) {
    logger.warn('connector configuration rejected; connector not registered', {
      source,
      reason: error instanceof Error ? error.message : 'unknown configuration error',
    });
  }
}

/** Construct only fully configured read-only connectors; partial configuration is safely ignored. */
export function createConnectorProviders(
  config: QuokyConfig['connectors'],
  logger: Logger,
): readonly ConnectorProvider[] {
  const connectors: ConnectorProvider[] = [];

  if (config.jira) {
    const jira = config.jira;
    registerConnector(connectors, 'jira', () => new JiraConnectorProvider(jira), logger);
  }
  if (config.slack) {
    const slack = config.slack;
    registerConnector(connectors, 'slack', () => new SlackConnectorProvider(slack), logger);
  }
  if (config.confluence) {
    const confluence = config.confluence;
    registerConnector(connectors, 'confluence', () => new ConfluenceConnectorProvider(confluence), logger);
  }

  return connectors;
}
