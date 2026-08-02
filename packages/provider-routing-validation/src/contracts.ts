import type {
  ProviderAttemptOutcome,
  ProviderExecutionPath,
  ProviderGatewayFailureCode,
  ProviderGatewayTerminalStatus,
  ResponseValidationReasonCode,
  RoutingExecutionState,
  RoutingFailureCode,
  ValidationDisposition,
} from '@chunsik/core';

export const FIXTURE_SCHEMA_VERSION = 'routing-validation-fixture-v1' as const;
export const HARNESS_DIGEST_VERSION = 'provider-routing-harness-digest-v1' as const;

export type FixtureValidationProfile = 'GENERAL_CHAT' | 'AUTHORITY_SENSITIVE';
export type FixtureReliability = 'LOW' | 'STANDARD' | 'HIGH';

export type ScriptedOutcome =
  | { readonly kind: 'RETURN'; readonly text: string; readonly advanceMs: number }
  | { readonly kind: 'THROW_CLASSIFIED'; readonly failureKind: string; readonly advanceMs: number }
  | { readonly kind: 'THROW_UNKNOWN'; readonly advanceMs: number };

export interface ProviderFixture {
  readonly id: string;
  readonly authorityReliability: FixtureReliability;
  readonly outcome: ScriptedOutcome;
}

export interface CanonicalAttemptProjection {
  readonly attemptIndex: number;
  readonly purpose: string;
  readonly providerId: string;
  readonly outcome: ProviderAttemptOutcome;
  readonly failureCode: RoutingFailureCode | null;
  readonly validationDisposition: ValidationDisposition | null;
  readonly validationReasonCodes: readonly ResponseValidationReasonCode[];
  readonly validationSucceeded: boolean;
}

export interface CanonicalTransitionProjection {
  readonly sequence: number;
  readonly from: RoutingExecutionState;
  readonly to: RoutingExecutionState;
  readonly cause: string;
}

/** Harness-owned stable subset. Product audit fields may evolve independently. */
export interface CanonicalAuditProjection {
  readonly terminalStatus: ProviderGatewayTerminalStatus;
  readonly failureCode: ProviderGatewayFailureCode | null;
  readonly humanReviewRequired: boolean;
  readonly outputText: string | null;
  readonly path: ProviderExecutionPath;
  readonly attemptCount: number;
  readonly attempts: readonly CanonicalAttemptProjection[];
  readonly transitions: readonly CanonicalTransitionProjection[];
  readonly finalProviderId: string | null;
  readonly finalPurpose: string | null;
}

export interface RoutingValidationFixture {
  readonly schemaVersion: typeof FIXTURE_SCHEMA_VERSION;
  readonly fixtureVersion: string;
  readonly scenarioId: string;
  readonly description: string;
  readonly selectedProviderId: string;
  readonly validationProfile: FixtureValidationProfile;
  readonly providers: readonly ProviderFixture[];
  readonly deadline: {
    readonly initialMs: number;
    readonly overallBudgetMs: number;
    readonly validationReserveMs: number;
    readonly minimumAttemptBudgetMs: number;
  };
  readonly request: { readonly prompt: string; readonly timeoutMs?: number };
  readonly expected: CanonicalAuditProjection;
  readonly fixtureDigest: string;
}

export interface FixtureManifestEntry {
  readonly scenarioId: string;
  readonly fixtureVersion: string;
  readonly fixtureDigest: string;
}

export interface FixtureManifest {
  readonly harnessDigestVersion: typeof HARNESS_DIGEST_VERSION;
  readonly fixtures: readonly FixtureManifestEntry[];
  readonly corpusDigest: string;
}

export interface ReplayResult {
  readonly projection: CanonicalAuditProjection;
  readonly projectionDigest: string;
  readonly providerInvocations: number;
}
