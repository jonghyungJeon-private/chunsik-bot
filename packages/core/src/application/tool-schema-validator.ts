import type { ToolSchema } from '../domain';

/** Internal bounded validator for the deliberately small ToolSchema language. */
export function validateToolSchemaValue(schema: ToolSchema, value: unknown): boolean {
  switch (schema.type) {
    case 'null':
      return value === null;
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string';
    case 'array':
      return Array.isArray(value) && value.every((item) => validateToolSchemaValue(schema.items, item));
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
      const record = value as Readonly<Record<string, unknown>>;
      for (const required of schema.required ?? []) {
        if (!Object.prototype.hasOwnProperty.call(record, required)) return false;
      }
      for (const [key, propertySchema] of Object.entries(schema.properties)) {
        if (
          Object.prototype.hasOwnProperty.call(record, key)
          && !validateToolSchemaValue(propertySchema, record[key])
        ) return false;
      }
      return true;
    }
  }
}

export function assertValidToolSchema(schema: ToolSchema): void {
  if (schema === null || typeof schema !== 'object') throw new Error('Tool schema must be an object');

  switch (schema.type) {
    case 'null':
    case 'boolean':
    case 'number':
    case 'string':
      return;
    case 'array':
      assertValidToolSchema(schema.items);
      return;
    case 'object': {
      if (schema.properties === null || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
        throw new Error('Tool object schema properties must be an object');
      }
      const propertyNames = new Set(Object.keys(schema.properties));
      for (const [name, child] of Object.entries(schema.properties)) {
        if (name.length === 0) throw new Error('Tool schema property names must be non-empty');
        assertValidToolSchema(child);
      }
      const required = schema.required ?? [];
      if (new Set(required).size !== required.length || required.some((name) => !propertyNames.has(name))) {
        throw new Error('Tool object schema required fields must uniquely name declared properties');
      }
      return;
    }
    default:
      throw new Error('Tool schema type is unsupported');
  }
}
