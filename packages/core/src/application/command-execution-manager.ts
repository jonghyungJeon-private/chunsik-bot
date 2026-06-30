import { newId } from '../util/id';
import { now } from '../util/clock';
import { contentHash } from '../util/hash';
import { ApprovalStatus, CommandExecutionStatus, RiskLevel } from '../domain';
import type { CommandExecution, Id, RunCommandInput } from '../domain';
import type { CommandRunResult, CommandRunner, StorageProvider } from '../ports';
import type { RiskPolicy } from './risk-policy';

/** Default per-command timeout (ms) when the caller supplies none. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;

/**
 * Conservative v2 command allow-list (CAP-007 review, MB-3). Only these binaries
 * may run; anything else is refused BEFORE the runner is invoked. Matched exactly
 * (no path, no shell), so it fails closed (e.g. `/usr/bin/node` is rejected).
 */
export const DEFAULT_ALLOWED_COMMANDS: ReadonlySet<string> = new Set(['pnpm', 'npm', 'node']);

/**
 * Eval-style `node` flags that turn an allow-listed `node` into an arbitrary-code runner,
 * bypassing a command-NAME-only allow-list (CAP-007 review, MB-2). Matches `-e`/`--eval`/
 * `-p`/`--print`, their `=value` long forms, and single-dash short clusters containing
 * `e`/`p` (e.g. `-pe`, `--eval=1+1`). The allow-list must be command + dangerous-arg aware.
 */
function isNodeEvalArg(arg: string): boolean {
  if (/^--(eval|print)(=|$)/.test(arg)) return true; // long forms (+ `=value`)
  return /^-[^-]*[ep]/.test(arg); // short cluster (not a `--` long flag) containing e/p
}

/** Whether `command`+`args` use a forbidden dangerous argument (currently `node` eval flags). */
function hasDangerousArgs(command: string, args: string[]): boolean {
  if (command === 'node') return args.some(isNodeEvalArg);
  return false;
}

/** Map a finished run to the terminal CommandExecution status. */
function deriveStatus(result: CommandRunResult): CommandExecutionStatus {
  if (result.timedOut) return CommandExecutionStatus.TIMED_OUT;
  return result.exitCode === 0 ? CommandExecutionStatus.SUCCEEDED : CommandExecutionStatus.FAILED;
}

/**
 * CAP-007 Command Execution (ADR-0028). Owns the `CommandExecution` aggregate — the
 * Execution History of running one command — and is the ONLY capability that mutates
 * it. The riskiest capability, so every run passes four deterministic gates BEFORE
 * the `CommandRunner` adapter is ever called:
 *
 *  1. **Allow-list** (MB-3): the command must be one of `allowedCommands`.
 *  2. **Dangerous-arg** (review MB-2): the allow-list is command + arg aware — an
 *     allow-listed binary may not use eval-style flags (e.g. `node -e`/`--eval`/`-p`).
 *  3. **Risk** (MB-2): `RiskPolicy.assessCommand`; a CRITICAL/destructive command is
 *     refused outright — regardless of approval.
 *  4. **Approval (Ref only)** (MB-2): HIGH commands require an APPROVED, plan-scoped
 *     ApprovalRef (referential integrity, ADR-0025/0026); MEDIUM run without approval.
 *
 * It references the plan/approval/workspace/change via Refs and never mutates them;
 * it never edits files, generates patches, calls git, or calls AI. Process execution
 * is delegated to the adapter (argv array, no shell, minimal env) — the core stays
 * `child_process`-free. The aggregate persists a `commandHash` identifying what ran (MB-1).
 */
export class CommandExecutionManager {
  constructor(
    private readonly storage: StorageProvider,
    private readonly runner: CommandRunner,
    private readonly risk: RiskPolicy,
    private readonly allowedCommands: ReadonlySet<string> = DEFAULT_ALLOWED_COMMANDS,
  ) {}

