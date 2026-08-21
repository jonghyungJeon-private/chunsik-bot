import { ConfluenceConnectorProvider } from '@chunsik/connector-confluence';
import { JiraConnectorProvider } from '@chunsik/connector-jira';
import { SlackConnectorProvider } from '@chunsik/connector-slack';
import type { ConnectorProvider } from '@chunsik/core';

import type { ChunsikConfig } from './config';

/** Construct only fully configured read-only connectors; partial configuration is safely ignored. */
export function createConnectorProviders(config: ChunsikConfig['connectors']): readonly ConnectorProvider[] {
  const connectors: ConnectorProvider[] = [];

  if (config.jira) connectors.push(new JiraConnectorProvider(config.jira));
  if (config.slack) connectors.push(new SlackConnectorProvider(config.slack));
  if (config.confluence) connectors.push(new ConfluenceConnectorProvider(config.confluence));

  return connectors;
}
