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
  | 'PROVIDER_EXECUTION_COUNT_EXCEEDED'
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
  /** Test-only post-dispatch seam for terminal observation preservation. */
  readonly afterProviderExecution?: () => void;
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
  readonly providerExecutionCount: number;
  readonly retryCount: number;
  readonly fallbackCount: 0 | 1;
  readonly escalationCount: 0 | 1;
  readonly normalizedOutput: string | null;
  readonly normalizedOutputDigest: string | null;
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
  observations: LifecycleObservations = lifecycleObservations(),
): ProviderGenerationValidationProjection {
  const acquisitionControl = Object.values(ModelAcquisitionControl).includes(input.modelAcquisitionControl)
    ? input.modelAcquisitionControl : null;
  return Object.freeze({
    contractVersion: PROVIDER_GENERATION_VALIDATION_CONTRACT_VERSION, status, failureCode,
    promptDigest: VALIDATION_PROMPT_DIGEST,
    selectedProviderId: observations.selected ? VALIDATION_PROVIDER_ID : null,
    selectedAdapterId: observations.selected ? VALIDATION_ADAPTER_ID : null,
    selectedModelId: observations.selected ? VALIDATION_MODEL_ID : null,
    planAttemptCount: observations.planAttemptCount,
    providerExecutionCount: observations.providerInvocationCount,
    retryCount: Math.max(0, observations.providerInvocationCount - 1),
    fallbackCount: observations.fallbackCount, escalationCount: observations.escalationCount,
    normalizedOutput: null, normalizedOutputDigest: observations.normalizedOutputDigest,
    normalizedOutputBytes: observations.normalizedOutputBytes, expectedOutputMatched: false,
    modelAcquisitionControl: acquisitionControl,
    modelDownloadPreventionVerified: observations.modelDownloadPreventionVerified,
    downloadCapableCommandInvoked: observations.delegatedRunnerCount > 0,
    downloadObserved: observations.downloadObserved,
    preflightPassed: observations.preflightPassed, postflightPassed: observations.postflightPassed,
    inventoryUnchanged: observations.inventoryUnchanged, timedOut: observations.timedOut,
    outputOverflowed: observations.outputOverflowed,
    externalEgressControl: observations.externalEgressControl,
    externalEgressIsolationVerified: observations.externalEgressIsolationVerified,
    networkClass: observations.networkClass,
    checks: Object.freeze([...checks]),
  });
}

interface LifecycleObservations {
  providerInvocationCount: number;
  delegatedRunnerCount: number;
  downloadObserved: boolean;
  timedOut: boolean;
  outputOverflowed: boolean;
  preflightPassed: boolean;
  postflightPassed: boolean;
  inventoryUnchanged: boolean;
  modelDownloadPreventionVerified: boolean;
  selected: boolean;
  planAttemptCount: 0 | 1;
  fallbackCount: 0 | 1;
  escalationCount: 0 | 1;
  normalizedOutputDigest: string | null;
  normalizedOutputBytes: number;
  externalEgressControl: ExternalEgressControl | null;
  externalEgressIsolationVerified: boolean;
  networkClass: 'LOOPBACK_DAEMON' | null;
}

function lifecycleObservations(): LifecycleObservations {
  return {
    providerInvocationCount: 0, delegatedRunnerCount: 0, downloadObserved: false,
    timedOut: false, outputOverflowed: false, preflightPassed: false,
    postflightPassed: false, inventoryUnchanged: false,
    modelDownloadPreventionVerified: false, selected: false, planAttemptCount: 0,
    fallbackCount: 0, escalationCount: 0, normalizedOutputDigest: null,
    normalizedOutputBytes: 0, externalEgressControl: null,
    externalEgressIsolationVerified: false, networkClass: null,
  };
}

