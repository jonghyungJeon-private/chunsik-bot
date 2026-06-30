/**
 * PORT: runs ONE command inside a workspace (CAP-007, ADR-0028). The riskiest
 * surface in the system, so the contract is deliberately narrow:
 *
 * - **argv array only** — `command` and `args` are separate; the implementation
 *   never builds a shell string and never uses `shell: true` (no injection).
 * - **timeout is required** — a hung process is killed and reported `timedOut`.
 * - **cwd is the workspace root** — supplied by the caller (Command Execution).
 * - **output is masked + size-capped by the adapter** — the core (and the persisted
 *   CommandExecution) never sees raw secret-shaped output.
 *
 * The implementation lives adapter-side (`node:child_process`); the core stays
 * `child_process`-free. Approval/risk/allow-list gating happens in the manager,
 * BEFORE the runner is ever called.
 */
export interface CommandRunOptions {
  /** Absolute working directory (the workspace root). */
  cwd: string;
  /** Required timeout in ms; on expiry the process is killed and `timedOut` is true. */
  timeoutMs: number;
  /**
   * Environment for the child. When omitted the adapter passes a MINIMAL env (PATH/HOME) —
   * a child must NEVER inherit the full parent `process.env` by default (CAP-007 review,
   * MB-1). Provide an explicit allow-listed env to override.
   */
  env?: Record<string, string>;
}

/** Outcome of one command run. stdout/stderr are already masked + capped by the adapter. */
export interface CommandRunResult {
  /** Process exit code, or null when the process timed out / failed to spawn. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** True when the run exceeded `timeoutMs` and was killed. */
  timedOut: boolean;
}

export interface CommandRunner {
  readonly kind: string;
  run(command: string, args: string[], options: CommandRunOptions): Promise<CommandRunResult>;
}
