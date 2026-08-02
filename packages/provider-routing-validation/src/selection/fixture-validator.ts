import {
  AuthorityRequirement,
  Capability,
  ContextCapacity,
  CostTier,
  ExecutionLocality,
  IntentType,
  LatencyClass,
  LatencyTier,
  OutputSizeClass,
  ProviderAvailability,
  RankingDimension,
  ReliabilityTier,
  Requirement,
  RoutingClass,
  RoutingReasonCode,
  RoutingRequestType,
  SemanticRisk,
  SortDirection,
  SupportLevel,
  TerminalDecision,
} from '@chunsik/core';
import {
  SELECTION_FIXTURE_COMPILER_VERSION,
  SELECTION_FIXTURE_SCHEMA_VERSION,
  SELECTION_HARNESS_DIGEST_VERSION,
  SelectionFixture,
  SelectionManifest,
} from './contracts';

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ROUTING_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const enumSet = (value: Record<string, string>): ReadonlySet<string> => new Set(Object.values(value));

const CONTEXT_KEYS = ['capability','requestType','intentType','semanticRisk','latencyClass','toolUseRequirement','authorityRequirement','continuityRequirement','expectedOutputSize','validationProfile'] as const;
const PROVIDER_KEYS = ['id','availability','enabled','supportedCapabilities','routingClasses','semanticReliability','authorityReliability','continuityReliability','toolUse','structuredOutput','contextCapacity','executionLocality','latencyTier','costTier'] as const;
const WHEN_KEYS = ['capabilities','requestTypes','intentTypes','semanticRisks','latencyClasses','toolUseRequirements','authorityRequirements','continuityRequirements','outputSizes','validationProfiles'] as const;
const ELIGIBILITY_KEYS = ['requiredRoutingClasses','excludedRoutingClasses','minimumSemanticReliability','minimumAuthorityReliability','minimumContinuityReliability','requiresToolUse','requiresStructuredOutput','minimumContextCapacity','executionLocality'] as const;
const EXPECTED_KEYS = ['selectedProviderId','eligibleProviderIds','matchedPolicyId','reasonCode','policyVersion','registryVersion','registryConfigurationDigest','policyConfigurationDigest','configurationDigest','rankingVector'] as const;

function object(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[], name: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${name} has unknown or missing fields`);
}
function text(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  return value;
}
function member(value: unknown, allowed: ReadonlySet<string>, name: string): string {
  const result = text(value, name);
  if (!allowed.has(result)) throw new Error(`${name} is invalid`);
  return result;
}
function strings(value: unknown, allowed: ReadonlySet<string>, name: string): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !allowed.has(entry))) throw new Error(`${name} must be an enum array`);
  if (new Set(value).size !== value.length) throw new Error(`${name} has duplicates`);
}
function identifiers(value: unknown, name: string): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !ROUTING_IDENTIFIER.test(entry))) {
    throw new Error(`${name} must be an identifier array`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${name} has duplicates`);
}
function nullableMember(value: unknown, allowed: ReadonlySet<string>, name: string): void {
  if (value !== null) member(value, allowed, name);
}

