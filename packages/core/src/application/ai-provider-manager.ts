import type { Capability } from '../domain';
import type { AiProvider } from '../ports';

/**
 * Holds the SET of AiProviders injected by the composition root and answers
 * availability/capability questions. It does NOT know the concrete classes —
 * it only sees the AiProvider interface, so the fallback policy stays
 * data-driven (priorities advertised by providers), never hardcoded here.
 */
export class AiProviderManager {
  constructor(private readonly providers: readonly AiProvider[]) {}

  all(): readonly AiProvider[] {
    return this.providers;
  }

  /** Providers that currently pass their health/auth probe. */
  async available(): Promise<AiProvider[]> {
    const checks = await Promise.all(
      this.providers.map(async (p) => ({ p, ok: await this.safeProbe(p) })),
    );
    return checks.filter((c) => c.ok).map((c) => c.p);
  }

  /** Available providers that advertise support for a capability. */
  async availableFor(capability: Capability): Promise<AiProvider[]> {
    const available = await this.available();
    return available.filter((p) => p.capabilities.some((c) => c.capability === capability));
  }

  private async safeProbe(p: AiProvider): Promise<boolean> {
    try {
      return await p.isAvailable();
    } catch {
      // A throwing probe is treated as unavailable rather than crashing routing.
      return false;
    }
  }
}
