import type {
  ProviderSelectionDecision,
  RankingDimension,
  SortDirection,
} from '@chunsik/core';

export const SELECTION_FIXTURE_SCHEMA_VERSION = 'routing-selection-fixture-v1' as const;
export const SELECTION_HARNESS_DIGEST_VERSION = 'routing-selection-harness-digest-v1' as const;
export const SELECTION_FIXTURE_COMPILER_VERSION = 'routing-selection-fixture-compiler-v1' as const;

export interface SelectionRankingProjection {
  readonly dimension: RankingDimension;
  readonly direction: SortDirection;
}

export interface CanonicalSelectionProjection extends ProviderSelectionDecision {
  readonly rankingVector: readonly SelectionRankingProjection[];
}

export interface SelectionProviderFixture {
  readonly id: string;
  readonly availability: string;
  readonly enabled: boolean;
  readonly supportedCapabilities: readonly string[];
  readonly routingClasses: readonly string[];
  readonly semanticReliability: string;
  readonly authorityReliability: string;
  readonly continuityReliability: string;
  readonly toolUse: string;
  readonly structuredOutput: string;
  readonly contextCapacity: string;
  readonly executionLocality: string;
  readonly latencyTier: string;
  readonly costTier: string;
}

export interface SelectionPolicyFixture {
  readonly policyId: string;
  readonly version: string;
  readonly precedence: number;
  readonly when: Readonly<Record<string, readonly string[]>>;
  readonly eligibility: Readonly<Record<string, unknown>>;
  readonly ranking: readonly Readonly<{
    dimension: string;
    direction: string;
    routingClassPreference: readonly string[];
  }>[];
  readonly terminal: string;
}

export interface SelectionFixture {
  readonly schemaVersion: typeof SELECTION_FIXTURE_SCHEMA_VERSION;
  readonly compilerVersion: typeof SELECTION_FIXTURE_COMPILER_VERSION;
  readonly fixtureVersion: string;
  readonly scenarioId: string;
  readonly description: string;
  readonly context: Readonly<Record<string, string>>;
  readonly registry: {
    readonly version: string;
    readonly providers: readonly SelectionProviderFixture[];
  };
  readonly policyConfiguration: {
    readonly version: string;
    readonly policies: readonly SelectionPolicyFixture[];
  };
  readonly expected: CanonicalSelectionProjection;
  readonly fixtureDigest: string;
}

export interface SelectionManifest {
  readonly harnessDigestVersion: typeof SELECTION_HARNESS_DIGEST_VERSION;
  readonly compilerVersion: typeof SELECTION_FIXTURE_COMPILER_VERSION;
  readonly fixtures: readonly Readonly<{
    scenarioId: string;
    fixtureVersion: string;
    fixtureDigest: string;
  }>[];
  readonly corpusDigest: string;
}

export interface SelectionReplayResult {
  readonly projection: CanonicalSelectionProjection;
  readonly projectionDigest: string;
  readonly providerInvocations: 0;
}

export interface SelectionCoverageEntry {
  readonly axis: string;
  readonly scenarioId: string;
  readonly assertion: string;
}
