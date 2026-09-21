import { describe, expect, it } from 'vitest';
import { redactSecrets, serializeError } from './error-diagnostics';

// Sprint 4c-Follow-up-2, Track B — secret-free structured error diagnostics. These tests lock in the two
// acceptance guarantees: (1) secrets are redacted from every logged string; (2) the serializer produces a flat,
// diagnosable LogFields record (name/message/stack/cause + context).

describe('redactSecrets', () => {
  it('redacts a PEM private-key block', () => {
    const pem =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA1234secretkeymaterial\nabcd/efgh+ij==\n-----END RSA PRIVATE KEY-----';
    const out = redactSecrets(`key was ${pem} done`);
    expect(out).toContain('[REDACTED_PRIVATE_KEY]');
    expect(out).not.toContain('secretkeymaterial');
    expect(out).not.toContain('BEGIN RSA PRIVATE KEY');
  });

  it('redacts an App JWT (eyJ… three-segment token)', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiI0MjM3MzA3In0.aGVsbG8-signature_part';
    const out = redactSecrets(`Bearer ${jwt}`);
    expect(out).toContain('[REDACTED_JWT]');
    expect(out).not.toContain('eyJhbGci');
  });

  it('redacts a token-bearing remote URL (x-access-token) while keeping the host', () => {
    const out = redactSecrets('remote https://x-access-token:ghs_AbCd1234567890abcdEF@github.com/o/r.git');
    expect(out).not.toContain('ghs_AbCd1234567890abcdEF');
    expect(out).not.toContain('x-access-token:');
    expect(out).toContain('@github.com/o/r.git'); // host/path preserved for diagnosis
    expect(out).toContain('[REDACTED]');
  });

  it('redacts GitHub tokens (installation / oauth / fine-grained PAT)', () => {
    for (const tok of ['ghs_0123456789abcdefABCDEF', 'gho_0123456789abcdefABCDEF', 'github_pat_0123456789abcdef_ABCDEF']) {
      const out = redactSecrets(`token ${tok} end`);
      expect(out).not.toContain(tok);
      expect(out).toContain('[REDACTED_TOKEN]');
    }
  });

  it('redacts an Authorization header value', () => {
    const out = redactSecrets('Authorization: Bearer abc123.def456-token_VALUE');
    expect(out).not.toContain('abc123.def456-token_VALUE');
    expect(out).toMatch(/authorization\s*:\s*bearer \[REDACTED\]/i);
  });

  it('redacts named secret env assignments (GIT_APP_TOKEN, QUOKY_GITHUB_APP_PRIVATE_KEY)', () => {
    expect(redactSecrets('GIT_APP_TOKEN=ghs_shouldnotshow123456')).toContain('GIT_APP_TOKEN=[REDACTED]');
    expect(redactSecrets('GIT_APP_TOKEN=ghs_shouldnotshow123456')).not.toContain('shouldnotshow');
    expect(redactSecrets('QUOKY_GITHUB_APP_PRIVATE_KEY=-----BEGIN')).toContain('QUOKY_GITHUB_APP_PRIVATE_KEY=[REDACTED]');
  });

  it('does NOT over-redact non-secret identifiers (a 40-char commit SHA is preserved)', () => {
    const sha = '6b46700e8e914b82e8f2cecc9d39ffe222f12718';
    expect(redactSecrets(`merged at ${sha}`)).toContain(sha);
  });
});

describe('serializeError', () => {
  it('extracts name / message / stack from an Error, redacting each', () => {
    const err = new Error('failed with token ghs_0123456789abcdefABCDEF in url');
    const out = serializeError(err, { stage: 'inbound' });
    expect(out.errorName).toBe('Error');
    expect(out.errorMessage).toContain('[REDACTED_TOKEN]');
    expect(String(out.errorMessage)).not.toContain('ghs_0123456789abcdefABCDEF');
    expect(typeof out.errorStack).toBe('string');
    expect(out.stage).toBe('inbound');
  });

  it('redacts a token-bearing URL that appears inside the stack', () => {
    const err = new Error('boom');
    err.stack = 'Error: boom\n  at push (https://x-access-token:ghs_AAAA1111BBBB2222CCCC@github.com/o/r.git)';
    const out = serializeError(err);
    expect(String(out.errorStack)).not.toContain('ghs_AAAA1111BBBB2222CCCC');
    expect(String(out.errorStack)).toContain('[REDACTED]@github.com');
  });

  it('captures a safe, redacted error.cause when present', () => {
    const err = new Error('outer', { cause: new Error('inner Authorization: Bearer sekret_TOKEN_value') });
    const out = serializeError(err);
    expect(String(out.errorCause)).toContain('inner');
    expect(String(out.errorCause)).not.toContain('sekret_TOKEN_value');
  });

  it('handles a non-Error thrown value', () => {
    const out = serializeError('plain string failure');
    expect(out.errorName).toBe('NonError');
    expect(out.errorMessage).toBe('plain string failure');
  });

  it('redacts secrets that ride in caller-supplied context, and stays a flat scalar record', () => {
    const out = serializeError(new Error('x'), { stage: 'inbound', note: 'GIT_APP_TOKEN=ghs_leakme1234567890abcd' });
    expect(String(out.note)).toContain('GIT_APP_TOKEN=[REDACTED]');
    for (const v of Object.values(out)) {
      expect(['string', 'number', 'boolean']).toContain(typeof v);
    }
  });
});
