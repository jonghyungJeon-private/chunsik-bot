import { describe, expect, it } from 'vitest';
import { CapabilityRouter } from './capability-router';
import { AiProviderManager } from './ai-provider-manager';
import { Capability } from '../domain';
import type { AiCapabilityDescriptor } from '../ports';
import type { AiProvider } from '../ports';

const provider = (
  id: string,
  capabilities: AiCapabilityDescriptor[],
  available = true,
): AiProvider => ({
  id,
  capabilities,
  isAvailable: async () => available,
  execute: async () => ({ text: '' }),
});

describe('CapabilityRouter', () => {
  it('selects the highest-priority available provider for the capability', async () => {
    const a = provider('a', [{ capability: Capability.GENERAL_CHAT, priority: 50 }]);
    const b = provider('b', [{ capability: Capability.GENERAL_CHAT, priority: 100 }]);
    const router = new CapabilityRouter(new AiProviderManager([a, b]));
    expect((await router.select(Capability.GENERAL_CHAT)).id).toBe('b');
  });

  it('skips unavailable providers even if higher priority', async () => {
    const a = provider('a', [{ capability: Capability.GENERAL_CHAT, priority: 100 }], false);
    const b = provider('b', [{ capability: Capability.GENERAL_CHAT, priority: 50 }], true);
    const router = new CapabilityRouter(new AiProviderManager([a, b]));
    expect((await router.select(Capability.GENERAL_CHAT)).id).toBe('b');
  });

  it('throws when no available provider serves the capability', async () => {
    const a = provider('a', [{ capability: Capability.GENERAL_CHAT, priority: 100 }]);
    const router = new CapabilityRouter(new AiProviderManager([a]));
    await expect(router.select(Capability.CODE_IMPLEMENTATION)).rejects.toThrow();
  });
});
