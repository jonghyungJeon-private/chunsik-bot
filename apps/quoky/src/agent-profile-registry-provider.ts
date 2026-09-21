import type { Provider } from '@nestjs/common';
import { AgentProfileRegistry } from '@quoky/core';

/** M3D-1 composition-time configuration. No production AgentProfile is configured yet. */
export const agentProfileRegistryProvider: Provider = {
  provide: AgentProfileRegistry,
  useFactory: () => new AgentProfileRegistry([]),
};
