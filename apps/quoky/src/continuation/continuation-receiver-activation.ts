import {
  ContinuationProviderRoutingService,
  PromptComposer,
  PromptRenderer,
} from '@quoky/core';
import type { ArtifactManager, ContinuationReceiver } from '@quoky/core';
import {
  buildProductionProviderRoutingConfiguration,
  createProductionProviderRoutingConfiguration,
} from '../provider-routing/production-provider-routing-config';
import type {
  ProductionProviderRoutingConfiguration,
  ProductionProviderRoutingFactoryInput,
} from '../provider-routing/production-provider-routing-config';
import { ProviderBackedContinuationReceiver } from './provider-backed-continuation-receiver';

export const CONTINUATION_RECEIVER_MODE_ENV_NAME = 'QUOKY_CONTINUATION_RECEIVER_MODE' as const;

/**
 * §31 typed continuation activation mode. Kept SEPARATE from QUOKY_PROVIDER_ROUTING_MODE: routing
 * configuration availability is never continuation execution authority. Default: 'disabled'.
 */
export type ContinuationReceiverMode = 'disabled' | 'general-chat-v1';

export enum ContinuationReceiverActivationErrorCode {
  INVALID_MODE = 'CONTINUATION_RECEIVER_INVALID_MODE',
  CONTAINMENT_UNAVAILABLE = 'CONTINUATION_RECEIVER_CONTAINMENT_UNAVAILABLE',
  CONTAINMENT_UNVERIFIED = 'CONTINUATION_RECEIVER_CONTAINMENT_UNVERIFIED',
  DEPENDENCY_MISSING = 'CONTINUATION_RECEIVER_DEPENDENCY_MISSING',
}

export class ContinuationReceiverActivationError extends Error {
  constructor(readonly code: ContinuationReceiverActivationErrorCode) {
    super(code);
    this.name = 'ContinuationReceiverActivationError';
  }
}

/** Exact-match, fail-closed parse mirroring parseProviderRoutingMode. Message === code on failure. */
export function parseContinuationReceiverMode(raw: string | undefined): ContinuationReceiverMode {
  if (raw === undefined || raw === 'disabled') return 'disabled';
  if (raw === 'general-chat-v1') return raw;
  throw new ContinuationReceiverActivationError(ContinuationReceiverActivationErrorCode.INVALID_MODE);
}

/**
 * §33 fake containment seam. R3 owns REAL containment/egress enforcement; it is NOT implemented yet.
 * Production general-chat-v1 mode therefore has no verifiable containment and MUST fail closed. Tests
 * may inject a fake verified containment to exercise the enabled composition (§34).
 */
export interface ContinuationContainmentVerification {
  readonly status: 'verified' | 'unavailable' | 'unverified';
}

export interface ContinuationContainment {
  verify(): ContinuationContainmentVerification;
}

export interface ProductionContinuationReceiverActivationInput {
  readonly mode: ContinuationReceiverMode;
  readonly ollama: ProductionProviderRoutingFactoryInput;
  /** Mandatory in general-chat-v1. Absent in production today → startup fail-closed (R3 not built). */
  readonly containment?: ContinuationContainment;
  readonly promptComposer?: PromptComposer;
  readonly promptRenderer?: PromptRenderer;
  readonly artifactManager?: ArtifactManager;
  readonly createConfiguration?: (
    input: ProductionProviderRoutingFactoryInput,
  ) => ProductionProviderRoutingConfiguration;
}

function continuationRoutingServiceFrom(
  configuration: ProductionProviderRoutingConfiguration,
): ContinuationProviderRoutingService {
  return new ContinuationProviderRoutingService({
    providerRegistry: configuration.providerRegistry,
    policyEngine: configuration.policyEngine,
    bindings: configuration.executableBindings,
    validationProfiles: configuration.validationProfiles,
    configurationVersion: configuration.version,
    configurationDigest: configuration.configurationDigest,
    deadlinePolicy: configuration.deadlinePolicy,
  });
}

/**
 * §32/§33 continuation receiver activation. disabled → undefined (absent binding, no composition). For
 * general-chat-v1 EVERY mandatory dependency must be present AND containment must verify; anything
 * missing/unverified fails closed. R3 containment is absent in production, so production general-chat-v1
 * fails closed by construction — R2 production shape is IMPLEMENTED but never production live-ready.
 */
export function createProductionContinuationReceiverActivation(
  input: ProductionContinuationReceiverActivationInput,
): ContinuationReceiver | undefined {
  if (input.mode === 'disabled') return undefined;

  if (input.containment === undefined) {
    throw new ContinuationReceiverActivationError(
      ContinuationReceiverActivationErrorCode.CONTAINMENT_UNAVAILABLE,
    );
  }
  const verification = input.containment.verify();
  if (verification.status === 'unavailable') {
    throw new ContinuationReceiverActivationError(
      ContinuationReceiverActivationErrorCode.CONTAINMENT_UNAVAILABLE,
    );
  }
  if (verification.status === 'unverified') {
    throw new ContinuationReceiverActivationError(
      ContinuationReceiverActivationErrorCode.CONTAINMENT_UNVERIFIED,
    );
  }

  const promptComposer = input.promptComposer ?? new PromptComposer();
  const promptRenderer = input.promptRenderer ?? new PromptRenderer();
  const artifactManager = input.artifactManager;
  if (artifactManager === undefined) {
    throw new ContinuationReceiverActivationError(
      ContinuationReceiverActivationErrorCode.DEPENDENCY_MISSING,
    );
  }

  const configuration = (input.createConfiguration ?? createProductionProviderRoutingConfiguration)(
    input.ollama,
  );
  const routing = continuationRoutingServiceFrom(configuration);
  return new ProviderBackedContinuationReceiver({
    promptComposer,
    promptRenderer,
    routing,
    artifactManager,
  });
}

/** Re-exported for tests that build a configuration directly. */
export { buildProductionProviderRoutingConfiguration, continuationRoutingServiceFrom };
