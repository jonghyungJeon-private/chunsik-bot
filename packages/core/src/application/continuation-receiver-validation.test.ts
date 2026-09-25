import { describe, expect, it } from 'vitest';
import { Capability } from '../domain';
import type { ContinuationRoutingAudit } from '../ports';
import { snapshotReceiverConstraint } from './continuation-execution-internal';
import { snapshotReceiverOutcome } from './continuation-receiver-validation';

/**
 * R1 unit contract (ADR-0089 amendment §29, §34). These prove the pre-start receiver support
 * declaration fails closed and that the bounded receiver outcome/audit projection never fabricates
 * terminal certainty from malformed post-invocation data. Support lists narrow eligibility only;
 * they are never a caller override and never grant authority.
 */
describe('snapshotReceiverConstraint — §29 support declaration validation', () => {
  it('accepts a bounded, unique, in-enum support list and returns a frozen immutable snapshot', () => {
    const source = [Capability.GENERAL_CHAT, Capability.SUMMARIZATION];
    const constraint = snapshotReceiverConstraint(source);
    expect(constraint.supportedCapabilities).toEqual(source);
    expect(Object.isFrozen(constraint)).toBe(true);
    expect(Object.isFrozen(constraint.supportedCapabilities)).toBe(true);
    // Copy semantics: mutating the caller array must not affect the frozen snapshot.
    source.push(Capability.CODE_REVIEW);
    expect(constraint.supportedCapabilities).toHaveLength(2);
  });

  it('supports the later R2 production declaration [GENERAL_CHAT] without hard-coding it in Core', () => {
    expect(snapshotReceiverConstraint([Capability.GENERAL_CHAT]).supportedCapabilities).toEqual([Capability.GENERAL_CHAT]);
  });

  it.each([
    ['empty list', [] as unknown],
    ['duplicate capability', [Capability.GENERAL_CHAT, Capability.GENERAL_CHAT]],
    ['non-Capability string', ['NOT_A_CAPABILITY']],
    ['non-array value', 'GENERAL_CHAT'],
    ['null', null],
    ['undefined', undefined],
    ['object', { GENERAL_CHAT: true }],
    ['nested null', [Capability.GENERAL_CHAT, null]],
    ['numeric member', [1]],
  ])('fails closed for %s', (_label, value) => {
    expect(() => snapshotReceiverConstraint(value)).toThrow('INVALID_RECEIVER_SUPPORT');
  });

  it('rejects a list longer than the Capability enum (no unbounded declaration)', () => {
    const oversized = [...Object.values(Capability), Capability.GENERAL_CHAT];
    expect(() => snapshotReceiverConstraint(oversized)).toThrow('INVALID_RECEIVER_SUPPORT');
  });
});

const EXECUTION_ID = 'exact-run-42';

function acceptedAudit(overrides: Partial<ContinuationRoutingAudit> = {}): ContinuationRoutingAudit {
  return {
    schemaVersion: 'continuation-routing-audit-v1',
    executionId: EXECUTION_ID,
    matchedPolicyId: 'policy-1',
    policyVersion: 'v1',
    configurationVersion: 'c1',
    policyDigest: null,
    configurationDigest: null,
    terminalStatus: 'ACCEPTED',
    terminalCode: null,
    attemptCount: 1,
    attemptCountKnown: true,
    attempts: [{
      index: 1, path: 'PRIMARY', providerId: 'provider-1', outcome: 'VALIDATION_ACCEPTED',
      failureCode: null, validationDisposition: 'ACCEPT', validationReasonCodes: [],
      responseSha256: 'a'.repeat(64), byteCount: 128, durationMs: 12, dispatchEvidence: 'RETURNED',
    }],
    finalAcceptedProviderId: 'provider-1',
    dispatchEvidence: 'RETURNED',
    transitions: [{ sequence: 1, evidence: 'RETURNED', code: null }],
    ...overrides,
  } as ContinuationRoutingAudit;
}

