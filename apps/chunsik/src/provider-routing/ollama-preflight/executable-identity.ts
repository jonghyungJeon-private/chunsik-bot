import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import {
  MAX_EXECUTABLE_BYTES,
  OLLAMA_EXECUTABLE_IDENTITY_VERSION,
  OllamaPreflightError,
  OllamaPreflightFailureCode,
} from './contracts';
import type { ApprovedOllamaExecutable } from './contracts';

export interface PreflightFileStat {
  readonly kind: 'file' | 'directory' | 'other';
  readonly sizeBytes: number;
  readonly mode: number;
}

export interface OllamaPreflightFileSystem {
  realpath(path: string): string;
  stat(path: string): PreflightFileStat;
  readChunks(path: string, maxBytes: number): Iterable<Uint8Array>;
}

export function resolveOllamaExecutableIdentity(
  inputPath: string,
  fileSystem: OllamaPreflightFileSystem,
): ApprovedOllamaExecutable {
  if (!isAbsolute(inputPath)) {
    throw new OllamaPreflightError(OllamaPreflightFailureCode.INVALID_PREFLIGHT_CONFIGURATION);
  }
  let realPath: string;
  let stat: PreflightFileStat;
  try {
    realPath = fileSystem.realpath(inputPath);
    stat = fileSystem.stat(realPath);
  } catch {
    throw new OllamaPreflightError(OllamaPreflightFailureCode.EXECUTABLE_NOT_FOUND);
  }
  if (!isAbsolute(realPath) || stat.kind !== 'file' || (stat.mode & 0o111) === 0) {
    throw new OllamaPreflightError(OllamaPreflightFailureCode.EXECUTABLE_NOT_RUNNABLE);
  }
  if (stat.sizeBytes <= 0 || stat.sizeBytes > MAX_EXECUTABLE_BYTES) {
    throw new OllamaPreflightError(OllamaPreflightFailureCode.EXECUTABLE_NOT_RUNNABLE);
  }
  const hash = createHash('sha256');
  let observed = 0;
  try {
    for (const chunk of fileSystem.readChunks(realPath, MAX_EXECUTABLE_BYTES)) {
      observed += chunk.byteLength;
      if (observed > MAX_EXECUTABLE_BYTES) {
        throw new OllamaPreflightError(OllamaPreflightFailureCode.EXECUTABLE_NOT_RUNNABLE);
      }
      hash.update(chunk);
    }
  } catch (error) {
    if (error instanceof OllamaPreflightError) throw error;
    throw new OllamaPreflightError(OllamaPreflightFailureCode.EXECUTABLE_NOT_RUNNABLE);
  }
  if (observed !== stat.sizeBytes) {
    throw new OllamaPreflightError(OllamaPreflightFailureCode.EXECUTABLE_IDENTITY_MISMATCH);
  }
  return Object.freeze({
    realPath,
    identity: Object.freeze({
      contractVersion: OLLAMA_EXECUTABLE_IDENTITY_VERSION,
      identityDigest: hash.digest('hex'),
      sizeBytes: stat.sizeBytes,
      modeClass: 'EXECUTABLE',
      pathKind: 'ABSOLUTE_REALPATH',
    }),
  });
}

export function assertOllamaExecutableIdentity(
  expected: ApprovedOllamaExecutable,
  inputPath: string,
  fileSystem: OllamaPreflightFileSystem,
): ApprovedOllamaExecutable {
  const observed = resolveOllamaExecutableIdentity(inputPath, fileSystem);
  if (
    observed.realPath !== expected.realPath ||
    observed.identity.identityDigest !== expected.identity.identityDigest ||
    observed.identity.sizeBytes !== expected.identity.sizeBytes
  ) {
    throw new OllamaPreflightError(OllamaPreflightFailureCode.EXECUTABLE_IDENTITY_MISMATCH);
  }
  return observed;
}
