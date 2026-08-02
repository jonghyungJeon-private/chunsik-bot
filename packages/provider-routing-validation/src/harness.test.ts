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
  [RoutingFailureCode.DEADLINE_EXHAUSTED]: 'deadline-after-validation',
  [RoutingFailureCode.PROMPT_LEAK]: 'prompt-leak',
});

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

  it('accounts for every failure-matrix contract and only calls executable coverage executable', () => {
    expect(ROUTING_FAILURE_MATRIX.map((entry) => entry.code).sort()).toEqual(Object.values(RoutingFailureCode).sort());
    const fixtureIds = new Set(GOLDEN_FIXTURES.map((fixture) => fixture.scenarioId));
    for (const entry of ROUTING_FAILURE_MATRIX) {
      const executableFixture = EXECUTABLE_FAILURE_COVERAGE[entry.code];
      if (executableFixture !== undefined) {
        expect(entry.producerStatus).toBe(RoutingFailureProducerStatus.ACTIVE);
        expect(fixtureIds.has(executableFixture)).toBe(true);
      } else {
        // Explicitly contract-only in this slice; no synthetic producer is invented.
        expect(Object.values(RoutingFailureCode)).toContain(entry.code);
      }
    }
  });
});