describe('snapshotReceiverOutcome — §34 bounded outcome/audit validation', () => {
  it('accepts a well-formed SUCCEEDED outcome and returns a deeply frozen copy', () => {
    const outcome = snapshotReceiverOutcome({ disposition: 'SUCCEEDED', artifactIds: ['artifact-1'] }, EXECUTION_ID);
    expect(outcome).not.toBeNull();
    expect(outcome!.disposition).toBe('SUCCEEDED');
    expect(Object.isFrozen(outcome)).toBe(true);
  });

  it('accepts a well-formed FAILED outcome', () => {
    const outcome = snapshotReceiverOutcome({ disposition: 'FAILED', error: 'CONTINUATION_RECEIVER_FAILED' }, EXECUTION_ID);
    expect(outcome?.disposition).toBe('FAILED');
  });

  it('accepts a well-formed UNRESOLVED outcome', () => {
    const outcome = snapshotReceiverOutcome({ disposition: 'UNRESOLVED', reason: 'EXECUTION_UNCERTAIN' }, EXECUTION_ID);
    expect(outcome?.disposition).toBe('UNRESOLVED');
  });

  it.each([
    ['unknown disposition', { disposition: 'MAYBE', artifactIds: [] }],
    ['null', null],
    ['non-object', 'SUCCEEDED'],
    ['SUCCEEDED with wrong error literal', { disposition: 'FAILED', error: 'RAW_ERROR' }],
    ['UNRESOLVED with wrong reason literal', { disposition: 'UNRESOLVED', reason: 'WHATEVER' }],
    ['SUCCEEDED missing artifactIds', { disposition: 'SUCCEEDED' }],
    ['SUCCEEDED non-array artifactIds', { disposition: 'SUCCEEDED', artifactIds: 'artifact-1' }],
    ['SUCCEEDED oversized artifactIds', { disposition: 'SUCCEEDED', artifactIds: Array.from({ length: 129 }, (_, i) => `a${i}`) }],
    ['SUCCEEDED empty-string artifactId', { disposition: 'SUCCEEDED', artifactIds: [''] }],
    ['raw extra key on FAILED', { disposition: 'FAILED', error: 'CONTINUATION_RECEIVER_FAILED', rawError: 'secret' }],
  ])('rejects malformed outcome (%s) without fabricating certainty', (_label, value) => {
    expect(snapshotReceiverOutcome(value as unknown, EXECUTION_ID)).toBeNull();
  });

  it('accepts a SUCCEEDED outcome with a valid ACCEPTED audit whose executionId matches the exact run', () => {
    const outcome = snapshotReceiverOutcome({ disposition: 'SUCCEEDED', artifactIds: ['artifact-1'], routingAudit: acceptedAudit() }, EXECUTION_ID);
    expect(outcome?.disposition).toBe('SUCCEEDED');
    expect(Object.isFrozen((outcome as { routingAudit: unknown }).routingAudit)).toBe(true);
  });

  it('rejects an audit whose executionId does not equal the exact TaskRun id', () => {
    expect(snapshotReceiverOutcome({ disposition: 'SUCCEEDED', artifactIds: ['artifact-1'], routingAudit: acceptedAudit({ executionId: 'other-run' }) }, EXECUTION_ID)).toBeNull();
  });

  it('rejects an audit with too many attempts', () => {
    const three = acceptedAudit({
      attemptCount: 2, attempts: [
        acceptedAudit().attempts[0]!,
        { ...acceptedAudit().attempts[0]!, index: 2, path: 'FALLBACK' },
        { ...acceptedAudit().attempts[0]!, index: 3, path: 'ESCALATION' } as never,
      ] as never,
    });
    expect(snapshotReceiverOutcome({ disposition: 'SUCCEEDED', artifactIds: ['a'], routingAudit: three }, EXECUTION_ID)).toBeNull();
  });

  it('rejects an audit with an invalid terminalStatus enum', () => {
    expect(snapshotReceiverOutcome({ disposition: 'SUCCEEDED', artifactIds: ['a'], routingAudit: acceptedAudit({ terminalStatus: 'BOGUS' as never }) }, EXECUTION_ID)).toBeNull();
  });

  it('rejects an audit with an oversized transition list', () => {
    const transitions = Array.from({ length: 8 }, (_, i) => ({ sequence: i + 1, evidence: 'RETURNED' as const, code: null }));
    expect(snapshotReceiverOutcome({ disposition: 'SUCCEEDED', artifactIds: ['a'], routingAudit: acceptedAudit({ transitions }) }, EXECUTION_ID)).toBeNull();
  });

  it('rejects an audit with a raw/unexpected key', () => {
    const audit = { ...acceptedAudit(), rawPrompt: 'secret' } as unknown as ContinuationRoutingAudit;
    expect(snapshotReceiverOutcome({ disposition: 'SUCCEEDED', artifactIds: ['a'], routingAudit: audit }, EXECUTION_ID)).toBeNull();
  });

  it('rejects acceptedProviderId on a FAILED outcome (allowed only on SUCCEEDED)', () => {
    const value = { disposition: 'FAILED', error: 'CONTINUATION_RECEIVER_FAILED', acceptedProviderId: 'provider-1' };
    expect(snapshotReceiverOutcome(value as unknown, EXECUTION_ID)).toBeNull();
  });

  it('rejects acceptedProviderId that does not match the audit final accepted provider identity', () => {
    const value = { disposition: 'SUCCEEDED', artifactIds: ['a'], acceptedProviderId: 'provider-9', routingAudit: acceptedAudit() };
    expect(snapshotReceiverOutcome(value as unknown, EXECUTION_ID)).toBeNull();
  });

  it('accepts acceptedProviderId that matches the audit final accepted provider identity', () => {
    const value = { disposition: 'SUCCEEDED', artifactIds: ['a'], acceptedProviderId: 'provider-1', routingAudit: acceptedAudit() };
    expect(snapshotReceiverOutcome(value as unknown, EXECUTION_ID)?.disposition).toBe('SUCCEEDED');
  });

  it('does not fabricate attemptCount=0 when count is unknown; explicit null is required', () => {
    // attemptCountKnown=false must carry attemptCount=null, not a fabricated 0.
    const unknownAudit = acceptedAudit({
      terminalStatus: 'UNKNOWN', terminalCode: null, dispatchEvidence: 'UNKNOWN',
      attemptCountKnown: false, attemptCount: null, attempts: [], finalAcceptedProviderId: null, transitions: [],
    });
    expect(snapshotReceiverOutcome({ disposition: 'UNRESOLVED', reason: 'EXECUTION_UNCERTAIN', routingAudit: unknownAudit }, EXECUTION_ID)?.disposition).toBe('UNRESOLVED');
    const fabricated = acceptedAudit({
      terminalStatus: 'UNKNOWN', terminalCode: null, dispatchEvidence: 'UNKNOWN',
      attemptCountKnown: false, attemptCount: 0 as never, attempts: [], finalAcceptedProviderId: null, transitions: [],
    });
    expect(snapshotReceiverOutcome({ disposition: 'UNRESOLVED', reason: 'EXECUTION_UNCERTAIN', routingAudit: fabricated }, EXECUTION_ID)).toBeNull();
  });
});

