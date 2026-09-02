import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CommandExecutionManager,
  CommandExecutionReceiptRunner,
  CommandExecutionStatus,
  ExecutionKind,
  ExecutionReceiptFailureClass,
  ExecutionReceiptManager,
  ExecutionReceiptOutcome,
  ExecutionReceiptRecordingError,
  RiskPolicy,
} from '@chunsik/core';
import type {
  CommandRunResult,
  CommandRunner,
  ExecutionReceiptRepository,
  RunCommandInput,
  StorageProvider,
} from '@chunsik/core';
import { SqliteStorageProvider } from './index';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function dbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'chunsik-receipt-e2e-'));
  dirs.push(dir);
  return join(dir, 'ephemeral.db');
}

const input = (overrides: Partial<RunCommandInput> = {}): RunCommandInput => ({
  executionPlanRef: { id: 'plan-1', goal: 'receipt e2e' },
  workspaceRef: { id: 'workspace-1', rootPath: '/ephemeral/workspace', kind: 'local-clone' },
  command: 'pnpm',
  args: ['test'],
  ...overrides,
});

async function compose(result: CommandRunResult, path = dbPath()) {
  const storage = new SqliteStorageProvider({ dbPath: path });
  await storage.init();
  const run = vi.fn(async (): Promise<CommandRunResult> => result);
  const externalBoundary: CommandRunner = { kind: 'fake-offline', run };
  const commands = new CommandExecutionManager(storage, externalBoundary, new RiskPolicy());
  const receipts = new ExecutionReceiptManager(storage);
  const composed = new CommandExecutionReceiptRunner(commands, receipts);
  return { storage, run, commands, receipts, composed, path };
}

