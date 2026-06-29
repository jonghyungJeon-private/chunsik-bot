import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalCloneWorkspaceProvider } from './index';

const provider = new LocalCloneWorkspaceProvider({ workspaceRoot: tmpdir() });
const created: string[] = [];

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'chunsik-scan-'));
  created.push(d);
  return d;
}

afterAll(() => {
  for (const d of created) rmSync(d, { recursive: true, force: true });
});

describe('LocalCloneWorkspaceProvider.scanProject (ADR-0018, read-only)', () => {
  it('returns exists=false for a non-existent path', async () => {
    const scan = await provider.scanProject('/definitely/not/here/chunsik-xyz');
    expect(scan.exists).toBe(false);
    expect(scan.gitBranch).toBe('unknown');
  });

  it('scans a non-git directory: branch unknown, detects the package manager', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    writeFileSync(join(dir, 'package.json'), '{}');
    const scan = await provider.scanProject(dir);
    expect(scan.exists).toBe(true);
    expect(scan.gitBranch).toBe('unknown');
    expect(scan.packageManager).toBe('pnpm');
  });

  it('excludes node_modules/dist/build/.git/coverage from the file tree summary', async () => {
    const dir = tempDir();
    for (const d of ['node_modules', 'dist', 'build', 'coverage', 'src']) mkdirSync(join(dir, d));
    writeFileSync(join(dir, 'README.md'), '#');
    const scan = await provider.scanProject(dir);
    expect(scan.fileTreeSummary).toContain('src/');
    expect(scan.fileTreeSummary).toContain('README.md');
    expect(scan.fileTreeSummary).not.toContain('node_modules');
    expect(scan.fileTreeSummary).not.toContain('dist');
    expect(scan.fileTreeSummary).not.toContain('coverage');
  });
});

describe('LocalCloneWorkspaceProvider.readProjectFiles (ADR-0019, gated read-only)', () => {
  it('reads only allow-listed metadata files; ignores non-allow-listed ones', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}');
    writeFileSync(join(dir, 'tsconfig.json'), '{}');
    writeFileSync(join(dir, 'README.md'), '# hi');
    writeFileSync(join(dir, 'index.ts'), 'export const x = 1;');
    const readout = await provider.readProjectFiles(dir);
    const paths = readout.files.map((f) => f.path);
    expect(paths).toContain('package.json');
    expect(paths).toContain('tsconfig.json');
    expect(paths).toContain('README.md');
    expect(paths).not.toContain('index.ts'); // source code is not in the allow-list
  });

  it('never reads env / secret-looking files', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, '.env'), 'DISCORD_BOT_TOKEN=abc');
    writeFileSync(join(dir, '.env.local'), 'SECRET=zzz');
    writeFileSync(join(dir, 'my-secret.json'), '{"token":"zzz"}');
    const readout = await provider.readProjectFiles(dir);
    const blob = JSON.stringify(readout.files);
    expect(blob).not.toContain('DISCORD_BOT_TOKEN');
    expect(blob).not.toContain('SECRET=zzz');
    expect(readout.files.map((f) => f.path)).not.toContain('my-secret.json');
  });

  it('caps each file at the size limit and flags truncation', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'package.json'), 'x'.repeat(20000));
    const readout = await provider.readProjectFiles(dir);
    const pkg = readout.files.find((f) => f.path === 'package.json');
    expect(pkg?.truncated).toBe(true);
    expect(pkg?.content.length).toBe(8000);
  });

  it('includes a 2-level tree (root + apps/ + packages/), excluding ignored dirs', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'packages', 'core'), { recursive: true });
    mkdirSync(join(dir, 'apps', 'chunsik'), { recursive: true });
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{}');
    const readout = await provider.readProjectFiles(dir);
    expect(readout.tree).toContain('packages/core/');
    expect(readout.tree).toContain('apps/chunsik/');
    expect(readout.tree).not.toContain('node_modules');
  });

  it('returns an empty readout for a non-existent path (no throw)', async () => {
    const readout = await provider.readProjectFiles('/definitely/not/here/chunsik-xyz');
    expect(readout.files).toEqual([]);
  });
});