/** A well-formed definite-failure audit: not ACCEPTED, no final Provider, no UNKNOWN uncertainty. */
function failedAudit(overrides: Partial<ContinuationRoutingAudit> = {}): ContinuationRoutingAudit {
  return acceptedAudit({
    terminalStatus: 'EXECUTION_FAILED', terminalCode: 'PROVIDER_EXECUTION_FAILED', dispatchEvidence: 'DISPATCHED',
    attemptCount: 1, attemptCountKnown: true, finalAcceptedProviderId: null,
    attempts: [{
      index: 1, path: 'PRIMARY', providerId: 'provider-1', outcome: 'PROVIDER_FAILED',
      failureCode: 'PROVIDER_EXECUTION_FAILED', validationDisposition: null, validationReasonCodes: [],
      responseSha256: null, byteCount: null, durationMs: 5, dispatchEvidence: 'DISPATCHED',
    }],
    transitions: [{ sequence: 1, evidence: 'DISPATCHED', code: 'PROVIDER_EXECUTION_FAILED' }],
    ...overrides,
  });
}

describe('snapshotReceiverOutcome — B1 outcome/audit consistency (§2, §3, §14)', () => {
  it('FAILED_ACCEPTED_AUDIT_REJECTED: FAILED + ACCEPTED audit is invalid', () => {
    expect(snapshotReceiverOutcome({ disposition: 'FAILED', error: 'CONTINUATION_RECEIVER_FAILED', routingAudit: acceptedAudit() }, EXECUTION_ID)).toBeNull();
  });

  it('FAILED + finalAcceptedProviderId (non-ACCEPTED status) is invalid', () => {
    // projectAudit already rejects finalAcceptedProviderId on non-ACCEPTED audits; assert end-to-end.
    const audit = failedAudit({ finalAcceptedProviderId: 'provider-1' });
    expect(snapshotReceiverOutcome({ disposition: 'FAILED', error: 'CONTINUATION_RECEIVER_FAILED', routingAudit: audit }, EXECUTION_ID)).toBeNull();
  });

  it('FAILED_UNKNOWN_AUDIT_REJECTED: FAILED + UNKNOWN terminalStatus is invalid', () => {
    const audit = failedAudit({ terminalStatus: 'UNKNOWN', terminalCode: null });
    expect(snapshotReceiverOutcome({ disposition: 'FAILED', error: 'CONTINUATION_RECEIVER_FAILED', routingAudit: audit }, EXECUTION_ID)).toBeNull();
  });

  it('FAILED + UNKNOWN dispatchEvidence is invalid (uncertain termination)', () => {
    const audit = failedAudit({
      dispatchEvidence: 'UNKNOWN',
      attempts: [{ ...failedAudit().attempts[0]!, dispatchEvidence: 'UNKNOWN' }],
      transitions: [{ sequence: 1, evidence: 'UNKNOWN', code: 'PROVIDER_EXECUTION_FAILED' }],
    });
    expect(snapshotReceiverOutcome({ disposition: 'FAILED', error: 'CONTINUATION_RECEIVER_FAILED', routingAudit: audit }, EXECUTION_ID)).toBeNull();
  });

  it('FAILED + attemptCountKnown=false is invalid (definite failure requires known count)', () => {
    const audit = failedAudit({ attemptCountKnown: false, attemptCount: null, attempts: [], dispatchEvidence: 'DISPATCHED', transitions: [] });
    expect(snapshotReceiverOutcome({ disposition: 'FAILED', error: 'CONTINUATION_RECEIVER_FAILED', routingAudit: audit }, EXECUTION_ID)).toBeNull();
  });

  it('FAILED + per-attempt UNKNOWN outcome is invalid', () => {
    const audit = failedAudit({
      attempts: [{ ...failedAudit().attempts[0]!, outcome: 'UNKNOWN', failureCode: null }],
    });
    expect(snapshotReceiverOutcome({ disposition: 'FAILED', error: 'CONTINUATION_RECEIVER_FAILED', routingAudit: audit }, EXECUTION_ID)).toBeNull();
  });

  it('accepts a well-formed FAILED outcome with a consistent definite-failure audit', () => {
    const outcome = snapshotReceiverOutcome({ disposition: 'FAILED', error: 'CONTINUATION_RECEIVER_FAILED', routingAudit: failedAudit() }, EXECUTION_ID);
    expect(outcome?.disposition).toBe('FAILED');
    expect(Object.isFrozen((outcome as { routingAudit: unknown }).routingAudit)).toBe(true);
  });

  it('UNRESOLVED_ACCEPTED_AUDIT_REJECTED: UNRESOLVED + ACCEPTED audit is invalid', () => {
    expect(snapshotReceiverOutcome({ disposition: 'UNRESOLVED', reason: 'EXECUTION_UNCERTAIN', routingAudit: acceptedAudit() }, EXECUTION_ID)).toBeNull();
  });

  it('UNRESOLVED + finalAcceptedProviderId is invalid', () => {
    const audit = failedAudit({ terminalStatus: 'UNKNOWN', terminalCode: null, dispatchEvidence: 'UNKNOWN',
      attemptCountKnown: false, attemptCount: null, attempts: [], transitions: [], finalAcceptedProviderId: 'provider-1' });
    expect(snapshotReceiverOutcome({ disposition: 'UNRESOLVED', reason: 'EXECUTION_UNCERTAIN', routingAudit: audit }, EXECUTION_ID)).toBeNull();
  });

  it('UNRESOLVED allows UNKNOWN/uncertain dispatch evidence', () => {
    const audit = acceptedAudit({ terminalStatus: 'UNKNOWN', terminalCode: null, dispatchEvidence: 'UNKNOWN',
      attemptCountKnown: false, attemptCount: null, attempts: [], transitions: [], finalAcceptedProviderId: null });
    expect(snapshotReceiverOutcome({ disposition: 'UNRESOLVED', reason: 'EXECUTION_UNCERTAIN', routingAudit: audit }, EXECUTION_ID)?.disposition).toBe('UNRESOLVED');
  });

  it('ACCEPTED_PROVIDER_ON_FAILED_REJECTED: acceptedProviderId is not accepted on FAILED', () => {
    expect(snapshotReceiverOutcome({ disposition: 'FAILED', error: 'CONTINUATION_RECEIVER_FAILED', acceptedProviderId: 'provider-1' } as unknown, EXECUTION_ID)).toBeNull();
  });

  it('ACCEPTED_PROVIDER_ON_UNRESOLVED_REJECTED: acceptedProviderId is not accepted on UNRESOLVED', () => {
    expect(snapshotReceiverOutcome({ disposition: 'UNRESOLVED', reason: 'EXECUTION_UNCERTAIN', acceptedProviderId: 'provider-1' } as unknown, EXECUTION_ID)).toBeNull();
  });

  it('SUCCEEDED + non-ACCEPTED audit is invalid', () => {
    expect(snapshotReceiverOutcome({ disposition: 'SUCCEEDED', artifactIds: ['a'], routingAudit: failedAudit() }, EXECUTION_ID)).toBeNull();
  });

  it('SUCCEEDED acceptedProviderId mismatch with audit final Provider is invalid', () => {
    const value = { disposition: 'SUCCEEDED', artifactIds: ['a'], acceptedProviderId: 'provider-9', routingAudit: acceptedAudit() };
    expect(snapshotReceiverOutcome(value as unknown, EXECUTION_ID)).toBeNull();
  });
});

