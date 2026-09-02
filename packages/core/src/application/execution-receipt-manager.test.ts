import { describe, expect, it, vi } from 'vitest';
import {
  ApprovalStatus,
  CommandExecutionStatus,
  ExecutionKind,
  ExecutionReceiptFailureClass,
  ExecutionReceiptOutcome,
  RiskLevel,
} from '../domain';
import type { CommandExecution, ExecutionReceipt } from '../domain';
import type { ExecutionReceiptRepository, StorageProvider } from '../ports';
import {
  CommandExecutionReceiptRunner,
  ExecutionReceiptManager,
  ExecutionReceiptRecordingError,
} from './execution-receipt-manager';

const TS = '2026-09-02T00:00:00.000Z';

function command(
  status: CommandExecutionStatus,
  overrides: Partial<CommandExecution> = {},
): CommandExecution {
  return {
    id: 'command-1',
    executionPlanRef: { id: 'plan-1', goal: 'test' },
    workspaceRef: { id: 'workspace-1', rootPath: '/tmp/workspace', kind: 'local-clone' },
    command: 'pnpm',
    args: ['test'],
    commandHash: 'raw-command-identity',
    status,
    stdout: 'sensitive stdout',
    stderr: 'sensitive stderr',
    durationMs: 42,
    riskLevel: RiskLevel.MEDIUM,
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

function harness(source?: CommandExecution) {
  const commands = new Map<string, CommandExecution>();
  if (source) commands.set(source.id, source);
  const receipts = new Map<string, ExecutionReceipt>();
  let failInsert = false;
  const repository: ExecutionReceiptRepository = {
    async insert(receipt) {
      if (failInsert) throw new Error('adapter detail must not escape');
      if ([...receipts.values()].some(
        (row) => row.executionKind === receipt.executionKind && row.sourceId === receipt.sourceId,
      )) throw new Error('unique');
      receipts.set(receipt.id, receipt);
      return receipt;
    },
    async get(id) {
      return receipts.get(id) ?? null;
    },
    async findBySource(kind, sourceId) {
      return [...receipts.values()].find(
        (row) => row.executionKind === kind && row.sourceId === sourceId,
      ) ?? null;
    },
    async findByExecutionPlan(planId) {
      return [...receipts.values()].filter((row) => row.executionPlanId === planId);
    },
  };
  const storage = {
    commandExecutions: { get: async (id: string) => commands.get(id) ?? null },
    executionReceipts: repository,
  } as unknown as StorageProvider;
  return {
    commands,
    receipts,
    storage,
    failInserts() { failInsert = true; },
  };
}

describe('ExecutionReceiptManager (CAP-013)', () => {
  it.each([
    [CommandExecutionStatus.SUCCEEDED, ExecutionReceiptOutcome.SUCCEEDED, undefined],
    [
      CommandExecutionStatus.FAILED,
      ExecutionReceiptOutcome.FAILED,
      ExecutionReceiptFailureClass.EXECUTION_FAILED,
    ],
    [
      CommandExecutionStatus.TIMED_OUT,
      ExecutionReceiptOutcome.FAILED,
      ExecutionReceiptFailureClass.TIMED_OUT,
    ],
  ])('derives bounded terminal provenance for %s', async (status, outcome, failureClass) => {
    const source = command(status);
    const h = harness(source);
    const receipt = await new ExecutionReceiptManager(h.storage).recordCommandExecution(source.id);

    expect(receipt.id).not.toBe(source.id);
    expect(receipt).toMatchObject({
      executionKind: ExecutionKind.COMMAND,
      sourceId: source.id,
      executionPlanId: source.executionPlanRef.id,
      authorization: { kind: 'NOT_REQUIRED' },
      outcome,
    });
    expect(receipt.failureClass).toBe(failureClass);
    expect(receipt).not.toHaveProperty('command');
    expect(receipt).not.toHaveProperty('args');
    expect(receipt).not.toHaveProperty('commandHash');
    expect(receipt).not.toHaveProperty('stdout');
    expect(receipt).not.toHaveProperty('stderr');
    expect(receipt).not.toHaveProperty('exitCode');
    expect(receipt).not.toHaveProperty('durationMs');
  });

  it('records only approval id provenance', async () => {
    const source = command(CommandExecutionStatus.SUCCEEDED, {
      approvalRef: {
        id: 'approval-1',
        status: ApprovalStatus.APPROVED,
        executionPlanRef: { id: 'plan-1', goal: 'test' },
      },
    });
    const receipt = await new ExecutionReceiptManager(harness(source).storage)
      .recordCommandExecution(source.id);
    expect(receipt.authorization).toEqual({ kind: 'APPROVAL', approvalId: 'approval-1' });
  });

  it('returns the same immutable receipt for duplicate recording', async () => {
    const source = command(CommandExecutionStatus.SUCCEEDED);
    const h = harness(source);
    const manager = new ExecutionReceiptManager(h.storage);
    const first = await manager.recordCommandExecution(source.id);
    const second = await manager.recordCommandExecution(source.id);
    expect(second).toEqual(first);
    expect(h.receipts.size).toBe(1);
  });

  it('rejects nonexistent and non-terminal canonical sources', async () => {
    await expect(new ExecutionReceiptManager(harness().storage).recordCommandExecution('missing'))
      .rejects.toThrow(/does not exist/);
    for (const status of [CommandExecutionStatus.PENDING, CommandExecutionStatus.RUNNING]) {
      const source = command(status);
      await expect(new ExecutionReceiptManager(harness(source).storage)
        .recordCommandExecution(source.id)).rejects.toThrow(/not terminal/);
    }
  });

  it('reloads a canonical receipt after an insert uniqueness race', async () => {
    const source = command(CommandExecutionStatus.SUCCEEDED);
    const h = harness(source);
    const raced: ExecutionReceipt = {
      id: 'receipt-winner',
      executionKind: ExecutionKind.COMMAND,
      sourceId: source.id,
      executionPlanId: 'plan-1',
      authorization: { kind: 'NOT_REQUIRED' },
      outcome: ExecutionReceiptOutcome.SUCCEEDED,
      recordedAt: TS,
    };
    let lookupCount = 0;
    h.storage.executionReceipts.findBySource = vi.fn(async () => {
      lookupCount++;
      return lookupCount === 1 ? null : raced;
    });
    h.storage.executionReceipts.insert = vi.fn(async () => { throw new Error('unique'); });
    await expect(new ExecutionReceiptManager(h.storage).recordCommandExecution(source.id))
      .resolves.toBe(raced);
  });

  it('preserves the canonical command id when receipt persistence fails', async () => {
    const source = command(CommandExecutionStatus.SUCCEEDED);
    const h = harness(source);
    h.failInserts();
    const manager = new ExecutionReceiptManager(h.storage);
    const run = vi.fn(async () => source);
    const composed = new CommandExecutionReceiptRunner({ run }, manager);

    const error = await composed.run({
      executionPlanRef: source.executionPlanRef,
      workspaceRef: source.workspaceRef,
      command: source.command,
      args: source.args,
    }).catch((caught: unknown) => caught);

    expect(run).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(ExecutionReceiptRecordingError);
    expect((error as ExecutionReceiptRecordingError).commandExecutionId).toBe(source.id);
    expect((error as ExecutionReceiptRecordingError).cause).toEqual(
      new Error('adapter detail must not escape'),
    );
    expect(h.commands.get(source.id)).toBe(source);
  });
});