describe('CAP-013 local E2E — real Core/Application/SQLite v8, fake process only', () => {
  it('A: records a successful fake command and returns the original execution', async () => {
    const h = await compose({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false });
    const execution = await h.composed.run(input());
    const receipt = await h.storage.executionReceipts.findBySource(ExecutionKind.COMMAND, execution.id);
    expect(execution.status).toBe(CommandExecutionStatus.SUCCEEDED);
    expect(receipt).toMatchObject({
      sourceId: execution.id,
      outcome: ExecutionReceiptOutcome.SUCCEEDED,
      authorization: { kind: 'NOT_REQUIRED' },
    });
    expect(h.run).toHaveBeenCalledTimes(1);
    await h.storage.close();
  });

  it('B: maps failed execution without copying stdout or stderr', async () => {
    const rawStdoutMarker = 'RAW_STDOUT_MARKER_8bde23';
    const rawStderrMarker = 'RAW_STDERR_MARKER_44fd19';
    const h = await compose({
      exitCode: 2,
      stdout: rawStdoutMarker,
      stderr: rawStderrMarker,
      timedOut: false,
    });
    const execution = await h.composed.run(input());
    const receipt = await h.storage.executionReceipts.findBySource(ExecutionKind.COMMAND, execution.id);
    expect(receipt).toMatchObject({
      outcome: ExecutionReceiptOutcome.FAILED,
      failureClass: ExecutionReceiptFailureClass.EXECUTION_FAILED,
    });
    expect(receipt).not.toHaveProperty('stdout');
    expect(receipt).not.toHaveProperty('stderr');
    expect(JSON.stringify(receipt)).not.toContain(rawStdoutMarker);
    expect(JSON.stringify(receipt)).not.toContain(rawStderrMarker);
    await h.storage.close();
  });

  it('C: maps timeout to FAILED plus TIMED_OUT', async () => {
    const h = await compose({ exitCode: null, stdout: '', stderr: '', timedOut: true });
    const execution = await h.composed.run(input());
    await expect(h.storage.executionReceipts.findBySource(ExecutionKind.COMMAND, execution.id))
      .resolves.toMatchObject({
        outcome: ExecutionReceiptOutcome.FAILED,
        failureClass: ExecutionReceiptFailureClass.TIMED_OUT,
      });
    await h.storage.close();
  });

  it('D: duplicate recording returns the same receipt and leaves one row', async () => {
    const h = await compose({ exitCode: 0, stdout: '', stderr: '', timedOut: false });
    const execution = await h.composed.run(input());
    const first = await h.receipts.recordCommandExecution(execution.id);
    const second = await h.receipts.recordCommandExecution(execution.id);
    expect(second).toEqual(first);
    expect(await h.storage.executionReceipts.findByExecutionPlan('plan-1')).toHaveLength(1);
    await h.storage.close();
  });

  it('E: reloads the immutable receipt after closing and reopening SQLite', async () => {
    const path = dbPath();
    const first = await compose({ exitCode: 0, stdout: '', stderr: '', timedOut: false }, path);
    const execution = await first.composed.run(input());
    const expected = await first.storage.executionReceipts.get(
      (await first.storage.executionReceipts.findBySource(ExecutionKind.COMMAND, execution.id))!.id,
    );
    await first.storage.close();

    const reopened = new SqliteStorageProvider({ dbPath: path });
    await reopened.init();
    expect(await reopened.executionReceipts.findBySource(ExecutionKind.COMMAND, execution.id))
      .toEqual(expected);
    await reopened.close();
  });

  it('F: a pre-execution gate rejection calls no process and persists neither aggregate', async () => {
    const h = await compose({ exitCode: 0, stdout: '', stderr: '', timedOut: false });
    await expect(h.composed.run(input({ command: 'git', args: ['push'] }))).rejects.toThrow(/allow-listed/);
    expect(h.run).not.toHaveBeenCalled();
    expect(await h.storage.commandExecutions.findByExecutionPlan('plan-1')).toEqual([]);
    expect(await h.storage.executionReceipts.findByExecutionPlan('plan-1')).toEqual([]);
    await h.storage.close();
  });

  it('G: canonical-source rules reject nonexistent, PENDING, and RUNNING sources', async () => {
    const h = await compose({ exitCode: 0, stdout: '', stderr: '', timedOut: false });
    await expect(h.receipts.recordCommandExecution('missing')).rejects.toThrow(/does not exist/);
    for (const status of [CommandExecutionStatus.PENDING, CommandExecutionStatus.RUNNING]) {
      const terminal = await h.commands.run(input());
      await h.storage.commandExecutions.save({ ...terminal, status });
      await expect(h.receipts.recordCommandExecution(terminal.id)).rejects.toThrow(/not terminal/);
    }
    await h.storage.close();
  });

  it('H (internal fault injection): receipt failure does not rerun and preserves canonical CommandExecution for reconciliation', async () => {
    const h = await compose({ exitCode: 0, stdout: '', stderr: '', timedOut: false });
    const failingReceipts: ExecutionReceiptRepository = {
      ...h.storage.executionReceipts,
      insert: async () => { throw new Error('simulated receipt storage failure'); },
      get: (id) => h.storage.executionReceipts.get(id),
      findBySource: (kind, sourceId) => h.storage.executionReceipts.findBySource(kind, sourceId),
      findByExecutionPlan: (planId) => h.storage.executionReceipts.findByExecutionPlan(planId),
    };
    const receiptStorage = {
      commandExecutions: h.storage.commandExecutions,
      executionReceipts: failingReceipts,
    } as unknown as StorageProvider;
    const composed = new CommandExecutionReceiptRunner(
      h.commands,
      new ExecutionReceiptManager(receiptStorage),
    );

    const error = await composed.run(input()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ExecutionReceiptRecordingError);
    const commandId = (error as ExecutionReceiptRecordingError).commandExecutionId;
    expect(h.run).toHaveBeenCalledTimes(1);
    await expect(h.storage.commandExecutions.get(commandId)).resolves.toMatchObject({
      id: commandId,
      status: CommandExecutionStatus.SUCCEEDED,
    });
    expect(await h.storage.executionReceipts.findBySource(ExecutionKind.COMMAND, commandId)).toBeNull();
    await h.storage.close();
  });
});
