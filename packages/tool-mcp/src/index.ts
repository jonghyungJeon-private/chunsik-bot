import type { CallToolResult, Client, Tool } from '@modelcontextprotocol/client';
import type {
  ToolDescriptor, ToolFailureCode, ToolInvocation, ToolJsonValue, ToolProvider, ToolResult, ToolSchema,
} from '@chunsik/core';

const SERVER_ID = /^[a-z0-9](?:[a-z0-9._-]{0,62})$/;
const MAX_TEXT_BLOCKS = 16;
const MAX_TEXT_LENGTH = 32_768;
const EMPTY_SNAPSHOT: readonly ToolDescriptor[] = Object.freeze([]);
const FAILURE_MESSAGES: Readonly<Record<ToolFailureCode, string>> = Object.freeze({
  TOOL_NOT_FOUND: 'The requested MCP tool was not found.',
  TOOL_UNAVAILABLE: 'The MCP tool provider is unavailable.',
  INVALID_INPUT: 'The MCP tool input is invalid.',
  MUTATION_NOT_AUTHORIZED: 'Mutating MCP tool invocation is not authorized.',
  EXECUTION_FAILED: 'The MCP tool execution failed.',
  OUTPUT_INVALID: 'The MCP tool output is invalid.',
});

export type McpInitializationFailureCode =
  | 'INVALID_CONFIGURATION' | 'DISCOVERY_FAILED' | 'DUPLICATE_TOOL_IDENTITY'
  | 'UNREPRESENTABLE_TOOL_IDENTITY' | 'UNREPRESENTABLE_TOOL_SCHEMA' | 'PROVIDER_CLOSED';

/** Bounded initialization error; raw SDK/server details never cross the adapter. */
export class McpInitializationError extends Error {
  override readonly name = 'McpInitializationError';
  constructor(readonly code: McpInitializationFailureCode) {
    super(`MCP adapter initialization failed: ${code}`);
  }
}

/** Adapter-private protocol session seam. Tests fake this boundary, not Core or ToolManager. */
export interface McpClientSession {
  listTools(): Promise<{ readonly tools: readonly Tool[] }>;
  callTool(request: { readonly name: string; readonly arguments?: Readonly<Record<string, unknown>> }):
    Promise<CallToolResult>;
  close(): Promise<void>;
}

/** Thin official-v2 wrapper. It never constructs/connects a transport or subscribes. */
export class OfficialMcpClientSession implements McpClientSession {
  constructor(private readonly client: Pick<Client, 'listTools' | 'callTool' | 'close'>) {}
  async listTools(): Promise<{ readonly tools: readonly Tool[] }> {
    const result = await this.client.listTools();
    return { tools: result.tools };
  }
  callTool(request: { readonly name: string; readonly arguments?: Readonly<Record<string, unknown>> }):
    Promise<CallToolResult> {
    return this.client.callTool({
      name: request.name,
      ...(request.arguments === undefined ? {} : { arguments: request.arguments }),
    });
  }
  close(): Promise<void> { return this.client.close(); }
}

export interface McpToolProviderConfig {
  readonly serverId: string;
  readonly readOnlyTools?: readonly string[];
}

/** Async-discovered MCP adapter with an immutable synchronous ToolProvider snapshot. */
export class McpToolProvider implements ToolProvider {
  readonly source: string;
  private readonly readOnlyTools: ReadonlySet<string>;
  private snapshot: readonly ToolDescriptor[] = EMPTY_SNAPSHOT;
  private initializePromise: Promise<void> | undefined;
  private initialized = false;
  private closed = false;
  private closePromise: Promise<void> | undefined;

  constructor(config: McpToolProviderConfig, private readonly session: McpClientSession) {
    if (!SERVER_ID.test(config.serverId)) throw new McpInitializationError('INVALID_CONFIGURATION');
    this.source = `mcp:${config.serverId}`;
    const configured = config.readOnlyTools ?? [];
    if (new Set(configured).size !== configured.length || configured.some((name) => !isRepresentableName(name))) {
      throw new McpInitializationError('INVALID_CONFIGURATION');
    }
    this.readOnlyTools = new Set(configured);
  }

  initialize(): Promise<void> {
    if (this.closed) return Promise.reject(new McpInitializationError('PROVIDER_CLOSED'));
    if (this.initialized) return Promise.resolve();
    this.initializePromise ??= this.discoverAtomically();
    return this.initializePromise;
  }

  listTools(): readonly ToolDescriptor[] {
    if (!this.initialized) throw new McpInitializationError('DISCOVERY_FAILED');
    return this.snapshot;
  }

  isAvailable(): Promise<boolean> { return Promise.resolve(this.initialized && !this.closed); }

  async invoke(request: ToolInvocation): Promise<ToolResult> {
    if (!this.initialized || this.closed) return failure('TOOL_UNAVAILABLE');
    if (!isRecord(request.input)) return failure('INVALID_INPUT');
    let result: CallToolResult;
    try {
      result = await this.session.callTool({ name: request.toolName, arguments: request.input });
    } catch {
      return failure('EXECUTION_FAILED');
    }
    return projectResult(result);
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    this.closed = true;
    this.snapshot = EMPTY_SNAPSHOT;
    this.initialized = false;
    this.closePromise = (async () => {
      if (this.initializePromise !== undefined) await this.initializePromise.catch(() => undefined);
      try { await this.session.close(); } catch { /* bounded, idempotent teardown */ }
    })();
    return this.closePromise;
  }

