import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { BenchmarkPhase } from './provider-benchmark';

export const BENCHMARK_POOL_SCHEMA_VERSION = 1 as const;

export type BenchmarkModelRole = 'REFERENCE' | 'CHALLENGER';
export type BenchmarkModelTier = 'REQUIRED' | 'OPTIONAL' | 'LARGE';
export type ConfigurationSource = 'LEGACY_DEFAULT' | 'EXPLICIT_FILE';

export interface BenchmarkModelConfiguration {
  readonly id: string;
  readonly role: BenchmarkModelRole;
  readonly tier: BenchmarkModelTier;
}

export interface BenchmarkPoolConfiguration {
  readonly schemaVersion: typeof BENCHMARK_POOL_SCHEMA_VERSION;
  readonly campaignId: string;
  readonly phase: BenchmarkPhase;
  readonly models: readonly BenchmarkModelConfiguration[];
}

export interface LoadedBenchmarkConfiguration {
  readonly configuration: BenchmarkPoolConfiguration;
  readonly configurationDigest: string;
  readonly configurationSource: ConfigurationSource;
  readonly sourcePath: string;
}

export class BenchmarkConfigurationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'BenchmarkConfigurationError';
  }
}

const CONFIG_KEYS = Object.freeze(['schemaVersion', 'campaignId', 'phase', 'models']);
const MODEL_KEYS = Object.freeze(['id', 'role', 'tier']);
const MODEL_PATTERN = /^[A-Za-z0-9._:/-]{1,200}$/;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
};

const parseModel = (value: unknown): BenchmarkModelConfiguration => {
  if (!isPlainObject(value) || !hasExactKeys(value, MODEL_KEYS)) {
    throw new BenchmarkConfigurationError('CONFIG_MODEL_FIELDS_INVALID');
  }
  const { id, role, tier } = value;
  if (typeof id !== 'string' || !MODEL_PATTERN.test(id)) {
    throw new BenchmarkConfigurationError('CONFIG_MODEL_ID_INVALID');
  }
  if (role !== 'REFERENCE' && role !== 'CHALLENGER') {
    throw new BenchmarkConfigurationError('CONFIG_MODEL_ROLE_INVALID');
  }
  if (tier !== 'REQUIRED' && tier !== 'OPTIONAL' && tier !== 'LARGE') {
    throw new BenchmarkConfigurationError('CONFIG_MODEL_TIER_INVALID');
  }
  return Object.freeze({ id, role, tier });
};

export function validateBenchmarkConfiguration(
  value: unknown,
  expectedPhase?: BenchmarkPhase,
): BenchmarkPoolConfiguration {
  if (!isPlainObject(value) || !hasExactKeys(value, CONFIG_KEYS)) {
    throw new BenchmarkConfigurationError('CONFIG_FIELDS_INVALID');
  }
  if (value.schemaVersion !== BENCHMARK_POOL_SCHEMA_VERSION) {
    throw new BenchmarkConfigurationError('CONFIG_SCHEMA_VERSION_INVALID');
  }
  if (
    typeof value.campaignId !== 'string' ||
    value.campaignId.length === 0 ||
    value.campaignId.length > 200 ||
    !/^[A-Za-z0-9._-]+$/.test(value.campaignId)
  ) {
    throw new BenchmarkConfigurationError('CONFIG_CAMPAIGN_ID_INVALID');
  }
  if (value.phase !== 'A1' && value.phase !== 'A2') {
    throw new BenchmarkConfigurationError('CONFIG_PHASE_INVALID');
  }
  if (expectedPhase !== undefined && value.phase !== expectedPhase) {
    throw new BenchmarkConfigurationError('CONFIG_PHASE_MISMATCH');
  }
  if (!Array.isArray(value.models) || value.models.length === 0) {
    throw new BenchmarkConfigurationError('CONFIG_POOL_EMPTY');
  }
  const models = value.models.map(parseModel);
  if (new Set(models.map((model) => model.id)).size !== models.length) {
    throw new BenchmarkConfigurationError('CONFIG_MODEL_DUPLICATE');
  }
  return Object.freeze({
    schemaVersion: BENCHMARK_POOL_SCHEMA_VERSION,
    campaignId: value.campaignId,
    phase: value.phase,
    models: Object.freeze(models),
  });
}

export const canonicalConfigurationPayload = (
  configuration: BenchmarkPoolConfiguration,
): readonly (readonly [string, unknown])[] => [
  ['schemaVersion', configuration.schemaVersion],
  ['phase', configuration.phase],
  [
    'models',
    [...configuration.models]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((model) => [model.id, model.role, model.tier]),
  ],
];

export const computeConfigurationDigest = (
  configuration: BenchmarkPoolConfiguration,
): string =>
  createHash('sha256')
    .update(JSON.stringify(canonicalConfigurationPayload(configuration)))
    .digest('hex');

export const LEGACY_DEFAULT_CONFIGURATION_PATH = resolve(
  __dirname,
  '../../src/tools/provider-benchmark-configs/legacy-v2.1-a1.json',
);

export const PRODUCTION_18GB_CONFIGURATION_PATH = resolve(
  __dirname,
  '../../src/tools/provider-benchmark-configs/production-18gb-a1.json',
);

const readConfigurationFile = (candidate: string): unknown => {
  let realPath: string;
  try {
    realPath = realpathSync(candidate);
  } catch {
    throw new BenchmarkConfigurationError('CONFIG_FILE_NOT_FOUND');
  }
  if (!statSync(realPath).isFile()) {
    throw new BenchmarkConfigurationError('CONFIG_PATH_NOT_FILE');
  }
  try {
    return JSON.parse(readFileSync(realPath, 'utf8')) as unknown;
  } catch {
    throw new BenchmarkConfigurationError('CONFIG_JSON_INVALID');
  }
};

export function loadBenchmarkConfiguration(
  explicitPath: string | undefined,
  expectedPhase: BenchmarkPhase,
): LoadedBenchmarkConfiguration {
  if (explicitPath !== undefined && !isAbsolute(explicitPath)) {
    throw new BenchmarkConfigurationError('CONFIG_PATH_NOT_ABSOLUTE');
  }
  const sourcePath = explicitPath ?? LEGACY_DEFAULT_CONFIGURATION_PATH;
  const configurationSource: ConfigurationSource =
    explicitPath === undefined ? 'LEGACY_DEFAULT' : 'EXPLICIT_FILE';
  const configuration = validateBenchmarkConfiguration(
    readConfigurationFile(sourcePath),
    expectedPhase,
  );
  return Object.freeze({
    configuration,
    configurationDigest: computeConfigurationDigest(configuration),
    configurationSource,
    sourcePath: realpathSync(sourcePath),
  });
}
