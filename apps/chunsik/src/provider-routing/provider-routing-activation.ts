import { RuntimeProviderRoutingService } from '@chunsik/core';
import type { RuntimeProviderRouting } from '@chunsik/core';
import {
  BALANCED_PROVIDER_ID,
  SEMANTIC_PROVIDER_ID,
  createProductionProviderRoutingConfiguration,
} from './production-provider-routing-config';
import type {
  ProductionProviderRoutingConfiguration,
  ProductionProviderRoutingFactoryInput,
} from './production-provider-routing-config';

export const PROVIDER_ROUTING_MODE_ENV_NAME = 'QUOKY_PROVIDER_ROUTING_MODE' as const;

export type ProviderRoutingMode = 'legacy' | 'stage2b-general-chat-v1';

export enum ProviderRoutingActivationErrorCode {
  INVALID_MODE = 'PROVIDER_ROUTING_INVALID_MODE',
  ENFORCEMENT_UNAVAILABLE = 'PROVIDER_ROUTING_EGRESS_ENFORCEMENT_UNAVAILABLE',
  ENFORCEMENT_UNVERIFIED = 'PROVIDER_ROUTING_EGRESS_ENFORCEMENT_UNVERIFIED',
  ENFORCEMENT_SCOPE_MISMATCH = 'PROVIDER_ROUTING_EGRESS_SCOPE_MISMATCH',
}

export class ProviderRoutingActivationError extends Error {
  constructor(readonly code: ProviderRoutingActivationErrorCode) {
    super(code);
    this.name = 'ProviderRoutingActivationError';
  }
}

export function parseProviderRoutingMode(raw: string | undefined): ProviderRoutingMode {
  if (raw === undefined || raw === 'legacy') return 'legacy';
  if (raw === 'stage2b-general-chat-v1') return raw;
  throw new ProviderRoutingActivationError(ProviderRoutingActivationErrorCode.INVALID_MODE);
}

export const PROVIDER_ROUTING_EGRESS_SCOPE_VERSION = 'stage2b-provider-routing-egress-scope-v1' as const;
export const PROVIDER_ROUTING_LOOPBACK_ENDPOINT = 'http://127.0.0.1:11434' as const;

export interface ProviderRoutingEgressScope {
  readonly contractVersion: typeof PROVIDER_ROUTING_EGRESS_SCOPE_VERSION;
  readonly ollamaExecutable: string;
  readonly loopbackEndpoint: typeof PROVIDER_ROUTING_LOOPBACK_ENDPOINT;
  readonly providerIds: readonly [typeof BALANCED_PROVIDER_ID, typeof SEMANTIC_PROVIDER_ID];
  readonly modelIds: readonly ['llama3.1:8b', 'granite3.3:8b'];
  readonly denyNonLoopbackIpv4: true;
  readonly denyNonLoopbackIpv6: true;
  readonly denyDns: true;
}

export type ProviderRoutingEgressVerification =
  | { readonly status: 'verified'; readonly exactScope: ProviderRoutingEgressScope }
  | { readonly status: 'unavailable' }
  | { readonly status: 'unverified' };

export interface ProviderRoutingEgressEnforcement {
  verifyExactScope(scope: ProviderRoutingEgressScope): ProviderRoutingEgressVerification;
}

export interface ProductionRuntimeProviderRoutingActivationInput {
  readonly mode: ProviderRoutingMode;
  readonly ollama: ProductionProviderRoutingFactoryInput;
  readonly enforcement?: ProviderRoutingEgressEnforcement;
  readonly createConfiguration?: (
    input: ProductionProviderRoutingFactoryInput,
  ) => ProductionProviderRoutingConfiguration;
  readonly createRoutingService?: (
    configuration: ProductionProviderRoutingConfiguration,
  ) => RuntimeProviderRouting;
}

function exactScopeFor(ollamaExecutable: string): ProviderRoutingEgressScope {
  return Object.freeze({
    contractVersion: PROVIDER_ROUTING_EGRESS_SCOPE_VERSION,
    ollamaExecutable,
    loopbackEndpoint: PROVIDER_ROUTING_LOOPBACK_ENDPOINT,
    providerIds: Object.freeze([BALANCED_PROVIDER_ID, SEMANTIC_PROVIDER_ID] as const),
    modelIds: Object.freeze(['llama3.1:8b', 'granite3.3:8b'] as const),
    denyNonLoopbackIpv4: true,
    denyNonLoopbackIpv6: true,
    denyDns: true,
  });
}

function scopesMatch(actual: ProviderRoutingEgressScope, expected: ProviderRoutingEgressScope): boolean {
  return (
    actual.contractVersion === expected.contractVersion &&
    actual.ollamaExecutable === expected.ollamaExecutable &&
    actual.loopbackEndpoint === expected.loopbackEndpoint &&
    actual.providerIds.length === 2 &&
    actual.providerIds[0] === expected.providerIds[0] &&
    actual.providerIds[1] === expected.providerIds[1] &&
    actual.modelIds.length === 2 &&
    actual.modelIds[0] === expected.modelIds[0] &&
    actual.modelIds[1] === expected.modelIds[1] &&
    actual.denyNonLoopbackIpv4 === true &&
    actual.denyNonLoopbackIpv6 === true &&
    actual.denyDns === true
  );
}

export function createProductionRuntimeProviderRoutingActivation(
  input: ProductionRuntimeProviderRoutingActivationInput,
): RuntimeProviderRouting | undefined {
  if (input.mode === 'legacy') return undefined;

  if (input.enforcement === undefined) {
    throw new ProviderRoutingActivationError(ProviderRoutingActivationErrorCode.ENFORCEMENT_UNAVAILABLE);
  }

  const scope = exactScopeFor(input.ollama.ollamaBin);
  const verification = input.enforcement.verifyExactScope(scope);
  if (verification.status === 'unavailable') {
    throw new ProviderRoutingActivationError(ProviderRoutingActivationErrorCode.ENFORCEMENT_UNAVAILABLE);
  }
  if (verification.status === 'unverified') {
    throw new ProviderRoutingActivationError(ProviderRoutingActivationErrorCode.ENFORCEMENT_UNVERIFIED);
  }
  if (!scopesMatch(verification.exactScope, scope)) {
    throw new ProviderRoutingActivationError(ProviderRoutingActivationErrorCode.ENFORCEMENT_SCOPE_MISMATCH);
  }

  const configuration = (input.createConfiguration ?? createProductionProviderRoutingConfiguration)(input.ollama);
  return (
    input.createRoutingService ??
    ((value) =>
      new RuntimeProviderRoutingService({
        providerRegistry: value.providerRegistry,
        policyEngine: value.policyEngine,
        bindings: value.executableBindings,
        validationProfiles: value.validationProfiles,
        deadlinePolicy: value.deadlinePolicy,
      }))
  )(configuration);
}
