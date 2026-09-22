import type { Provider } from '@nestjs/common';
import { AgentProfileRegistry } from '@quoky/core';
import type { AgentProfile } from '@quoky/core';

/**
 * ADR-0089 composition-time AgentProfile configuration (M3D-1 registry, M3E-6H configuration surface).
 * The validated `QUOKY_AGENT_PROFILES` list becomes ONE immutable startup snapshot: the registry copies and
 * freezes its input, so later mutation of the source array or objects cannot affect it. There is no
 * register/replace/remove/reload API, no persistence and no runtime authority. An absent or empty
 * configuration yields an empty registry, so continuation lookup stays fail-closed exactly as before.
 * Configured personas grant no capability, Provider selection, Tool authority or execution permission.
 */
export function createAgentProfileRegistryProvider(profiles: readonly AgentProfile[] = []): Provider {
  return {
    provide: AgentProfileRegistry,
    useFactory: () => new AgentProfileRegistry(profiles),
  };
}
