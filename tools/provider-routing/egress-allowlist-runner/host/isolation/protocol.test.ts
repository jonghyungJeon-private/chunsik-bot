import { describe, expect, it } from 'vitest';
import { canonicalize } from '../../canonical';
import { XR_FCI_MAX_AGGREGATE_BYTES, XR_FCI_MAX_FRAME_BYTES, XrFciOperationRequest } from './contracts';
import { XrFciFrameDecoder, assertOperationRequest, assertResponse, encodeXrFciFrame, okResponse } from './protocol';

const request = Object.freeze({ protocolVersion: 1, recordNonce: 'a'.repeat(32), sequenceIndex: 1,
  pass: 'PRE_READ_PASS', operation: 'LSTAT', exactPath: '/approved/exact' } as const);
const frame = (text: string): Uint8Array => { const payload = new TextEncoder().encode(text);
  const value = new Uint8Array(payload.length + 4); new DataView(value.buffer).setUint32(0, payload.length, false);
  value.set(payload, 4); return value; };

describe('XR-FCI bounded canonical protocol', () => {
  it('round-trips the four-operation request and a path-free response through split framing', () => {
    for (const operation of ['LSTAT', 'READLINK', 'REALPATH', 'STAT'] as const) {
      const item = { ...request, operation }; expect(() => assertOperationRequest(item)).not.toThrow();
      const encoded = encodeXrFciFrame(item); const decoder = new XrFciFrameDecoder();
      expect(decoder.push(encoded.slice(0, 2))).toEqual([]); expect(decoder.push(encoded.slice(2))).toEqual([item]); decoder.finish();
      const response = okResponse(item, operation === 'READLINK' || operation === 'REALPATH' ? 'bounded-value' :
        { fileType: 'REGULAR_FILE', device: 1, inode: 2, uid: 501, gid: 20, mode: 0o100755, size: 3, mtime: 4 });
      expect(canonicalize(response)).not.toContain(item.exactPath); expect(() => assertResponse(response)).not.toThrow();
    }
  });
  it.each([
    ['unknown operation', { ...request, operation: 'READ_FILE' }],
    ['unknown field', { ...request, arbitraryRpc: true }],
    ['relative path', { ...request, exactPath: 'relative' }],
    ['wrong nonce', { ...request, recordNonce: 'wrong' }],
    ['wrong version', { ...request, protocolVersion: 2 }],
    ['sequence zero', { ...request, sequenceIndex: 0 }],
  ])('rejects %s', (_label, value) => expect(() => assertOperationRequest(value)).toThrow('PROTOCOL_INVALID'));
  it('rejects malformed, non-canonical, duplicate-key, invalid UTF-8, and unexpected EOF frames', () => {
    const cases = [frame('{'), frame(JSON.stringify(request)),
      frame('{"exactPath":"/a","exactPath":"/b","operation":"LSTAT","pass":"PRE_READ_PASS","protocolVersion":1,"recordNonce":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sequenceIndex":1}'),
      new Uint8Array([0, 0, 0, 1, 0xff])];
    for (const value of cases) expect(() => new XrFciFrameDecoder().push(value)).toThrow('PROTOCOL_INVALID');
    const partial = new XrFciFrameDecoder(); partial.push(encodeXrFciFrame(request).slice(0, 8));
    expect(() => partial.finish()).toThrow('PROTOCOL_INVALID');
  });
  it('accepts an exact maximum frame and rejects one byte beyond', () => {
    const base = { protocolVersion: 1 as const, recordNonce: 'a'.repeat(32), sequenceIndex: 1, status: 'OK' as const, result: '' };
    const overhead = new TextEncoder().encode(canonicalize(base)).byteLength;
    const exact = { ...base, result: 'x'.repeat(XR_FCI_MAX_FRAME_BYTES - overhead) };
    expect(encodeXrFciFrame(exact).byteLength).toBe(XR_FCI_MAX_FRAME_BYTES + 4);
    expect(() => encodeXrFciFrame({ ...exact, result: `${exact.result}x` })).toThrow('RESPONSE_CAP_EXCEEDED');
  });
  it('rejects zero/oversized frames and aggregate bytes one beyond the cap', () => {
    const zero = new Uint8Array(4); expect(() => new XrFciFrameDecoder().push(zero)).toThrow('RESPONSE_CAP_EXCEEDED');
    const over = new Uint8Array(4); new DataView(over.buffer).setUint32(0, XR_FCI_MAX_FRAME_BYTES + 1, false);
    expect(() => new XrFciFrameDecoder().push(over)).toThrow('RESPONSE_CAP_EXCEEDED');
    const exactFrame = (totalBytes: number): Uint8Array => { const base = { protocolVersion: 1 as const,
      recordNonce: 'a'.repeat(32), sequenceIndex: 1, status: 'OK' as const, result: '' };
      const overhead = new TextEncoder().encode(canonicalize(base)).byteLength;
      return encodeXrFciFrame({ ...base, result: 'x'.repeat(totalBytes - 4 - overhead) }); };
    const decoder = new XrFciFrameDecoder(); for (let index = 0; index < 7; index += 1) decoder.push(exactFrame(8196));
    decoder.push(exactFrame(XR_FCI_MAX_AGGREGATE_BYTES - (8196 * 7)));
    expect(() => decoder.push(new Uint8Array(1))).toThrow('RESPONSE_CAP_EXCEEDED');
  });
  it.each([
    ['path echo', { protocolVersion: 1, recordNonce: 'a'.repeat(32), sequenceIndex: 1, status: 'ERROR', error: 'ENOENT', exactPath: '/secret' }],
    ['raw message', { protocolVersion: 1, recordNonce: 'a'.repeat(32), sequenceIndex: 1, status: 'ERROR', error: 'IO_UNCLASSIFIED', message: 'host error' }],
    ['unknown errno', { protocolVersion: 1, recordNonce: 'a'.repeat(32), sequenceIndex: 1, status: 'ERROR', error: 'EISDIR' }],
  ])('rejects response %s', (_label, value) => expect(() => assertResponse(value)).toThrow('PROTOCOL_INVALID'));
  it('types the request as the canonical parent-authorized representation', () => {
    const typed: XrFciOperationRequest = request; expect(typed.operation).toBe('LSTAT');
  });
});