export async function executeProviderGenerationValidation(
  input: ProviderGenerationValidationInput,
  dependencies: ProviderGenerationValidationDependencies,
): Promise<ProviderGenerationValidationProjection> {
  const checks: Array<Readonly<{ code: string; status: 'PASS' | 'FAIL' | 'BLOCKED' }>> = [];
  const observations = lifecycleObservations();
  if (!isAbsolute(input.executableRealpath) || !validEndpoint(input.approvedLoopbackEndpoint) ||
      !Object.values(ModelAcquisitionControl).includes(input.modelAcquisitionControl)) {
    return emptyProjection(input, 'BLOCKED', 'MODEL_DOWNLOAD_RISK_UNCONTROLLED', checks, observations);
  }
  let preventionVerified = false;
  if (input.modelAcquisitionControl === ModelAcquisitionControl.DENIED_VERIFIED) {
    try { preventionVerified = dependencies.verifyModelAcquisitionDenied?.() === true; } catch { preventionVerified = false; }
    observations.modelDownloadPreventionVerified = preventionVerified;
    if (!preventionVerified) return emptyProjection(input, 'BLOCKED', 'MODEL_DOWNLOAD_RISK_UNCONTROLLED', checks, observations);
  }

  let preflight: GenerationInventorySnapshot;
  try { preflight = await dependencies.runPreflight('PRE'); } catch {
    return emptyProjection(input, 'BLOCKED', 'PRE_GENERATION_PREFLIGHT_FAILED', checks, observations);
  }
  if (!preflight.passed || preflight.inventoryFingerprint === null) {
    return emptyProjection(input, 'BLOCKED', 'PRE_GENERATION_PREFLIGHT_FAILED', checks, observations);
  }
  if (!preflight.requiredModelPresent) return emptyProjection(input, 'BLOCKED', 'MODEL_NOT_AVAILABLE', checks, observations);
  observations.preflightPassed = true;
  observations.externalEgressControl = preflight.externalEgressControl;
  observations.externalEgressIsolationVerified = preflight.externalEgressIsolationVerified;
  observations.networkClass = preflight.networkClass;
  checks.push(Object.freeze({ code: 'PRE_GENERATION_PREFLIGHT', status: 'PASS' }));

  const underlyingRunner = dependencies.generationRunner ?? defaultCliRunner;
  const observingRunner: CliRunner = async (bin, args, options) => {
    observations.providerInvocationCount = Math.min(2, observations.providerInvocationCount + 1);
    if (observations.providerInvocationCount > 1) {
      return {
        code: null, stdout: '', stderr: 'Provider invocation count exceeded.', timedOut: false,
        downloadObserved: false, outputOverflowed: false,
      };
    }
    observations.delegatedRunnerCount += 1;
    const result = await underlyingRunner(bin, args, options);
    observations.downloadObserved ||= result.downloadObserved === true;
    observations.timedOut ||= result.timedOut;
    observations.outputOverflowed ||= result.outputOverflowed === true;
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
      return emptyProjection(input, 'BLOCKED', 'PRIMARY_ONLY_PLAN_REQUIRED', checks, observations);
    }
    observations.selected = true;
    observations.planAttemptCount = 1;
    observations.fallbackCount = plan.operationalFallback === null ? 0 : 1;
    observations.escalationCount = plan.semanticEscalation === null ? 0 : 1;
    checks.push(Object.freeze({ code: 'PRIMARY_ONLY_PLAN', status: 'PASS' }));
    const gateway = new ProviderRoutingGateway(bindings, profiles);
    const result = await gateway.execute(plan, {
      capability: Capability.GENERAL_CHAT, prompt: VALIDATION_PROMPT,
      contextFiles: [], timeoutMs: 45_000,
    });
    dependencies.afterProviderExecution?.();

    let postflight: GenerationInventorySnapshot | null = null;
    try { postflight = await dependencies.runPreflight('POST'); } catch { postflight = null; }
    const postflightPassed = postflight?.passed === true && postflight.inventoryFingerprint !== null;
    const inventoryUnchanged = postflightPassed &&
      postflight?.inventoryFingerprint === preflight.inventoryFingerprint;
    observations.postflightPassed = postflightPassed;
    observations.inventoryUnchanged = inventoryUnchanged;
    if (postflightPassed) checks.push(Object.freeze({ code: 'POST_GENERATION_PREFLIGHT', status: 'PASS' }));

    const rawOutput = result.output?.text ?? '';
    const normalizedOutput = rawOutput.trim();
    const normalizedOutputBytes = Buffer.byteLength(normalizedOutput, 'utf8');
    observations.normalizedOutputBytes = normalizedOutputBytes;
    const outputOverflowed = observations.outputOverflowed || normalizedOutputBytes > MAX_NORMALIZED_OUTPUT_BYTES;
    observations.outputOverflowed = outputOverflowed;
    observations.normalizedOutputDigest = outputOverflowed ? null
      : createHash('sha256').update(Buffer.from(normalizedOutput, 'utf8')).digest('hex');
    const expectedOutputMatched = !outputOverflowed && normalizedOutput === EXPECTED_VALIDATION_OUTPUT;
    let status: 'PASS' | 'FAIL' = 'PASS';
    let failureCode: string | null = null;
    if (observations.downloadObserved) failureCode = 'MODEL_DOWNLOAD_DETECTED';
    else if (outputOverflowed) failureCode = 'OUTPUT_OVERFLOW';
    else if (observations.providerInvocationCount > 1) failureCode = 'PROVIDER_EXECUTION_COUNT_EXCEEDED';
    else if (!postflightPassed) failureCode = 'POST_GENERATION_PREFLIGHT_FAILED';
    else if (!inventoryUnchanged) failureCode = 'INVENTORY_CHANGED';
    else if (!expectedOutputMatched) failureCode = result.failureCode ?? 'EXPECTED_OUTPUT_MISMATCH';
    if (failureCode !== null) status = 'FAIL';
    return Object.freeze({
      contractVersion: PROVIDER_GENERATION_VALIDATION_CONTRACT_VERSION, status, failureCode,
      promptDigest: VALIDATION_PROMPT_DIGEST, selectedProviderId: VALIDATION_PROVIDER_ID,
      selectedAdapterId: VALIDATION_ADAPTER_ID, selectedModelId: VALIDATION_MODEL_ID,
      planAttemptCount: 1, providerExecutionCount: observations.providerInvocationCount,
      retryCount: Math.max(0, observations.providerInvocationCount - 1),
      fallbackCount: observations.fallbackCount, escalationCount: observations.escalationCount,
      normalizedOutput: expectedOutputMatched ? EXPECTED_VALIDATION_OUTPUT : null,
      normalizedOutputDigest: observations.normalizedOutputDigest, normalizedOutputBytes,
      expectedOutputMatched, modelAcquisitionControl: input.modelAcquisitionControl,
      modelDownloadPreventionVerified: observations.modelDownloadPreventionVerified,
      downloadCapableCommandInvoked: observations.delegatedRunnerCount > 0,
      downloadObserved: observations.downloadObserved, preflightPassed: observations.preflightPassed,
      postflightPassed, inventoryUnchanged, timedOut: observations.timedOut,
      outputOverflowed, externalEgressControl: observations.externalEgressControl,
      externalEgressIsolationVerified: observations.externalEgressIsolationVerified,
      networkClass: observations.networkClass, checks: Object.freeze(checks),
    });
  } catch (error) {
    const failureCode = observations.downloadObserved ? 'MODEL_DOWNLOAD_DETECTED'
      : observations.outputOverflowed ? 'OUTPUT_OVERFLOW'
        : observations.providerInvocationCount > 1 ? 'PROVIDER_EXECUTION_COUNT_EXCEEDED'
          : error instanceof ProviderBindingConfigurationError ? error.code : 'PROVIDER_EXECUTION_FAILED';
    return emptyProjection(input, 'BLOCKED', failureCode, checks, observations);
  }
}

export function validationPromptDigest(): string {
  return createHash('sha256').update(Buffer.from(VALIDATION_PROMPT, 'utf8')).digest('hex');
}
