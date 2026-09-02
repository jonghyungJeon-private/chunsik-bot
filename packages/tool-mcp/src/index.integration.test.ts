import type { CallToolResult, Tool } from '@modelcontextprotocol/client';
import { ToolManager, type ToolInvocation } from '@chunsik/core';
import { describe, expect, it } from 'vitest';
import { McpToolProvider, type McpClientSession } from './index';

class IntegrationSession implements McpClientSession {
  callCount = 0;
  readonly tools = [
    { name: 'lookup', inputSchema: {
      type: 'object', properties: { id: { type: 'string' } }, required: ['id'],
    }, outputSchema: {
      type: 'object', properties: { value: { type: 'string' } }, required: ['value'],
    } },
    { name: 'unknown-effect', inputSchema: { type: 'object', properties: {} } },
  ] as readonly Tool[];
  listTools(): Promise<{ readonly tools: readonly Tool[] }> { return Promise.resolve({ tools: this.tools }); }
  callTool(request: { readonly name: string; readonly arguments?: Readonly<Record<string, unknown>> }):
    Promise<CallToolResult> {
    this.callCount += 1;
    return Promise.resolve({ content: [], structuredContent: {
      value: `value:${String(request.arguments?.id)}`,
    } } as CallToolResult);
  }
  close(): Promise<void> { return Promise.resolve(); }
}

const request = (toolName: string, input: ToolInvocation['input']): ToolInvocation => ({
  toolName, input, actorId: 'actor-integration',
});

describe('McpToolProvider + real ToolManager integration', () => {
  it('keeps validation and mutation gates ahead of the MCP call', async () => {
    const session = new IntegrationSession();
    const provider = new McpToolProvider({ serverId: 'integration', readOnlyTools: ['lookup'] }, session);
    await provider.initialize();
    const manager = new ToolManager([provider]);
    await expect(manager.invoke(provider.source, request('lookup', {}))).resolves.toMatchObject({
      ok: false, failure: { code: 'INVALID_INPUT' },
    });
    await expect(manager.invoke(provider.source, request('unknown-effect', {}))).resolves.toMatchObject({
      ok: false, failure: { code: 'MUTATION_NOT_AUTHORIZED' },
    });
    expect(session.callCount).toBe(0);
    await expect(manager.invoke(provider.source, request('lookup', { id: '42' }))).resolves.toEqual({
      ok: true, output: { value: 'value:42' },
    });
    expect(session.callCount).toBe(1);
  });

  it('lets ToolManager reject adapter output against the discovered output schema', async () => {
    const session = new IntegrationSession();
    session.callTool = () => Promise.resolve({ content: [], structuredContent: { value: 42 } } as CallToolResult);
    const provider = new McpToolProvider({ serverId: 'bad-output', readOnlyTools: ['lookup'] }, session);
    await provider.initialize();
    await expect(new ToolManager([provider]).invoke(provider.source, request('lookup', { id: '42' })))
      .resolves.toMatchObject({ ok: false, failure: { code: 'OUTPUT_INVALID' } });
  });
});
