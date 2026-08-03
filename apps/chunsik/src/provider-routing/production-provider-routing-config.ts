import { createHash } from 'node:crypto';
import { OllamaCliProvider } from '@chunsik/ai-cli';
import {
  DEFAULT_PROVIDER_DEADLINE_POLICY,
  GENERAL_CHAT,
  AdapterId,
  AvailabilityClass,
  Capability,
  ConcurrencyClass,
  ContextCapacity,
  CostTier,
  DeadlineClass,
  ExecutionLocality,
  LatencyTier,
  ProviderBindingRegistry,
  ProviderDescriptor,
  ProviderId,
  ProviderRegistry,
  RankingDimension,
  ReliabilityTier,
  RoutingClass,
  RoutingConfigurationError,
  RoutingPolicyConfiguration,
  RoutingPolicyEngine,
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
  ExecutableProviderBinding,
  ProviderDeadlinePolicy,
  ValidationProfileRegistry,
} from '@chunsik/core';

export const PRODUCTION_ROUTING_CONFIGURATION_VERSION =
  'stage2b-production-routing-config-v1' as const;
export const PROVIDER_PROFILE_VERSION = 'stage2b-provider-profile-v1' as const;
export const PROVIDER_PROVENANCE_CONTRACT_VERSION =
  'stage2b-provider-provenance-v1' as const;
export const PROVIDER_BINDING_VERSION = 'stage2b-provider-binding-v1' as const;

export const OLLAMA_ADAPTER_ID = adapterId('ollama-cli');
export const BALANCED_PROVIDER_ID = providerId('ollama-cli:llama3.1:8b');
export const SEMANTIC_PROVIDER_ID = providerId('ollama-cli:granite3.3:8b');

export enum ProviderCandidateRole {
  BALANCED_PRIMARY = 'BALANCED_PRIMARY',
  SEMANTIC_CANDIDATE = 'SEMANTIC_CANDIDATE',
}

export interface Stage2AProviderProvenancePayload {
  readonly contractVersion: typeof PROVIDER_PROVENANCE_CONTRACT_VERSION;
  readonly providerId: ProviderId;
  readonly adapterId: AdapterId;
  readonly modelId: string;
  readonly candidateRole: ProviderCandidateRole;
  readonly campaignId: 'stage2a-production-18gb-a1-v1';
  readonly poolSchemaVersion: 1;
  readonly productionCheckerVersion: 'stage2a-semantic-checker-v4';
  readonly historicalReplayCheckerVersion: 'stage2a-semantic-checker-v3';
  readonly goldenCorpusId: 'A1+A3';
  readonly goldenCorpusRecordCount: 224;
  readonly goldenCorpusCheckCount: 896;
  readonly goldenCorpusDigest: 'add786d6ebef4cb0158119783b2329f30a6c030ed37682c95d1071df7801e3b4';
  readonly promptRootCauseStatus: 'NOT_ESTABLISHED';
}

export interface Stage2AProviderProvenance {
  readonly payload: Stage2AProviderProvenancePayload;
  readonly evidenceBindingDigest: string;
}

export interface ProductionProviderDefinition {
  readonly providerId: ProviderId;
  readonly adapterId: AdapterId;
  readonly modelId: string;
  readonly candidateRole: ProviderCandidateRole;
  readonly provider: AiProvider;
}

export interface ProductionProviderRoutingConfiguration {
  readonly version: typeof PRODUCTION_ROUTING_CONFIGURATION_VERSION;
  readonly configurationDigest: string;
  readonly providerDescriptors: readonly ProviderDescriptor[];
  readonly executableBindings: readonly ExecutableProviderBinding[];
  readonly routingPolicy: RoutingPolicyConfiguration;
  readonly validationProfile: typeof GENERAL_CHAT;
  readonly validationProfiles: ValidationProfileRegistry;
  readonly deadlineClass: DeadlineClass.STANDARD;
  readonly deadlinePolicy: ProviderDeadlinePolicy;
  readonly providerProvenance: readonly Stage2AProviderProvenance[];
  readonly providerRegistry: ProviderRegistry;
  readonly policyEngine: RoutingPolicyEngine;
}

export interface ProductionProviderRoutingFactoryInput {
  readonly ollamaBin: string;
}

