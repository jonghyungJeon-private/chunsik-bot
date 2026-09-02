import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import {
  TOOL_PROVIDERS, ToolManager,
  type ToolDescriptor, type ToolInvocation, type ToolProvider, type ToolResult,
} from '@chunsik/core';
import { toolManagerProvider } from './tool-manager-provider';
import { McpToolProvider, type McpClientSession } from '@chunsik/tool-mcp';

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
  it('composes the real MCP adapter asynchronously through real Nest and ToolManager', async () => {
    let callCount = 0;
    const session: McpClientSession = {
      listTools: () => Promise.resolve({ tools: [{
        name: 'lookup',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        outputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
      }, {
        name: 'unknown-effect', inputSchema: { type: 'object', properties: {} },
      }] } as never),
      callTool: (request) => {
        callCount += 1;
        return Promise.resolve({
          content: [], structuredContent: { value: `mcp:${String(request.arguments?.id)}` },
        } as never);
      },
      close: () => Promise.resolve(),
    };
    @Module({ providers: [
      {
        provide: TOOL_PROVIDERS,
        useFactory: async () => {
          const provider = new McpToolProvider({ serverId: 'offline-e2e', readOnlyTools: ['lookup'] }, session);
          await provider.initialize();
          return [provider] satisfies readonly ToolProvider[];
        },
      },
      toolManagerProvider,
    ] })
    class OfflineMcpE2eModule {}

    const app = await NestFactory.createApplicationContext(OfflineMcpE2eModule, { logger: false });
    try {
      const manager = app.get(ToolManager);
      expect(manager.discover().map(({ source, name, effect }) => [source, name, effect])).toEqual([
        ['mcp:offline-e2e', 'lookup', 'READ_ONLY'],
        ['mcp:offline-e2e', 'unknown-effect', 'MUTATING'],
      ]);
      await expect(manager.invoke('mcp:offline-e2e', {
        toolName: 'lookup', input: {}, actorId: 'actor-e2e',
      })).resolves.toMatchObject({ ok: false, failure: { code: 'INVALID_INPUT' } });
      await expect(manager.invoke('mcp:offline-e2e', {
        toolName: 'unknown-effect', input: {}, actorId: 'actor-e2e',
      })).resolves.toMatchObject({ ok: false, failure: { code: 'MUTATION_NOT_AUTHORIZED' } });
      expect(callCount).toBe(0);
      await expect(manager.invoke('mcp:offline-e2e', {
        toolName: 'lookup', input: { id: '42' }, actorId: 'actor-e2e',
      })).resolves.toEqual({ ok: true, output: { value: 'mcp:42' } });
      expect(callCount).toBe(1);
    } finally {
      await app.close();
    }
  });

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