  /**
   * Gate, run, and record a command as a `CommandExecution`. A run that fails the
   * gates throws (nothing is persisted); a run that executes is always recorded,
   * whatever its exit code (SUCCEEDED / FAILED / TIMED_OUT).
   */
  async run(input: RunCommandInput): Promise<CommandExecution> {
    const { command, args, executionPlanRef, approvalRef, workspaceRef } = input;

    // (1) Allow-list gate (MB-3) — fail closed on anything not explicitly permitted.
    if (!this.allowedCommands.has(command)) {
      throw new Error(
        `command '${command}' is not allow-listed (allowed: ${[...this.allowedCommands].join(', ')})`,
      );
    }

    // (2) Dangerous-arg gate (CAP-007 review, MB-2) — the allow-list is command + arg aware,
    //     so an allow-listed binary cannot bypass it via eval-style flags (e.g. `node -e`).
    if (hasDangerousArgs(command, args)) {
      throw new Error(`command '${command}' may not use eval-style arguments: ${args.join(' ')}`);
    }

    // (3) Risk gate (MB-2). CRITICAL = a destructive pattern matched → always refuse.
    const riskLevel = this.risk.assessCommand([command, ...args].join(' '));
    if (riskLevel === RiskLevel.CRITICAL) {
      throw new Error(`refusing to run a CRITICAL/destructive command: ${command}`);
    }

    // (4) Approval gate (MB-2) — Ref only (no ApprovalManager query). HIGH requires an
    //     APPROVED, plan-scoped approval; MEDIUM (and LOW) run without one.
    if (this.risk.requiresApproval(riskLevel)) {
      if (!approvalRef || approvalRef.status !== ApprovalStatus.APPROVED) {
        throw new Error(
          `command execution requires an APPROVED approval for ${riskLevel} risk ` +
            `(got ${approvalRef ? approvalRef.status : 'none'})`,
        );
      }
      if (approvalRef.executionPlanRef.id !== executionPlanRef.id) {
        throw new Error(
          `approval ${approvalRef.id} is scoped to a different ExecutionPlan ` +
            `(${approvalRef.executionPlanRef.id}, expected ${executionPlanRef.id})`,
        );
      }
    }

    // Command identity (MB-1): deterministic hash of exactly what ran.
    const commandHash = contentHash(JSON.stringify([command, ...args]));

    // Record the run as PENDING → RUNNING before executing (Execution History).
    const ts = now();
    const base: CommandExecution = {
      id: newId(),
      executionPlanRef,
      ...(approvalRef ? { approvalRef } : {}),
      workspaceRef,
      ...(input.workspaceChangeRef ? { workspaceChangeRef: input.workspaceChangeRef } : {}),
      command,
      args,
      commandHash,
      status: CommandExecutionStatus.PENDING,
      stdout: '',
      stderr: '',
      durationMs: 0,
      riskLevel,
      createdAt: ts,
      updatedAt: ts,
    };
    await this.storage.commandExecutions.save({
      ...base,
      status: CommandExecutionStatus.RUNNING,
      updatedAt: ts,
    });

    // Execute via the adapter (argv array, no shell, timeout, cwd = workspace root).
    const timeoutMs = input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    const startedAt = now();
    let result: CommandRunResult;
    try {
      result = await this.runner.run(command, args, { cwd: workspaceRef.rootPath, timeoutMs });
    } catch (err) {
      // A runner that throws (rather than encoding failure) still yields a recorded FAILED run.
      result = { exitCode: null, stdout: '', stderr: err instanceof Error ? err.message : String(err), timedOut: false };
    }

    const finishedAt = now();
    const execution: CommandExecution = {
      ...base,
      status: deriveStatus(result),
      ...(result.exitCode !== null ? { exitCode: result.exitCode } : {}),
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
      updatedAt: finishedAt,
    };
    return this.storage.commandExecutions.save(execution);
  }

  async get(id: Id): Promise<CommandExecution | null> {
    return this.storage.commandExecutions.get(id);
  }

  /** Execution history for a given ExecutionPlan. */
  async findByExecutionPlan(executionPlanId: Id): Promise<CommandExecution[]> {
    return this.storage.commandExecutions.findByExecutionPlan(executionPlanId);
  }

  /** Execution history for a given WorkspaceChange. */
  async findByWorkspaceChange(workspaceChangeId: Id): Promise<CommandExecution[]> {
    return this.storage.commandExecutions.findByWorkspaceChange(workspaceChangeId);
  }
}
