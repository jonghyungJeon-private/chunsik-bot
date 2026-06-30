import type { Id, IsoTimestamp } from './common';
import type { CommandExecutionStatus, RiskLevel } from './enums';
import type { ExecutionPlanRef } from './execution-plan';
import type { ApprovalRef } from './approval';
import type { WorkspaceRef } from './workspace';
import type { WorkspaceChangeRef } from './workspace-change';

/**
 * Command Execution's aggregate — the **Execution History** of running ONE command
 * inside a workspace (CAP-007, ADR-0028). Owned & mutated ONLY by Command Execution;
 * it references the plan/approval/workspace/change via Refs and never mutates them
 * (Aggregate Ownership Rule, ADR-0025). The last aggregate of the Execution Ledger:
 * ExecutionPlan → ApprovalRequest → PatchSet → WorkspaceChange → CommandExecution.
 */
export interface CommandExecution {
  id: Id;
  executionPlanRef: ExecutionPlanRef;
  /**
   * The authorizing approval, present only when the command's risk required it
   * (HIGH/CRITICAL). LOW/MEDIUM commands run without an approval (CAP-007 review).
   * When present it is plan-scoped and was validated against `executionPlanRef`.
   */
  approvalRef?: ApprovalRef;
  workspaceRef: WorkspaceRef;
  /** The applied change this run follows, when tied to one (run after a patch apply). */
  workspaceChangeRef?: WorkspaceChangeRef;
  /** The executed binary (argv[0]); never a shell string. */
  command: string;
  /** The argument vector (never concatenated into a shell command). */
  args: string[];
  /**
   * Deterministic identity of WHAT ran — a content hash of `command` + `args`
   * (pure `contentHash`, no `node:crypto`). Persisted so the Execution History can
   * identify the command for audit / duplicate detection / resume, and so a future
   * Execution Orchestrator can implement retry (CAP-007 review, MB-1).
   */
  commandHash: string;
  status: CommandExecutionStatus;
  /** Process exit code; absent when the command timed out or failed to spawn. */
  exitCode?: number;
  /** Captured stdout — masked (secret patterns) and size-capped by the runner adapter. */
  stdout: string;
  /** Captured stderr — masked (secret patterns) and size-capped by the runner adapter. */
  stderr: string;
  /** Wall-clock duration of the run, in ms. */
  durationMs: number;
  /** Risk assessed for this command by the deterministic RiskPolicy. */
  riskLevel: RiskLevel;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/** Lightweight handle (V2 Ref model). */
export interface CommandExecutionRef {
  id: Id;
  status: CommandExecutionStatus;
}

/** Pure derivation of a CommandExecutionRef from the aggregate. */
export function commandExecutionRef(execution: CommandExecution): CommandExecutionRef {
  return { id: execution.id, status: execution.status };
}

/**
 * Input to running a command (CAP-007). The caller composes these (supply the
 * plan-scoped ApprovalRef when the command needs one, the resolved WorkspaceRef,
 * and optionally the WorkspaceChangeRef this run follows); Command Execution
 * imports no other capability manager.
 */
export interface RunCommandInput {
  executionPlanRef: ExecutionPlanRef;
  /** Required only for HIGH/CRITICAL commands; omitted for LOW/MEDIUM. */
  approvalRef?: ApprovalRef;
  workspaceRef: WorkspaceRef;
  workspaceChangeRef?: WorkspaceChangeRef;
  command: string;
  args: string[];
  /** Per-run timeout override; defaults to the manager's DEFAULT_COMMAND_TIMEOUT_MS. */
  timeoutMs?: number;
}
