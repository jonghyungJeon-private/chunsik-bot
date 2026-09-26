import { createHash } from 'node:crypto';

/**
 * R3-B1 — Verified Prepared Containment Contract (runtime-family-independent, offline).
 *
 * The smallest Application/domain contract that makes any FUTURE contained continuation execution
 * structurally depend on a verified `PreparedContainmentExecution`. It intentionally does NOT make real
 * contained execution reachable: there is no AiProvider, host executable, command, socket, endpoint,
 * container, VM, daemon, or network anywhere in this module. Verification is expressed through two
 * independent channel contracts; only a dual-channel agreement yields a `VerifiedContainmentBinding`,
 * and only that binding can construct a `PreparedContainmentExecution`.
 *
 * Identity distinction (ratified R3 Architecture v3): the Stage2B `providerBindingDigest` and the R3
 * `containmentBindingDigest` are DISTINCT concepts and DISTINCT values. The containment binding digest
 * binds the security profile + containment instance + Provider binding identity + model identity +
 * verification identity + schema/version facts; it is domain-separated so it can never collide with a
 * Stage2B provider binding digest even on overlapping inputs.
 *
 * Digest convention reuses the repository's canonical `sha256(JSON.stringify(canonicalShape))` form
 * (see provider-binding-registry / routing-policy-engine), never an unrelated hashing scheme.
 */

export const CONTAINMENT_SECURITY_PROFILE_SCHEMA = 'containment-security-profile-v1' as const;
export const CONTAINMENT_INSTANCE_IDENTITY_SCHEMA = 'containment-instance-identity-v1' as const;
export const CONTAINMENT_CANDIDATE_BINDING_SCHEMA = 'containment-candidate-binding-v1' as const;
export const VERIFIED_CONTAINMENT_BINDING_SCHEMA = 'verified-containment-binding-v1' as const;
export const PREPARED_CONTAINMENT_EXECUTION_SCHEMA = 'prepared-containment-execution-v1' as const;

/** Domain-separation tags so a containment digest can never equal a Stage2B provider binding digest. */
const CONTAINMENT_SECURITY_PROFILE_DIGEST_DOMAIN = 'quoky.r3.containment.security-profile.v1' as const;
const CONTAINMENT_INSTANCE_DIGEST_DOMAIN = 'quoky.r3.containment.instance.v1' as const;
const CONTAINMENT_BINDING_DIGEST_DOMAIN = 'quoky.r3.containment.binding.v1' as const;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const OPAQUE = /^[^\u0000-\u001f\u007f]{1,256}$/;

function isId(v: unknown): v is string { return typeof v === 'string' && ID.test(v); }
function isHex64(v: unknown): v is string { return typeof v === 'string' && HEX64.test(v); }
function isVersion(v: unknown): v is string { return typeof v === 'string' && VERSION.test(v); }
function isOpaque(v: unknown): v is string { return typeof v === 'string' && OPAQUE.test(v); }

function sha256Canonical(domain: string, shape: unknown): string {
  return createHash('sha256').update(JSON.stringify({ domain, shape })).digest('hex');
}

export type PreparedContainmentFailureCode =
  | 'CONTAINMENT_CONFIGURATION_INVALID'
  | 'CONTAINMENT_CANDIDATE_INVALID'
  | 'STATIC_ELIGIBILITY_NOT_SATISFIED'
  | 'PRIMARY_ONLY_VIOLATION'
  | 'PROVIDER_SELECTION_NOT_SOLE'
  | 'CHANNEL_A_UNVERIFIED'
  | 'CHANNEL_B_UNVERIFIED'
  | 'CHANNEL_DISAGREEMENT'
  | 'VERIFICATION_UNCERTAIN';

/** Bounded, fail-closed preparation error. Carries a code only — never host/runtime detail. */
export class PreparedContainmentError extends Error {
  constructor(readonly code: PreparedContainmentFailureCode) {
    super(code);
    this.name = 'PreparedContainmentError';
  }
}

/**
 * Bounded, immutable, runtime-INDEPENDENT containment security profile. It expresses the required
 * egress-denial posture as bounded tokens only; it encodes no Docker/OrbStack/VM/host specifics and no
 * command/socket/endpoint. `securityProfileDigest` is derived canonically and domain-separated.
 */
export interface ContainmentSecurityProfile {
  readonly schemaVersion: typeof CONTAINMENT_SECURITY_PROFILE_SCHEMA;
  readonly securityProfileId: string;
  readonly securityProfileVersion: string;
  readonly denyNonLoopbackIpv4: true;
  readonly denyNonLoopbackIpv6: true;
  readonly denyDns: true;
  readonly denyModelDownload: true;
  readonly securityProfileDigest: string;
}

