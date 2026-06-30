import { NoProviderAvailableError } from '../errors';
import type { Capability } from '../domain';
import type { AiProvider, ProviderSelector } from '../ports';
import type { AiProviderManager } from './ai-provider-manager';

/**
 * Selects an AiProvider for a capability — the `ProviderSelector` implementation
 * (CAP-008, ADR-0029). This is the concrete expression of "capabilities are above
 * models": the core asks for a CAPABILITY and the router returns whichever AVAILABLE
 * provider advertises the highest priority for it. No concrete CLI name appears here —
 * the fallback policy lives in the priorities each provider advertises (see
 * AiCapabilityDescriptor docs).
 */
export class CapabilityRouter implements ProviderSelector {
  constructor(private readonly manager: AiProviderManager) {}

  async select(capability: Capability): Promise<AiProvider> {
    const candidates = await this.manager.availableFor(capability);
    if (candidates.length === 0) {
      throw new NoProviderAvailableError(capability);
    }
    candidates.sort((a, b) => this.priority(b, capability) - this.priority(a, capability));
    // Non-null: length checked above; noUncheckedIndexedAccess-safe via assertion.
    return candidates[0] as AiProvider;
  }

  private priority(provider: AiProvider, capability: Capability): number {
    const desc = provider.capabilities.find((c) => c.capability === capability);
    return desc ? desc.priority : Number.NEGATIVE_INFINITY;
  }
}
