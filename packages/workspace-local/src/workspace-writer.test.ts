import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import type { PatchOperation, WorkspaceRef } from '@chunsik/core';
import { LocalWorkspaceWriter } from './index';

const created: string[] = [];
afterAll(() => created.forEach((d) => rmSync(d, { recursive: true, force: true })));

function ws(): WorkspaceRef {
  const dir = mkdtempSync(join(tmpdir(), 'chunsik-wswrite-'));
  created.push(dir);
  return { id: 'w1', rootPath: dir, kind: 'local-clone' };
}
function unified(path: string, before: string, after: string): string {
  return createTwoFilesPatch(path, path, before, after, '', '');
}

const writer = new LocalWorkspaceWriter();

describe('LocalWorkspaceWriter (CAP-006, ADR-0027) — atomic per file', () => {
  it('updates an existing file by applying its unified diff', async () => {
    const ref = ws();
    writeFileSync(join(ref.rootPath, 'a.txt'), 'hello\n');
    const op: PatchOperation = { path: 'a.txt', operation: 'update', diff: unified('a.txt', 'hello\n', 'world\n') };
    const r = await writer.applyOperation(ref, op);
    expect(r.status).toBe('applied');
    expect(readFileSync(join(ref.rootPath, 'a.txt'), 'utf8')).toBe('world\n');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('adds a new file (incl. nested dir)', async () => {
    const ref = ws();
    const op: PatchOperation = { path: 'src/new.ts', operation: 'add', diff: unified('src/new.ts', '', 'export const x = 1;\n') };
    const r = await writer.applyOperation(ref, op);
    expect(r.status).toBe('applied');
    expect(readFileSync(join(ref.rootPath, 'src/new.ts'), 'utf8')).toBe('export const x = 1;\n');
  });

  it('deletes a file', async () => {
    const ref = ws();
    writeFileSync(join(ref.rootPath, 'gone.txt'), 'bye\n');
    const r = await writer.applyOperation(ref, { path: 'gone.txt', operation: 'delete', diff: '' });
    expect(r.status).toBe('applied');
    expect(existsSync(join(ref.rootPath, 'gone.txt'))).toBe(false);
  });

  it('reports failed when the diff does not apply cleanly (conflict)', async () => {
    const ref = ws();
    writeFileSync(join(ref.rootPath, 'a.txt'), 'COMPLETELY DIFFERENT\n');
    const op: PatchOperation = { path: 'a.txt', operation: 'update', diff: unified('a.txt', 'hello\n', 'world\n') };
    const r = await writer.applyOperation(ref, op);
    expect(r.status).toBe('failed');
    // file unchanged on failure
    expect(readFileSync(join(ref.rootPath, 'a.txt'), 'utf8')).toBe('COMPLETELY DIFFERENT\n');
  });

  it('skips binary operations', async () => {
    const ref = ws();
    const r = await writer.applyOperation(ref, { path: 'img.png', operation: 'update', diff: '', metadata: { binary: true } });
    expect(r.status).toBe('skipped');
  });

  it('refuses to write outside the workspace root (sandbox)', async () => {
    const ref = ws();
    const r = await writer.applyOperation(ref, { path: '../escape.txt', operation: 'add', diff: unified('../escape.txt', '', 'x') });
    expect(r.status).toBe('failed');
    expect(r.message).toMatch(/escape|root|absolute/i);
  });
});