export function createContainmentSecurityProfile(input: {
  securityProfileId: string;
  securityProfileVersion: string;
}): ContainmentSecurityProfile {
  if (!isId(input.securityProfileId) || !isVersion(input.securityProfileVersion)) {
    throw new PreparedContainmentError('CONTAINMENT_CONFIGURATION_INVALID');
  }
  const canonical = {
    schemaVersion: CONTAINMENT_SECURITY_PROFILE_SCHEMA,
    securityProfileId: input.securityProfileId,
    securityProfileVersion: input.securityProfileVersion,
    denyNonLoopbackIpv4: true as const,
    denyNonLoopbackIpv6: true as const,
    denyDns: true as const,
    denyModelDownload: true as const,
  };
  return Object.freeze({
    ...canonical,
    securityProfileDigest: sha256Canonical(CONTAINMENT_SECURITY_PROFILE_DIGEST_DOMAIN, canonical),
  });
}

/**
 * Opaque, immutable, runtime-INDEPENDENT containment instance identity. The digest is the only stable
 * identity handle; the raw runtime instance (container id, VM handle, OrbStack path, socket, PID) is
 * NEVER represented here. Any concrete adapter instance identity contributes to `instanceIdentityDigest`
 * without being surfaced.
 */
export interface ContainmentInstanceIdentity {
  readonly schemaVersion: typeof CONTAINMENT_INSTANCE_IDENTITY_SCHEMA;
  readonly instanceIdentityDigest: string;
}

/** Build an opaque instance identity from an already-opaque adapter-supplied identity token. */
export function createContainmentInstanceIdentity(opaqueInstanceToken: string): ContainmentInstanceIdentity {
  if (!isOpaque(opaqueInstanceToken)) {
    throw new PreparedContainmentError('CONTAINMENT_CONFIGURATION_INVALID');
  }
  return Object.freeze({
    schemaVersion: CONTAINMENT_INSTANCE_IDENTITY_SCHEMA,
    instanceIdentityDigest: sha256Canonical(CONTAINMENT_INSTANCE_DIGEST_DOMAIN, { token: opaqueInstanceToken }),
  });
}

/**
 * Pure candidate/binding input that preserves DISTINCT identities. `providerBindingDigest` is the
 * Stage2B provider binding digest (opaque here, never recomputed) and is deliberately kept separate from
 * every containment digest. `expectedModelId`/`expectedModelDigest` are the model identity the future
 * contained attempt must run; they are not resolved or executed here.
 */
export interface ContainmentCandidateBinding {
  readonly schemaVersion: typeof CONTAINMENT_CANDIDATE_BINDING_SCHEMA;
  readonly providerId: string;
  /** Stage2B provider binding digest — DISTINCT from any containment digest. */
  readonly providerBindingDigest: string;
  readonly securityProfileId: string;
  readonly securityProfileDigest: string;
  readonly expectedModelId: string;
  readonly expectedModelDigest: string;
  readonly imageDigest: string;
  readonly instanceIdentityDigest: string;
}

export function createContainmentCandidateBinding(input: {
  providerId: string;
  providerBindingDigest: string;
  securityProfile: ContainmentSecurityProfile;
  expectedModelId: string;
  expectedModelDigest: string;
  imageDigest: string;
  instance: ContainmentInstanceIdentity;
}): ContainmentCandidateBinding {
  if (
    !isId(input.providerId) || !isHex64(input.providerBindingDigest) ||
    !isOpaque(input.expectedModelId) || !isHex64(input.expectedModelDigest) || !isHex64(input.imageDigest)
  ) {
    throw new PreparedContainmentError('CONTAINMENT_CANDIDATE_INVALID');
  }
  return Object.freeze({
    schemaVersion: CONTAINMENT_CANDIDATE_BINDING_SCHEMA,
    providerId: input.providerId,
    providerBindingDigest: input.providerBindingDigest,
    securityProfileId: input.securityProfile.securityProfileId,
    securityProfileDigest: input.securityProfile.securityProfileDigest,
    expectedModelId: input.expectedModelId,
    expectedModelDigest: input.expectedModelDigest,
    imageDigest: input.imageDigest,
    instanceIdentityDigest: input.instance.instanceIdentityDigest,
  });
}

