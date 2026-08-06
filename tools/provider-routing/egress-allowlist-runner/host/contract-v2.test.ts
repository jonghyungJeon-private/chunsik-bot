import { describe, expect, it } from 'vitest';
import { ALLOWLIST_CONTRACT, TIER_A_RECORDS } from '../allowlist';
import { canonicalize, sha256 } from '../canonical';
import {
  ALLOWLIST_CANONICALIZATION_VERSION, ALLOWLIST_CONTRACT_VERSION, COMMAND_ORDER_VERSION,
  EVIDENCE_SCHEMA_VERSION, FINAL_DIGEST_FROZEN, PRIOR_BASELINE_DIGEST_COMPATIBLE,
  PRIOR_STATIC_DIGEST_COMPATIBLE,
} from '../contracts';
import { assertClosedEvidence, validateContract } from '../runner';

const evidence = Object.freeze({ contractVersion: 'stage2b-5c-eg-f0-command-evidence-v1',
  schemaVersion: EVIDENCE_SCHEMA_VERSION, allowlistDigest: 'a'.repeat(64), executionBaselineDigest: 'b'.repeat(64),
  sequencerRunId: 'factory-run', commandOrderVersion: COMMAND_ORDER_VERSION, sequenceIndex: 0,
  commandId: 'F0-GIT-00', executableRealpath: '/usr/bin/git', executableIdentity: {}, argvDigest: 'c'.repeat(64),
  workingDirectory: '/fixture', repositoryBranch: 'main', repositoryHead: 'd'.repeat(40),
  privilegeClass: 'UNPRIVILEGED', localDaemonContact: 'NONE', exitClass: 'SUCCESS', stopReason: 'NONE',
  processExitCode: 0, processSignal: 'NONE', stdoutByteCount: 0, stderrByteCount: 0, normalizedFacts: {},
  redactionCount: 0, outputTruncated: false, normalizationResult: 'SUCCESS', evidenceClass: 'FIXTURE',
  observedAt: 'AUDIT_ONLY' });

describe('closed v2 migration', () => {
  it('requires exact v2 contract, canonicalization, and evidence versions', () => {
    expect([ALLOWLIST_CONTRACT_VERSION, ALLOWLIST_CANONICALIZATION_VERSION, EVIDENCE_SCHEMA_VERSION]).toEqual([
      'stage2b-5c-eg-f0-allowlist-v2', 'stage2b-5c-eg-f0-canonical-json-v2',
      'stage2b-5c-eg-f0-command-evidence-schema-v2']);
  });
  it('rejects a v1 contract', () => expect(() => validateContract({ ...ALLOWLIST_CONTRACT,
    contractVersion: 'stage2b-5c-eg-f0-allowlist-v1' })).toThrow('ALLOWLIST_CONTRACT_VERSION_MISMATCH'));
  it('rejects missing and mismatched command-order versions', () => {
    expect(() => validateContract({ ...ALLOWLIST_CONTRACT, commandOrderVersion: 'wrong' })).toThrow('COMMAND_ORDER_VERSION_MISMATCH');
    const missing = { ...ALLOWLIST_CONTRACT } as Record<string, unknown>; delete missing.commandOrderVersion;
    expect(() => validateContract(missing as unknown as typeof ALLOWLIST_CONTRACT)).toThrow('ALLOWLIST_CONTRACT_SCHEMA_MISMATCH');
  });
  it('binds command-order version into static canonical bytes', () => expect(sha256(canonicalize(ALLOWLIST_CONTRACT)))
    .not.toBe(sha256(canonicalize({ ...ALLOWLIST_CONTRACT, commandOrderVersion: 'other' }))));
  it('places all four process stop reasons on every record', () => {
    for (const record of TIER_A_RECORDS) expect(record.stopConditions).toEqual(expect.arrayContaining([
      'COMMAND_TIMEOUT', 'PROCESS_SPAWN_FAILED', 'STREAM_READ_FAILED', 'PROCESS_TERMINATION_FAILED']));
  });
  it('declares both prior digests incompatible and no final digest frozen', () => {
    expect(PRIOR_STATIC_DIGEST_COMPATIBLE).toBe(false); expect(PRIOR_BASELINE_DIGEST_COMPATIBLE).toBe(false);
    expect(FINAL_DIGEST_FROZEN).toBe(false);
  });
  it('requires all evidence v2 fields and rejects unknown fields', () => {
    expect(() => assertClosedEvidence(evidence)).not.toThrow();
    expect(() => assertClosedEvidence({ ...evidence, rawStdout: 'forbidden' })).toThrow('EVIDENCE_UNKNOWN_FIELD');
  });
  it('rejects wrong run order, sequence range, and schema', () => {
    expect(() => assertClosedEvidence({ ...evidence, sequencerRunId: '' })).toThrow('EVIDENCE_REPLAY_BINDING_INVALID');
    expect(() => assertClosedEvidence({ ...evidence, commandOrderVersion: 'wrong' })).toThrow('COMMAND_ORDER_VERSION_MISMATCH');
    expect(() => assertClosedEvidence({ ...evidence, sequenceIndex: 16 })).toThrow('EVIDENCE_SEQUENCE_INDEX_INVALID');
    expect(() => assertClosedEvidence({ ...evidence, schemaVersion: 'v1' })).toThrow('EVIDENCE_SCHEMA_VERSION_MISMATCH');
  });
  it('keeps numeric exit and signal mutually exclusive', () => expect(() => assertClosedEvidence({ ...evidence,
    processExitCode: 0, processSignal: 'SIGTERM' })).toThrow('PROCESS_RESULT_CONTRADICTION'));
  it('requires failed evidence facts to remain empty', () => expect(() => assertClosedEvidence({ ...evidence,
    exitClass: 'EXECUTION_ERROR', stopReason: 'COMMAND_TIMEOUT', processExitCode: 'NONE', processSignal: 'SIGTERM',
    normalizedFacts: { leaked: true } })).toThrow('FAILED_EVIDENCE_FACTS_NOT_EMPTY'));
});
