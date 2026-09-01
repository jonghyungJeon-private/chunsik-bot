import type {
  ToolDescriptor,
  ToolFailureCode,
  ToolInvocation,
  ToolJsonValue,
  ToolResult,
  ToolSchema,
} from '../domain';
import type { ToolProvider } from '../ports';
import { assertValidToolSchema, validateToolSchemaValue } from './tool-schema-validator';

interface ToolRegistryEntry {
  readonly provider: ToolProvider;
  readonly descriptor: ToolDescriptor;
}

const FAILURE_MESSAGES: Readonly<Record<ToolFailureCode, string>> = Object.freeze({
  TOOL_NOT_FOUND: 'The requested tool was not found.',
  TOOL_UNAVAILABLE: 'The requested tool is unavailable.',
  INVALID_INPUT: 'The tool input is invalid.',
  MUTATION_NOT_AUTHORIZED: 'Mutating tool invocation is not authorized.',
  EXECUTION_FAILED: 'The tool execution failed.',
  OUTPUT_INVALID: 'The tool output is invalid.',
});

/** Immutable, composition-time registry and bounded READ_ONLY invocation policy. */
export class ToolManager {
  private readonly toolsBySource: ReadonlyMap<string, ReadonlyMap<string, ToolRegistryEntry>>;
  private readonly discovered: readonly ToolDescriptor[];

  constructor(providers: readonly ToolProvider[] = []) {
    const providerSources = new Set<string>();
    const toolsBySource = new Map<string, ReadonlyMap<string, ToolRegistryEntry>>();
    const discovered: ToolDescriptor[] = [];

    for (const provider of [...providers]) {
      const source = requireIdentityPart(provider.source, 'provider source');
      if (providerSources.has(source)) throw new Error(`Duplicate tool provider source: ${source}`);
      providerSources.add(source);
      const providerTools = new Map<string, ToolRegistryEntry>();

      for (const rawDescriptor of provider.listTools()) {
        const descriptor = cloneDescriptor(rawDescriptor);
        if (descriptor.source !== source) {
          throw new Error(`Tool descriptor source must match its provider source: ${descriptor.source}`);
        }
        if (providerTools.has(descriptor.name)) {
          throw new Error(`Duplicate tool identity: ${descriptor.source}:${descriptor.name}`);
        }
        providerTools.set(descriptor.name, Object.freeze({ provider, descriptor }));
        discovered.push(descriptor);
      }
      toolsBySource.set(source, providerTools);
    }

    this.toolsBySource = toolsBySource;
    this.discovered = Object.freeze(discovered);
    Object.freeze(this);
  }

  discover(): readonly ToolDescriptor[] {
    return this.discovered;
  }

  async invoke(source: string, request: ToolInvocation): Promise<ToolResult> {
    const entry = this.toolsBySource.get(source)?.get(request.toolName);
    if (!entry) return failure('TOOL_NOT_FOUND');

    try {
      if (!validateToolSchemaValue(entry.descriptor.inputSchema, request.input)) return failure('INVALID_INPUT');
    } catch {
      return failure('INVALID_INPUT');
    }
    if (entry.descriptor.effect === 'MUTATING') return failure('MUTATION_NOT_AUTHORIZED');

    try {
      if (!(await entry.provider.isAvailable())) return failure('TOOL_UNAVAILABLE');
    } catch {
      return failure('TOOL_UNAVAILABLE');
    }

    let result: ToolResult;
    try {
      result = await entry.provider.invoke(request);
    } catch {
      return failure('EXECUTION_FAILED');
    }

    try {
      if (!isToolResult(result)) return failure('EXECUTION_FAILED');
      if (!result.ok) return failure(isFailureCode(result.failure.code) ? result.failure.code : 'EXECUTION_FAILED');
      if (
        entry.descriptor.outputSchema !== undefined
        && !validateToolSchemaValue(entry.descriptor.outputSchema, result.output)
      ) {
        return failure('OUTPUT_INVALID');
      }
      return Object.freeze({ ok: true, output: cloneJsonValue(result.output) });
    } catch {
      return failure('EXECUTION_FAILED');
    }
  }
}

function requireIdentityPart(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`Tool ${label} must be non-empty`);
  return value.trim();
}

function cloneDescriptor(descriptor: ToolDescriptor): ToolDescriptor {
  const source = requireIdentityPart(descriptor.source, 'descriptor source');
  const name = requireIdentityPart(descriptor.name, 'name');
  if (descriptor.effect !== 'READ_ONLY' && descriptor.effect !== 'MUTATING') {
    throw new Error(`Tool effect is unsupported: ${String(descriptor.effect)}`);
  }
  assertValidToolSchema(descriptor.inputSchema);
  if (descriptor.outputSchema !== undefined) assertValidToolSchema(descriptor.outputSchema);
  return Object.freeze({
    source,
    name,
    effect: descriptor.effect,
    inputSchema: cloneSchema(descriptor.inputSchema),
    ...(descriptor.outputSchema === undefined ? {} : { outputSchema: cloneSchema(descriptor.outputSchema) }),
  });
}

function cloneSchema(schema: ToolSchema): ToolSchema {
  if (schema.type === 'object') {
    return Object.freeze({
      type: 'object',
      properties: Object.freeze(Object.fromEntries(
        Object.entries(schema.properties).map(([name, child]) => [name, cloneSchema(child)]),
      )),
      ...(schema.required === undefined ? {} : { required: Object.freeze([...schema.required]) }),
    });
  }
  if (schema.type === 'array') return Object.freeze({ type: 'array', items: cloneSchema(schema.items) });
  return Object.freeze({ type: schema.type });
}

function cloneJsonValue(value: ToolJsonValue): ToolJsonValue {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneJsonValue));
  if (value !== null && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)])));
  }
  return value;
}

function failure(code: ToolFailureCode): ToolResult {
  return Object.freeze({ ok: false, failure: Object.freeze({ code, message: FAILURE_MESSAGES[code] }) });
}

function isFailureCode(value: unknown): value is ToolFailureCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FAILURE_MESSAGES, value);
}

function isToolResult(value: unknown): value is ToolResult {
  if (value === null || typeof value !== 'object') return false;
  const result = value as { readonly ok?: unknown; readonly output?: unknown; readonly failure?: unknown };
  if (result.ok === true) return isJsonValue(result.output);
  if (result.ok !== false || result.failure === null || typeof result.failure !== 'object') return false;
  return typeof (result.failure as { readonly code?: unknown }).code === 'string';
}

function isJsonValue(value: unknown): value is ToolJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === 'object') return Object.values(value).every(isJsonValue);
  return false;
}
