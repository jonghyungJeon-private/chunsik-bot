import { XrError } from './offline-read';

const FORBIDDEN_OFFLINE = /(?:['"](?:node:)?(?:fs(?:\/promises)?|child_process|net|http|https|dgram|tls)['"]|\bfetch\s*\(|process\.(?:kill|env)|\bDeno\b|\bBun\b)/;

export function assertOfflineSourceBoundary(sources: readonly string[]): void {
  if (sources.some((source) => FORBIDDEN_OFFLINE.test(source))) throw new XrError('COMMAND_SAFETY_BLOCKED');
}

export function assertRealAdapterSourceBoundary(source: string): void {
  const imports = [...source.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]node:fs\/promises['"]\s*;/g)];
  if (imports.length !== 1) throw new XrError('COMMAND_SAFETY_BLOCKED');
  const clause = imports[0]?.[1]?.replace(/\s/g, '') ?? '';
  const fsReferences = source.match(/['"]node:fs(?:\/promises)?['"]/g) ?? [];
  if (clause !== '{lstat,readlink,realpath,stat}' || fsReferences.length !== 1 ||
      /import\s*\(['"]node:fs\/promises/.test(source) ||
      /require\s*\(['"]node:fs\/promises/.test(source) || /export[^;\n]*(?:nodeFsPrimitivePort|Production)/.test(source)) {
    throw new XrError('COMMAND_SAFETY_BLOCKED');
  }
}
