import { spawnSync } from 'node:child_process';
import type { CommandRunOptions, CommandRunResult, CommandRunner } from '@chunsik/core';

/** Per-stream cap on captured output (chars). Larger output is truncated. */
const MAX_OUTPUT_CHARS = 100_000;

/**
 * Secret-shaped substrings redacted from captured output before it is surfaced/stored.
 * Quantifiers are bounded (not open-ended `{n,}`) so masking stays linear and cannot
 * catastrophically backtrack on large/adversarial command output (ReDoS-safe).
 */
const SECRET_PATTERNS: RegExp[] = [
  // Discord-bot-token shape: <id>.<part>.<part>
  /[A-Za-z0-9_-]{20,256}\.[A-Za-z0-9_-]{5,256}\.[A-Za-z0-9_-]{20,256}/g,
  // Common API-key / OAuth shapes
  /\b(?:sk|pk|ghp|gho|ghs|xox[baprs])-[A-Za-z0-9_-]{8,256}\b/g,
  /Bearer\s+[A-Za-z0-9._-]{1,512}/gi,
  // Embedded URL credentials
  /(https?:\/\/)[^@\s/]{1,512}@/g,
];

/**
 * Cap length FIRST (bounds the work regardless of how large the stream was), then
 * redact secret-shaped substrings. Applied to all captured output by the runner.
 */
export function maskCommandOutput(text: string): string {
  const capped =
    text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n…[truncated]` : text;
  return SECRET_PATTERNS.reduce((acc, re) => acc.replace(re, '***redacted***'), capped);
}

/** Raw spawn result, before masking/capping. */
export interface RawRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Low-level injectable executor. The default uses `node:child_process`; tests inject
 * a fake to assert the exact argv (no shell) and simulate timeouts without spawning.
 */
export type RawCommandRunner = (
  command: string,
  args: string[],
  options: CommandRunOptions,
) => RawRunResult;

/** Default runner: argument-array `spawnSync`, NEVER a shell, cwd + required timeout. */
export const defaultRawRunner: RawCommandRunner = (command, args, { cwd, timeoutMs, env }) => {
  const res = spawnSync(command, args, {
    cwd,
    timeout: timeoutMs,
    encoding: 'utf8',
    shell: false, // explicit: command + args are passed as an argv vector, never a shell string
    ...(env ? { env } : {}), // omitted → inherits process.env (PATH); provided → exact env
  });
  const timedOut = !!(res.error && (res.error as NodeJS.ErrnoException).code === 'ETIMEDOUT');
  // A spawn-level error (e.g. binary not found) is surfaced in stderr; not a timeout.
  const spawnErr = res.error && !timedOut ? String(res.error.message ?? res.error) : '';
  return {
    status: res.status,
    stdout: res.stdout ?? '',
    stderr: `${res.stderr ?? ''}${spawnErr}`,
    timedOut,
  };
};

/**
 * Runs ONE command with an ARGUMENT ARRAY (never a shell string, never `shell: true`),
 * a required timeout (a hung process is killed → `timedOut`), cwd = workspace root, and
 * **masked + size-capped** output (CAP-007, ADR-0028). The core stays
 * `child_process`-free; ALL process execution lives here. Approval / risk / allow-list
 * gating happens in `CommandExecutionManager` BEFORE this runner is invoked — the runner
 * enforces no policy beyond "no shell".
 */
export class LocalCommandRunner implements CommandRunner {
  readonly kind = 'local-command';

  constructor(private readonly raw: RawCommandRunner = defaultRawRunner) {}

  async run(command: string, args: string[], options: CommandRunOptions): Promise<CommandRunResult> {
    const res = this.raw(command, args, options);
    return {
      exitCode: res.status,
      stdout: maskCommandOutput(res.stdout),
      stderr: maskCommandOutput(res.stderr),
      timedOut: res.timedOut,
    };
  }
}
