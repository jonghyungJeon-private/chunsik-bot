import { describe, expect, it, vi } from 'vitest';
import {
  CONTAINMENT_SECURITY_PROFILE_SCHEMA,
  PREPARED_CONTAINMENT_EXECUTION_SCHEMA,
  PreparedContainmentError,
  PreparedContainmentExecution,
  VERIFIED_CONTAINMENT_BINDING_SCHEMA,
  assertExactSoleProviderSelection,
  createContainmentCandidateBinding,
  createContainmentInstanceIdentity,
  createContainmentSecurityProfile,
  prepareVerifiedContainmentBinding,
} from './continuation-prepared-containment';
import type {
  ContainmentCandidateBinding,
  ContainmentChannelResult,
  ContainmentVerificationChannel,
  ContainmentVerificationSubject,
  StaticEligibilityDecision,
} from './continuation-prepared-containment';
import { createHash } from 'node:crypto';

const HEX = (c: string) => c.repeat(64);
const PROVIDER_BINDING_DIGEST = HEX('a'); // opaque Stage2B digest (distinct from any containment digest)

function securityProfile() {
  return createContainmentSecurityProfile({ securityProfileId: 'no-network-v1', securityProfileVersion: '1' });
}

function candidate(overrides: Partial<Parameters<typeof createContainmentCandidateBinding>[0]> = {}): ContainmentCandidateBinding {
  const profile = securityProfile();
  const instance = createContainmentInstanceIdentity('opaque-instance-token-1');
  return createContainmentCandidateBinding({
    providerId: 'ollama-cli:llama3.1:8b',
    providerBindingDigest: PROVIDER_BINDING_DIGEST,
    securityProfile: profile,
    expectedModelId: 'llama3.1:8b',
    expectedModelDigest: HEX('c'),
    imageDigest: HEX('d'),
    instance,
    ...overrides,
  });
}

/** Faithful fake channel: recomputes the EXACT result digest the verifier would produce for the subject. */
function honestChannel(channel: 'A' | 'B', verifierVersion: string): ContainmentVerificationChannel {
  return {
    channel,
    verify(subject: ContainmentVerificationSubject): ContainmentChannelResult {
      const resultDigest = createHash('sha256').update(JSON.stringify({
        domain: `quoky.r3.containment.channel.${channel}.v1`,
        shape: {
          verifierVersion,
          providerId: subject.candidate.providerId,
          providerBindingDigest: subject.providerBindingDigest,
          securityProfileDigest: subject.securityProfileDigest,
          instanceIdentityDigest: subject.instanceIdentityDigest,
          expectedModelDigest: subject.expectedModelDigest,
          imageDigest: subject.candidate.imageDigest,
        },
      })).digest('hex');
      return { status: 'VERIFIED', verifierVersion, resultDigest };
    },
  };
}

function statusChannel(channel: 'A' | 'B', verifierVersion: string, status: ContainmentChannelResult['status']): ContainmentVerificationChannel {
  return { channel, verify: () => ({ status, verifierVersion }) };
}

const channelA = () => honestChannel('A', 'verifier-a-1');
const channelB = () => honestChannel('B', 'verifier-b-1');

describe('R3-B1 containment security profile + instance identity', () => {
  it('security profile is bounded, immutable, runtime-independent with a deny-egress posture', () => {
    const p = securityProfile();
    expect(p.schemaVersion).toBe(CONTAINMENT_SECURITY_PROFILE_SCHEMA);
    expect(p.denyNonLoopbackIpv4).toBe(true);
    expect(p.denyNonLoopbackIpv6).toBe(true);
    expect(p.denyDns).toBe(true);
    expect(p.denyModelDownload).toBe(true);
    expect(p.securityProfileDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(p)).toBe(true);
    // No Docker/OrbStack/VM/host tokens anywhere in the profile.
    expect(JSON.stringify(p)).not.toMatch(/docker|orbstack|vm|socket|127\.0\.0\.1|ollama/i);
  });

  it('security profile digest is deterministic and rejects malformed identity (fail closed)', () => {
    expect(securityProfile().securityProfileDigest).toBe(securityProfile().securityProfileDigest);
    expect(() => createContainmentSecurityProfile({ securityProfileId: ' bad id', securityProfileVersion: '1' }))
      .toThrow(PreparedContainmentError);
  });

  it('instance identity is opaque; the raw token never appears in the identity', () => {
    const instance = createContainmentInstanceIdentity('secret-container-abc123');
    expect(instance.instanceIdentityDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(instance)).not.toContain('secret-container-abc123');
    expect(() => createContainmentInstanceIdentity('bad\u0000token')).toThrow(PreparedContainmentError);
  });
});

