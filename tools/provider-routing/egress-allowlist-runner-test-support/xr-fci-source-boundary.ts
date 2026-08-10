import { posix } from 'node:path';
import * as ts from 'typescript';
import { XrError } from '../egress-allowlist-runner/host/read/offline-read';
import { SourceTreePort } from './source-boundary';

const FORBIDDEN_MODULE = /(?:@chunsik\/command-local|command-local|ollama-preflight|process-runner|command-runner|provider[^/]*runner|egress-allowlist-runner-test-support)/i;
const FORBIDDEN_HOST = /^(?:node:)?(?:child_process|cluster|worker_threads|net|http|https|http2|dgram|tls|module)$/;
const FORBIDDEN_SOURCE = /(?:\bREAD_FILE\b|\breadFile(?:Sync)?\s*\(|\bprocess\.(?:env|title)\b|(?<![.\w])exec(?:File|Sync)?\s*\(|(?<![.\w])fork\s*\(|\bshell\s*:\s*true|\.\.\.\s*process\.env|\/usr\/bin\/env)/;
const EXPECTED_OPERATIONS = ['LSTAT', 'READLINK', 'REALPATH', 'STAT'];

export function assertXrFciSource(source: string, name = 'fci.ts'): void {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diagnostics = (file as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  if ((diagnostics?.length ?? 0) > 0 || FORBIDDEN_SOURCE.test(source)) throw new XrError('COMMAND_SAFETY_BLOCKED');
  for (const statement of file.statements.filter(ts.isImportDeclaration)) {
    if (!ts.isStringLiteral(statement.moduleSpecifier)) throw new XrError('COMMAND_SAFETY_BLOCKED');
    const specifier = statement.moduleSpecifier.text;
    if (FORBIDDEN_MODULE.test(specifier) || FORBIDDEN_HOST.test(specifier)) throw new XrError('COMMAND_SAFETY_BLOCKED');
    if (specifier.startsWith('.') && !posix.resolve('/runner/host/isolation', specifier).startsWith('/runner/')) {
      throw new XrError('COMMAND_SAFETY_BLOCKED');
    }
  }
  let dynamic = false; const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) dynamic = true;
    ts.forEachChild(node, visit);
  }; visit(file); if (dynamic) throw new XrError('COMMAND_SAFETY_BLOCKED');
}

export function assertXrFciSourceBoundary(root: string, tree: SourceTreePort): readonly string[] {
  const paths: string[] = [];
  const visit = (directory: string): void => { for (const entry of tree.list(directory)) {
    const path = posix.join(directory, entry.name); if (entry.directory) visit(path);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) { assertXrFciSource(tree.read(path), path); paths.push(path); }
  } };
  visit(root); if (paths.length === 0) throw new XrError('COMMAND_SAFETY_BLOCKED'); return Object.freeze(paths.sort());
}

export function assertClosedOperationContract(source: string): void {
  const found = EXPECTED_OPERATIONS.filter((operation) => source.includes(`'${operation}'`));
  if (found.length !== EXPECTED_OPERATIONS.length || /READ_FILE|READFILE|CONTENT_READ/.test(source)) {
    throw new XrError('COMMAND_SAFETY_BLOCKED');
  }
}
