import { describe, expect, it } from 'vitest';
import { CONTINUATION_CONTAINMENT_AUDIT_SCHEMA, type ContinuationContainmentAudit } from '../ports';
import {
  containmentEvidencePreserved,
  snapshotContainmentAudit,
} from './continuation-containment-validation';
import { classifyContainmentFailure, classifyProviderSpawnFailed } from './containment-failure-classifier';

const HEX = 'a'.repeat(64);
const RUN = 'run-1';

function binding(overrides: Record<string, unknown> = {}) {
  return {
    executionId: RUN,
    taskRunId: RUN,
    containmentPolicyId: 'policy-1',
    containmentPolicyVersion: 'v1',
    containmentPolicyDigest: HEX,
    containmentBindingDigest: 'b'.repeat(64),
    providerId: 'ollama-local',
    modelId: 'llama3:8b',
    modelDigest: 'c'.repeat(64),
    imageDigest: 'd'.repeat(64),
    runtimeFamily: 'NONE',
    runtimeVersion: 'v0',
    securityProfileDigest: 'e'.repeat(64),
    modelMountIdentityDigest: 'f'.repeat(64),
    verifierVersion: 'verifier-1',
    channelAResultDigest: '0'.repeat(64),
    channelBResultDigest: '1'.repeat(64),
    preflightDisposition: 'VERIFIED',
    modelIntegrityStatus: 'VERIFIED_AT_BIND',
    ...overrides,
  };
}
function audit(overrides: Record<string, unknown> = {}): ContinuationContainmentAudit {
  return {
    schemaVersion: CONTINUATION_CONTAINMENT_AUDIT_SCHEMA,
    binding: binding() as never,
    ...overrides,
  } as ContinuationContainmentAudit;
}

describe('R3-A ContinuationContainmentAudit validation', () => {
  it('accepts a well-formed binding-only audit anchored to the exact run', () => {
    const projected = snapshotContainmentAudit(audit(), RUN, RUN);
    expect(projected).not.toBeNull();
    expect(projected!.schemaVersion).toBe(CONTINUATION_CONTAINMENT_AUDIT_SCHEMA);
    expect(projected!.postAttempt).toBeUndefined();
  });

  it('accepts append-once post-attempt evidence', () => {
    const withPost = audit({ postAttempt: { attemptBoundaryCrossed: true, postAttemptModelIntegrity: 'MATCHED', failureCode: null } });
    expect(snapshotContainmentAudit(withPost, RUN, RUN)).not.toBeNull();
  });

  it('fails closed on wrong schema version', () => {
    expect(snapshotContainmentAudit(audit({ schemaVersion: 'continuation-containment-audit-v2' }), RUN, RUN)).toBeNull();
  });

  it('fails closed on unknown keys', () => {
    const extra = { ...audit(), extra: 'nope' };
    expect(snapshotContainmentAudit(extra, RUN, RUN)).toBeNull();
  });

  it('fails closed when executionId/taskRunId do not match the exact run', () => {
    expect(snapshotContainmentAudit(audit(), 'other', 'other')).toBeNull();
    expect(snapshotContainmentAudit({ ...audit(), binding: binding({ taskRunId: 'mismatch' }) }, RUN, RUN)).toBeNull();
  });

  it('fails closed on malformed digest formats', () => {
    expect(snapshotContainmentAudit({ ...audit(), binding: binding({ containmentBindingDigest: 'short' }) }, RUN, RUN)).toBeNull();
  });

  it('fails closed on unknown enum dispositions', () => {
    expect(snapshotContainmentAudit({ ...audit(), binding: binding({ preflightDisposition: 'MAYBE' }) }, RUN, RUN)).toBeNull();
    expect(snapshotContainmentAudit({ ...audit(), binding: binding({ runtimeFamily: 'DOCKER' }) }, RUN, RUN)).toBeNull();
  });

  it('rejects a bind-time-only integrity status inside post-attempt evidence', () => {
    const bad = audit({ postAttempt: { attemptBoundaryCrossed: true, postAttemptModelIntegrity: 'VERIFIED_AT_BIND', failureCode: null } });
    expect(snapshotContainmentAudit(bad, RUN, RUN)).toBeNull();
  });

  it('rejects accessor (getter) properties without invoking them', () => {
    const trap: Record<string, unknown> = { ...audit() };
    let invoked = false;
    Object.defineProperty(trap, 'binding', { enumerable: true, get() { invoked = true; return binding(); } });
    expect(snapshotContainmentAudit(trap, RUN, RUN)).toBeNull();
    expect(invoked).toBe(false);
  });
});

