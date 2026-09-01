import { describe, expect, it } from 'vitest';
import type { ToolDescriptor, ToolInvocation, ToolProvider, ToolResult } from '..';
import { ToolManager } from './tool-manager';

const readTool: ToolDescriptor = {
  source: 'fake', name: 'lookup', effect: 'READ_ONLY',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  outputSchema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
};
const mutatingTool: ToolDescriptor = {
  source: 'fake', name: 'update', effect: 'MUTATING', inputSchema: { type: 'object', properties: {} },
};
const request = (toolName = 'lookup', input: ToolInvocation['input'] = { query: 'status' }): ToolInvocation =>
  ({ toolName, input, actorId: 'actor-1' });

class FakeToolProvider implements ToolProvider {
  invokeCount = 0;
  constructor(
    readonly source: string,
    private readonly tools: readonly ToolDescriptor[],
    private readonly available = true,
    private readonly result: ToolResult = { ok: true, output: { answer: 'ready' } },
    private readonly rawError?: Error,
  ) {}
  async isAvailable(): Promise<boolean> { return this.available; }
  listTools(): readonly ToolDescriptor[] { return this.tools; }
  async invoke(_request: ToolInvocation): Promise<ToolResult> {
    this.invokeCount += 1;
    if (this.rawError) throw this.rawError;
    return this.result;
  }
}

describe('ToolManager', () => {
  it('rejects duplicate provider sources and duplicate composite tool identities', () => {
    expect(() => new ToolManager([
      new FakeToolProvider('fake', [readTool]), new FakeToolProvider('fake', []),
    ])).toThrow('Duplicate tool provider source: fake');
    expect(() => new ToolManager([
      new FakeToolProvider('fake', [readTool, { ...readTool }]),
    ])).toThrow('Duplicate tool identity: fake:lookup');
  });

  it('keeps distinct source/name tuples distinct even when identity parts contain NUL', async () => {
    const first = new FakeToolProvider('a', [{ ...readTool, source: 'a', name: 'b\u0000c' }]);
    const second = new FakeToolProvider('a\u0000b', [{ ...readTool, source: 'a\u0000b', name: 'c' }]);
    const manager = new ToolManager([first, second]);

    await expect(manager.invoke('a', request('b\u0000c'))).resolves.toMatchObject({ ok: true });
    await expect(manager.invoke('a\u0000b', request('c'))).resolves.toMatchObject({ ok: true });
    expect(first.invokeCount).toBe(1);
    expect(second.invokeCount).toBe(1);
  });

  it('discovers an immutable deterministic snapshot', () => {
    const manager = new ToolManager([new FakeToolProvider('fake', [readTool, mutatingTool])]);
    expect(manager.discover()).toEqual([readTool, mutatingTool]);
    expect(Object.isFrozen(manager.discover())).toBe(true);
    expect(Object.isFrozen(manager.discover()[0]?.inputSchema)).toBe(true);
  });

  it('delegates a valid READ_ONLY invocation', async () => {
    const provider = new FakeToolProvider('fake', [readTool]);
    await expect(new ToolManager([provider]).invoke('fake', request())).resolves.toEqual({
      ok: true, output: { answer: 'ready' },
    });
    expect(provider.invokeCount).toBe(1);
  });

  it('returns INVALID_INPUT without invoking the provider', async () => {
    const provider = new FakeToolProvider('fake', [readTool]);
    await expect(new ToolManager([provider]).invoke('fake', request('lookup', {}))).resolves.toMatchObject({
      ok: false, failure: { code: 'INVALID_INPUT' },
    });
    expect(provider.invokeCount).toBe(0);
  });

  it('fails MUTATING tools closed without invoking the provider', async () => {
    const provider = new FakeToolProvider('fake', [mutatingTool]);
    await expect(new ToolManager([provider]).invoke('fake', request('update', {}))).resolves.toMatchObject({
      ok: false, failure: { code: 'MUTATION_NOT_AUTHORIZED' },
    });
    expect(provider.invokeCount).toBe(0);
  });

  it('classifies unavailable providers and unknown tools', async () => {
    const provider = new FakeToolProvider('fake', [readTool], false);
    await expect(new ToolManager([provider]).invoke('fake', request())).resolves.toMatchObject({
      ok: false, failure: { code: 'TOOL_UNAVAILABLE' },
    });
    expect(provider.invokeCount).toBe(0);
    await expect(new ToolManager([provider]).invoke('fake', request('missing'))).resolves.toMatchObject({
      ok: false, failure: { code: 'TOOL_NOT_FOUND' },
    });
  });

  it('returns OUTPUT_INVALID for a declared output-schema violation', async () => {
    const provider = new FakeToolProvider('fake', [readTool], true, { ok: true, output: { answer: 42 } });
    await expect(new ToolManager([provider]).invoke('fake', request())).resolves.toMatchObject({
      ok: false, failure: { code: 'OUTPUT_INVALID' },
    });
  });

  it('contains raw provider errors and stack traces', async () => {
    const provider = new FakeToolProvider('fake', [readTool], true, undefined, new Error('secret raw detail'));
    const result = await new ToolManager([provider]).invoke('fake', request());
    expect(result).toEqual({
      ok: false, failure: { code: 'EXECUTION_FAILED', message: 'The tool execution failed.' },
    });
    expect(JSON.stringify(result)).not.toContain('secret raw detail');
    expect(JSON.stringify(result)).not.toContain('stack');
  });
});