export function validateSelectionFixture(value: unknown): SelectionFixture {
  const root = object(value, 'fixture');
  exact(root, ['schemaVersion','compilerVersion','fixtureVersion','scenarioId','description','context','registry','policyConfiguration','expected','fixtureDigest'], 'fixture');
  if (root.schemaVersion !== SELECTION_FIXTURE_SCHEMA_VERSION) throw new Error('Unknown selection fixture schema');
  if (root.compilerVersion !== SELECTION_FIXTURE_COMPILER_VERSION) throw new Error('Unknown selection fixture compiler');
  if (!VERSION.test(text(root.fixtureVersion, 'fixtureVersion')) || !ID.test(text(root.scenarioId, 'scenarioId'))) throw new Error('Invalid fixture identity');
  text(root.description, 'description');

  const context = object(root.context, 'context'); exact(context, CONTEXT_KEYS, 'context');
  member(context.capability, enumSet(Capability), 'context.capability');
  member(context.requestType, enumSet(RoutingRequestType), 'context.requestType');
  member(context.intentType, enumSet(IntentType), 'context.intentType');
  member(context.semanticRisk, enumSet(SemanticRisk), 'context.semanticRisk');
  member(context.latencyClass, enumSet(LatencyClass), 'context.latencyClass');
  member(context.toolUseRequirement, enumSet(Requirement), 'context.toolUseRequirement');
  member(context.authorityRequirement, enumSet(AuthorityRequirement), 'context.authorityRequirement');
  member(context.continuityRequirement, enumSet(Requirement), 'context.continuityRequirement');
  member(context.expectedOutputSize, enumSet(OutputSizeClass), 'context.expectedOutputSize');
  if (!ROUTING_IDENTIFIER.test(text(context.validationProfile, 'context.validationProfile'))) throw new Error('Invalid validationProfile');

  const registry = object(root.registry, 'registry'); exact(registry, ['version','providers'], 'registry');
  if (!VERSION.test(text(registry.version, 'registry.version')) || !Array.isArray(registry.providers) || registry.providers.length === 0) throw new Error('Invalid registry');
  const ids = new Set<string>();
  registry.providers.forEach((raw) => {
    const provider = object(raw, 'provider'); exact(provider, PROVIDER_KEYS, 'provider');
    const id = text(provider.id, 'provider.id'); if (!ID.test(id) || ids.has(id)) throw new Error('Invalid or duplicate provider id'); ids.add(id);
    member(provider.availability, enumSet(ProviderAvailability), 'provider.availability');
    if (typeof provider.enabled !== 'boolean') throw new Error('provider.enabled must be boolean');
    strings(provider.supportedCapabilities, enumSet(Capability), 'supportedCapabilities');
    strings(provider.routingClasses, enumSet(RoutingClass), 'routingClasses');
    if ((provider.supportedCapabilities as unknown[]).length === 0 || (provider.routingClasses as unknown[]).length === 0) throw new Error('Provider arrays must not be empty');
    member(provider.semanticReliability, enumSet(ReliabilityTier), 'semanticReliability');
    member(provider.authorityReliability, enumSet(ReliabilityTier), 'authorityReliability');
    member(provider.continuityReliability, enumSet(ReliabilityTier), 'continuityReliability');
    member(provider.toolUse, enumSet(SupportLevel), 'toolUse'); member(provider.structuredOutput, enumSet(SupportLevel), 'structuredOutput');
    member(provider.contextCapacity, enumSet(ContextCapacity), 'contextCapacity'); member(provider.executionLocality, enumSet(ExecutionLocality), 'executionLocality');
    member(provider.latencyTier, enumSet(LatencyTier), 'latencyTier'); member(provider.costTier, enumSet(CostTier), 'costTier');
  });

  const configuration = object(root.policyConfiguration, 'policyConfiguration'); exact(configuration, ['version','policies'], 'policyConfiguration');
  if (!VERSION.test(text(configuration.version, 'policyConfiguration.version')) || !Array.isArray(configuration.policies) || configuration.policies.length === 0) throw new Error('Invalid policy configuration');
  configuration.policies.forEach((raw) => {
    const policy = object(raw, 'policy'); exact(policy, ['policyId','version','precedence','when','eligibility','ranking','terminal'], 'policy');
    if (!ID.test(text(policy.policyId, 'policyId')) || !VERSION.test(text(policy.version, 'policy.version')) || !Number.isSafeInteger(policy.precedence) || (policy.precedence as number) < 0) throw new Error('Invalid policy identity');
    const when = object(policy.when, 'when'); exact(when, WHEN_KEYS, 'when');
    const whenEnums: readonly [string, ReadonlySet<string>][] = [['capabilities',enumSet(Capability)],['requestTypes',enumSet(RoutingRequestType)],['intentTypes',enumSet(IntentType)],['semanticRisks',enumSet(SemanticRisk)],['latencyClasses',enumSet(LatencyClass)],['toolUseRequirements',enumSet(Requirement)],['authorityRequirements',enumSet(AuthorityRequirement)],['continuityRequirements',enumSet(Requirement)],['outputSizes',enumSet(OutputSizeClass)]];
    whenEnums.forEach(([key, allowed]) => strings(when[key], allowed, `when.${key}`));
    identifiers(when.validationProfiles, 'when.validationProfiles');
    const eligibility = object(policy.eligibility, 'eligibility'); exact(eligibility, ELIGIBILITY_KEYS, 'eligibility');
    strings(eligibility.requiredRoutingClasses, enumSet(RoutingClass), 'requiredRoutingClasses'); strings(eligibility.excludedRoutingClasses, enumSet(RoutingClass), 'excludedRoutingClasses');
    nullableMember(eligibility.minimumSemanticReliability, enumSet(ReliabilityTier), 'minimumSemanticReliability'); nullableMember(eligibility.minimumAuthorityReliability, enumSet(ReliabilityTier), 'minimumAuthorityReliability'); nullableMember(eligibility.minimumContinuityReliability, enumSet(ReliabilityTier), 'minimumContinuityReliability');
    if (![null,true,false].includes(eligibility.requiresToolUse as null | boolean) || ![null,true,false].includes(eligibility.requiresStructuredOutput as null | boolean)) throw new Error('Invalid eligibility booleans');
    nullableMember(eligibility.minimumContextCapacity, enumSet(ContextCapacity), 'minimumContextCapacity'); nullableMember(eligibility.executionLocality, enumSet(ExecutionLocality), 'executionLocality');
    if (!Array.isArray(policy.ranking) || policy.ranking.length === 0) throw new Error('ranking must not be empty');
    policy.ranking.forEach((rawRule) => { const rule = object(rawRule, 'ranking rule'); exact(rule, ['dimension','direction','routingClassPreference'], 'ranking rule'); member(rule.dimension, enumSet(RankingDimension), 'dimension'); member(rule.direction, enumSet(SortDirection), 'direction'); strings(rule.routingClassPreference, enumSet(RoutingClass), 'routingClassPreference'); });
    member(policy.terminal, enumSet(TerminalDecision), 'terminal');
  });

  const expected = object(root.expected, 'expected'); exact(expected, EXPECTED_KEYS, 'expected');
  if (expected.selectedProviderId !== null) text(expected.selectedProviderId, 'selectedProviderId');
  if (!Array.isArray(expected.eligibleProviderIds) || expected.eligibleProviderIds.some((id) => typeof id !== 'string')) throw new Error('eligibleProviderIds must be strings');
  if (expected.matchedPolicyId !== null) text(expected.matchedPolicyId, 'matchedPolicyId');
  member(expected.reasonCode, enumSet(RoutingReasonCode), 'reasonCode'); text(expected.policyVersion, 'policyVersion'); text(expected.registryVersion, 'registryVersion');
  ['registryConfigurationDigest','policyConfigurationDigest','configurationDigest'].forEach((key) => { if (!SHA256.test(text(expected[key], key))) throw new Error(`Invalid ${key}`); });
  if (!Array.isArray(expected.rankingVector)) throw new Error('rankingVector must be an array');
  expected.rankingVector.forEach((raw) => { const vector = object(raw, 'rankingVector'); exact(vector, ['dimension','direction'], 'rankingVector'); member(vector.dimension, enumSet(RankingDimension), 'dimension'); member(vector.direction, enumSet(SortDirection), 'direction'); });
  if (!SHA256.test(text(root.fixtureDigest, 'fixtureDigest'))) throw new Error('Invalid fixtureDigest');
  return value as SelectionFixture;
}

