import { ConfluenceConnectorProvider } from '@chunsik/connector-confluence';
import { JiraConnectorProvider } from '@chunsik/connector-jira';
import { SlackConnectorProvider } from '@chunsik/connector-slack';
import type { ConnectorProvider, Logger } from '@chunsik/core';

import type { ChunsikConfig } from './config';

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
  config: ChunsikConfig['connectors'],
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
