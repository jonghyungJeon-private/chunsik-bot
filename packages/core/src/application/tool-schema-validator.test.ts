import { describe, expect, it } from 'vitest';
import type { ToolSchema } from '../domain';
import { validateToolSchemaValue } from './tool-schema-validator';

describe('ToolSchema validation', () => {
  it('validates primitive JSON types', () => {
    expect(validateToolSchemaValue({ type: 'null' }, null)).toBe(true);
    expect(validateToolSchemaValue({ type: 'boolean' }, false)).toBe(true);
    expect(validateToolSchemaValue({ type: 'number' }, 1.5)).toBe(true);
    expect(validateToolSchemaValue({ type: 'number' }, Number.NaN)).toBe(false);
    expect(validateToolSchemaValue({ type: 'string' }, 'value')).toBe(true);
    expect(validateToolSchemaValue({ type: 'string' }, 1)).toBe(false);
  });

  it('validates object properties and required fields', () => {
    const schema: ToolSchema = {
      type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'],
    };
    expect(validateToolSchemaValue(schema, { query: 'open', limit: 2 })).toBe(true);
    expect(validateToolSchemaValue(schema, { query: 'open' })).toBe(true);
    expect(validateToolSchemaValue(schema, { limit: 2 })).toBe(false);
    expect(validateToolSchemaValue(schema, { query: 2 })).toBe(false);
    expect(validateToolSchemaValue(schema, { query: undefined })).toBe(false);
  });

  it('validates arrays through their item schema', () => {
    const schema: ToolSchema = { type: 'array', items: { type: 'string' } };
    expect(validateToolSchemaValue(schema, ['a', 'b'])).toBe(true);
    expect(validateToolSchemaValue(schema, ['a', 2])).toBe(false);
    expect(validateToolSchemaValue(schema, { 0: 'a' })).toBe(false);
  });
});
