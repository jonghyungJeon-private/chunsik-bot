import type { Actor } from './actor';
import type { ResourceRef } from './resource-ref';

/** JSON values accepted at the protocol-neutral ToolProvider boundary. */
export type ToolJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ToolJsonValue[]
  | { readonly [key: string]: ToolJsonValue };

/**
 * Deliberately bounded schema language for tool inputs and outputs (ADR-0076).
 * It is not an extensible JSON Schema metadata bag.
 */
export type ToolSchema =
  | { readonly type: 'null' }
  | { readonly type: 'boolean' }
  | { readonly type: 'number' }
  | { readonly type: 'string' }
  | {
      readonly type: 'object';
      readonly properties: Readonly<Record<string, ToolSchema>>;
      readonly required?: readonly string[];
    }
  | { readonly type: 'array'; readonly items: ToolSchema };

/** QuirkyBot-owned effect classification. Provider metadata is not authority. */
export type ToolEffect = 'READ_ONLY' | 'MUTATING';

/** A provider-neutral tool declaration, structurally identified by source + name. */
export interface ToolDescriptor {
  readonly source: string;
  readonly name: string;
  readonly effect: ToolEffect;
  readonly inputSchema: ToolSchema;
  readonly outputSchema?: ToolSchema;
}

/** One bounded provider-local invocation. Provider selection remains outside this value. */
export interface ToolInvocation {
  readonly toolName: string;
  readonly input: ToolJsonValue;
  readonly actorId: Actor['id'];
  readonly resourceRef?: ResourceRef;
}

export type ToolFailureCode =
  | 'TOOL_NOT_FOUND'
  | 'TOOL_UNAVAILABLE'
  | 'INVALID_INPUT'
  | 'MUTATION_NOT_AUTHORIZED'
  | 'EXECUTION_FAILED'
  | 'OUTPUT_INVALID';

export interface ToolFailure {
  readonly code: ToolFailureCode;
  readonly message: string;
}

export type ToolResult =
  | { readonly ok: true; readonly output: ToolJsonValue }
  | { readonly ok: false; readonly failure: ToolFailure };
