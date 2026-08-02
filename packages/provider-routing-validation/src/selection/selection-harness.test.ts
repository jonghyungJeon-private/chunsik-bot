import { describe, expect, it } from 'vitest';
import { RoutingReasonCode } from '@chunsik/core';
import {
  computeSelectionCorpusDigest,
  computeSelectionFixtureDigest,
  selectionDigest,
} from './canonical';
import {
  REQUIRED_SELECTION_COVERAGE_AXES,
  SELECTION_COVERAGE_MANIFEST,
} from './coverage';
import {
  SELECTION_FIXTURE_COMPILER_VERSION,
  SELECTION_FIXTURE_SCHEMA_VERSION,
  SELECTION_HARNESS_DIGEST_VERSION,
} from './contracts';
import { GOLDEN_SELECTION_FIXTURES, GOLDEN_SELECTION_MANIFEST } from './fixtures';
import {
  replaySelectionFixtureMetamorphic,
  replaySelectionFixtureTwice,
} from './replay';

describe('deterministic routing selection harness', () => {
  it.each(GOLDEN_SELECTION_FIXTURES)('replays $scenarioId exactly and under fixed metamorphic ordering', (fixture) => {
    const [first, second] = replaySelectionFixtureTwice(fixture);
    const metamorphic = replaySelectionFixtureMetamorphic(fixture);
    expect(first.projection).toEqual(fixture.expected);
    expect(second.projection).toEqual(fixture.expected);
    expect(metamorphic.projection).toEqual(fixture.expected);
    expect(first.projectionDigest).toBe(selectionDigest(fixture.expected));
    expect(second.projectionDigest).toBe(first.projectionDigest);
    expect(metamorphic.projectionDigest).toBe(first.projectionDigest);
    expect(first.providerInvocations).toBe(0);
    expect(metamorphic.providerInvocations).toBe(0);
    expect(computeSelectionFixtureDigest(fixture)).toBe(fixture.fixtureDigest);
  });

  it('keeps schema, compiler, and digest versions independent and pins the corpus identity', () => {
    expect(new Set([SELECTION_FIXTURE_SCHEMA_VERSION, SELECTION_FIXTURE_COMPILER_VERSION, SELECTION_HARNESS_DIGEST_VERSION]).size).toBe(3);
    expect(GOLDEN_SELECTION_MANIFEST).toMatchObject({
      harnessDigestVersion: SELECTION_HARNESS_DIGEST_VERSION,
      compilerVersion: SELECTION_FIXTURE_COMPILER_VERSION,
    });
    expect(GOLDEN_SELECTION_MANIFEST.fixtures).toEqual(
      GOLDEN_SELECTION_FIXTURES.map(({ scenarioId, fixtureVersion, fixtureDigest }) => ({ scenarioId, fixtureVersion, fixtureDigest }))
        .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId)),
    );
    expect(computeSelectionCorpusDigest(GOLDEN_SELECTION_FIXTURES)).toBe(GOLDEN_SELECTION_MANIFEST.corpusDigest);
  });

  it('binds every required coverage axis to an existing golden fixture without an implicit bucket', () => {
    const fixtureIds = new Set(GOLDEN_SELECTION_FIXTURES.map((fixture) => fixture.scenarioId));
    const axes = SELECTION_COVERAGE_MANIFEST.map((entry) => entry.axis);
    expect(new Set(axes).size).toBe(axes.length);
    expect([...axes].sort()).toEqual([...REQUIRED_SELECTION_COVERAGE_AXES].sort());
    for (const entry of SELECTION_COVERAGE_MANIFEST) {
      expect(fixtureIds.has(entry.scenarioId), `${entry.axis} must reference a golden fixture`).toBe(true);
      expect(entry.assertion.trim().length).toBeGreaterThan(0);
    }
  });

  it('cross-covers authority, safety-sensitive context, and ranking in one golden decision', () => {
    const fixture = GOLDEN_SELECTION_FIXTURES.find((candidate) => candidate.scenarioId === 'authority-safety-ranking');
    expect(fixture?.context).toMatchObject({ semanticRisk: 'HIGH', authorityRequirement: 'REQUIRED', validationProfile: 'AUTHORITY_SENSITIVE' });
    expect(fixture?.expected.reasonCode).toBe(RoutingReasonCode.SELECTED);
    expect(fixture?.expected.rankingVector.map((entry) => entry.dimension)).toEqual(['AUTHORITY_RELIABILITY','COST_TIER']);
  });

  it('does not expose execution, validation, clock, or Provider-call facts in the selection projection', () => {
    for (const fixture of GOLDEN_SELECTION_FIXTURES) {
      expect(Object.keys(fixture.expected).sort()).toEqual([
        'configurationDigest','eligibleProviderIds','matchedPolicyId','policyConfigurationDigest','policyVersion',
        'rankingVector','reasonCode','registryConfigurationDigest','registryVersion','selectedProviderId',
      ].sort());
      expect(JSON.stringify(fixture.expected)).not.toMatch(/attempt|gateway|output|deadline|clock|executionPlan/iu);
    }
  });
});
