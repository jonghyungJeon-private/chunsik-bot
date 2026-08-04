import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { OllamaCliProvider, defaultCliRunner } from '@chunsik/ai-cli';
import type { CliRunner } from '@chunsik/ai-cli';
import {
  GENERAL_CHAT,
  AdapterId,
  AvailabilityClass,
  AuthorityRequirement,
  Capability,
  ConcurrencyClass,
  ContextCapacity,
  CostTier,
  DeadlineClass,
  ExecutionLocality,
  IntentType,
  LatencyClass,
  LatencyTier,
  OutputSizeClass,
  ProviderAvailability,
  ProviderBindingRegistry,
  ProviderBindingConfigurationError,
  ProviderExecutionPlanner,
  ProviderId,
  ProviderRegistry,
  ProviderRoutingGateway,
  RankingDimension,
  ReliabilityTier,
  Requirement,
  RoutingClass,
  RoutingPolicyEngine,
  RoutingRequestType,
  SemanticRisk,
  SortDirection,
  SupportLevel,
  TerminalDecision,
  TimeoutClass,
  adapterId,
  createDefaultValidationProfileRegistry,
  policyId,
  providerId,
} from '@chunsik/core';
import type {
  AiProvider,
  ProviderDescriptor,
  RoutingContext,
  RoutingPolicyConfiguration,
} from '@chunsik/core';
import { ExternalEgressControl } from '../provider-routing/ollama-preflight/contracts';

export const PROVIDER_GENERATION_VALIDATION_CONTRACT_VERSION =
  'stage2b-provider-generation-validation-v1' as const;
export const VALIDATION_PROVIDER_ID = providerId('ollama-cli:llama3.1:8b');
export const VALIDATION_ADAPTER_ID = adapterId('ollama-cli');
export const VALIDATION_MODEL_ID = 'llama3.1:8b' as const;
export const VALIDATION_PROMPT =
  'Return exactly this token and nothing else:\nQUIRKYBOT_STAGE_2B_PROVIDER_OK' as const;
export const VALIDATION_PROMPT_DIGEST =
  '12a9525d65db443f5bb1a3e93d0f2d8229c76f15dc1e72f9d1b3df252ba8d006' as const;
export const EXPECTED_VALIDATION_OUTPUT = 'QUIRKYBOT_STAGE_2B_PROVIDER_OK' as const;
export const MAX_NORMALIZED_OUTPUT_BYTES = 128;

export enum ModelAcquisitionControl {
  DENIED_VERIFIED = 'DENIED_VERIFIED',
  PRECHECK_OBSERVE_POSTCHECK_RISK_ACCEPTED = 'PRECHECK_OBSERVE_POSTCHECK_RISK_ACCEPTED',
}

export type GenerationValidationFailureCode =
  | 'PRIMARY_ONLY_PLAN_REQUIRED'
  | 'MODEL_NOT_AVAILABLE'
  | 'MODEL_DOWNLOAD_RISK_UNCONTROLLED'
  | 'MODEL_DOWNLOAD_DETECTED'
  | 'PRE_GENERATION_PREFLIGHT_FAILED'
  | 'POST_GENERATION_PREFLIGHT_FAILED'
  | 'INVENTORY_CHANGED'
  | 'EXPECTED_OUTPUT_MISMATCH'
  | 'OUTPUT_OVERFLOW'
  | 'PROVIDER_EXECUTION_FAILED';

export interface GenerationInventorySnapshot {
  readonly passed: boolean;
  readonly requiredModelPresent: boolean;
  readonly inventoryFingerprint: string | null;
  readonly externalEgressControl: ExternalEgressControl | null;
  readonly externalEgressIsolationVerified: boolean;
  readonly networkClass: 'LOOPBACK_DAEMON' | null;
}

export interface ProviderGenerationValidationInput {
  readonly executableRealpath: string;
  readonly approvedLoopbackEndpoint: string;
  readonly modelAcquisitionControl: ModelAcquisitionControl;
}

export interface ProviderGenerationValidationDependencies {
  readonly runPreflight: (phase: 'PRE' | 'POST') => Promise<GenerationInventorySnapshot>;
  readonly generationRunner?: CliRunner;
  readonly verifyModelAcquisitionDenied?: () => boolean;
  readonly providerFactory?: (options: {
    readonly bin: string;
    readonly model: string;
    readonly providerId: string;
    readonly validationHost: string;
    readonly runner: CliRunner;
  }) => AiProvider;
}