describe('snapshotReceiverOutcome — B2 inert projection adversarial (§5-§12, §16)', () => {
  it('rejects own toJSON on the outcome container', () => {
    const value = { disposition: 'FAILED', error: 'CONTINUATION_RECEIVER_FAILED',
      toJSON() { return { disposition: 'SUCCEEDED', artifactIds: ['RAW_SECRET'] }; } };
    expect(snapshotReceiverOutcome(value as unknown, EXECUTION_ID)).toBeNull();
  });

  it('rejects toJSON on artifactIds and never lets its raw value reach the snapshot', () => {
    const artifactIds: string[] = ['a'];
    (artifactIds as unknown as { toJSON: () => string }).toJSON = () => 'RAW_SECRET\n/etc/passwd';
    const value = { disposition: 'SUCCEEDED', artifactIds };
    const outcome = snapshotReceiverOutcome(value as unknown, EXECUTION_ID);
    expect(outcome).toBeNull();
    expect(JSON.stringify(outcome)).not.toContain('RAW_SECRET');
  });

  it('rejects toJSON on attempts inside the routing audit', () => {
    const audit = acceptedAudit();
    (audit.attempts as unknown as { toJSON: () => string }).toJSON = () => 'RAW_ATTEMPTS';
    const outcome = snapshotReceiverOutcome({ disposition: 'SUCCEEDED', artifactIds: ['a'], routingAudit: audit }, EXECUTION_ID);
    expect(outcome).toBeNull();
    expect(JSON.stringify(outcome)).not.toContain('RAW_ATTEMPTS');
  });

  it('rejects an accessor (getter) artifactId — single-read semantics, no getter mutation reaches snapshot', () => {
    let reads = 0;
    const artifactIds: unknown[] = [];
    Object.defineProperty(artifactIds, 0, {
      enumerable: true, configurable: true,
      get() { reads += 1; return reads === 1 ? 'a' : 'RAW_SECRET\n/etc/passwd'; },
    });
    Object.defineProperty(artifactIds, 'length', { value: 1, writable: true });
    const outcome = snapshotReceiverOutcome({ disposition: 'SUCCEEDED', artifactIds }, EXECUTION_ID);
    expect(outcome).toBeNull();
    expect(JSON.stringify(outcome)).not.toContain('RAW_SECRET');
  });

  it('rejects a sparse artifactIds array (hole must never become [null])', () => {
    // eslint-disable-next-line no-sparse-arrays
    const artifactIds = ['a', , 'b'];
    const outcome = snapshotReceiverOutcome({ disposition: 'SUCCEEDED', artifactIds }, EXECUTION_ID);
    expect(outcome).toBeNull();
    // The hole must never be materialized as a durable [null]: rejection is total, no projection exists.
  });

  it('rejects a sparse attempts array in the audit', () => {
    const attempts = new Array(1) as ContinuationRoutingAudit['attempts'];
    const audit = acceptedAudit({ attemptCount: 1, attempts });
    expect(snapshotReceiverOutcome({ disposition: 'SUCCEEDED', artifactIds: ['a'], routingAudit: audit }, EXECUTION_ID)).toBeNull();
  });

  it('rejects an accessor index inside the audit attempts array', () => {
    const attempts: unknown[] = [];
    Object.defineProperty(attempts, 0, { enumerable: true, configurable: true, get() { return acceptedAudit().attempts[0]; } });
    Object.defineProperty(attempts, 'length', { value: 1, writable: true });
    const audit = acceptedAudit({ attemptCount: 1, attempts: attempts as ContinuationRoutingAudit['attempts'] });
    expect(snapshotReceiverOutcome({ disposition: 'SUCCEEDED', artifactIds: ['a'], routingAudit: audit }, EXECUTION_ID)).toBeNull();
  });

  it('rejects a non-plain prototype audit object', () => {
    class Evil { }
    const audit = Object.assign(new Evil(), acceptedAudit());
    expect(snapshotReceiverOutcome({ disposition: 'SUCCEEDED', artifactIds: ['a'], routingAudit: audit as unknown as ContinuationRoutingAudit }, EXECUTION_ID)).toBeNull();
  });

  it('rejects a symbol-keyed outcome container', () => {
    const value: Record<string | symbol, unknown> = { disposition: 'FAILED', error: 'CONTINUATION_RECEIVER_FAILED' };
    value[Symbol('x')] = 'y';
    expect(snapshotReceiverOutcome(value as unknown, EXECUTION_ID)).toBeNull();
  });

  it('returns a fresh projection that does not retain receiver-owned nested references', () => {
    const audit = acceptedAudit();
    const outcome = snapshotReceiverOutcome({ disposition: 'SUCCEEDED', artifactIds: ['a'], routingAudit: audit }, EXECUTION_ID);
    expect(outcome?.disposition).toBe('SUCCEEDED');
    const projected = (outcome as { routingAudit: ContinuationRoutingAudit }).routingAudit;
    expect(projected).not.toBe(audit);
    expect(projected.attempts).not.toBe(audit.attempts);
    expect(projected.attempts[0]).not.toBe(audit.attempts[0]);
    expect(projected.transitions).not.toBe(audit.transitions);
    expect(Object.isFrozen(projected.attempts)).toBe(true);
    expect(Object.isFrozen(projected.attempts[0])).toBe(true);
  });
});

