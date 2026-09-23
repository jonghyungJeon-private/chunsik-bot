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
