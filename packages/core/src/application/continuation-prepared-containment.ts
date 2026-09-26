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
 * R3-B1 remediation (B-1/B-2/B-3): every security-bearing capability in this module is NON-FORGEABLE at
 * runtime, not merely by TypeScript shape. Issuance is gated by module-private `WeakSet` registries: an
 * object literal, spread copy, or reconstructed look-alike is rejected because it was never issued by
 * this module. Digests are recomputed and re-verified on acceptance (defense in depth). There is NO
 * public arbitrary execution-callback injection point; the only contained execution capability is a
 * module-issued deterministic fake bound to an exact containment instance.
 *
 * Identity distinction (ratified R3 Architecture v3, Gate 4): the Stage2B `providerBindingDigest` and the
 * R3 `containmentBindingDigest` are DISTINCT concepts and DISTINCT values. `providerBindingDigest` stays
 * opaque and is never recomputed here; `containmentBindingDigest` is independently derived and
 * domain-separated so it can never collide with a Stage2B provider binding digest even on overlapping
 * inputs.
 *
 * Digest convention reuses the repository's canonical `sha256(JSON.stringify(canonicalShape))` form
 * (see provider-binding-registry / routing-policy-engine), never an unrelated hashing scheme.
 */

export const CONTAINMENT_SECURITY_PROFILE_SCHEMA = 'containment-security-profile-v1' as const;
export const CONTAINMENT_INSTANCE_IDENTITY_SCHEMA = 'containment-instance-identity-v1' as const;
export const SOLE_PROVIDER_SELECTION_SCHEMA = 'sole-provider-selection-v1' as const;
export const CONTAINMENT_CANDIDATE_BINDING_SCHEMA = 'containment-candidate-binding-v1' as const;
export const VERIFIED_CONTAINMENT_BINDING_SCHEMA = 'verified-containment-binding-v1' as const;
export const CONTAINED_EXECUTION_CAPABILITY_SCHEMA = 'contained-execution-capability-v1' as const;
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
  | 'CONTAINMENT_CANDIDATE_NOT_ISSUED'
  | 'PROVIDER_SELECTION_NOT_ISSUED'
  | 'STATIC_ELIGIBILITY_NOT_SATISFIED'
  | 'PRIMARY_ONLY_VIOLATION'
  | 'PROVIDER_SELECTION_NOT_SOLE'
  | 'CHANNEL_A_UNVERIFIED'
  | 'CHANNEL_B_UNVERIFIED'
  | 'CHANNEL_DISAGREEMENT'
  | 'VERIFICATION_UNCERTAIN'
  | 'VERIFIED_BINDING_NOT_ISSUED'
  | 'CONTAINMENT_BINDING_DIGEST_MISMATCH'
  | 'EXECUTION_CAPABILITY_NOT_ISSUED'
  | 'EXECUTION_CAPABILITY_INSTANCE_MISMATCH';

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

// ────────────────────────────────────────────────────────────────────────────────────────────────
// B-2 — Non-forgeable exact sole Provider selection.
//
// `SoleProviderSelection` is an OPAQUE nominal capability: its concrete class is module-private and its
// instances are registered in a module-private WeakSet. Only `assertExactSoleProviderSelection` can mint
// one (after enforcing static eligibility + PRIMARY_ONLY + exact sole selection). An arbitrary object
// literal is not a member of the registry, so `createContainmentCandidateBinding` rejects it. The public
// type is an opaque brand; the selected providerId is read only through a module function, and the
// candidate derives its providerId FROM the selection — a caller can never substitute a different one.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Opaque, non-forgeable exact-sole-Provider selection. No public constructor; no readable fields. */
export interface SoleProviderSelection {
  readonly schemaVersion: typeof SOLE_PROVIDER_SELECTION_SCHEMA;
  /** Opaque brand — the real identity lives in module-private state, not in this surface. */
  readonly __brand: 'SoleProviderSelection';
}

class IssuedSoleProviderSelection implements SoleProviderSelection {
  readonly schemaVersion = SOLE_PROVIDER_SELECTION_SCHEMA;
  readonly __brand = 'SoleProviderSelection' as const;
  constructor(readonly providerId: string) {
    Object.freeze(this);
  }
}

const issuedSelections = new WeakSet<IssuedSoleProviderSelection>();

/** Recover the selected providerId ONLY from a genuinely issued selection; else fail closed. */
function selectedProviderIdOf(selection: SoleProviderSelection): string {
  if (!(selection instanceof IssuedSoleProviderSelection) || !issuedSelections.has(selection)) {
    throw new PreparedContainmentError('PROVIDER_SELECTION_NOT_ISSUED');
  }
  return selection.providerId;
}

