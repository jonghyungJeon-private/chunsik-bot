import { createHash } from 'node:crypto';
import { HARNESS_DIGEST_VERSION, RoutingValidationFixture } from './contracts';

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON rejects non-finite numbers');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  throw new Error('Canonical JSON rejects non-JSON values');
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function harnessDigest(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJson({ harnessDigestVersion: HARNESS_DIGEST_VERSION, value }))
    .digest('hex');
}

export function computeFixtureDigest(fixture: RoutingValidationFixture): string {
  const { fixtureDigest: _excluded, ...material } = fixture;
  return harnessDigest(material);
}

export function computeCorpusDigest(fixtures: readonly RoutingValidationFixture[]): string {
  return harnessDigest(
    fixtures
      .map(({ scenarioId, fixtureVersion, fixtureDigest }) => ({ scenarioId, fixtureVersion, fixtureDigest }))
      .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId)),
  );
}