describe('R3-A containment evidence preservation (A-1 comparator)', () => {
  const base = () => snapshotContainmentAudit(audit(), RUN, RUN)!;

  it('allows any incoming when current is absent', () => {
    expect(containmentEvidencePreserved(null, base())).toBe(true);
    expect(containmentEvidencePreserved(null, null)).toBe(true);
  });

  it('forbids removing existing evidence', () => {
    expect(containmentEvidencePreserved(base(), null)).toBe(false);
  });

  it('forbids changing the binding digest', () => {
    const changed = snapshotContainmentAudit({ ...audit(), binding: binding({ containmentBindingDigest: '9'.repeat(64) }) }, RUN, RUN)!;
    expect(containmentEvidencePreserved(base(), changed)).toBe(false);
  });

  it('allows identical preservation and adding post-attempt evidence', () => {
    expect(containmentEvidencePreserved(base(), base())).toBe(true);
    const withPost = snapshotContainmentAudit(audit({ postAttempt: { attemptBoundaryCrossed: true, postAttemptModelIntegrity: 'MATCHED', failureCode: null } }), RUN, RUN)!;
    expect(containmentEvidencePreserved(base(), withPost)).toBe(true);
  });

  it('forbids removing or mutating existing post-attempt evidence', () => {
    const withPost = snapshotContainmentAudit(audit({ postAttempt: { attemptBoundaryCrossed: true, postAttemptModelIntegrity: 'MATCHED', failureCode: null } }), RUN, RUN)!;
    expect(containmentEvidencePreserved(withPost, base())).toBe(false);
    const otherPost = snapshotContainmentAudit(audit({ postAttempt: { attemptBoundaryCrossed: true, postAttemptModelIntegrity: 'MISMATCH', failureCode: 'MODEL_DIGEST_MISMATCH' } }), RUN, RUN)!;
    expect(containmentEvidencePreserved(withPost, otherPost)).toBe(false);
  });
});

describe('R3-A routing-audit-v1 separation regression', () => {
  it('keeps the routing-audit-v1 schema literal distinct from the containment audit schema', () => {
    // The containment audit is a separate, independently versioned contract; it must NOT reuse or
    // collide with continuation-routing-audit-v1.
    expect(CONTINUATION_CONTAINMENT_AUDIT_SCHEMA).toBe('continuation-containment-audit-v1');
    expect(CONTINUATION_CONTAINMENT_AUDIT_SCHEMA).not.toBe('continuation-routing-audit-v1');
  });

  it('containment audit carries its own schema, never the routing-audit-v1 tag', () => {
    const projected = snapshotContainmentAudit(audit(), RUN, RUN);
    expect(projected!.schemaVersion).toBe('continuation-containment-audit-v1');
    expect((projected as unknown as Record<string, unknown>).routingAudit).toBeUndefined();
  });
});

describe('R3-A phase-sensitive containment failure classifier', () => {
  it('classifies CONTAINMENT_FAILURE / MODEL_DOWNLOAD_DETECTED as definite FAILED pre-attempt', () => {
    expect(classifyContainmentFailure('PRE_ATTEMPT', 'CONTAINMENT_FAILURE')).toBe('FAILED');
    expect(classifyContainmentFailure('PRE_ATTEMPT', 'MODEL_DOWNLOAD_DETECTED')).toBe('FAILED');
  });

  it('classifies the same codes as UNRESOLVED once the attempt boundary is crossed', () => {
    expect(classifyContainmentFailure('ATTEMPT_STARTED', 'CONTAINMENT_FAILURE')).toBe('UNRESOLVED');
    expect(classifyContainmentFailure('POST_ATTEMPT', 'MODEL_DOWNLOAD_DETECTED')).toBe('UNRESOLVED');
  });

  it('classifies deterministic pre-attempt containment codes as FAILED pre-attempt', () => {
    expect(classifyContainmentFailure('PRE_ATTEMPT', 'MODEL_DIGEST_MISMATCH')).toBe('FAILED');
    expect(classifyContainmentFailure('PRE_ATTEMPT', 'PRIVATE_DAEMON_NOT_READY')).toBe('FAILED');
  });

  it('PROVIDER_SPAWN_FAILED is phase-sensitive, not global', () => {
    expect(classifyProviderSpawnFailed('PRE_ATTEMPT', false)).toBe('FAILED');
    expect(classifyProviderSpawnFailed('ATTEMPT_STARTED', true)).toBe('FAILED');
    expect(classifyProviderSpawnFailed('ATTEMPT_STARTED', false)).toBe('UNRESOLVED');
    expect(classifyProviderSpawnFailed('POST_ATTEMPT', false)).toBe('UNRESOLVED');
  });
});
