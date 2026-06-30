import type { Capability } from '../domain';
import type { AiProvider } from './ai-provider.port';

/**
 * PORT: selects an AiProvider for a capability (CAP-008, ADR-0029). The provider-
 * selection responsibility, separated from any single router implementation so a
 * capability depends on the SELECTION CONTRACT, not on a concrete router:
 *
 *   Capability → ProviderSelector → AiProvider
 *
 * v2 implementation: `CapabilityRouter` (highest-priority available provider). The
 * core never names a concrete CLI; selection stays policy-driven.
 */
export interface ProviderSelector {
  select(capability: Capability): Promise<AiProvider>;
}
