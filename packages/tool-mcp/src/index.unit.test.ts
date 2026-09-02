import type { CallToolResult, Tool } from '@modelcontextprotocol/client';
import type { ToolInvocation } from '@chunsik/core';
import { describe, expect, it } from 'vitest';
import {
  McpInitializationError, McpToolProvider, OfficialMcpClientSession, type McpClientSession,
} from './index';

class FakeSession implements McpClientSession {
  listCount = 0;
  callCount = 0;
  closeCount = 0;
  lastCall: { readonly name: string; readonly arguments?: Readonly<Record<string, unknown>> } | undefined;
  tools: readonly Tool[] = [];
  result: CallToolResult = { content: [{ type: 'text', text: 'ok' }] } as CallToolResult;
  listError = false;
  callError = false;

  listTools(): Promise<{ readonly tools: readonly Tool[] }> {
    this.listCount += 1;
    return this.listError ? Promise.reject(new Error('raw discovery detail')) : Promise.resolve({ tools: this.tools });
  }
  callTool(request: { readonly name: string; readonly arguments?: Readonly<Record<string, unknown>> }):
    Promise<CallToolResult> {
    this.callCount += 1;
    this.lastCall = request;
    return this.callError ? Promise.reject(new Error('raw call detail')) : Promise.resolve(this.result);
  }
  close(): Promise<void> { this.closeCount += 1; return Promise.resolve(); }
}

const objectSchema = {
  type: 'object' as const,
  properties: { id: { type: 'string' as const } },
  required: ['id'],
};
function discovered(name: string, overrides: Partial<Tool> = {}): Tool {
  return { name, inputSchema: objectSchema, ...overrides } as Tool;
}
function invocation(toolName: string, input: ToolInvocation['input'] = { id: '42' }): ToolInvocation {
  return { toolName, input, actorId: 'actor-test' };
}

