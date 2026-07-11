import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import type { PatchOperation, WorkspaceRef } from '@chunsik/core';
import { LocalWorkspaceWriter } from './index';

/**
 * Gate 5 — final isolated E2E of the REAL workspace-apply boundary against a disposable, ephemeral git
 * repository (never product, never the quoky-uat-sandbox). Uses the CA-corrected single-`update` fixture
 * `gate5/apply-smoke.txt` (existing file: `marker: PENDING` → `marker: quoky-gate5-workspace-apply`).
 *
 * Proves (CA §5/§6): exact single-file mutation, byte-exact applied content, WORKSPACE_APPLIED, and that a
 * one-file rollback restores the exact baseline with HEAD unchanged — the real `LocalWorkspaceWriter` (the
 * sole file mutator's adapter), no git/command mutation performed by the writer. Test-only; no production code.
 */

const GATE5_PATH = 'gate5/apply-smoke.txt';
const BASELINE = 'gate5 apply smoke\nmarker: PENDING\n';
const APPLIED = 'gate5 apply smoke\nmarker: quoky-gate5-workspace-apply\n';

const created: string[] = [];
afterAll(() => created.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Run git in an isolated repo (ignore the developer's global/system git config). */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  }).trim();
}

/** A dedicated disposable Gate 5 repo: git-init, seed the fixture at BASELINE content, one baseline commit. */
function disposableGate5Repo(): WorkspaceRef {
  const dir = mkdtempSync(join(tmpdir(), 'quoky-gate5-'));
  created.push(dir);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'gate5@quoky.test');
  git(dir, 'config', 'user.name', 'gate5');
  git(dir, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, 'gate5'), { recursive: true });
  writeFileSync(join(dir, GATE5_PATH), BASELINE);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'gate5 baseline');
  return { id: 'gate5-ws', rootPath: dir, kind: 'local-clone' };
}

const writer = new LocalWorkspaceWriter();
const updateOp = (): PatchOperation => ({
  path: GATE5_PATH,
  operation: 'update',
  diff: createTwoFilesPatch(GATE5_PATH, GATE5_PATH, BASELINE, APPLIED, '', ''),
});

function statusLines(dir: string): string[] {
  return git(dir, 'status', '--porcelain').split('\n').filter(Boolean);
}

describe('Gate 5 — real-fs workspace-apply boundary E2E (corrected update fixture)', () => {
  it('single update op → byte-exact, file-only mutation; then a one-file rollback restores the exact baseline', async () => {
    const ref = disposableGate5Repo();
    const baselineHead = git(ref.rootPath, 'rev-parse', 'HEAD');
    expect(statusLines(ref.rootPath)).toEqual([]); // clean baseline
    expect(readFileSync(join(ref.rootPath, GATE5_PATH), 'utf8')).toBe(BASELINE);

    // ── APPLY — the single real WorkspaceWrite ────────────────────────────────────────────────
    const result = await writer.applyOperation(ref, updateOp());
    expect(result.status).toBe('applied');
    expect(result.operation).toBe('update');
    expect(result.path).toBe(GATE5_PATH);

    // byte-exact applied content
    expect(readFileSync(join(ref.rootPath, GATE5_PATH), 'utf8')).toBe(APPLIED);
    // ONLY the fixture changed — exactly one modified path, no adds/deletes/renames
    const lines = statusLines(ref.rootPath);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^M\s+gate5\/apply-smoke\.txt$/);
    // the writer performed NO git mutation — HEAD is still the baseline commit
    expect(git(ref.rootPath, 'rev-parse', 'HEAD')).toBe(baselineHead);

    // ── ROLLBACK — restore only the fixture (operator-side control; never the bot) ─────────────
    git(ref.rootPath, 'checkout', '--', GATE5_PATH);
    expect(statusLines(ref.rootPath)).toEqual([]); // clean again
    expect(git(ref.rootPath, 'rev-parse', 'HEAD')).toBe(baselineHead); // HEAD unchanged
    expect(readFileSync(join(ref.rootPath, GATE5_PATH), 'utf8')).toBe(BASELINE); // baseline restored byte-exact
  });

  it('re-applying the same op is deterministic (idempotent bytes) and never escapes the file', async () => {
    const ref = disposableGate5Repo();
    await writer.applyOperation(ref, updateOp());
    const after1 = readFileSync(join(ref.rootPath, GATE5_PATH), 'utf8');
    // a second identical apply against the already-applied content does not apply cleanly (no PENDING line),
    // so the file is left byte-identical — never corrupted, never a second unrelated change.
    const result2 = await writer.applyOperation(ref, updateOp());
    expect(result2.status).toBe('failed'); // diff context (marker: PENDING) no longer present
    expect(readFileSync(join(ref.rootPath, GATE5_PATH), 'utf8')).toBe(after1); // unchanged on failure
    expect(statusLines(ref.rootPath)).toHaveLength(1); // still only the one file
  });

  it('the disposable repo is neither the product repo nor the UAT sandbox', () => {
    const ref = disposableGate5Repo();
    expect(ref.rootPath.startsWith(tmpdir())).toBe(true);
    expect(ref.rootPath).toContain('quoky-gate5-');
    expect(ref.rootPath).not.toContain('chunsik-bot-2');
    expect(ref.rootPath).not.toContain('quoky-uat-sandbox');
  });
});