export function validateSelectionManifest(value: unknown): SelectionManifest {
  const root = object(value, 'selection manifest');
  exact(root, ['harnessDigestVersion','compilerVersion','fixtures','corpusDigest'], 'selection manifest');
  if (root.harnessDigestVersion !== SELECTION_HARNESS_DIGEST_VERSION) throw new Error('Unknown selection harness digest version');
  if (root.compilerVersion !== SELECTION_FIXTURE_COMPILER_VERSION) throw new Error('Unknown selection manifest compiler');
  if (!Array.isArray(root.fixtures) || root.fixtures.length === 0) throw new Error('Selection manifest fixtures must not be empty');
  const scenarioIds = new Set<string>();
  root.fixtures.forEach((raw) => {
    const fixture = object(raw, 'selection manifest fixture');
    exact(fixture, ['scenarioId','fixtureVersion','fixtureDigest'], 'selection manifest fixture');
    const scenarioId = text(fixture.scenarioId, 'scenarioId');
    if (!ID.test(scenarioId) || scenarioIds.has(scenarioId)) throw new Error('Invalid or duplicate manifest scenarioId');
    scenarioIds.add(scenarioId);
    if (!VERSION.test(text(fixture.fixtureVersion, 'fixtureVersion'))) throw new Error('Invalid manifest fixtureVersion');
    if (!SHA256.test(text(fixture.fixtureDigest, 'fixtureDigest'))) throw new Error('Invalid manifest fixtureDigest');
  });
  if (!SHA256.test(text(root.corpusDigest, 'corpusDigest'))) throw new Error('Invalid selection corpusDigest');
  return value as SelectionManifest;
}