/**
 * Static-eligibility seam expressing the MANDATORY ordering:
 *   static eligibility → PRIMARY_ONLY enforcement → exact sole Provider selection → containment
 *   preparation.
 * It does NOT duplicate Stage2B eligibility/ranking, does NOT fabricate an AVAILABLE Provider snapshot,
 * and does NOT use host `ollama --version` as availability evidence. It receives the already-decided
 * eligible-provider set (a trusted Application seam/fake in R3-B1) and enforces that exactly one provider
 * is eligible AND is the sole selection before any containment candidate may be prepared.
 */
export interface StaticEligibilityDecision {
  /** The eligible providers a prior (fake in R3-B1) static-eligibility pass produced. */
  readonly eligibleProviderIds: readonly string[];
  /** The sole selected provider. PRIMARY_ONLY requires this to be the ONLY eligible provider. */
  readonly selectedProviderId: string;
  /** Positive assertion from the caller's PRIMARY_ONLY enforcement (no fallback/escalation planned). */
  readonly primaryOnly: true;
}

/**
 * Assert the mandatory ordering; fail closed on any deviation. Returns an OPAQUE, non-forgeable
 * `SoleProviderSelection` (not a raw string) that is the ONLY key able to open candidate creation.
 */
export function assertExactSoleProviderSelection(decision: StaticEligibilityDecision): SoleProviderSelection {
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
  const selection = new IssuedSoleProviderSelection(decision.selectedProviderId);
  issuedSelections.add(selection);
  return selection;
}