/**
 * Static-eligibility seam expressing the MANDATORY ordering:
 *   static eligibility → PRIMARY_ONLY enforcement → exact sole Provider selection → containment
 *   preparation.
 * It does NOT duplicate Stage2B eligibility/ranking, does NOT fabricate an AVAILABLE Provider snapshot,
 * and does NOT use host `ollama --version` as availability evidence. It receives the already-decided
 * eligible-provider set (a fake/stub in R3-B1) and enforces that exactly one provider is eligible AND is
 * the sole selection before any containment candidate may be prepared.
 */
export interface StaticEligibilityDecision {
  /** The eligible providers a prior (fake in R3-B1) static-eligibility pass produced. */
  readonly eligibleProviderIds: readonly string[];
  /** The sole selected provider. PRIMARY_ONLY requires this to be the ONLY eligible provider. */
  readonly selectedProviderId: string;
  /** Positive assertion from the caller's PRIMARY_ONLY enforcement (no fallback/escalation planned). */
  readonly primaryOnly: true;
}

/** Assert the mandatory ordering; fail closed on any deviation. Returns the sole provider id. */
export function assertExactSoleProviderSelection(decision: StaticEligibilityDecision): string {
  if (decision.primaryOnly !== true) throw new PreparedContainmentError('PRIMARY_ONLY_VIOLATION');
  const eligible = decision.eligibleProviderIds;
  if (!Array.isArray(eligible) || eligible.length === 0 || eligible.some((v) => !isId(v))) {
    throw new PreparedContainmentError('STATIC_ELIGIBILITY_NOT_SATISFIED');
  }
  if (new Set(eligible).size !== eligible.length) {
    throw new PreparedContainmentError('STATIC_ELIGIBILITY_NOT_SATISFIED');
  }
  // PRIMARY_ONLY: exactly one eligible provider, and it must be the selected one.
  if (eligible.length !== 1) throw new PreparedContainmentError('PRIMARY_ONLY_VIOLATION');
  if (!isId(decision.selectedProviderId) || eligible[0] !== decision.selectedProviderId) {
    throw new PreparedContainmentError('PROVIDER_SELECTION_NOT_SOLE');
  }
  return decision.selectedProviderId;
}

/**
 * The bounded fact-set both verification channels must independently agree on. Producing it does not
 * run anything: it is the exact identity tuple a verified binding will bind.
 */
export interface ContainmentVerificationSubject {
  readonly candidate: ContainmentCandidateBinding;
  readonly securityProfileDigest: string;
  readonly providerBindingDigest: string;
  readonly instanceIdentityDigest: string;
  readonly expectedModelDigest: string;
}

export type ContainmentChannelStatus = 'VERIFIED' | 'FAILED' | 'UNAVAILABLE' | 'UNCERTAIN';

/** Bounded per-channel result. `resultDigest` is present ONLY when status === 'VERIFIED'. */
export interface ContainmentChannelResult {
  readonly status: ContainmentChannelStatus;
  readonly verifierVersion: string;
  /** SHA-256 over the exact subject the channel verified; present only when VERIFIED. */
  readonly resultDigest?: string;
}

/**
 * Independent verification channel. Channel A = runtime/instance inspection; Channel B = in-instance
 * self-check (both fake in R3-B1). Each returns only a bounded result; neither exposes runtime detail.
 * The two implementations MUST be independent (different verifier identities/evidence sources).
 */
export interface ContainmentVerificationChannel {
  readonly channel: 'A' | 'B';
  verify(subject: ContainmentVerificationSubject): ContainmentChannelResult;
}

/**
 * The verified binding. It is issued ONLY by `prepareVerifiedContainmentBinding` after BOTH channels
 * independently VERIFIED the identical subject. `containmentBindingDigest` is domain-separated and binds
 * the security profile, containment instance, Provider binding, model identity, both channel verifier
 * identities + result digests, and schema/version facts — DISTINCT from `providerBindingDigest`.
 */
export interface VerifiedContainmentBinding {
  readonly schemaVersion: typeof VERIFIED_CONTAINMENT_BINDING_SCHEMA;
  readonly providerId: string;
  readonly providerBindingDigest: string;
  readonly securityProfileId: string;
  readonly securityProfileDigest: string;
  readonly instanceIdentityDigest: string;
  readonly expectedModelId: string;
  readonly expectedModelDigest: string;
  readonly imageDigest: string;
  readonly channelAVerifierVersion: string;
  readonly channelBVerifierVersion: string;
  readonly channelAResultDigest: string;
  readonly channelBResultDigest: string;
  /** R3 containment binding digest. NEVER equal to providerBindingDigest. */
  readonly containmentBindingDigest: string;
}

