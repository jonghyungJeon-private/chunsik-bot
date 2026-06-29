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