export interface ProviderGenerationValidationProjection {
  readonly contractVersion: typeof PROVIDER_GENERATION_VALIDATION_CONTRACT_VERSION;
  readonly status: 'PASS' | 'FAIL' | 'BLOCKED';
  readonly failureCode: GenerationValidationFailureCode | string | null;
  readonly promptDigest: typeof VALIDATION_PROMPT_DIGEST;
  readonly selectedProviderId: ProviderId | null;
  readonly selectedAdapterId: AdapterId | null;
  readonly selectedModelId: string | null;
  readonly planAttemptCount: 0 | 1;
  readonly providerExecutionCount: 0 | 1;
  readonly retryCount: 0;
  readonly fallbackCount: 0;
  readonly escalationCount: 0;
  readonly normalizedOutput: string | null;
  readonly normalizedOutputBytes: number;
  readonly expectedOutputMatched: boolean;
  readonly modelAcquisitionControl: ModelAcquisitionControl | null;
  readonly modelDownloadPreventionVerified: boolean;
  readonly downloadCapableCommandInvoked: boolean;
  readonly downloadObserved: boolean;
  readonly preflightPassed: boolean;
  readonly postflightPassed: boolean;
  readonly inventoryUnchanged: boolean;
  readonly timedOut: boolean;
  readonly outputOverflowed: boolean;
  readonly externalEgressControl: ExternalEgressControl | null;
  readonly externalEgressIsolationVerified: boolean;
  readonly networkClass: 'LOOPBACK_DAEMON' | null;
  readonly checks: readonly Readonly<{ code: string; status: 'PASS' | 'FAIL' | 'BLOCKED' }>[];
}

const validationDescriptor = (): ProviderDescriptor => ({
  providerId: VALIDATION_PROVIDER_ID,
  adapterId: VALIDATION_ADAPTER_ID,
  modelId: VALIDATION_MODEL_ID,
  capabilities: {
    supportedCapabilities: [Capability.GENERAL_CHAT], routingClasses: [RoutingClass.BALANCED],
    semanticReliability: ReliabilityTier.STANDARD, authorityReliability: ReliabilityTier.STANDARD,
    continuityReliability: ReliabilityTier.STANDARD, toolUse: SupportLevel.UNSUPPORTED,
    structuredOutput: SupportLevel.UNSUPPORTED, contextCapacity: ContextCapacity.MEDIUM,
    streaming: SupportLevel.UNSUPPORTED, executionLocality: ExecutionLocality.LOCAL,
  },
  operationalProfile: {
    latencyTier: LatencyTier.UNKNOWN, timeoutClass: TimeoutClass.STANDARD,
    costTier: CostTier.UNKNOWN, concurrencyClass: ConcurrencyClass.UNKNOWN,
    availabilityClass: AvailabilityClass.UNKNOWN,
  },
  enabled: true,
  profileVersion: 'stage2b-provider-generation-validation-profile-v1',
});

const validationPolicy = (): RoutingPolicyConfiguration => ({
  version: 'stage2b-provider-generation-validation-policy-v1',
  policies: [{
    policyId: policyId('stage2b-provider-generation-validation'), version: '1', precedence: 100,
    when: { capabilities: [Capability.GENERAL_CHAT], validationProfiles: [GENERAL_CHAT] },
    eligibility: {},
    ranking: [{ dimension: RankingDimension.ROUTING_CLASS, direction: SortDirection.ASCENDING,
      routingClassPreference: [RoutingClass.BALANCED] }],
    terminal: TerminalDecision.NO_SELECTION,
  }],
});

const validationContext = (): RoutingContext => ({
  capability: Capability.GENERAL_CHAT, requestType: RoutingRequestType.CONVERSATIONAL,
  intentType: IntentType.CHAT, semanticRisk: SemanticRisk.LOW, latencyClass: LatencyClass.BALANCED,
  toolUseRequirement: Requirement.NOT_REQUIRED, authorityRequirement: AuthorityRequirement.NOT_REQUIRED,
  continuityRequirement: Requirement.NOT_REQUIRED, expectedOutputSize: OutputSizeClass.SMALL,
  validationProfile: GENERAL_CHAT,
});

function validEndpoint(value: string): boolean {
  try {
    const endpoint = new URL(value);
    return endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1' &&
      endpoint.port.length > 0 && endpoint.pathname === '/' && !endpoint.search && !endpoint.hash &&
      !endpoint.username && !endpoint.password;
  } catch { return false; }
}

