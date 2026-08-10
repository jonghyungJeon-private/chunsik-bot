import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SourceTreePort, nodeReadOnlySourceTree } from '../../../egress-allowlist-runner-test-support/source-boundary';
import { assertClosedOperationContract, assertXrFciSource, assertXrFciSourceBoundary } from
  '../../../egress-allowlist-runner-test-support/xr-fci-source-boundary';

describe('XR-FCI static production boundary', () => {
  it('inspects every actual isolation production module', () => {
    const root = fileURLToPath(new URL('./', import.meta.url)); const paths = assertXrFciSourceBoundary(root, nodeReadOnlySourceTree);
    expect(paths.map((path) => path.slice(root.length)).sort()).toEqual(['contracts.ts', 'index.ts', 'isolation.ts', 'protocol.ts']);
    assertClosedOperationContract(readFileSync(new URL('./protocol.ts', import.meta.url), 'utf8'));
  });
  it.each([
    ['CAP-007', "import '@chunsik/command-local';"], ['command runner', "import './generic-command-runner';"],
    ['Ollama runner', "import '../../../apps/chunsik/src/provider-routing/ollama-preflight/process-runner';"],
    ['Provider runner', "import './provider-specific-runner';"],
    ['test support', "import '../../../egress-allowlist-runner-test-support/fake-observer-lifecycle';"],
    ['process API', "import { spawn } from 'node:child_process';"], ['shell', 'const request = { shell: true };'],
    ['PATH lookup', 'const selected = process.env.PATH;'], ['env spread', 'const env = { ...process.env };'],
    ['content read', 'const value = readFile(path);'], ['operation', "const op = 'READ_FILE';"],
    ['dynamic loader', "const module = import('./alternate');"], ['usr env', "const executable = '/usr/bin/env';"],
  ])('rejects seeded %s authority', (_label, source) => expect(() => assertXrFciSource(source)).toThrow('COMMAND_SAFETY_BLOCKED'));
  it('rejects a newly added violating module through recursive inspection', () => {
    const sources = new Map([['/fci/contracts.ts', 'export const safe = true;'],
      ['/fci/nested/escape.ts', "import { spawn } from 'node:child_process'; void spawn;"]]);
    const tree: SourceTreePort = { list: (path) => path === '/fci' ? [{ name: 'contracts.ts', directory: false },
      { name: 'nested', directory: true }] : [{ name: 'escape.ts', directory: false }], read: (path) => sources.get(path) ?? '' };
    expect(() => assertXrFciSourceBoundary('/fci', tree)).toThrow('COMMAND_SAFETY_BLOCKED');
  });
});
