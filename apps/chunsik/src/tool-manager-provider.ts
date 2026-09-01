import type { Provider } from '@nestjs/common';
import { TOOL_PROVIDERS, ToolManager, type ToolProvider } from '@chunsik/core';

/** Shared production/test composition definition for the CAP-012 Core boundary. */
export const toolManagerProvider: Provider = {
  provide: ToolManager,
  useFactory: (providers: readonly ToolProvider[]) => new ToolManager(providers),
  inject: [TOOL_PROVIDERS],
};