const EXPECTED_ROLE_BINDINGS = Object.freeze({
  [ProviderCandidateRole.BALANCED_PRIMARY]: Object.freeze({
    providerId: BALANCED_PROVIDER_ID,
    modelId: 'llama3.1:8b',
    routingClass: RoutingClass.BALANCED,
    semanticReliability: ReliabilityTier.STANDARD,
  }),
  [ProviderCandidateRole.SEMANTIC_CANDIDATE]: Object.freeze({
    providerId: SEMANTIC_PROVIDER_ID,
    modelId: 'granite3.3:8b',
    routingClass: RoutingClass.SEMANTIC_HIGH,
    semanticReliability: ReliabilityTier.HIGH,
  }),
});

function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function createStage2AProviderProvenance(
  definition: Pick<
    ProductionProviderDefinition,
    'providerId' | 'adapterId' | 'modelId' | 'candidateRole'
  >,
): Stage2AProviderProvenance {
  const payload = Object.freeze({
    contractVersion: PROVIDER_PROVENANCE_CONTRACT_VERSION,
    providerId: definition.providerId,
    adapterId: definition.adapterId,
    modelId: definition.modelId,
    candidateRole: definition.candidateRole,
    campaignId: 'stage2a-production-18gb-a1-v1',
    poolSchemaVersion: 1,
    productionCheckerVersion: 'stage2a-semantic-checker-v4',
    historicalReplayCheckerVersion: 'stage2a-semantic-checker-v3',
    goldenCorpusId: 'A1+A3',
    goldenCorpusRecordCount: 224,
    goldenCorpusCheckCount: 896,
    goldenCorpusDigest: 'add786d6ebef4cb0158119783b2329f30a6c030ed37682c95d1071df7801e3b4',
    promptRootCauseStatus: 'NOT_ESTABLISHED',
  } as const satisfies Stage2AProviderProvenancePayload);
  return Object.freeze({ payload, evidenceBindingDigest: sha256Canonical(payload) });
}

function validateDefinitions(definitions: readonly ProductionProviderDefinition[]): void {
  if (definitions.length !== 2) {
    throw new RoutingConfigurationError('Production routing requires exactly two Provider instances');
  }
  if (new Set(definitions.map((definition) => definition.providerId)).size !== definitions.length) {
    throw new RoutingConfigurationError('Duplicate production providerId');
  }
  if (new Set(definitions.map((definition) => definition.candidateRole)).size !== definitions.length) {
    throw new RoutingConfigurationError('Duplicate production candidate role');
  }
  for (const definition of definitions) {
    const expected = EXPECTED_ROLE_BINDINGS[definition.candidateRole];
    if (
      definition.adapterId !== OLLAMA_ADAPTER_ID ||
      definition.providerId !== expected.providerId ||
      definition.modelId !== expected.modelId ||
      definition.providerId !== `${definition.adapterId}:${definition.modelId}`
    ) {
      throw new RoutingConfigurationError('Production provider identity/model binding mismatch');
    }
  }
}

function descriptorFor(
  definition: ProductionProviderDefinition,
  provenance: Stage2AProviderProvenance,
): ProviderDescriptor {
  const expected = EXPECTED_ROLE_BINDINGS[definition.candidateRole];
  return {
    providerId: definition.providerId,
    adapterId: definition.adapterId,
    modelId: definition.modelId,
    capabilities: {
      supportedCapabilities: [Capability.GENERAL_CHAT],
      routingClasses: [expected.routingClass],
      semanticReliability: expected.semanticReliability,
      authorityReliability: ReliabilityTier.STANDARD,
      continuityReliability: ReliabilityTier.STANDARD,
      toolUse: SupportLevel.UNSUPPORTED,
      structuredOutput: SupportLevel.UNSUPPORTED,
      contextCapacity: ContextCapacity.MEDIUM,
      streaming: SupportLevel.UNSUPPORTED,
      executionLocality: ExecutionLocality.LOCAL,
    },
    operationalProfile: {
      latencyTier: LatencyTier.UNKNOWN,
      timeoutClass: TimeoutClass.STANDARD,
      costTier: CostTier.UNKNOWN,
      concurrencyClass: ConcurrencyClass.UNKNOWN,
      availabilityClass: AvailabilityClass.UNKNOWN,
    },
    enabled: true,
    profileVersion: PROVIDER_PROFILE_VERSION,
    evidenceBindingDigest: provenance.evidenceBindingDigest,
  };
}

