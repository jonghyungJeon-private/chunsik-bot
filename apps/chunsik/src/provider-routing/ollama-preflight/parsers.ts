import {
  MAX_INVENTORY_ROWS,
  OllamaPreflightError,
  OllamaPreflightFailureCode,
  REQUIRED_OLLAMA_MODELS,
} from './contracts';
import { createHash } from 'node:crypto';

const VERSION_TOKEN = /(?<![0-9A-Za-z.-])v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?(?![0-9A-Za-z.-])/g;
const MODEL_TAG = /^[A-Za-z0-9._:/-]+$/;

function decodeUtf8(input: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    throw new OllamaPreflightError(OllamaPreflightFailureCode.INVALID_UTF8);
  }
}

/** Removes terminal framing without interpreting content. */
export function sanitizePreflightOutput(input: string): string {
  return input
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[ -/]*[0-~]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '');
}

function meaningful(input: Uint8Array): string {
  return sanitizePreflightOutput(decodeUtf8(input)).trim();
}

export function parseOllamaVersion(stdout: Uint8Array, stderr: Uint8Array): string {
  const out = meaningful(stdout);
  const err = meaningful(stderr);
  if ((out.length === 0) === (err.length === 0)) {
    throw new OllamaPreflightError(OllamaPreflightFailureCode.VERSION_OUTPUT_INVALID);
  }
  const selected = out || err;
  if (Buffer.byteLength(selected, 'utf8') > 256 || selected.split(/\r?\n/).length !== 1) {
    throw new OllamaPreflightError(OllamaPreflightFailureCode.VERSION_OUTPUT_INVALID);
  }
  const tokens = selected.match(VERSION_TOKEN) ?? [];
  if (tokens.length !== 1) {
    throw new OllamaPreflightError(OllamaPreflightFailureCode.VERSION_OUTPUT_INVALID);
  }
  return (tokens[0] as string).replace(/^v/, '');
}

export interface ParsedOllamaInventory {
  readonly installedRequiredModels: readonly string[];
  readonly missingRequiredModels: readonly string[];
  readonly additionalModelCount: number;
  readonly inventoryFingerprint: string;
}

export function parseOllamaInventory(input: Uint8Array): ParsedOllamaInventory {
  const text = meaningful(input);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = lines.shift();
  if (header?.split(/\s+/).join(' ') !== 'NAME ID SIZE MODIFIED' || lines.length > MAX_INVENTORY_ROWS) {
    throw new OllamaPreflightError(OllamaPreflightFailureCode.INVENTORY_OUTPUT_INVALID);
  }
  const names: string[] = [];
  for (const line of lines) {
    const columns = line.split(/\s+/);
    const name = columns[0];
    if (
      columns.length < 4 ||
      name === undefined ||
      Buffer.byteLength(name, 'utf8') > 200 ||
      !MODEL_TAG.test(name) ||
      names.includes(name)
    ) {
      throw new OllamaPreflightError(OllamaPreflightFailureCode.INVENTORY_OUTPUT_INVALID);
    }
    names.push(name);
  }
  const installedRequiredModels = REQUIRED_OLLAMA_MODELS.filter((model) => names.includes(model));
  const missingRequiredModels = REQUIRED_OLLAMA_MODELS.filter((model) => !names.includes(model));
  return Object.freeze({
    installedRequiredModels: Object.freeze([...installedRequiredModels]),
    missingRequiredModels: Object.freeze([...missingRequiredModels]),
    additionalModelCount: names.length - installedRequiredModels.length,
    inventoryFingerprint: createHash('sha256')
      .update(Buffer.from([...names].sort().join('\n'), 'utf8')).digest('hex'),
  });
}

const DOWNLOAD_PATTERNS = Object.freeze([
  /\bpulling\b/i,
  /\bdownloading\b/i,
  /\bfetching\b/i,
  /writing manifest/i,
  /verifying (?:sha|digest)/i,
]);

export function observesModelDownload(stdout: Uint8Array, stderr: Uint8Array): boolean {
  let text: string;
  try {
    text = `${meaningful(stdout)} ${meaningful(stderr)}`;
  } catch {
    return false;
  }
  return DOWNLOAD_PATTERNS.some((pattern) => pattern.test(text));
}