describe('McpToolProvider unit', () => {
  it('wraps the official Client surface without constructing or connecting a transport', async () => {
    const calls: unknown[] = [];
    let closeCount = 0;
    const client = {
      listTools: () => Promise.resolve({ tools: [discovered('exact/name')] }),
      callTool: (request: unknown) => {
        calls.push(request);
        return Promise.resolve({ content: [{ type: 'text', text: 'ok' }] });
      },
      close: () => { closeCount += 1; return Promise.resolve(); },
    } as never;
    const session = new OfficialMcpClientSession(client);
    await expect(session.listTools()).resolves.toMatchObject({ tools: [{ name: 'exact/name' }] });
    await session.callTool({ name: 'exact/name', arguments: { id: '42' } });
    expect(calls).toEqual([{ name: 'exact/name', arguments: { id: '42' } }]);
    await session.close();
    expect(closeCount).toBe(1);
  });

  it('discovers atomically, maps an allow-listed non-contradicted tool READ_ONLY, and freezes its snapshot', async () => {
    const session = new FakeSession();
    session.tools = [discovered('lookup', { outputSchema: {
      type: 'object', properties: { value: { type: 'string' } }, required: ['value'],
    } })];
    session.result = { content: [], structuredContent: { value: 'answer' } } as CallToolResult;
    const provider = new McpToolProvider({ serverId: 'trusted.server', readOnlyTools: ['lookup'] }, session);

    expect(() => provider.listTools()).toThrowError(McpInitializationError);
    await provider.initialize();
    await provider.initialize();
    const snapshot = provider.listTools();
    expect(session.listCount).toBe(1);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot[0])).toBe(true);
    expect(snapshot).toEqual([{
      source: 'mcp:trusted.server', name: 'lookup', effect: 'READ_ONLY', inputSchema: objectSchema,
      outputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
    }]);
    await expect(provider.invoke(invocation('lookup'))).resolves.toEqual({ ok: true, output: { value: 'answer' } });
    expect(session.lastCall).toEqual({ name: 'lookup', arguments: { id: '42' } });
  });

  it('does not authorize READ_ONLY from annotations and fails contradictory configured metadata closed', async () => {
    const session = new FakeSession();
    session.tools = [
      discovered('hint-only', { annotations: { readOnlyHint: true } }),
      discovered('contradicted', { annotations: { readOnlyHint: false } }),
      discovered('destructive', { annotations: { destructiveHint: true } }),
    ];
    const provider = new McpToolProvider({
      serverId: 'effects', readOnlyTools: ['contradicted', 'destructive'],
    }, session);
    await provider.initialize();
    expect(provider.listTools().map(({ name, effect }) => [name, effect])).toEqual([
      ['hint-only', 'MUTATING'], ['contradicted', 'MUTATING'], ['destructive', 'MUTATING'],
    ]);
  });

  it.each([
    [[discovered('same'), discovered('same')], 'DUPLICATE_TOOL_IDENTITY'],
    [[discovered(' padded ')], 'UNREPRESENTABLE_TOOL_IDENTITY'],
    [[discovered('enum', { inputSchema: {
      type: 'object', properties: { state: { type: 'string', enum: ['open'] } },
    } as Tool['inputSchema'] })], 'UNREPRESENTABLE_TOOL_SCHEMA'],
    [[discovered('union', { inputSchema: {
      type: 'object', properties: { value: { oneOf: [{ type: 'string' }] } },
    } as Tool['inputSchema'] })], 'UNREPRESENTABLE_TOOL_SCHEMA'],
  ] as const)('rejects invalid discovery atomically (%s)', async (tools, code) => {
    const session = new FakeSession();
    session.tools = tools;
    const provider = new McpToolProvider({ serverId: 'invalid' }, session);
    await expect(provider.initialize()).rejects.toMatchObject({ code });
    expect(() => provider.listTools()).toThrowError(McpInitializationError);
  });

  it('contains discovery and call failures without leaking raw details', async () => {
    const discoverySession = new FakeSession();
    discoverySession.listError = true;
    const undiscovered = new McpToolProvider({ serverId: 'down' }, discoverySession);
    await expect(undiscovered.initialize()).rejects.toEqual(
      new McpInitializationError('DISCOVERY_FAILED'),
    );

    const callSession = new FakeSession();
    callSession.tools = [discovered('lookup')];
    callSession.callError = true;
    const provider = new McpToolProvider({ serverId: 'call', readOnlyTools: ['lookup'] }, callSession);
    await provider.initialize();
    const result = await provider.invoke(invocation('lookup'));
    expect(result).toMatchObject({ ok: false, failure: { code: 'EXECUTION_FAILED' } });
    expect(JSON.stringify(result)).not.toContain('raw call detail');
  });

  it('projects bounded text and rejects unsupported or malformed output', async () => {
    const session = new FakeSession();
    session.tools = [discovered('lookup')];
    const provider = new McpToolProvider({ serverId: 'output', readOnlyTools: ['lookup'] }, session);
    await provider.initialize();
    session.result = { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } as CallToolResult;
    await expect(provider.invoke(invocation('lookup'))).resolves.toEqual({ ok: true, output: { text: ['a', 'b'] } });
    session.result = { content: [{ type: 'image', data: 'secret', mimeType: 'image/png' }] } as CallToolResult;
    await expect(provider.invoke(invocation('lookup'))).resolves.toMatchObject({
      ok: false, failure: { code: 'OUTPUT_INVALID' },
    });
    session.result = { content: [], structuredContent: { invalid: Number.NaN } } as CallToolResult;
    await expect(provider.invoke(invocation('lookup'))).resolves.toMatchObject({
      ok: false, failure: { code: 'OUTPUT_INVALID' },
    });
  });

  it('closes exactly once and becomes unavailable', async () => {
    const session = new FakeSession();
    session.tools = [discovered('lookup')];
    const provider = new McpToolProvider({ serverId: 'lifecycle' }, session);
    await provider.initialize();
    await Promise.all([provider.close(), provider.close()]);
    expect(session.closeCount).toBe(1);
    await expect(provider.isAvailable()).resolves.toBe(false);
    expect(() => provider.listTools()).toThrowError(McpInitializationError);
  });
});
