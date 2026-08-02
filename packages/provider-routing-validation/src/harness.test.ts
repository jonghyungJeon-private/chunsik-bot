import { describe, expect, it } from 'vitest';
import {
  MAX_PROVIDER_ATTEMPTS,
  MAX_ROUTING_TRANSITIONS,
  ROUTING_FAILURE_MATRIX,
  RoutingFailureCode,
  RoutingFailureProducerStatus,
} from '@chunsik/core';
import { computeCorpusDigest, computeFixtureDigest, harnessDigest } from './canonical';
import { GOLDEN_FIXTURE_MANIFEST, GOLDEN_FIXTURES } from './fixtures';
import { replayFixtureTwice } from './harness';

const EXECUTABLE_FAILURE_COVERAGE: Readonly<Partial<Record<RoutingFailureCode, string>>> = Object.freeze({
  [RoutingFailureCode.PROVIDER_TIMEOUT]: 'timeout-fallback',
  [RoutingFailureCode.EMPTY_OUTPUT]: 'empty-output-fallback',
  [RoutingFailureCode.SEMANTIC_VALIDATION_FAILED]: 'semantic-escalation',
  [RoutingFailureCode.SEMANTIC_VALIDATION_UNRESOLVED]: 'semantic-validation-unresolved',
  [RoutingFailureCode.DEADLINE_EXHAUSTED]: 'deadline-after-validation',
  [RoutingFailureCode.PROMPT_LEAK]: 'prompt-leak',
});

interface ActiveFailureWaiver {
  readonly failureCode: RoutingFailureCode;
  readonly reason: string;
  readonly coveredBy: string;
}

/** Bounded MA-1 manifest: ACTIVE contracts that intentionally have no Harness golden fixture yet. */
const ACTIVE_FAILURE_WAIVERS: readonly ActiveFailureWaiver[] = Object.freeze([
  { failureCode: RoutingFailureCode.ROUTING_CONFIGURATION_MISMATCH, reason: 'Requires rejected configuration mutation outside strict replay fixtures.', coveredBy: 'Core gateway focused test' },
  { failureCode: RoutingFailureCode.BINDING_MISMATCH, reason: 'Reserved routing-level binding contract has no direct Gateway producer.', coveredBy: 'Core failure-matrix focused test' },
  { failureCode: RoutingFailureCode.PROVIDER_BINDING_NOT_FOUND, reason: 'Requires preflight binding-registry mutation outside strict replay fixtures.', coveredBy: 'Core gateway focused test' },
  { failureCode: RoutingFailureCode.PROVIDER_DISABLED, reason: 'Rejected during registry/binding construction before replay.', coveredBy: 'Core binding-registry focused test' },
  { failureCode: RoutingFailureCode.UNKNOWN_VALIDATION_PROFILE, reason: 'Strict fixture schema accepts only registered validation profiles.', coveredBy: 'Core execution-plan focused test' },
  { failureCode: RoutingFailureCode.PROVIDER_UNAVAILABLE, reason: 'MA-1 adds only the mandated unresolved golden scenario.', coveredBy: 'Core failure-classifier focused test' },
  { failureCode: RoutingFailureCode.PROVIDER_AUTH_REQUIRED, reason: 'MA-1 adds only the mandated unresolved golden scenario.', coveredBy: 'Core failure-classifier focused test' },
  { failureCode: RoutingFailureCode.PROVIDER_EXECUTION_FAILED, reason: 'Unknown-exception normalization remains covered at the Gateway boundary.', coveredBy: 'Core gateway focused test' },
  { failureCode: RoutingFailureCode.OUTPUT_LIMIT_VIOLATION, reason: 'Output-boundary behavior remains covered by Core validation and Gateway tests.', coveredBy: 'Core validator and gateway focused tests' },
  { failureCode: RoutingFailureCode.MULTI_ENTRY_ECHO, reason: 'Context-corpus fixtures are outside the current strict fixture schema.', coveredBy: 'Core validator focused test' },
  { failureCode: RoutingFailureCode.SECRET_EXPOSURE_RISK, reason: 'Synthetic secret-pattern behavior remains covered by the Core validator.', coveredBy: 'Core validator focused test' },
  { failureCode: RoutingFailureCode.VALIDATOR_INTERNAL_FAILURE, reason: 'Malformed provider-output injection is outside the current scripted Provider contract.', coveredBy: 'Core validator focused test' },
]);

