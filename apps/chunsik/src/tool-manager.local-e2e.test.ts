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

async function createMcpApplication(
  session: McpClientSession,
  serverId: string,
): Promise<Awaited<ReturnType<typeof NestFactory.createApplicationContext>>> {
  @Module({ providers: [
    {
      provide: TOOL_PROVIDERS,
      useFactory: async () => {
        const provider = new McpToolProvider({ serverId, readOnlyTools: ['lookup'] }, session);
        await provider.initialize();
        return [provider] satisfies readonly ToolProvider[];
      },
    },
    toolManagerProvider,
  ] })
  class OfflineMcpScenarioModule {}

  return NestFactory.createApplicationContext(OfflineMcpScenarioModule, {
    logger: false,
    abortOnError: false,
  });
}

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

  it('fails duplicate MCP discovery atomically during async real composition', async () => {
    const session: McpClientSession = {
      listTools: () => Promise.resolve({ tools: [
        { name: 'lookup', inputSchema: { type: 'object', properties: {} } },
        { name: 'lookup', inputSchema: { type: 'object', properties: {} } },
      ] } as never),
      callTool: () => Promise.resolve({ content: [] } as never),
      close: () => Promise.resolve(),
    };
    const provider = new McpToolProvider({ serverId: 'duplicate-e2e' }, session);

    await expect(createMcpApplication(session, 'duplicate-e2e')).rejects.toMatchObject({
      code: 'DUPLICATE_TOOL_IDENTITY',
    });
    await expect(provider.initialize()).rejects.toMatchObject({ code: 'DUPLICATE_TOOL_IDENTITY' });
    expect(() => provider.listTools()).toThrowError(/DISCOVERY_FAILED/);
  });

  it.each([
    ['enum', { type: 'object', properties: { state: { type: 'string', enum: ['open'] } } }],
    ['oneOf', { type: 'object', properties: { value: { oneOf: [{ type: 'string' }] } } }],
  ])('fails unsupported MCP %s schema during async real composition', async (_name, inputSchema) => {
    const session: McpClientSession = {
      listTools: () => Promise.resolve({ tools: [{ name: 'lookup', inputSchema }] } as never),
      callTool: () => Promise.resolve({ content: [] } as never),
      close: () => Promise.resolve(),
    };

    await expect(createMcpApplication(session, 'schema-e2e')).rejects.toMatchObject({
      code: 'UNREPRESENTABLE_TOOL_SCHEMA',
    });
  });

  it('keeps discovery failure atomic during async real composition', async () => {
    const session: McpClientSession = {
      listTools: () => Promise.reject(new Error('raw discovery detail')),
      callTool: () => Promise.resolve({ content: [] } as never),
      close: () => Promise.resolve(),
    };
    const provider = new McpToolProvider({ serverId: 'discovery-e2e' }, session);

    await expect(createMcpApplication(session, 'discovery-e2e')).rejects.toMatchObject({
      code: 'DISCOVERY_FAILED',
    });
    await expect(provider.initialize()).rejects.toMatchObject({ code: 'DISCOVERY_FAILED' });
    expect(() => provider.listTools()).toThrowError(/DISCOVERY_FAILED/);
  });

  it('bounds MCP call failures through the real Nest-resolved ToolManager', async () => {
    const session: McpClientSession = {
      listTools: () => Promise.resolve({ tools: [{
        name: 'lookup', inputSchema: { type: 'object', properties: {} },
      }] } as never),
      callTool: () => Promise.reject(new Error('raw SDK transport detail')),
      close: () => Promise.resolve(),
    };
    const app = await createMcpApplication(session, 'call-failure-e2e');
    try {
      const result = await app.get(ToolManager).invoke('mcp:call-failure-e2e', {
        toolName: 'lookup', input: {}, actorId: 'actor-e2e',
      });
      expect(result).toEqual({
        ok: false,
        failure: { code: 'EXECUTION_FAILED', message: 'The tool execution failed.' },
      });
      expect(JSON.stringify(result)).not.toContain('raw SDK transport detail');
    } finally {
      await app.close();
    }
  });

  it.each([
    ['image', { content: [{ type: 'image', data: 'offline', mimeType: 'image/png' }] }],
    ['NaN', { content: [], structuredContent: { value: Number.NaN } }],
  ])('rejects unsupported MCP %s output through the real Nest-resolved ToolManager', async (_name, response) => {
    const session: McpClientSession = {
      listTools: () => Promise.resolve({ tools: [{
        name: 'lookup', inputSchema: { type: 'object', properties: {} },
      }] } as never),
      callTool: () => Promise.resolve(response as never),
      close: () => Promise.resolve(),
    };
    const app = await createMcpApplication(session, 'output-e2e');
    try {
      await expect(app.get(ToolManager).invoke('mcp:output-e2e', {
        toolName: 'lookup', input: {}, actorId: 'actor-e2e',
      })).resolves.toMatchObject({ ok: false, failure: { code: 'OUTPUT_INVALID' } });
    } finally {
      await app.close();
    }
  });
});
