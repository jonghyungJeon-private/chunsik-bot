import {
  AiFailureKind,
  ProviderAttemptOutcome,
  ProviderBindingFailureCode,
  ProviderGatewayTerminalStatus,
  ResponseValidationReasonCode,
  RoutingExecutionState,
  RoutingFailureCode,
  ValidationDisposition,
} from '@chunsik/core';
import {
  FIXTURE_SCHEMA_VERSION,
  FixtureManifest,
  HARNESS_DIGEST_VERSION,
  RoutingValidationFixture,
} from './contracts';

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const enumSet = (value: Record<string, string>): ReadonlySet<string> => new Set(Object.values(value));
const failures = new Set([...Object.values(RoutingFailureCode), ...Object.values(ProviderBindingFailureCode)]);

function object(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[], name: string): void {
  const actual = Object.keys(value).sort();
  const allowed = [...keys].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    throw new Error(`${name} has unknown or missing fields`);
  }
}
function string(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  return value;
}
function integer(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${name} must be a non-negative integer`);
  return value as number;
}
function member(value: unknown, allowed: ReadonlySet<string>, name: string): string {
  const text = string(value, name);
  if (!allowed.has(text)) throw new Error(`${name} is invalid`);
  return text;
}

export function validateFixture(value: unknown): RoutingValidationFixture {
  const root = object(value, 'fixture');
  exact(root, ['schemaVersion','fixtureVersion','scenarioId','description','selectedProviderId','validationProfile','providers','deadline','request','expected','fixtureDigest'], 'fixture');
  if (root.schemaVersion !== FIXTURE_SCHEMA_VERSION) throw new Error('Unknown fixture schemaVersion');
  if (!VERSION.test(string(root.fixtureVersion, 'fixtureVersion'))) throw new Error('Invalid fixtureVersion');
  if (!ID.test(string(root.scenarioId, 'scenarioId'))) throw new Error('Invalid scenarioId');
  string(root.description, 'description');
  if (!ID.test(string(root.selectedProviderId, 'selectedProviderId'))) throw new Error('Invalid selectedProviderId');
  member(root.validationProfile, new Set(['GENERAL_CHAT','AUTHORITY_SENSITIVE']), 'validationProfile');
  if (!Array.isArray(root.providers) || root.providers.length < 1 || root.providers.length > 3) throw new Error('providers must contain 1..3 entries');
  const providerIds = new Set<string>();
  for (const raw of root.providers) {
    const provider = object(raw, 'provider');
    exact(provider, ['id','authorityReliability','outcome'], 'provider');
    const id = string(provider.id, 'provider.id');
    if (!ID.test(id) || providerIds.has(id)) throw new Error('Invalid or duplicate provider.id');
    providerIds.add(id);
    member(provider.authorityReliability, new Set(['LOW','STANDARD','HIGH']), 'authorityReliability');
    const outcome = object(provider.outcome, 'outcome');
    const kind = member(outcome.kind, new Set(['RETURN','THROW_CLASSIFIED','THROW_UNKNOWN']), 'outcome.kind');
    exact(outcome, kind === 'RETURN' ? ['kind','text','advanceMs'] : kind === 'THROW_CLASSIFIED' ? ['kind','failureKind','advanceMs'] : ['kind','advanceMs'], 'outcome');
    integer(outcome.advanceMs, 'outcome.advanceMs');
    if (kind === 'RETURN') string(outcome.text, 'outcome.text');
    if (kind === 'THROW_CLASSIFIED') member(outcome.failureKind, enumSet(AiFailureKind), 'outcome.failureKind');
  }
  if (!providerIds.has(string(root.selectedProviderId, 'selectedProviderId'))) throw new Error('Selected provider is absent');
  const deadline = object(root.deadline, 'deadline');
  exact(deadline, ['initialMs','overallBudgetMs','validationReserveMs','minimumAttemptBudgetMs'], 'deadline');
  Object.entries(deadline).forEach(([key, child]) => integer(child, `deadline.${key}`));
  const request = object(root.request, 'request');
  const requestKeys = root.request && 'timeoutMs' in request ? ['prompt','timeoutMs'] : ['prompt'];
  exact(request, requestKeys, 'request');
  string(request.prompt, 'request.prompt');
  if ('timeoutMs' in request) integer(request.timeoutMs, 'request.timeoutMs');
  const expected = object(root.expected, 'expected');
  exact(expected, ['terminalStatus','failureCode','humanReviewRequired','outputText','path','attemptCount','attempts','transitions','finalProviderId','finalPurpose'], 'expected');
  member(expected.terminalStatus, enumSet(ProviderGatewayTerminalStatus), 'expected.terminalStatus');
  if (expected.failureCode !== null) member(expected.failureCode, failures, 'expected.failureCode');
  if (typeof expected.humanReviewRequired !== 'boolean') throw new Error('humanReviewRequired must be boolean');
  if (expected.outputText !== null) string(expected.outputText, 'outputText');
  member(expected.path, new Set(['PRIMARY_ONLY','FALLBACK','ESCALATION']), 'path');
  integer(expected.attemptCount, 'attemptCount');
  if (!Array.isArray(expected.attempts) || !Array.isArray(expected.transitions)) throw new Error('Expected audit arrays are required');
  for (const raw of expected.attempts) {
    const attempt = object(raw, 'attempt');
    exact(attempt, ['attemptIndex','purpose','providerId','outcome','failureCode','validationDisposition','validationReasonCodes','validationSucceeded'], 'attempt');
    integer(attempt.attemptIndex, 'attemptIndex'); string(attempt.purpose, 'purpose'); string(attempt.providerId, 'providerId');
    member(attempt.outcome, enumSet(ProviderAttemptOutcome), 'outcome');
    if (attempt.failureCode !== null) member(attempt.failureCode, enumSet(RoutingFailureCode), 'failureCode');
    if (attempt.validationDisposition !== null) member(attempt.validationDisposition, enumSet(ValidationDisposition), 'validationDisposition');
    if (!Array.isArray(attempt.validationReasonCodes)) throw new Error('validationReasonCodes must be an array');
    attempt.validationReasonCodes.forEach((reason) => member(reason, enumSet(ResponseValidationReasonCode), 'reasonCode'));
    if (typeof attempt.validationSucceeded !== 'boolean') throw new Error('validationSucceeded must be boolean');
  }
  for (const raw of expected.transitions) {
    const transition = object(raw, 'transition');
    exact(transition, ['sequence','from','to','cause'], 'transition');
    integer(transition.sequence, 'sequence'); member(transition.from, enumSet(RoutingExecutionState), 'from');
    member(transition.to, enumSet(RoutingExecutionState), 'to'); string(transition.cause, 'cause');
  }
  if (expected.finalProviderId !== null) string(expected.finalProviderId, 'finalProviderId');
  if (expected.finalPurpose !== null) string(expected.finalPurpose, 'finalPurpose');
  if (!SHA256.test(string(root.fixtureDigest, 'fixtureDigest'))) throw new Error('Invalid fixtureDigest');
  return value as RoutingValidationFixture;
}

export function validateManifest(value: unknown): FixtureManifest {
  const root = object(value, 'manifest');
  exact(root, ['harnessDigestVersion','fixtures','corpusDigest'], 'manifest');
  if (root.harnessDigestVersion !== HARNESS_DIGEST_VERSION) throw new Error('Unknown harness digest version');
  if (!Array.isArray(root.fixtures)) throw new Error('manifest.fixtures must be an array');
  root.fixtures.forEach((raw) => {
    const entry = object(raw, 'manifest entry');
    exact(entry, ['scenarioId','fixtureVersion','fixtureDigest'], 'manifest entry');
    if (!ID.test(string(entry.scenarioId, 'scenarioId')) || !VERSION.test(string(entry.fixtureVersion, 'fixtureVersion')) || !SHA256.test(string(entry.fixtureDigest, 'fixtureDigest'))) throw new Error('Invalid manifest entry');
  });
  if (!SHA256.test(string(root.corpusDigest, 'corpusDigest'))) throw new Error('Invalid corpusDigest');
  return value as FixtureManifest;
}