function routingPolicyConfiguration(): RoutingPolicyConfiguration {
  return Object.freeze({
    version: PRODUCTION_ROUTING_CONFIGURATION_VERSION,
    policies: Object.freeze([
      Object.freeze({
        policyId: policyId('stage2b-general-chat-v1'),
        version: '1',
        precedence: 100,
        when: Object.freeze({
          capabilities: Object.freeze([Capability.GENERAL_CHAT]),
          validationProfiles: Object.freeze([GENERAL_CHAT]),
        }),
        eligibility: Object.freeze({}),
        ranking: Object.freeze([
          Object.freeze({
            dimension: RankingDimension.ROUTING_CLASS,
            direction: SortDirection.ASCENDING,
            routingClassPreference: Object.freeze([
              RoutingClass.BALANCED,
              RoutingClass.SEMANTIC_HIGH,
            ]),
          }),
          Object.freeze({
            dimension: RankingDimension.SEMANTIC_RELIABILITY,
            direction: SortDirection.DESCENDING,
          }),
        ]),
        terminal: TerminalDecision.NO_SELECTION,
      }),
    ]),
  });
}

export function buildProductionProviderRoutingConfiguration(
  definitions: readonly ProductionProviderDefinition[],
): ProductionProviderRoutingConfiguration {
  validateDefinitions(definitions);
  const providerProvenance = Object.freeze(definitions.map(createStage2AProviderProvenance));
  const descriptors = definitions.map((definition, index) =>
    descriptorFor(definition, providerProvenance[index] as Stage2AProviderProvenance),
  );
  const providerRegistry = new ProviderRegistry(
    PRODUCTION_ROUTING_CONFIGURATION_VERSION,
    descriptors.map((descriptor) => ({ providerId: descriptor.providerId, descriptor })),
  );
  const providerDescriptors = providerRegistry.all();
  const executableBindings = Object.freeze(
    definitions.map((definition) =>
      Object.freeze({
        providerId: definition.providerId,
        adapterId: definition.adapterId,
        modelId: definition.modelId,
        bindingVersion: PROVIDER_BINDING_VERSION,
        provider: definition.provider,
      }),
    ),
  );
  new ProviderBindingRegistry(providerRegistry.snapshot(), executableBindings);

  const routingPolicy = routingPolicyConfiguration();
  const policyEngine = new RoutingPolicyEngine(routingPolicy);
  const validationProfiles = createDefaultValidationProfileRegistry();
  validationProfiles.resolve(GENERAL_CHAT);
  const configurationDigest = sha256Canonical({
    version: PRODUCTION_ROUTING_CONFIGURATION_VERSION,
    registryConfigurationDigest: providerRegistry.configurationDigest,
    policyConfigurationDigest: policyEngine.policyDigest,
    validationProfile: GENERAL_CHAT,
    deadlineClass: DeadlineClass.STANDARD,
    deadlinePolicyVersion: DEFAULT_PROVIDER_DEADLINE_POLICY.version,
  });

  return Object.freeze({
    version: PRODUCTION_ROUTING_CONFIGURATION_VERSION,
    configurationDigest,
    providerDescriptors,
    executableBindings,
    routingPolicy,
    validationProfile: GENERAL_CHAT,
    validationProfiles,
    deadlineClass: DeadlineClass.STANDARD,
    deadlinePolicy: DEFAULT_PROVIDER_DEADLINE_POLICY,
    providerProvenance,
    providerRegistry,
    policyEngine,
  });
}

export function createProductionProviderRoutingConfiguration(
  input: ProductionProviderRoutingFactoryInput,
): ProductionProviderRoutingConfiguration {
  return buildProductionProviderRoutingConfiguration([
    {
      providerId: BALANCED_PROVIDER_ID,
      adapterId: OLLAMA_ADAPTER_ID,
      modelId: 'llama3.1:8b',
      candidateRole: ProviderCandidateRole.BALANCED_PRIMARY,
      provider: new OllamaCliProvider({
        bin: input.ollamaBin,
        model: 'llama3.1:8b',
        providerId: BALANCED_PROVIDER_ID,
      }),
    },
    {
      providerId: SEMANTIC_PROVIDER_ID,
      adapterId: OLLAMA_ADAPTER_ID,
      modelId: 'granite3.3:8b',
      candidateRole: ProviderCandidateRole.SEMANTIC_CANDIDATE,
      provider: new OllamaCliProvider({
        bin: input.ollamaBin,
        model: 'granite3.3:8b',
        providerId: SEMANTIC_PROVIDER_ID,
      }),
    },
  ]);
}