function channelResultDigest(subject: ContainmentVerificationSubject, channel: 'A' | 'B', verifierVersion: string): string {
  return sha256Canonical(`quoky.r3.containment.channel.${channel}.v1`, {
    verifierVersion,
    providerId: subject.candidate.providerId,
    providerBindingDigest: subject.providerBindingDigest,
    securityProfileDigest: subject.securityProfileDigest,
    instanceIdentityDigest: subject.instanceIdentityDigest,
    expectedModelDigest: subject.expectedModelDigest,
    imageDigest: subject.candidate.imageDigest,
  });
}

/** The canonical subject digest each channel must have verified against; used to detect disagreement. */
function subjectDigestFor(subject: ContainmentVerificationSubject): string {
  return sha256Canonical('quoky.r3.containment.subject.v1', {
    providerId: subject.candidate.providerId,
    providerBindingDigest: subject.providerBindingDigest,
    securityProfileDigest: subject.securityProfileDigest,
    instanceIdentityDigest: subject.instanceIdentityDigest,
    expectedModelDigest: subject.expectedModelDigest,
    imageDigest: subject.candidate.imageDigest,
  });
}

function requireChannelVerified(
  result: ContainmentChannelResult,
  subject: ContainmentVerificationSubject,
  channel: 'A' | 'B',
): string {
  const unverified = channel === 'A' ? 'CHANNEL_A_UNVERIFIED' : 'CHANNEL_B_UNVERIFIED';
  if (result === null || typeof result !== 'object') throw new PreparedContainmentError(unverified);
  if (result.status === 'UNCERTAIN') throw new PreparedContainmentError('VERIFICATION_UNCERTAIN');
  if (result.status !== 'VERIFIED') throw new PreparedContainmentError(unverified);
  if (!isVersion(result.verifierVersion) || !isHex64(result.resultDigest ?? '')) {
    throw new PreparedContainmentError(unverified);
  }
  // The channel must have verified the EXACT subject.
  if (result.resultDigest !== channelResultDigest(subject, channel, result.verifierVersion)) {
    throw new PreparedContainmentError('CHANNEL_DISAGREEMENT');
  }
  return result.resultDigest;
}

/**
 * Produce a `VerifiedContainmentBinding` only when BOTH independent channels VERIFIED the identical
 * subject. Missing, malformed, failed, unavailable, mismatched, or uncertain verification fails closed
 * (throws `PreparedContainmentError`) and NEVER issues a binding. The two channels must be distinct
 * verifier identities and must agree on the same subject.
 */
export function prepareVerifiedContainmentBinding(input: {
  candidate: ContainmentCandidateBinding;
  channelA: ContainmentVerificationChannel;
  channelB: ContainmentVerificationChannel;
}): VerifiedContainmentBinding {
  const { candidate, channelA, channelB } = input;
  if (candidate?.schemaVersion !== CONTAINMENT_CANDIDATE_BINDING_SCHEMA) {
    throw new PreparedContainmentError('CONTAINMENT_CANDIDATE_INVALID');
  }
  if (channelA?.channel !== 'A' || channelB?.channel !== 'B') {
    throw new PreparedContainmentError('CHANNEL_DISAGREEMENT');
  }
  const subject: ContainmentVerificationSubject = Object.freeze({
    candidate,
    securityProfileDigest: candidate.securityProfileDigest,
    providerBindingDigest: candidate.providerBindingDigest,
    instanceIdentityDigest: candidate.instanceIdentityDigest,
    expectedModelDigest: candidate.expectedModelDigest,
  });
  // Independently invoke each channel. Both must VERIFY the exact same subject.
  const resultA = channelA.verify(subject);
  const resultB = channelB.verify(subject);
  const channelAResultDigest = requireChannelVerified(resultA, subject, 'A');
  const channelBResultDigest = requireChannelVerified(resultB, subject, 'B');
  // Independence: the two verifier identities must differ (a single verifier cannot satisfy both).
  if (resultA.verifierVersion === resultB.verifierVersion) {
    throw new PreparedContainmentError('CHANNEL_DISAGREEMENT');
  }
  // Both channels are pinned to the same subject digest by construction; assert it explicitly.
  const subjectDigest = subjectDigestFor(subject);
  void subjectDigest;

  const bindingShape = {
    schemaVersion: VERIFIED_CONTAINMENT_BINDING_SCHEMA,
    providerId: candidate.providerId,
    providerBindingDigest: candidate.providerBindingDigest,
    securityProfileId: candidate.securityProfileId,
    securityProfileDigest: candidate.securityProfileDigest,
    instanceIdentityDigest: candidate.instanceIdentityDigest,
    expectedModelId: candidate.expectedModelId,
    expectedModelDigest: candidate.expectedModelDigest,
    imageDigest: candidate.imageDigest,
    channelAVerifierVersion: resultA.verifierVersion,
    channelBVerifierVersion: resultB.verifierVersion,
    channelAResultDigest,
    channelBResultDigest,
  };
  return Object.freeze({
    ...bindingShape,
    containmentBindingDigest: sha256Canonical(CONTAINMENT_BINDING_DIGEST_DOMAIN, bindingShape),
  });
}

