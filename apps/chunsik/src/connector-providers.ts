import { ConfluenceConnectorProvider } from '@chunsik/connector-confluence';
import { JiraConnectorProvider } from '@chunsik/connector-jira';
import { SlackConnectorProvider } from '@chunsik/connector-slack';
import type { ConnectorProvider } from '@chunsik/core';

import type { ChunsikConfig } from './config';

/** Construct only fully configured read-only connectors; partial configuration is safely ignored. */
export function createConnectorProviders(config: ChunsikConfig['connectors']): readonly ConnectorProvider[] {
  const connectors: ConnectorProvider[] = [];

  if (config.jira) {
    try {
      connectors.push(new JiraConnectorProvider(config.jira));
    } catch {
      // Invalid optional connector config must not prevent unrelated application flows from starting.
    }
  }
  if (config.slack) {
    try {
      connectors.push(new SlackConnectorProvider(config.slack));
    } catch {
      // Invalid optional connector config must not prevent unrelated application flows from starting.
    }
  }
  if (config.confluence) {
    try {
      connectors.push(new ConfluenceConnectorProvider(config.confluence));
    } catch {
      // Invalid optional connector config must not prevent unrelated application flows from starting.
    }
  }

  return connectors;
}
