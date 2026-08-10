import { canonicalize } from '../../canonical';
import { XR_FCI_MAX_AGGREGATE_BYTES, XR_FCI_MAX_FRAME_BYTES, XR_FCI_MAX_REQUESTS, XR_FCI_PROTOCOL_VERSION,
  XrFciCloseRequest, XrFciErrorResponse, XrFciOkResponse, XrFciOperationRequest, XrFciPrimitiveError,
  XrFciResponse } from './contracts';

export class XrFciProtocolError extends Error { constructor(readonly code: 'PROTOCOL_INVALID' | 'RESPONSE_CAP_EXCEEDED') {
  super(code); } }
const encoder = new TextEncoder();
const noncePattern = /^[0-9a-f]{32}$/;
const operations = new Set(['LSTAT', 'READLINK', 'REALPATH', 'STAT']);
const passes = new Set(['PRE_READ_PASS', 'POST_READ_PASS']);
const primitiveErrors = new Set<XrFciPrimitiveError>(['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES', 'EPERM', 'EINVAL',
  'ENAMETOOLONG', 'IO_UNCLASSIFIED']);

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new XrFciProtocolError('PROTOCOL_INVALID');
  }
  return value as Readonly<Record<string, unknown>>;
}
function exactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort(); const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new XrFciProtocolError('PROTOCOL_INVALID');
  }
}
function common(value: Readonly<Record<string, unknown>>): void {
  if (value.protocolVersion !== XR_FCI_PROTOCOL_VERSION || typeof value.recordNonce !== 'string' ||
      !noncePattern.test(value.recordNonce) || !Number.isSafeInteger(value.sequenceIndex) ||
      (value.sequenceIndex as number) < 1 || (value.sequenceIndex as number) > XR_FCI_MAX_REQUESTS + 1) {
    throw new XrFciProtocolError('PROTOCOL_INVALID');
  }
}

export function assertOperationRequest(value: unknown): asserts value is XrFciOperationRequest {
  const item = record(value); exactKeys(item, ['protocolVersion', 'recordNonce', 'sequenceIndex', 'pass', 'operation', 'exactPath']);
  common(item);
  if (!passes.has(String(item.pass)) || !operations.has(String(item.operation)) || typeof item.exactPath !== 'string' ||
      !item.exactPath.startsWith('/') || item.exactPath.includes('\0') || encoder.encode(item.exactPath).byteLength > 4096) {
    throw new XrFciProtocolError('PROTOCOL_INVALID');
  }
}
export function assertCloseRequest(value: unknown): asserts value is XrFciCloseRequest {
  const item = record(value); exactKeys(item, ['protocolVersion', 'recordNonce', 'sequenceIndex', 'close']); common(item);
  if (item.close !== true) throw new XrFciProtocolError('PROTOCOL_INVALID');
}
function validMetadata(value: unknown): boolean {
  const item = record(value); exactKeys(item, ['fileType', 'device', 'inode', 'uid', 'gid', 'mode', 'size', 'mtime']);
  return ['DIRECTORY', 'REGULAR_FILE', 'SYMLINK'].includes(String(item.fileType)) &&
    ['device', 'inode', 'uid', 'gid', 'mode', 'size', 'mtime'].every((key) => Number.isSafeInteger(item[key]));
}
export function assertResponse(value: unknown): asserts value is XrFciResponse {
  const item = record(value); common(item);
  if (item.status === 'CLOSED') { exactKeys(item, ['protocolVersion', 'recordNonce', 'sequenceIndex', 'status']); return; }
  if (item.status === 'ERROR') { exactKeys(item, ['protocolVersion', 'recordNonce', 'sequenceIndex', 'status', 'error']);
    if (!primitiveErrors.has(item.error as XrFciPrimitiveError)) throw new XrFciProtocolError('PROTOCOL_INVALID'); return; }
  if (item.status === 'OK') { exactKeys(item, ['protocolVersion', 'recordNonce', 'sequenceIndex', 'status', 'result']);
    if (typeof item.result !== 'string' && !validMetadata(item.result)) throw new XrFciProtocolError('PROTOCOL_INVALID'); return; }
  throw new XrFciProtocolError('PROTOCOL_INVALID');
}

export function encodeXrFciFrame(value: XrFciOperationRequest | XrFciCloseRequest | XrFciResponse): Uint8Array {
  const payload = encoder.encode(canonicalize(value));
  if (payload.byteLength === 0 || payload.byteLength > XR_FCI_MAX_FRAME_BYTES) {
    throw new XrFciProtocolError('RESPONSE_CAP_EXCEEDED');
  }
  const frame = new Uint8Array(payload.byteLength + 4); new DataView(frame.buffer).setUint32(0, payload.byteLength, false);
  frame.set(payload, 4); return frame;
}

export class XrFciFrameDecoder {
  private buffer = new Uint8Array(); private aggregate = 0; private ended = false;
  push(chunk: Uint8Array): readonly unknown[] {
    if (this.ended || this.aggregate + chunk.byteLength > XR_FCI_MAX_AGGREGATE_BYTES) {
      throw new XrFciProtocolError('RESPONSE_CAP_EXCEEDED');
    }
    this.aggregate += chunk.byteLength; const combined = new Uint8Array(this.buffer.byteLength + chunk.byteLength);
    combined.set(this.buffer); combined.set(chunk, this.buffer.byteLength); this.buffer = combined;
    const values: unknown[] = [];
    while (this.buffer.byteLength >= 4) {
      const length = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength).getUint32(0, false);
      if (length === 0 || length > XR_FCI_MAX_FRAME_BYTES) throw new XrFciProtocolError('RESPONSE_CAP_EXCEEDED');
      if (this.buffer.byteLength < length + 4) break;
      const payload = this.buffer.slice(4, length + 4); this.buffer = this.buffer.slice(length + 4);
      let text: string; let parsed: unknown;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(payload); parsed = JSON.parse(text); }
      catch { throw new XrFciProtocolError('PROTOCOL_INVALID'); }
      try { if (canonicalize(parsed) !== text) throw new XrFciProtocolError('PROTOCOL_INVALID'); }
      catch (error) { if (error instanceof XrFciProtocolError) throw error; throw new XrFciProtocolError('PROTOCOL_INVALID'); }
      values.push(parsed);
    }
    return Object.freeze(values);
  }
  finish(): void { this.ended = true; if (this.buffer.byteLength !== 0) throw new XrFciProtocolError('PROTOCOL_INVALID'); }
}

export function okResponse(request: XrFciOperationRequest, result: XrFciOkResponse['result']): XrFciOkResponse {
  return Object.freeze({ protocolVersion: 1, recordNonce: request.recordNonce, sequenceIndex: request.sequenceIndex,
    status: 'OK', result });
}
export function errorResponse(request: XrFciOperationRequest, error: XrFciPrimitiveError): XrFciErrorResponse {
  return Object.freeze({ protocolVersion: 1, recordNonce: request.recordNonce, sequenceIndex: request.sequenceIndex,
    status: 'ERROR', error });
}