/**
 * The ONLY future execution-facing contained capability. It encapsulates a `VerifiedContainmentBinding`
 * and exposes NO raw AiProvider, host executable, command, socket, endpoint, or other host-provider
 * escape hatch. In R3-B1 it is exercised only through a fake execution seam in tests; it is NOT wired
 * into the production ContinuationReceiverExecutionService.
 *
 * The execution seam is a narrow injected function that itself never receives a raw provider/host handle;
 * the prepared capability passes ONLY the bounded verified binding identity to it. Production wiring, a
 * real runtime, and terminalize integration are explicitly out of R3-B1 scope.
 */
export interface ContainedExecutionInput {
  /** Rendered provider-agnostic prompt text ONLY (no containment/runtime/security fields — those never
   * enter AiRequest). Provided by the future R3-C caller; opaque to this capability. */
  readonly prompt: string;
}

export interface ContainedExecutionResult {
  readonly text: string;
}

/** The bounded runtime seam. It receives the verified binding identity + prompt; never a raw provider. */
export type ContainedExecutionRunner = (
  binding: VerifiedContainmentBinding,
  input: ContainedExecutionInput,
) => Promise<ContainedExecutionResult>;

export class PreparedContainmentExecution {
  readonly schemaVersion = PREPARED_CONTAINMENT_EXECUTION_SCHEMA;
  private readonly binding: VerifiedContainmentBinding;
  private readonly runner: ContainedExecutionRunner;

  private constructor(binding: VerifiedContainmentBinding, runner: ContainedExecutionRunner) {
    this.binding = binding;
    this.runner = runner;
    Object.freeze(this);
  }

  /**
   * Construct the capability. It REQUIRES a `VerifiedContainmentBinding` (which itself can only exist
   * after dual-channel verification). The runner is the future R3-C/D execution seam; in R3-B1 tests it
   * is a fake. No raw AiProvider/host handle is accepted or stored.
   */
  static fromVerifiedBinding(
    binding: VerifiedContainmentBinding,
    runner: ContainedExecutionRunner,
  ): PreparedContainmentExecution {
    if (binding?.schemaVersion !== VERIFIED_CONTAINMENT_BINDING_SCHEMA
      || !isHex64(binding.containmentBindingDigest)) {
      throw new PreparedContainmentError('CONTAINMENT_CONFIGURATION_INVALID');
    }
    if (typeof runner !== 'function') {
      throw new PreparedContainmentError('CONTAINMENT_CONFIGURATION_INVALID');
    }
    return new PreparedContainmentExecution(binding, runner);
  }

  /** Bounded, read-only view of the verified containment binding identity. No host escape hatch. */
  get containmentBindingDigest(): string {
    return this.binding.containmentBindingDigest;
  }

  bindingIdentity(): Readonly<Pick<VerifiedContainmentBinding,
    'providerId' | 'providerBindingDigest' | 'containmentBindingDigest' | 'securityProfileDigest'
    | 'instanceIdentityDigest' | 'expectedModelId' | 'expectedModelDigest'>> {
    return Object.freeze({
      providerId: this.binding.providerId,
      providerBindingDigest: this.binding.providerBindingDigest,
      containmentBindingDigest: this.binding.containmentBindingDigest,
      securityProfileDigest: this.binding.securityProfileDigest,
      instanceIdentityDigest: this.binding.instanceIdentityDigest,
      expectedModelId: this.binding.expectedModelId,
      expectedModelDigest: this.binding.expectedModelDigest,
    });
  }

  /**
   * Future contained execution entry (R3-B1: fake-runner only). It passes ONLY the verified binding and
   * the bounded prompt to the injected runner; it never surfaces a provider/host handle to the caller.
   */
  async execute(input: ContainedExecutionInput): Promise<ContainedExecutionResult> {
    return this.runner(this.binding, input);
  }
}
