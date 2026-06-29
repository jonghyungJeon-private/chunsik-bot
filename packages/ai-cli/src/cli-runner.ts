import { spawn } from 'node:child_process';

export interface CliRunOptions {
  /** Working directory for the process (use a neutral dir to avoid CLAUDE.md pickup). */
  cwd: string;
  /** Text written to the child's stdin (the prompt — never passed as an argv). */
  input: string;
  timeoutMs: number;
}

export interface CliRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Injectable CLI executor. The default uses node:child_process; tests inject a
 * fake to assert command construction without spawning anything.
 */
export type CliRunner = (bin: string, args: string[], options: CliRunOptions) => Promise<CliRunResult>;

export const defaultCliRunner: CliRunner = (bin, args, options) =>
  new Promise<CliRunResult>((resolve) => {
    const child = spawn(bin, args, { cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeoutMs);

    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${String(err)}`, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });

    if (options.input) child.stdin?.write(options.input);
    child.stdin?.end();
  });

const SECRET_PATTERNS: RegExp[] = [
  // Discord-bot-token shape: <id>.<part>.<part>
  /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,}/g,
  // Common API-key / OAuth shapes
  /\b(?:sk|pk|ghp|gho|ghs|xox[baprs])-[A-Za-z0-9_-]{8,}\b/g,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
];

/** Redact obvious secret-shaped substrings before logging/storing CLI output. */
export function maskSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((acc, re) => acc.replace(re, '***redacted***'), text);
}