describe('deterministic provider routing validation harness', () => {
  it.each(GOLDEN_FIXTURES)('replays $scenarioId twice with an exact stable projection', async (fixture) => {
    expect(computeFixtureDigest(fixture)).toBe(fixture.fixtureDigest);
    const [first, second] = await replayFixtureTwice(fixture);
    expect(first.projection).toEqual(fixture.expected);
    expect(second.projection).toEqual(fixture.expected);
    expect(first.projectionDigest).toBe(second.projectionDigest);
    expect(first.projectionDigest).toBe(harnessDigest(fixture.expected));
    expect(first.providerInvocations).toBeLessThanOrEqual(MAX_PROVIDER_ATTEMPTS);
    expect(second.providerInvocations).toBe(first.providerInvocations);
    expect(first.projection.transitions.length).toBeLessThanOrEqual(MAX_ROUTING_TRANSITIONS);
  });

  it('pins the immutable manifest and corpus identity without filesystem discovery', () => {
    expect(GOLDEN_FIXTURES.every((fixture) => Object.isFrozen(fixture) && Object.isFrozen(fixture.expected))).toBe(true);
    expect(Object.isFrozen(GOLDEN_FIXTURE_MANIFEST.fixtures)).toBe(true);
    expect(GOLDEN_FIXTURE_MANIFEST.fixtures).toEqual(
      GOLDEN_FIXTURES.map(({ scenarioId, fixtureVersion, fixtureDigest }) => ({ scenarioId, fixtureVersion, fixtureDigest }))
        .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId)),
    );
    expect(computeCorpusDigest(GOLDEN_FIXTURES)).toBe(GOLDEN_FIXTURE_MANIFEST.corpusDigest);
  });

  it('partitions failure-matrix coverage into golden, explicit ACTIVE waiver, and producer-pending sets', () => {
    expect(ROUTING_FAILURE_MATRIX.map((entry) => entry.code).sort()).toEqual(Object.values(RoutingFailureCode).sort());
    const fixturesById = new Map(GOLDEN_FIXTURES.map((fixture) => [fixture.scenarioId, fixture]));
    const goldenCodes = Object.keys(EXECUTABLE_FAILURE_COVERAGE) as RoutingFailureCode[];
    const waiverCodes = ACTIVE_FAILURE_WAIVERS.map((waiver) => waiver.failureCode);
    const activeCodes = ROUTING_FAILURE_MATRIX
      .filter((entry) => entry.producerStatus === RoutingFailureProducerStatus.ACTIVE)
      .map((entry) => entry.code);
    const pendingCodes = ROUTING_FAILURE_MATRIX
      .filter((entry) => entry.producerStatus === RoutingFailureProducerStatus.PRODUCER_PENDING)
      .map((entry) => entry.code);

    expect(new Set(goldenCodes).size).toBe(goldenCodes.length);
    expect(new Set(waiverCodes).size).toBe(waiverCodes.length);
    expect(goldenCodes.filter((code) => waiverCodes.includes(code))).toEqual([]);
    expect([...goldenCodes, ...waiverCodes].sort()).toEqual([...activeCodes].sort());
    expect(pendingCodes.filter((code) => goldenCodes.includes(code) || waiverCodes.includes(code))).toEqual([]);

    for (const code of goldenCodes) {
      const scenarioId = EXECUTABLE_FAILURE_COVERAGE[code];
      const fixture = scenarioId === undefined ? undefined : fixturesById.get(scenarioId);
      expect(fixture, `${code} must reference an existing golden fixture`).toBeDefined();
      expect(
        fixture?.expected.failureCode === code || fixture?.expected.attempts.some((attempt) => attempt.failureCode === code),
        `${code} must be observable in its declared golden fixture`,
      ).toBe(true);
    }

    for (const waiver of ACTIVE_FAILURE_WAIVERS) {
      expect(waiver.reason.trim().length).toBeGreaterThan(0);
      expect(waiver.coveredBy.trim().length).toBeGreaterThan(0);
    }
  });
});