describe('R3-B1 candidate binding preserves distinct identities', () => {
  it('carries the Stage2B providerBindingDigest verbatim and validates fields', () => {
    const c = candidate();
    expect(c.providerBindingDigest).toBe(PROVIDER_BINDING_DIGEST);
    expect(c.securityProfileDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(c.instanceIdentityDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(c)).toBe(true);
  });

  it('fails closed on an invalid providerBindingDigest / model digest', () => {
    expect(() => candidate({ providerBindingDigest: 'not-hex' })).toThrow(PreparedContainmentError);
    expect(() => candidate({ expectedModelDigest: 'short' })).toThrow(PreparedContainmentError);
  });
});

describe('R3-B1 dual-channel verification is mandatory and fail-closed', () => {
  it('issues a VerifiedContainmentBinding only when BOTH channels verify the identical subject', () => {
    const binding = prepareVerifiedContainmentBinding({ candidate: candidate(), channelA: channelA(), channelB: channelB() });
    expect(binding.schemaVersion).toBe(VERIFIED_CONTAINMENT_BINDING_SCHEMA);
    expect(binding.containmentBindingDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(binding.channelAResultDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(binding.channelBResultDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(binding.channelAResultDigest).not.toBe(binding.channelBResultDigest); // independent channels
  });

  it('providerBindingDigest and containmentBindingDigest are DISTINCT concepts and values', () => {
    const binding = prepareVerifiedContainmentBinding({ candidate: candidate(), channelA: channelA(), channelB: channelB() });
    expect(binding.providerBindingDigest).toBe(PROVIDER_BINDING_DIGEST);
    expect(binding.containmentBindingDigest).not.toBe(binding.providerBindingDigest);
    // Even the security-profile / instance digests never collide with the binding digest.
    expect(binding.containmentBindingDigest).not.toBe(binding.securityProfileDigest);
    expect(binding.containmentBindingDigest).not.toBe(binding.instanceIdentityDigest);
  });

  it.each(['FAILED', 'UNAVAILABLE', 'UNCERTAIN'] as const)('Channel A %s → fail closed, no binding', (status) => {
    expect(() => prepareVerifiedContainmentBinding({
      candidate: candidate(), channelA: statusChannel('A', 'verifier-a-1', status), channelB: channelB(),
    })).toThrow(PreparedContainmentError);
  });

  it.each(['FAILED', 'UNAVAILABLE', 'UNCERTAIN'] as const)('Channel B %s → fail closed, no binding', (status) => {
    expect(() => prepareVerifiedContainmentBinding({
      candidate: candidate(), channelA: channelA(), channelB: statusChannel('B', 'verifier-b-1', status),
    })).toThrow(PreparedContainmentError);
  });

  it('BOTH channels are mandatory: a single verified channel cannot issue a binding', () => {
    // Channel A verified, Channel B unavailable → reject.
    expect(() => prepareVerifiedContainmentBinding({
      candidate: candidate(), channelA: channelA(), channelB: statusChannel('B', 'verifier-b-1', 'UNAVAILABLE'),
    })).toThrow(PreparedContainmentError);
  });

  it('rejects a channel whose result digest does not match the subject (disagreement)', () => {
    const lyingA: ContainmentVerificationChannel = {
      channel: 'A',
      verify: () => ({ status: 'VERIFIED', verifierVersion: 'verifier-a-1', resultDigest: HEX('9') }),
    };
    expect(() => prepareVerifiedContainmentBinding({ candidate: candidate(), channelA: lyingA, channelB: channelB() }))
      .toThrow(PreparedContainmentError);
  });

  it('rejects two channels that share a verifier identity (independence required)', () => {
    expect(() => prepareVerifiedContainmentBinding({
      candidate: candidate(), channelA: honestChannel('A', 'same-verifier'), channelB: honestChannel('B', 'same-verifier'),
    })).toThrow(PreparedContainmentError);
  });

  it('malformed candidate / wrong channel role → fail closed', () => {
    expect(() => prepareVerifiedContainmentBinding({
      candidate: { ...candidate(), schemaVersion: 'wrong' as never }, channelA: channelA(), channelB: channelB(),
    })).toThrow(PreparedContainmentError);
    // Channel role swap (B provided where A expected) fails closed.
    expect(() => prepareVerifiedContainmentBinding({
      candidate: candidate(), channelA: channelB(), channelB: channelA(),
    })).toThrow(PreparedContainmentError);
  });

  it('uncertain verification is never treated as verified', () => {
    expect(() => prepareVerifiedContainmentBinding({
      candidate: candidate(), channelA: statusChannel('A', 'verifier-a-1', 'UNCERTAIN'), channelB: channelB(),
    })).toThrow(/VERIFICATION_UNCERTAIN/);
  });
});

describe('R3-B1 static eligibility → PRIMARY_ONLY → exact sole selection ordering', () => {
  it('accepts exactly one eligible provider that is the sole selection', () => {
    const decision: StaticEligibilityDecision = {
      eligibleProviderIds: ['ollama-cli:llama3.1:8b'], selectedProviderId: 'ollama-cli:llama3.1:8b', primaryOnly: true,
    };
    expect(assertExactSoleProviderSelection(decision)).toBe('ollama-cli:llama3.1:8b');
  });

  it('rejects more than one eligible provider (PRIMARY_ONLY violation)', () => {
    expect(() => assertExactSoleProviderSelection({
      eligibleProviderIds: ['a', 'b'], selectedProviderId: 'a', primaryOnly: true,
    })).toThrow(/PRIMARY_ONLY_VIOLATION/);
  });

  it('rejects empty eligibility and a selection not equal to the sole eligible provider', () => {
    expect(() => assertExactSoleProviderSelection({ eligibleProviderIds: [], selectedProviderId: 'a', primaryOnly: true }))
      .toThrow(/STATIC_ELIGIBILITY_NOT_SATISFIED/);
    expect(() => assertExactSoleProviderSelection({ eligibleProviderIds: ['a'], selectedProviderId: 'b', primaryOnly: true }))
      .toThrow(/PROVIDER_SELECTION_NOT_SOLE/);
  });

  it('rejects primaryOnly !== true', () => {
    expect(() => assertExactSoleProviderSelection({
      eligibleProviderIds: ['a'], selectedProviderId: 'a', primaryOnly: false as never,
    })).toThrow(/PRIMARY_ONLY_VIOLATION/);
  });

  it('fake orchestration: preparation occurs ONLY after exact sole selection', () => {
    // Ordering witness: selection asserted first; only then is the candidate for that exact provider prepared.
    const decision: StaticEligibilityDecision = {
      eligibleProviderIds: ['ollama-cli:llama3.1:8b'], selectedProviderId: 'ollama-cli:llama3.1:8b', primaryOnly: true,
    };
    const selected = assertExactSoleProviderSelection(decision);
    const c = candidate({ providerId: selected });
    expect(c.providerId).toBe(selected);
    const binding = prepareVerifiedContainmentBinding({ candidate: c, channelA: channelA(), channelB: channelB() });
    expect(binding.providerId).toBe(selected);
    // A non-sole selection never reaches preparation.
    expect(() => assertExactSoleProviderSelection({
      eligibleProviderIds: ['x', 'y'], selectedProviderId: 'x', primaryOnly: true,
    })).toThrow(PreparedContainmentError);
  });
});

describe('R3-B1 PreparedContainmentExecution exposes no raw host Provider capability', () => {
  const verified = () => prepareVerifiedContainmentBinding({ candidate: candidate(), channelA: channelA(), channelB: channelB() });

  it('requires a VerifiedContainmentBinding to construct', () => {
    expect(() => PreparedContainmentExecution.fromVerifiedBinding({ schemaVersion: 'nope' } as never, async () => ({ text: 'x' })))
      .toThrow(PreparedContainmentError);
  });

  it('exposes only bounded binding identity — no provider/executable/command/socket/endpoint', () => {
    const prepared = PreparedContainmentExecution.fromVerifiedBinding(verified(), async () => ({ text: 'ok' }));
    expect(prepared.schemaVersion).toBe(PREPARED_CONTAINMENT_EXECUTION_SCHEMA);
    const identity = prepared.bindingIdentity();
    expect(identity.containmentBindingDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.providerBindingDigest).not.toBe(identity.containmentBindingDigest);
    // The prepared capability's PUBLIC API surface is only the bounded identity view + execute(): no
    // getter returns a raw AiProvider, executable, command, socket, or endpoint. `binding`/`runner` are
    // private implementation fields (never a public accessor / escape hatch).
    const proto = Object.getPrototypeOf(prepared);
    const publicMethods = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
    expect(publicMethods.sort()).toEqual(['bindingIdentity', 'containmentBindingDigest', 'execute'].sort());
    // The bounded identity legitimately carries the DISTINCT provider/model IDENTITY facts (§2), but must
    // NOT carry a host escape hatch: no executable path, loopback endpoint, daemon port, socket, or URL.
    expect(JSON.stringify(identity)).not.toMatch(/127\.0\.0\.1|:11434|\/bin\/|\/usr\/|\.sock|https?:\/\//i);
    // No AiProvider handle is reachable through the public accessors.
    expect((prepared as unknown as { provider?: unknown }).provider).toBeUndefined();
  });

  it('execute passes ONLY the verified binding + bounded prompt to the injected runner (fake)', async () => {
    const runner = vi.fn(async (binding, input) => ({ text: `handled:${binding.containmentBindingDigest.slice(0, 6)}:${input.prompt}` }));
    const prepared = PreparedContainmentExecution.fromVerifiedBinding(verified(), runner);
    const result = await prepared.execute({ prompt: 'hello' });
    expect(result.text).toContain('handled:');
    expect(runner).toHaveBeenCalledTimes(1);
    const [passedBinding, passedInput] = runner.mock.calls[0]!;
    expect(passedBinding.schemaVersion).toBe(VERIFIED_CONTAINMENT_BINDING_SCHEMA);
    // The runner never receives a raw provider/host handle — only the bounded binding + prompt.
    expect(Object.keys(passedInput)).toEqual(['prompt']);
  });
});
