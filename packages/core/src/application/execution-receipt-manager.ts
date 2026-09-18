import {
  CommandExecutionStatus,
  ExecutionKind,
  ExecutionReceiptFailureClass,
  ExecutionReceiptOutcome,
} from '../domain';
import type { ExecutionReceipt, Id, RunCommandInput, CommandExecution } from '../domain';
import type { StorageProvider } from '../ports';
import { now } from '../util/clock';
import { newId } from '../util/id';

/**
 * A terminal CommandExecution exists even when its receipt could not be stored.
 * The canonical id is retained so reconciliation can record it without rerun.
 */
export class ExecutionReceiptRecordingError extends Error {
  constructor(readonly commandExecutionId: Id, cause: unknown) {
    super(`execution receipt recording failed for CommandExecution ${commandExecutionId}`, { cause });
    this.name = 'ExecutionReceiptRecordingError';
  }
}

/** CAP-013 immutable receipt derivation from canonical persisted producers. */
export class ExecutionReceiptManager {
  constructor(private readonly storage: StorageProvider) {}

  async recordCommandExecution(commandExecutionId: Id): Promise<ExecutionReceipt> {
    const execution = await this.storage.commandExecutions.get(commandExecutionId);
    if (!execution) {
      throw new Error(`CommandExecution ${commandExecutionId} does not exist`);
    }

    const terminal = this.deriveTerminal(execution);
    const existing = await this.storage.executionReceipts.findBySource(
      ExecutionKind.COMMAND,
      execution.id,
    );
    if (existing) return existing;

    const receipt: ExecutionReceipt = {
      id: newId(),
      executionKind: ExecutionKind.COMMAND,
      sourceId: execution.id,
      executionPlanId: execution.executionPlanRef.id,
      authorization: execution.approvalRef
        ? { kind: 'APPROVAL', approvalId: execution.approvalRef.id }
        : { kind: 'NOT_REQUIRED' },
      ...terminal,
      recordedAt: now(),
    };

    try {
      return await this.storage.executionReceipts.insert(receipt);
    } catch (cause) {
      // A concurrent recorder may have won the unique (executionKind, sourceId)
      // insert. Reload the canonical row; never update or upsert a receipt.
      const raced = await this.storage.executionReceipts.findBySource(
        ExecutionKind.COMMAND,
        execution.id,
      );
      if (raced) return raced;
      throw new ExecutionReceiptRecordingError(execution.id, cause);
    }
  }

  private deriveTerminal(
    execution: CommandExecution,
  ): Pick<ExecutionReceipt, 'outcome' | 'failureClass'> {
    switch (execution.status) {
      case CommandExecutionStatus.SUCCEEDED:
        return { outcome: ExecutionReceiptOutcome.SUCCEEDED };
      case CommandExecutionStatus.FAILED:
        return {
          outcome: ExecutionReceiptOutcome.FAILED,
          failureClass: ExecutionReceiptFailureClass.EXECUTION_FAILED,
        };
      case CommandExecutionStatus.TIMED_OUT:
        return {
          outcome: ExecutionReceiptOutcome.FAILED,
          failureClass: ExecutionReceiptFailureClass.TIMED_OUT,
        };
      case CommandExecutionStatus.PENDING:
      case CommandExecutionStatus.RUNNING:
        throw new Error(
          `CommandExecution ${execution.id} is not terminal (${execution.status})`,
        );
    }
  }
}

/**
 * Stateless composition above CAP-007: execute once, then record provenance,
 * returning the original canonical CommandExecution.
 */
export class CommandExecutionReceiptRunner {
  constructor(
    private readonly command: { run(input: RunCommandInput): Promise<CommandExecution> },
    private readonly receipts: ExecutionReceiptManager,
  ) {}

  async run(input: RunCommandInput): Promise<CommandExecution> {
    const execution = await this.command.run(input);
    await this.receipts.recordCommandExecution(execution.id);
    return execution;
  }
}
