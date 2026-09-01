import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import {
  TOOL_PROVIDERS, ToolManager,
  type ToolDescriptor, type ToolInvocation, type ToolProvider, type ToolResult,
} from '@chunsik/core';
import { toolManagerProvider } from './tool-manager-provider';

const descriptors: readonly ToolDescriptor[] = [
  {
    source: 'local-e2e-fake', name: 'inspect', effect: 'READ_ONLY',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    outputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
  },
  {
    source: 'local-e2e-fake', name: 'change', effect: 'MUTATING',
    inputSchema: { type: 'object', properties: {} },
  },
];

class OfflineFakeToolProvider implements ToolProvider {
  readonly source = 'local-e2e-fake';
  invokeCount = 0;
  available = true;
  isAvailable(): Promise<boolean> { return Promise.resolve(this.available); }
  listTools(): readonly ToolDescriptor[] { return descriptors; }
  invoke(request: ToolInvocation): Promise<ToolResult> {
    this.invokeCount += 1;
    return Promise.resolve({ ok: true, output: { value: `value:${String((request.input as { id: string }).id)}` } });
  }
}

const fake = new OfflineFakeToolProvider();

@Module({
  providers: [
    { provide: TOOL_PROVIDERS, useValue: [fake] satisfies readonly ToolProvider[] },
    toolManagerProvider,
  ],
})
class OfflineToolE2eModule {}

describe('CAP-012 local E2E (ephemeral, offline)', () => {
  it('exercises real Nest composition, ToolManager registry/schema policy, and ToolProvider invocation', async () => {
    const app = await NestFactory.createApplicationContext(OfflineToolE2eModule, { logger: false });
    try {
      const manager = app.get(ToolManager);
      expect(manager.discover().map(({ source, name }) => `${source}:${name}`)).toEqual([
        'local-e2e-fake:inspect', 'local-e2e-fake:change',
      ]);
      fake.invokeCount = 0;
      await expect(manager.invoke('local-e2e-fake', {
        toolName: 'inspect', input: { id: '42' }, actorId: 'actor-e2e',
      })).resolves.toEqual({ ok: true, output: { value: 'value:42' } });
      expect(fake.invokeCount).toBe(1);
      await expect(manager.invoke('local-e2e-fake', {
        toolName: 'inspect', input: {}, actorId: 'actor-e2e',
      })).resolves.toMatchObject({ ok: false, failure: { code: 'INVALID_INPUT' } });
      expect(fake.invokeCount).toBe(1);
      await expect(manager.invoke('local-e2e-fake', {
        toolName: 'change', input: {}, actorId: 'actor-e2e',
      })).resolves.toMatchObject({ ok: false, failure: { code: 'MUTATION_NOT_AUTHORIZED' } });
      expect(fake.invokeCount).toBe(1);
      fake.available = false;
      await expect(manager.invoke('local-e2e-fake', {
        toolName: 'inspect', input: { id: '42' }, actorId: 'actor-e2e',
      })).resolves.toMatchObject({ ok: false, failure: { code: 'TOOL_UNAVAILABLE' } });
      expect(fake.invokeCount).toBe(1);
    } finally {
      await app.close();
      fake.available = true;
    }
  });

  it('fails duplicate composite identity deterministically during real DI construction', async () => {
    const duplicateToolProvider: ToolProvider = {
      source: 'local-e2e-fake',
      isAvailable: () => Promise.resolve(true),
      listTools: () => [descriptors[0]!, descriptors[0]!],
      invoke: () => Promise.resolve({ ok: true, output: null }),
    };
    @Module({ providers: [
      {
        provide: TOOL_PROVIDERS,
        useValue: [duplicateToolProvider] satisfies readonly ToolProvider[],
      },
      toolManagerProvider,
    ] })
    class DuplicateIdentityModule {}

    await expect(NestFactory.createApplicationContext(DuplicateIdentityModule, {
      logger: false,
      abortOnError: false,
    })).rejects.toThrow(
      'Duplicate tool identity: local-e2e-fake:inspect',
    );
  });
});