/**
 * Pure candidate/binding input that preserves DISTINCT identities. `providerBindingDigest` is the
 * Stage2B provider binding digest (opaque here, never recomputed) and is deliberately kept separate from
 * every containment digest. `expectedModelId`/`expectedModelDigest` are the model identity the future
 * contained attempt must run; they are not resolved or executed here.
 *
 * B-2: the candidate is runtime-distinguishable from an arbitrary object literal (module-private
 * WeakSet registration) and its `providerId` is DERIVED from the issued `SoleProviderSelection` — never
 * a caller-supplied raw providerId.
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

const issuedCandidates = new WeakSet<ContainmentCandidateBinding>();

export function createContainmentCandidateBinding(input: {
  /** The ONLY source of providerId — an issued exact sole selection. No raw providerId is accepted. */
  selection: SoleProviderSelection;
  providerBindingDigest: string;
  securityProfile: ContainmentSecurityProfile;
  expectedModelId: string;
  expectedModelDigest: string;
  imageDigest: string;
  instance: ContainmentInstanceIdentity;
}): ContainmentCandidateBinding {
  // B-2: providerId is derived from the issued selection; an unissued selection fails closed here.
  const providerId = selectedProviderIdOf(input.selection);
  if (
    input.securityProfile?.schemaVersion !== CONTAINMENT_SECURITY_PROFILE_SCHEMA ||
    !isHex64(input.securityProfile.securityProfileDigest) ||
    !isId(input.securityProfile.securityProfileId) ||
    input.instance?.schemaVersion !== CONTAINMENT_INSTANCE_IDENTITY_SCHEMA ||
    !isHex64(input.instance.instanceIdentityDigest) ||
    !isHex64(input.providerBindingDigest) ||
    !isOpaque(input.expectedModelId) || !isHex64(input.expectedModelDigest) || !isHex64(input.imageDigest)
  ) {
    throw new PreparedContainmentError('CONTAINMENT_CANDIDATE_INVALID');
  }
  const candidate: ContainmentCandidateBinding = Object.freeze({
    schemaVersion: CONTAINMENT_CANDIDATE_BINDING_SCHEMA,
    providerId,
    providerBindingDigest: input.providerBindingDigest,
    securityProfileId: input.securityProfile.securityProfileId,
    securityProfileDigest: input.securityProfile.securityProfileDigest,
    expectedModelId: input.expectedModelId,
    expectedModelDigest: input.expectedModelDigest,
    imageDigest: input.imageDigest,
    instanceIdentityDigest: input.instance.instanceIdentityDigest,
  });
  issuedCandidates.add(candidate);
  return candidate;
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
 * independently VERIFIED the identical subject, AND is registered in a module-private WeakSet so it
 * cannot be forged. `containmentBindingDigest` is domain-separated and binds the security profile,
 * containment instance, Provider binding, model identity, both channel verifier identities + result
 * digests, and schema/version facts — DISTINCT from `providerBindingDigest`.
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

const issuedVerifiedBindings = new WeakSet<VerifiedContainmentBinding>();

/** Canonical shape whose digest is `containmentBindingDigest`; used to recompute/verify on acceptance. */
function verifiedBindingCanonicalShape(binding: VerifiedContainmentBinding) {
  return {
    schemaVersion: VERIFIED_CONTAINMENT_BINDING_SCHEMA,
    providerId: binding.providerId,
    providerBindingDigest: binding.providerBindingDigest,
    securityProfileId: binding.securityProfileId,
    securityProfileDigest: binding.securityProfileDigest,
    instanceIdentityDigest: binding.instanceIdentityDigest,
    expectedModelId: binding.expectedModelId,
    expectedModelDigest: binding.expectedModelDigest,
    imageDigest: binding.imageDigest,
    channelAVerifierVersion: binding.channelAVerifierVersion,
    channelBVerifierVersion: binding.channelBVerifierVersion,
    channelAResultDigest: binding.channelAResultDigest,
    channelBResultDigest: binding.channelBResultDigest,
  };
}

/**
 * Accept a binding as verified ONLY if (defense in depth):
 *  1. it was issued by this module (WeakSet membership) — literals/spread copies/reconstructions fail; AND
 *  2. its `containmentBindingDigest` still equals the recomputed digest over its canonical identity.
 */
function requireIssuedVerifiedBinding(binding: VerifiedContainmentBinding): void {
  if (binding?.schemaVersion !== VERIFIED_CONTAINMENT_BINDING_SCHEMA
    || !isHex64(binding.containmentBindingDigest)
    || !issuedVerifiedBindings.has(binding)) {
    throw new PreparedContainmentError('VERIFIED_BINDING_NOT_ISSUED');
  }
  const recomputed = sha256Canonical(CONTAINMENT_BINDING_DIGEST_DOMAIN, verifiedBindingCanonicalShape(binding));
  if (recomputed !== binding.containmentBindingDigest) {
    throw new PreparedContainmentError('CONTAINMENT_BINDING_DIGEST_MISMATCH');
  }
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
 * Produce a `VerifiedContainmentBinding` only when the candidate was genuinely issued (B-2) AND BOTH
 * independent channels VERIFIED the identical subject. Missing, malformed, failed, unavailable,
 * mismatched, or uncertain verification fails closed (throws `PreparedContainmentError`) and NEVER issues
 * a binding. The issued binding is registered so it cannot later be forged (B-1).
 */
export function prepareVerifiedContainmentBinding(input: {
  candidate: ContainmentCandidateBinding;
  channelA: ContainmentVerificationChannel;
  channelB: ContainmentVerificationChannel;
}): VerifiedContainmentBinding {
  const { candidate, channelA, channelB } = input;
  // B-2: only a candidate this module issued may be prepared. Literals/spread copies are rejected here.
  if (candidate?.schemaVersion !== CONTAINMENT_CANDIDATE_BINDING_SCHEMA || !issuedCandidates.has(candidate)) {
    throw new PreparedContainmentError('CONTAINMENT_CANDIDATE_NOT_ISSUED');
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
  const binding: VerifiedContainmentBinding = Object.freeze({
    ...bindingShape,
    containmentBindingDigest: sha256Canonical(CONTAINMENT_BINDING_DIGEST_DOMAIN, bindingShape),
  });
  issuedVerifiedBindings.add(binding);
  return binding;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// B-3 — Contained execution capability is issued, not injected.
//
// There is NO public arbitrary execution-callback / AiProvider / command / socket / endpoint injection
// point. The only contained execution capability is a module-issued deterministic fake, registered in a
// module-private WeakSet and bound to an EXACT `instanceIdentityDigest`. Its `run` is closed over
// module-internal deterministic logic; a caller cannot supply the function body, so it can never wrap
// `hostProvider.execute(...)`. Production runtime capability issuance is deferred to a later slice.
// ────────────────────────────────────────────────────────────────────────────────────────────────

export interface ContainedExecutionInput {
  /** Rendered provider-agnostic prompt text ONLY (no containment/runtime/security fields — those never
   * enter AiRequest). Provided by the future R3-C caller; opaque to this capability. */
  readonly prompt: string;
}

export interface ContainedExecutionResult {
  readonly text: string;
}

/**
 * Opaque contained execution capability. Non-forgeable: the concrete class is module-private and only a
 * module factory can mint + register one. It is bound to an exact containment instance identity digest,
 * and its `run` cannot be supplied by a caller.
 */
export interface ContainedExecutionCapability {
  readonly schemaVersion: typeof CONTAINED_EXECUTION_CAPABILITY_SCHEMA;
  readonly instanceIdentityDigest: string;
}

class IssuedContainedExecutionCapability implements ContainedExecutionCapability {
  readonly schemaVersion = CONTAINED_EXECUTION_CAPABILITY_SCHEMA;
  constructor(
    readonly instanceIdentityDigest: string,
    /** Module-internal deterministic run. Never caller-supplied; never a host handle. */
    readonly run: (binding: VerifiedContainmentBinding, input: ContainedExecutionInput) => Promise<ContainedExecutionResult>,
  ) {
    Object.freeze(this);
  }
}

const issuedCapabilities = new WeakSet<IssuedContainedExecutionCapability>();

/**
 * R3-B1 test-only deterministic fake contained execution capability. It accepts ONLY a bounded instance
 * identity — NO execution callback, AiProvider, executable, command, endpoint, socket, or generic host
 * function. Its `run` is fixed, deterministic, and closed over module-internal logic, so executing it can
 * never invoke a caller-injected host Provider. This is the intentionally narrow issuance surface for
 * R3-B1; a production runtime capability is a later authorized slice.
 */
export function createFakeContainedExecutionCapability(
  instance: ContainmentInstanceIdentity,
): ContainedExecutionCapability {
  if (instance?.schemaVersion !== CONTAINMENT_INSTANCE_IDENTITY_SCHEMA || !isHex64(instance.instanceIdentityDigest)) {
    throw new PreparedContainmentError('CONTAINMENT_CONFIGURATION_INVALID');
  }
  const capability = new IssuedContainedExecutionCapability(
    instance.instanceIdentityDigest,
    // Deterministic, side-effect-free fake. No network, provider, command, or host access.
    async (binding, input) =>
      Object.freeze({
        text: `contained-fake:${binding.containmentBindingDigest.slice(0, 12)}:${input.prompt}`,
      }),
  );
  issuedCapabilities.add(capability);
  return capability;
}

function requireIssuedCapability(capability: ContainedExecutionCapability): IssuedContainedExecutionCapability {
  if (!(capability instanceof IssuedContainedExecutionCapability) || !issuedCapabilities.has(capability)) {
    throw new PreparedContainmentError('EXECUTION_CAPABILITY_NOT_ISSUED');
  }
  return capability;
}

/**
 * The ONLY future execution-facing contained capability holder. It encapsulates a genuinely issued
 * `VerifiedContainmentBinding` and a genuinely issued `ContainedExecutionCapability`, and exposes NO raw
 * AiProvider, host executable, command, socket, endpoint, or execution-callback injection point. It is
 * NOT wired into the production ContinuationReceiverExecutionService; production wiring, a real runtime,
 * and terminalize integration are explicitly out of R3-B1 scope.
 */
export class PreparedContainmentExecution {
  readonly schemaVersion = PREPARED_CONTAINMENT_EXECUTION_SCHEMA;
  private readonly binding: VerifiedContainmentBinding;
  private readonly capability: IssuedContainedExecutionCapability;

  private constructor(binding: VerifiedContainmentBinding, capability: IssuedContainedExecutionCapability) {
    this.binding = binding;
    this.capability = capability;
    Object.freeze(this);
  }

  /**
   * Construct the capability holder. It REQUIRES a genuinely issued `VerifiedContainmentBinding` (B-1)
   * and a genuinely issued `ContainedExecutionCapability` (B-3) whose `instanceIdentityDigest` exactly
   * equals the binding's. No raw runner/AiProvider/host handle is accepted.
   */
  static fromVerifiedBinding(
    binding: VerifiedContainmentBinding,
    capability: ContainedExecutionCapability,
  ): PreparedContainmentExecution {
    requireIssuedVerifiedBinding(binding); // B-1: issued + digest recomputed/verified
    const issuedCapability = requireIssuedCapability(capability); // B-3: issued, not a forged object/callback
    if (issuedCapability.instanceIdentityDigest !== binding.instanceIdentityDigest) {
      throw new PreparedContainmentError('EXECUTION_CAPABILITY_INSTANCE_MISMATCH');
    }
    return new PreparedContainmentExecution(binding, issuedCapability);
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
   * Future contained execution entry (R3-B1: module-issued fake capability only). It passes ONLY the
   * verified binding and the bounded prompt to the issued capability's fixed `run`; there is no
   * caller-injected function, so it can never invoke a host Provider.
   */
  async execute(input: ContainedExecutionInput): Promise<ContainedExecutionResult> {
    return this.capability.run(this.binding, input);
  }
}