describe('snapshotReceiverOutcome — F1 acceptedProviderId requires audit-backed evidence', () => {
  it('SUCCEEDED + acceptedProviderId + routingAudit absent → null (no audit, no durable Provider)', () => {
    const value = { disposition: 'SUCCEEDED', artifactIds: ['a'], acceptedProviderId: 'p1' };
    expect(snapshotReceiverOutcome(value as unknown, EXECUTION_ID)).toBeNull();
  });

  it('SUCCEEDED + acceptedProviderId + non-ACCEPTED audit → null', () => {
    // failedAudit is a valid non-ACCEPTED audit; a Provider identity may not ride on it.
    const value = { disposition: 'SUCCEEDED', artifactIds: ['a'], acceptedProviderId: 'provider-1', routingAudit: failedAudit() };
    expect(snapshotReceiverOutcome(value as unknown, EXECUTION_ID)).toBeNull();
  });

  it('SUCCEEDED + acceptedProviderId matching an ACCEPTED audit final Provider → accepted', () => {
    const value = { disposition: 'SUCCEEDED', artifactIds: ['a'], acceptedProviderId: 'provider-1', routingAudit: acceptedAudit() };
    const outcome = snapshotReceiverOutcome(value as unknown, EXECUTION_ID);
    expect(outcome?.disposition).toBe('SUCCEEDED');
    expect((outcome as { acceptedProviderId?: string }).acceptedProviderId).toBe('provider-1');
  });

  it('SUCCEEDED + acceptedProviderId mismatching the ACCEPTED audit final Provider → null', () => {
    const value = { disposition: 'SUCCEEDED', artifactIds: ['a'], acceptedProviderId: 'provider-9', routingAudit: acceptedAudit() };
    expect(snapshotReceiverOutcome(value as unknown, EXECUTION_ID)).toBeNull();
  });

  it('SUCCEEDED without acceptedProviderId is still accepted (Provider is optional; audit optional)', () => {
    expect(snapshotReceiverOutcome({ disposition: 'SUCCEEDED', artifactIds: ['a'] }, EXECUTION_ID)?.disposition).toBe('SUCCEEDED');
    const withAudit = snapshotReceiverOutcome({ disposition: 'SUCCEEDED', artifactIds: ['a'], routingAudit: acceptedAudit() }, EXECUTION_ID);
    expect(withAudit?.disposition).toBe('SUCCEEDED');
    expect((withAudit as { acceptedProviderId?: string }).acceptedProviderId).toBeUndefined();
  });
});

