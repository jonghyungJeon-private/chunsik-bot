import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentProfileRegistry,
  ArtifactKind,
  ArtifactManager,
  ExecutionKind,
  ExecutionReceiptOutcome,
  ResourceRef,
  WorkHandoffManager,
  WorkManager,
  agentProfileId,
} from '@chunsik/core';
import type { AgentProfile, ExecutionReceipt } from '@chunsik/core';
import { SqliteStorageProvider } from './index';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function profile(id: string): AgentProfile {
  return {
    id: agentProfileId(id),
    displayName: id,
    role: 'bounded role',
    purpose: 'bounded purpose',
    instructions: 'bounded instructions',
  };
}

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'chunsik-work-handoff-e2e-'));
  directories.push(directory);
  return join(directory, 'ephemeral.db');
}

describe('CAP-014 Local E2E — real Core/Application/SQLite v9, no external boundary', () => {
  it('persists validated provenance and reloads it across the real composition chain', async () => {
    const path = databasePath();
    const storage = new SqliteStorageProvider({ dbPath: path });
    await storage.init();
    const workItem = await new WorkManager(storage).create({
      actorId: 'actor-1',
      origin: 'conversation',
    });
    const artifact = await new ArtifactManager(storage).create({
      kind: ArtifactKind.CODE_DIFF,
      title: 'Bounded diff',
    });
    const receipt: ExecutionReceipt = {
      id: 'receipt-1',
      executionKind: ExecutionKind.COMMAND,
      sourceId: 'command-1',
      executionPlanId: 'plan-1',
      authorization: { kind: 'NOT_REQUIRED' },
      outcome: ExecutionReceiptOutcome.SUCCEEDED,
      recordedAt: '2026-09-02T00:00:00.000Z',
    };
    await storage.executionReceipts.insert(receipt);
    const registry = new AgentProfileRegistry([profile('builder'), profile('reviewer')]);
    const handoff = await new WorkHandoffManager(storage, registry).create({
      workItemId: workItem.id,
      fromAgentProfileId: agentProfileId('builder'),
      toAgentProfileId: agentProfileId('reviewer'),
      objective: 'Review the durable handoff.',
      resourceRefs: [new ResourceRef({ source: 'jira', externalId: 'CAP-014' })],
      artifactIds: [artifact.id],
      executionReceiptIds: [receipt.id],
    });
    await storage.close();

    const reopened = new SqliteStorageProvider({ dbPath: path });
    await reopened.init();
    await expect(reopened.workHandoffs.get(handoff.id)).resolves.toEqual(handoff);
    await expect(reopened.workHandoffs.listByWorkItem(workItem.id)).resolves.toEqual([handoff]);
    await reopened.close();
  });
});