  private async discoverAtomically(): Promise<void> {
    let tools: readonly Tool[];
    try { ({ tools } = await this.session.listTools()); } catch {
      throw new McpInitializationError('DISCOVERY_FAILED');
    }
    let candidate: readonly ToolDescriptor[];
    try {
      const identities = new Set<string>();
      candidate = Object.freeze(tools.map((tool) => {
        if (!isRepresentableName(tool.name)) throw new McpInitializationError('UNREPRESENTABLE_TOOL_IDENTITY');
        if (identities.has(tool.name)) throw new McpInitializationError('DUPLICATE_TOOL_IDENTITY');
        identities.add(tool.name);
        return mapTool(this.source, tool, this.readOnlyTools.has(tool.name));
      }));
    } catch (error) {
      if (error instanceof McpInitializationError) throw error;
      throw new McpInitializationError('UNREPRESENTABLE_TOOL_SCHEMA');
    }
    if (this.closed) throw new McpInitializationError('PROVIDER_CLOSED');
    this.snapshot = candidate;
    this.initialized = true;
  }
}

function mapTool(source: string, tool: Tool, configuredReadOnly: boolean): ToolDescriptor {
  const contradicted = tool.annotations?.readOnlyHint === false || tool.annotations?.destructiveHint === true;
  return Object.freeze({
    source, name: tool.name, effect: configuredReadOnly && !contradicted ? 'READ_ONLY' : 'MUTATING',
    inputSchema: mapSchema(tool.inputSchema),
    ...(tool.outputSchema === undefined ? {} : { outputSchema: mapSchema(tool.outputSchema) }),
  });
}

function mapSchema(value: unknown, ancestors: ReadonlySet<object> = new Set()): ToolSchema {
  if (!isRecord(value) || typeof value.type !== 'string' || ancestors.has(value)) unsupportedSchema();
  const nextAncestors = new Set(ancestors).add(value);
  switch (value.type) {
    case 'null': case 'boolean': case 'number': case 'string':
      requireExactKeys(value, ['type']);
      return Object.freeze({ type: value.type });
    case 'array':
      requireExactKeys(value, ['type', 'items']);
      if (!Object.prototype.hasOwnProperty.call(value, 'items')) unsupportedSchema();
      return Object.freeze({ type: 'array', items: mapSchema(value.items, nextAncestors) });
    case 'object': {
      requireExactKeys(value, ['type', 'properties', 'required']);
      const rawProperties = value.properties ?? {};
      if (!isRecord(rawProperties)) unsupportedSchema();
      const properties: Record<string, ToolSchema> = {};
      for (const [name, child] of Object.entries(rawProperties)) {
        if (name.length === 0) unsupportedSchema();
        properties[name] = mapSchema(child, nextAncestors);
      }
      const rawRequired = value.required;
      if (rawRequired !== undefined && (!Array.isArray(rawRequired) || rawRequired.some((x) => typeof x !== 'string'))) {
        unsupportedSchema();
      }
      const required = rawRequired as readonly string[] | undefined;
      if (required !== undefined && (
        new Set(required).size !== required.length || required.some((name) => !(name in properties))
      )) unsupportedSchema();
      return Object.freeze({ type: 'object', properties: Object.freeze(properties),
        ...(required === undefined ? {} : { required: Object.freeze([...required]) }) });
    }
    default: return unsupportedSchema();
  }
}

function requireExactKeys(value: Readonly<Record<string, unknown>>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) unsupportedSchema();
}
function unsupportedSchema(): never { throw new McpInitializationError('UNREPRESENTABLE_TOOL_SCHEMA'); }

function projectResult(result: CallToolResult): ToolResult {
  if (result.isError === true) return failure('EXECUTION_FAILED');
  if (result.structuredContent !== undefined) {
    if (!isJsonValue(result.structuredContent)) return failure('OUTPUT_INVALID');
    return success(cloneJsonValue(result.structuredContent));
  }
  if (!Array.isArray(result.content) || result.content.length === 0 || result.content.length > MAX_TEXT_BLOCKS) {
    return failure('OUTPUT_INVALID');
  }
  const texts: string[] = [];
  let length = 0;
  for (const block of result.content) {
    if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') return failure('OUTPUT_INVALID');
    length += block.text.length;
    if (length > MAX_TEXT_LENGTH) return failure('OUTPUT_INVALID');
    texts.push(block.text);
  }
  return success(Object.freeze({ text: Object.freeze(texts) }));
}

function isRepresentableName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isJsonValue(value: unknown): value is ToolJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}
function cloneJsonValue(value: ToolJsonValue): ToolJsonValue {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneJsonValue));
  if (isRecord(value)) return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]),
  ));
  return value;
}
function success(output: ToolJsonValue): ToolResult { return Object.freeze({ ok: true, output }); }
function failure(code: ToolFailureCode): ToolResult {
  return Object.freeze({ ok: false, failure: Object.freeze({ code, message: FAILURE_MESSAGES[code] }) });
}
