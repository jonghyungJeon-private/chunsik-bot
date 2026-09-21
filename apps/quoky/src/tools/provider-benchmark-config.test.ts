import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  LEGACY_DEFAULT_CONFIGURATION_PATH,
  PRODUCTION_18GB_CONFIGURATION_PATH,
  computeConfigurationDigest,
  loadBenchmarkConfiguration,
  validateBenchmarkConfiguration,
} from './provider-benchmark-config';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'provider-benchmark-config-test-'));
afterAll(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

const models = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `synthetic-${index}:1b`,
    role: index === 0 ? ('REFERENCE' as const) : ('CHALLENGER' as const),
    tier: 'REQUIRED' as const,
  }));

const configuration = (count: number, campaignId = 'campaign') => ({
  schemaVersion: 1,
  campaignId,
  phase: 'A1',
  models: models(count),
});

describe('benchmark pool configuration', () => {
  it.each([4, 6, 15])('accepts a valid %i-model pool', (count) => {
    expect(validateBenchmarkConfiguration(configuration(count), 'A1').models).toHaveLength(count);
  });

  it('loads the immutable legacy 10-model and production 4-model configurations', () => {
    const legacy = loadBenchmarkConfiguration(LEGACY_DEFAULT_CONFIGURATION_PATH, 'A1');
    const production = loadBenchmarkConfiguration(PRODUCTION_18GB_CONFIGURATION_PATH, 'A1');
    expect(legacy.configuration.models).toHaveLength(10);
    expect(production.configuration.models.map((model) => model.id)).toEqual([
      'llama3.1:8b',
      'llama3.2:3b',
      'mistral:7b',
      'granite3.3:8b',
    ]);
  });

  it('rejects empty and duplicate pools', () => {
    expect(() => validateBenchmarkConfiguration({ ...configuration(4), models: [] })).toThrowError(
      'CONFIG_POOL_EMPTY',
    );
    const duplicate = [models(1)[0], models(1)[0]];
    expect(() => validateBenchmarkConfiguration({ ...configuration(4), models: duplicate })).toThrowError(
      'CONFIG_MODEL_DUPLICATE',
    );
  });

  it('rejects unknown top-level and nested fields', () => {
    expect(() =>
      validateBenchmarkConfiguration({ ...configuration(4), unexpected: true }),
    ).toThrowError('CONFIG_FIELDS_INVALID');
    expect(() =>
      validateBenchmarkConfiguration({
        ...configuration(4),
        models: [{ ...models(1)[0], unexpected: true }],
      }),
    ).toThrowError('CONFIG_MODEL_FIELDS_INVALID');
  });

  it('rejects invalid model, role, tier, and phase mismatches', () => {
    expect(() =>
      validateBenchmarkConfiguration({
        ...configuration(4),
        models: [{ ...models(1)[0], id: 'bad model' }],
      }),
    ).toThrowError('CONFIG_MODEL_ID_INVALID');
    expect(() =>
      validateBenchmarkConfiguration({
        ...configuration(4),
        models: [{ ...models(1)[0], role: 'GOLDEN' }],
      }),
    ).toThrowError('CONFIG_MODEL_ROLE_INVALID');
    expect(() =>
      validateBenchmarkConfiguration({
        ...configuration(4),
        models: [{ ...models(1)[0], tier: 'TINY' }],
      }),
    ).toThrowError('CONFIG_MODEL_TIER_INVALID');
    expect(() => validateBenchmarkConfiguration(configuration(4), 'A2')).toThrowError(
      'CONFIG_PHASE_MISMATCH',
    );
  });

  it('computes a deterministic order- and campaignId-independent digest', () => {
    const first = validateBenchmarkConfiguration(configuration(4, 'first'));
    const second = validateBenchmarkConfiguration({
      ...configuration(4, 'second'),
      models: [...models(4)].reverse(),
    });
    expect(computeConfigurationDigest(first)).toBe(computeConfigurationDigest(first));
    expect(computeConfigurationDigest(first)).toBe(computeConfigurationDigest(second));
  });

  it('excludes the file path from the digest', () => {
    const content = JSON.stringify(configuration(4));
    const firstPath = join(temporaryDirectory, 'first.json');
    const secondPath = join(temporaryDirectory, 'second.json');
    writeFileSync(firstPath, content);
    writeFileSync(secondPath, content);
    expect(loadBenchmarkConfiguration(firstPath, 'A1').configurationDigest).toBe(
      loadBenchmarkConfiguration(secondPath, 'A1').configurationDigest,
    );
  });
});
