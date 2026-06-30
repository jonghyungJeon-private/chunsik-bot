import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Capability, CodeGenerationStatus } from '@chunsik/core';
import type { CodeGeneration, CodeProposal } from '@chunsik/core';
import { SqliteStorageProvider } from './index';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

async function freshStore(): Promise<SqliteStorageProvider> {
  const dir = mkdtempSync(join(tmpdir(), 'chunsik-codegen-'));
  dirs.push(dir);
  const store = new SqliteStorageProvider({ dbPath: join(dir, 'chunsik.db') });
  await store.init(); // runs migrations incl. v6 (code_generations + code_proposals)
  return store;
}

function generation(id: string, planId: string, proposalId: string): CodeGeneration {
  return {
    id,
    executionPlanRef: { id: planId, goal: 'g' },
    capability: Capability.CODE_IMPLEMENTATION,
    status: CodeGenerationStatus.SUCCEEDED,
    codeProposalRef: { id: proposalId },
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T00:00:00.000Z',
  };
}

function proposal(id: string, genId: string): CodeProposal {
  return {
    id,
    codeGenerationRef: { id: genId, status: CodeGenerationStatus.SUCCEEDED },
    proposal: [{ path: 'src/a.ts', newContent: 'export const a = 1;\n' }],
    providerId: 'codex-cli',
    createdAt: '2026-06-30T00:00:00.000Z',
  };
}

describe('Sqlite code-generation repositories (CAP-008) — persistence via migration v6', () => {
  it('round-trips a CodeGeneration and finds it by ExecutionPlan', async () => {
    const store = await freshStore();
    await store.codeGenerations.save(generation('g1', 'plan-1', 'p1'));
    await store.codeGenerations.save(generation('g2', 'plan-2', 'p2'));
    const got = await store.codeGenerations.get('g1');
    expect(got?.status).toBe(CodeGenerationStatus.SUCCEEDED);
    expect(got?.codeProposalRef?.id).toBe('p1');
    expect((await store.codeGenerations.findByExecutionPlan('plan-1')).map((g) => g.id)).toEqual(['g1']);
    await store.close();
  });

  it('round-trips a CodeProposal and finds it by CodeGeneration', async () => {
    const store = await freshStore();
    await store.codeProposals.save(proposal('p1', 'g1'));
    await store.codeProposals.save(proposal('p2', 'g2'));
    const got = await store.codeProposals.get('p1');
    expect(got?.proposal[0]?.path).toBe('src/a.ts');
    expect(got?.providerId).toBe('codex-cli');
    expect((await store.codeProposals.findByCodeGeneration('g1')).map((p) => p.id)).toEqual(['p1']);
    await store.close();
  });
});
