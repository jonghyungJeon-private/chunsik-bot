import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as ts from 'typescript';
import { XrError } from './offline-read';

export const STATIC_SOURCE_INSPECTION_READ = 'APPROVED_READ_ONLY_TEST_INFRA' as const;
const REAL_ADAPTER_PATH = 'host/read/real-read-adapter.ts';
const SOURCE_BOUNDARY_PATH = 'host/read/source-boundary.ts';
const FORBIDDEN_OFFLINE = /(?:['"](?:node:)?(?:fs(?:\/promises)?|child_process|net|http|https|http2|dgram|tls|worker_threads|module)['"]|\bcreateRequire\b|\bfetch\s*\(|process\.(?:kill|env)|process\s*\[\s*['"]env['"]\s*\]|\bDeno\b|\bBun\b)/;

export interface SourceTreePort {
  list(path: string): readonly Readonly<{ name: string; directory: boolean }>[];
  read(path: string): string;
}

export const nodeReadOnlySourceTree: SourceTreePort = Object.freeze({
  list: (path: string) => readdirSync(path, { withFileTypes: true }).map((entry) =>
    Object.freeze({ name: entry.name, directory: entry.isDirectory() })),
  read: (path: string) => readFileSync(path, 'utf8'),
});

function excluded(relativePath: string): boolean {
  return relativePath.endsWith('.test.ts') || relativePath === SOURCE_BOUNDARY_PATH || relativePath === REAL_ADAPTER_PATH;
}

export function deriveOfflineProductionSources(root: string, tree: SourceTreePort = nodeReadOnlySourceTree): readonly string[] {
  const found: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of [...tree.list(directory)].sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      if (entry.directory) visit(path);
      else if (entry.name.endsWith('.ts')) { const name = relative(root, path).replaceAll('\\', '/');
        if (!excluded(name)) found.push(path); }
    }
  };
  visit(root);
  if (found.length === 0) throw new XrError('COMMAND_SAFETY_BLOCKED');
  return Object.freeze(found.sort());
}

export function assertOfflineSourceBoundary(root: string, tree: SourceTreePort = nodeReadOnlySourceTree): readonly string[] {
  const paths = deriveOfflineProductionSources(root, tree);
  if (paths.some((path) => FORBIDDEN_OFFLINE.test(tree.read(path)))) throw new XrError('COMMAND_SAFETY_BLOCKED');
  return paths;
}

function hasExport(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false);
}
function identifiers(node: ts.Node): readonly string[] {
  const values: string[] = [];
  const visit = (child: ts.Node): void => { if (ts.isIdentifier(child)) values.push(child.text); ts.forEachChild(child, visit); };
  visit(node); return values;
}
function yieldsTainted(node: ts.Node, tainted: ReadonlySet<string>): boolean {
  return identifiers(node).some((name) => tainted.has(name));
}

export function assertRealAdapterSourceBoundary(source: string): void {
  const file = ts.createSourceFile('real-read-adapter.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diagnostics = (file as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  if ((diagnostics?.length ?? 0) > 0) throw new XrError('COMMAND_SAFETY_BLOCKED');
  const hostImports = file.statements.filter(ts.isImportDeclaration).filter((statement) =>
    ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text.startsWith('node:fs'));
  if (hostImports.length !== 1) throw new XrError('COMMAND_SAFETY_BLOCKED');
  const declaration = hostImports[0];
  if (declaration === undefined || !ts.isStringLiteral(declaration.moduleSpecifier) ||
      declaration.moduleSpecifier.text !== 'node:fs/promises' || declaration.importClause?.name !== undefined ||
      declaration.importClause?.namedBindings === undefined ||
      !ts.isNamedImports(declaration.importClause.namedBindings)) throw new XrError('COMMAND_SAFETY_BLOCKED');
  const elements = declaration.importClause.namedBindings.elements;
  const expected = ['lstat', 'readlink', 'realpath', 'stat'];
  if (elements.length !== expected.length || elements.some((element, index) =>
    element.propertyName !== undefined || element.name.text !== expected[index])) throw new XrError('COMMAND_SAFETY_BLOCKED');

  let forbiddenLoader = false;
  const inspectLoader = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ((node.expression.kind === ts.SyntaxKind.ImportKeyword) ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
        node.arguments.some((argument) => ts.isStringLiteral(argument) && argument.text.startsWith('node:fs'))) {
      forbiddenLoader = true;
    }
    ts.forEachChild(node, inspectLoader);
  };
  inspectLoader(file); if (forbiddenLoader) throw new XrError('COMMAND_SAFETY_BLOCKED');

  const tainted = new Set<string>(); const factories = new Set<string>();
  for (const statement of file.statements) if (ts.isVariableStatement(statement)) {
    for (const item of statement.declarationList.declarations) if (ts.isIdentifier(item.name) && item.initializer !== undefined) {
      const names = new Set(identifiers(item.initializer));
      if (expected.every((name) => names.has(name))) tainted.add(item.name.text);
    }
  }
  let changed = true;
  while (changed) { changed = false;
    for (const statement of file.statements) {
      if (ts.isVariableStatement(statement)) for (const item of statement.declarationList.declarations) {
        if (!ts.isIdentifier(item.name) || item.initializer === undefined) continue;
        const before = tainted.size + factories.size;
        if (yieldsTainted(item.initializer, tainted)) {
          if (ts.isArrowFunction(item.initializer) || ts.isFunctionExpression(item.initializer)) factories.add(item.name.text);
          else tainted.add(item.name.text);
        }
        if (tainted.size + factories.size !== before) changed = true;
      }
      if (ts.isFunctionDeclaration(statement) && statement.name !== undefined && statement.body !== undefined &&
          yieldsTainted(statement.body, tainted) && !factories.has(statement.name.text)) {
        factories.add(statement.name.text); changed = true;
      }
    }
  }
  const escaping = new Set([...tainted, ...factories]);
  for (const statement of file.statements) {
    if (hasExport(statement) && (yieldsTainted(statement, tainted) ||
        (ts.isFunctionDeclaration(statement) && statement.name !== undefined && factories.has(statement.name.text)) ||
        (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((item) =>
          ts.isIdentifier(item.name) && escaping.has(item.name.text))))) throw new XrError('COMMAND_SAFETY_BLOCKED');
    if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause) &&
        statement.exportClause.elements.some((element) => escaping.has((element.propertyName ?? element.name).text))) {
      throw new XrError('COMMAND_SAFETY_BLOCKED');
    }
    if (ts.isExportAssignment(statement) && yieldsTainted(statement.expression, tainted)) throw new XrError('COMMAND_SAFETY_BLOCKED');
  }
}