describe('snapshotReceiverOutcome — F2 Proxy adversarial (length snapshot + has trap)', () => {
  // A Proxy array whose observed length changes between reads. Our projection snapshots length once
  // from the own `length` data descriptor and validates the exact own-key set, so a later-enlarged
  // length can never enlarge the projected array.
  function shiftingLengthArray(reportedFirst: number, reportedLater: number, realIndices: number): unknown[] {
    const target: unknown[] = [];
    for (let i = 0; i < realIndices; i++) target[i] = `x${i}`;
    let lengthReads = 0;
    return new Proxy(target, {
      getOwnPropertyDescriptor(t, key) {
        if (key === 'length') {
          lengthReads += 1;
          return { value: lengthReads === 1 ? reportedFirst : reportedLater, writable: true, enumerable: false, configurable: false };
        }
        return Object.getOwnPropertyDescriptor(t, key);
      },
      get(t, key) {
        if (key === 'length') {
          lengthReads += 1;
          return lengthReads === 1 ? reportedFirst : reportedLater;
        }
        return (t as Record<string | symbol, unknown>)[key];
      },
    }) as unknown as unknown[];
  }

  it('artifactIds Proxy that reports length 1 then 500 cannot yield a 500-length projection', () => {
    const artifactIds = shiftingLengthArray(1, 500, 1);
    const outcome = snapshotReceiverOutcome({ disposition: 'SUCCEEDED', artifactIds }, EXECUTION_ID);
    // Contradictory length observations → strict rejection (key set never matches a stable snapshot).
    if (outcome) {
      expect((outcome as { artifactIds: readonly string[] }).artifactIds.length).toBeLessThanOrEqual(128);
      expect((outcome as { artifactIds: readonly string[] }).artifactIds.length).not.toBe(500);
    } else {
      expect(outcome).toBeNull();
    }
  });

  it('artifactIds Proxy claiming length 500 but only 1 real index is rejected (never projects 500)', () => {
    const artifactIds = shiftingLengthArray(500, 500, 1);
    const outcome = snapshotReceiverOutcome({ disposition: 'SUCCEEDED', artifactIds }, EXECUTION_ID);
    expect(outcome).toBeNull();
  });

  it('attempts Proxy cannot exceed the Stage2B/R1 max (2) via shifting length', () => {
    const attempts = shiftingLengthArray(1, 500, 1) as unknown as ContinuationRoutingAudit['attempts'];
    const audit = acceptedAudit({ attemptCount: 1, attempts });
    const outcome = snapshotReceiverOutcome({ disposition: 'SUCCEEDED', artifactIds: ['a'], routingAudit: audit }, EXECUTION_ID);
    // Whatever the Proxy reports, the projected attempts can never exceed 2 (here it is rejected).
    if (outcome) {
      const projected = (outcome as { routingAudit: ContinuationRoutingAudit }).routingAudit;
      expect(projected.attempts.length).toBeLessThanOrEqual(2);
    } else {
      expect(outcome).toBeNull();
    }
  });

  it('attempts Proxy claiming length 500 is rejected before it can exceed the bound', () => {
    const attempts = shiftingLengthArray(500, 500, 1) as unknown as ContinuationRoutingAudit['attempts'];
    const audit = acceptedAudit({ attemptCount: 1, attempts });
    expect(snapshotReceiverOutcome({ disposition: 'SUCCEEDED', artifactIds: ['a'], routingAudit: audit }, EXECUTION_ID)).toBeNull();
  });

  it('transitions Proxy cannot exceed max transitions (7) via shifting length', () => {
    const transitions = shiftingLengthArray(1, 500, 1) as unknown as ContinuationRoutingAudit['transitions'];
    const audit = acceptedAudit({ transitions });
    const outcome = snapshotReceiverOutcome({ disposition: 'SUCCEEDED', artifactIds: ['a'], routingAudit: audit }, EXECUTION_ID);
    if (outcome) {
      const projected = (outcome as { routingAudit: ContinuationRoutingAudit }).routingAudit;
      expect(projected.transitions.length).toBeLessThanOrEqual(7);
    } else {
      expect(outcome).toBeNull();
    }
  });

  it('transitions Proxy claiming length 500 is rejected before it can exceed the bound', () => {
    const transitions = shiftingLengthArray(500, 500, 1) as unknown as ContinuationRoutingAudit['transitions'];
    const audit = acceptedAudit({ transitions });
    expect(snapshotReceiverOutcome({ disposition: 'SUCCEEDED', artifactIds: ['a'], routingAudit: audit }, EXECUTION_ID)).toBeNull();
  });

  it('Proxy has trap lying about routingAudit presence does not create a phantom audit', () => {
    // The container is a Proxy over a valid SUCCEEDED body. Its `has` trap claims `routingAudit`
    // exists, but there is no own `routingAudit` data property. Presence must be decided by the own
    // descriptor snapshot only — never by `in`/`has` — so the projection carries no routingAudit.
    const target: Record<string, unknown> = { disposition: 'SUCCEEDED', artifactIds: ['a'] };
    const proxy = new Proxy(target, {
      has(t, key) { if (key === 'routingAudit' || key === 'acceptedProviderId') return true; return key in t; },
    });
    const outcome = snapshotReceiverOutcome(proxy as unknown, EXECUTION_ID);
    expect(outcome?.disposition).toBe('SUCCEEDED');
    expect((outcome as { routingAudit?: unknown }).routingAudit).toBeUndefined();
    expect((outcome as { acceptedProviderId?: unknown }).acceptedProviderId).toBeUndefined();
  });

  it('Proxy has trap lying about acceptedProviderId does not inject a Provider identity', () => {
    // has() claims acceptedProviderId exists, but there is no own data property for it. The result
    // must not carry any Provider id, and certainly not one fabricated by the trap.
    const target: Record<string, unknown> = { disposition: 'SUCCEEDED', artifactIds: ['a'] };
    const proxy = new Proxy(target, {
      has(t, key) { if (key === 'acceptedProviderId') return true; return key in t; },
    });
    const outcome = snapshotReceiverOutcome(proxy as unknown, EXECUTION_ID);
    expect(outcome?.disposition).toBe('SUCCEEDED');
    expect((outcome as { acceptedProviderId?: unknown }).acceptedProviderId).toBeUndefined();
  });
});