function emptyProjection(
  input: ProviderGenerationValidationInput,
  status: 'FAIL' | 'BLOCKED',
  failureCode: GenerationValidationFailureCode | string,
  checks: ProviderGenerationValidationProjection['checks'],
): ProviderGenerationValidationProjection {
  return Object.freeze({
    contractVersion: PROVIDER_GENERATION_VALIDATION_CONTRACT_VERSION, status, failureCode,
    promptDigest: VALIDATION_PROMPT_DIGEST, selectedProviderId: null, selectedAdapterId: null,
    selectedModelId: null, planAttemptCount: 0, providerExecutionCount: 0, retryCount: 0,
    fallbackCount: 0, escalationCount: 0, normalizedOutput: null, normalizedOutputBytes: 0,
    expectedOutputMatched: false, modelAcquisitionControl: input.modelAcquisitionControl ?? null,
    modelDownloadPreventionVerified: false, downloadCapableCommandInvoked: false,
    downloadObserved: false, preflightPassed: false, postflightPassed: false,
    inventoryUnchanged: false, timedOut: false, outputOverflowed: false,
    externalEgressControl: null, externalEgressIsolationVerified: false, networkClass: null,
    checks: Object.freeze([...checks]),
  });
}

export async function executeProviderGenerationValidation(
  input: ProviderGenerationValidationInput,
  dependencies: ProviderGenerationValidationDependencies,
): Promise<ProviderGenerationValidationProjection> {
  const checks: Array<Readonly<{ code: string; status: 'PASS' | 'FAIL' | 'BLOCKED' }>> = [];
  if (!isAbsolute(input.executableRealpath) || !validEndpoint(input.approvedLoopbackEndpoint) ||
      !Object.values(ModelAcquisitionControl).includes(input.modelAcquisitionControl)) {
    return emptyProjection(input, 'BLOCKED', 'MODEL_DOWNLOAD_RISK_UNCONTROLLED', checks);
  }
  let preventionVerified = false;
  if (input.modelAcquisitionControl === ModelAcquisitionControl.DENIED_VERIFIED) {
    try { preventionVerified = dependencies.verifyModelAcquisitionDenied?.() === true; } catch { preventionVerified = false; }
    if (!preventionVerified) return emptyProjection(input, 'BLOCKED', 'MODEL_DOWNLOAD_RISK_UNCONTROLLED', checks);
  }

  let preflight: GenerationInventorySnapshot;
  try { preflight = await dependencies.runPreflight('PRE'); } catch {
    return emptyProjection(input, 'BLOCKED', 'PRE_GENERATION_PREFLIGHT_FAILED', checks);
  }
  if (!preflight.passed || preflight.inventoryFingerprint === null) {
    return emptyProjection(input, 'BLOCKED', 'PRE_GENERATION_PREFLIGHT_FAILED', checks);
  }
  if (!preflight.requiredModelPresent) return emptyProjection(input, 'BLOCKED', 'MODEL_NOT_AVAILABLE', checks);
  checks.push(Object.freeze({ code: 'PRE_GENERATION_PREFLIGHT', status: 'PASS' }));

  const executionObservation: { count: number } = { count: 0 };
  let downloadObserved = false;
  let timedOut = false;
  let rawOutputOverflowed = false;
  const underlyingRunner = dependencies.generationRunner ?? defaultCliRunner;
  const observingRunner: CliRunner = async (bin, args, options) => {
    executionObservation.count = 1;
    const result = await underlyingRunner(bin, args, options);
    downloadObserved ||= result.downloadObserved === true;
    timedOut ||= result.timedOut;
    rawOutputOverflowed ||= result.code === null && /capture limit/u.test(result.stderr);
    return result;
  };
  const providerOptions = {
    bin: input.executableRealpath, model: VALIDATION_MODEL_ID,
    providerId: VALIDATION_PROVIDER_ID, validationHost: input.approvedLoopbackEndpoint,
    runner: observingRunner,
  };
  const provider = dependencies.providerFactory?.(providerOptions) ?? new OllamaCliProvider(providerOptions);

  try {
    const registry = new ProviderRegistry('stage2b-provider-generation-validation-registry-v1', [
      { providerId: VALIDATION_PROVIDER_ID, descriptor: validationDescriptor() },
    ]);
    const snapshot = registry.snapshot({ [VALIDATION_PROVIDER_ID]: ProviderAvailability.AVAILABLE });
    const bindings = new ProviderBindingRegistry(snapshot, [{
      providerId: VALIDATION_PROVIDER_ID, adapterId: VALIDATION_ADAPTER_ID,
      modelId: VALIDATION_MODEL_ID, bindingVersion: 'stage2b-provider-generation-validation-binding-v1', provider,
    }]);
    const policy = new RoutingPolicyEngine(validationPolicy());
    const decision = policy.select(validationContext(), snapshot);
    const profiles = createDefaultValidationProfileRegistry();
    const plan = new ProviderExecutionPlanner().create(decision, snapshot, bindings, profiles, {
      capability: Capability.GENERAL_CHAT, validationProfile: GENERAL_CHAT,
      deadlineClass: DeadlineClass.STANDARD, executionId: 'stage2b-provider-generation-validation',
    });
    const planAttemptCount = 1 + Number(plan.operationalFallback !== null) + Number(plan.semanticEscalation !== null);
    if (planAttemptCount !== 1 || plan.primary.providerId !== VALIDATION_PROVIDER_ID) {
      return emptyProjection(input, 'BLOCKED', 'PRIMARY_ONLY_PLAN_REQUIRED', checks);
    }
    checks.push(Object.freeze({ code: 'PRIMARY_ONLY_PLAN', status: 'PASS' }));
    const gateway = new ProviderRoutingGateway(bindings, profiles);
    const result = await gateway.execute(plan, {
      capability: Capability.GENERAL_CHAT, prompt: VALIDATION_PROMPT,
      contextFiles: [], timeoutMs: 45_000,
    });

    let postflight: GenerationInventorySnapshot | null = null;
    try { postflight = await dependencies.runPreflight('POST'); } catch { postflight = null; }
    const postflightPassed = postflight?.passed === true && postflight.inventoryFingerprint !== null;
    const inventoryUnchanged = postflightPassed &&
      postflight?.inventoryFingerprint === preflight.inventoryFingerprint;
    if (postflightPassed) checks.push(Object.freeze({ code: 'POST_GENERATION_PREFLIGHT', status: 'PASS' }));

    const rawOutput = result.output?.text ?? '';
    const normalizedOutput = rawOutput.trim();
    const normalizedOutputBytes = Buffer.byteLength(normalizedOutput, 'utf8');
    const outputOverflowed = rawOutputOverflowed || normalizedOutputBytes > MAX_NORMALIZED_OUTPUT_BYTES;
    const expectedOutputMatched = !outputOverflowed && normalizedOutput === EXPECTED_VALIDATION_OUTPUT;
    let status: 'PASS' | 'FAIL' = 'PASS';
    let failureCode: string | null = null;
    if (downloadObserved) failureCode = 'MODEL_DOWNLOAD_DETECTED';
    else if (!postflightPassed) failureCode = 'POST_GENERATION_PREFLIGHT_FAILED';
    else if (!inventoryUnchanged) failureCode = 'INVENTORY_CHANGED';
    else if (outputOverflowed) failureCode = 'OUTPUT_OVERFLOW';
    else if (!expectedOutputMatched) failureCode = result.failureCode ?? 'EXPECTED_OUTPUT_MISMATCH';
    if (failureCode !== null) status = 'FAIL';
    return Object.freeze({
      contractVersion: PROVIDER_GENERATION_VALIDATION_CONTRACT_VERSION, status, failureCode,
      promptDigest: VALIDATION_PROMPT_DIGEST, selectedProviderId: VALIDATION_PROVIDER_ID,
      selectedAdapterId: VALIDATION_ADAPTER_ID, selectedModelId: VALIDATION_MODEL_ID,
      planAttemptCount: 1, providerExecutionCount: executionObservation.count === 0 ? 0 : 1,
      retryCount: 0, fallbackCount: 0, escalationCount: 0,
      normalizedOutput: outputOverflowed ? null : normalizedOutput, normalizedOutputBytes,
      expectedOutputMatched, modelAcquisitionControl: input.modelAcquisitionControl,
      modelDownloadPreventionVerified: preventionVerified,
      downloadCapableCommandInvoked: executionObservation.count > 0,
      downloadObserved, preflightPassed: true, postflightPassed, inventoryUnchanged, timedOut,
      outputOverflowed, externalEgressControl: preflight.externalEgressControl,
      externalEgressIsolationVerified: preflight.externalEgressIsolationVerified,
      networkClass: preflight.networkClass, checks: Object.freeze(checks),
    });
  } catch (error) {
    const failureCode = error instanceof ProviderBindingConfigurationError
      ? error.code : 'PROVIDER_EXECUTION_FAILED';
    return emptyProjection(input, 'BLOCKED', failureCode, checks);
  }
}

export function validationPromptDigest(): string {
  return createHash('sha256').update(Buffer.from(VALIDATION_PROMPT, 'utf8')).digest('hex');
}
