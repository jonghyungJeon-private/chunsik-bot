import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { sanitizeTerminalOutput } from './output-sanitizer';

export interface CliRunOptions {
  /** Working directory for the process (use a neutral dir to avoid CLAUDE.md pickup). */
  cwd: string;
  /** Text written to the child's stdin (the prompt — never passed as an argv). */
  input: string;
  timeoutMs: number;
  /**
   * Provider-owned child environment overrides. Only the names in
   * {@link CALLER_ENV_ALLOWLIST} are accepted; anything else makes the run fail
   * closed WITHOUT spawning, so `options.env` can never be used as a bypass for
   * full parent-environment inheritance.
   */
  env?: Readonly<Record<string, string>>;
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

// ---------------------------------------------------------------------------
// Containment bounds
// ---------------------------------------------------------------------------

/**
 * Per-stream capture bound for stdout. Sized for a real PRODUCT response — a code
 * proposal carries whole-file `newContent`, so the Stage 2A validation harness's
 * 8 KiB preview bound would truncate legitimate output. 256 KiB is generous for a
 * single-file proposal while keeping worst-case accumulation flat and predictable.
 */
export const MAX_STDOUT_CAPTURE_BYTES = 262_144;

/**
 * Per-stream capture bound for stderr — deliberately smaller than stdout because
 * stderr is DIAGNOSTIC ONLY: both providers surface at most 300–1,000 characters of
 * it and never turn it into response text.
 */
export const MAX_STDERR_CAPTURE_BYTES = 65_536;

/** Grace period between SIGTERM and SIGKILL when the runner stops a child. */
export const KILL_GRACE_MS = 1_000;

/** Prefix of the runner-owned per-child temporary directory (always under OS temp). */
export const CHILD_TEMP_PREFIX = 'chunsik-cli-';

/**
 * The ONLY parent-process variables forwarded to a child. The full `process.env`
 * is never inherited, so no API key, token, password, credential, proxy setting,
 * certificate override, Node preload (`NODE_OPTIONS`/`NODE_PATH`/`LD_PRELOAD`/
 * `DYLD_*`), or shell-initialization value can reach a Provider process.
 *
 * `PATH` is required because both CLI adapters are configured with a bare command
 * name. `HOME` is required and deliberately preserved: Claude's existing OAuth /
 * global configuration and Ollama's model inventory both live under it. Isolating
 * HOME is a separate, later Architecture Sprint — not this one.
 */
export const INHERITED_ENV_ALLOWLIST = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE'] as const;

/**
 * The only names a Provider adapter may add through `CliRunOptions.env`. Minimised
 * to what the in-tree adapters actually require today: Ollama's colour controls
 * (Claude passes no environment at all). `TMPDIR` is intentionally absent — it is
 * runner-owned and must not be overridable by a caller.
 */
export const CALLER_ENV_ALLOWLIST = ['NO_COLOR', 'CLICOLOR', 'CLICOLOR_FORCE'] as const;

const CALLER_ENV_ALLOWED = new Set<string>(CALLER_ENV_ALLOWLIST);

/**
 * Bounded, generic diagnostic reasons. None of them embeds captured output, an
 * environment name or value, a prompt, or a filesystem path.
 */
const DISALLOWED_ENV_REASON = 'cli runner refused a provider environment name that is not allow-listed';
const TEMP_CREATE_FAILED_REASON = 'cli runner could not create its temporary directory';
const TEMP_CLEANUP_FAILED_REASON = 'cli runner could not remove its temporary directory';
const STDOUT_OVERFLOW_REASON = 'cli runner stopped the child: stdout exceeded the capture limit';
const STDERR_OVERFLOW_REASON = 'cli runner stopped the child: stderr exceeded the capture limit';
const STDIN_UNAVAILABLE_REASON = 'cli runner could not open the child stdin stream';
const STDIN_DELIVERY_REASON = 'cli runner could not deliver the prompt to the child stdin stream';

/** Upper bound on a spawn-error message copied into the diagnostic stderr. */
const MAX_SPAWN_ERROR_CHARS = 300;

export type ChildEnvironment =
  | { readonly ok: true; readonly env: Record<string, string> }
  | { readonly ok: false; readonly reason: string };

/**
 * Build the child environment explicitly. Nothing is inherited except the
 * allow-listed names above; `TMPDIR` is always the runner-owned directory; a
 * caller may only add {@link CALLER_ENV_ALLOWLIST} names. Any other caller name
 * fails closed (the caller's run is refused before a process is spawned).
 */
export function buildChildEnvironment(
  parent: NodeJS.ProcessEnv,
  temporaryDirectory: string,
  callerEnv?: Readonly<Record<string, string>>,
): ChildEnvironment {
  const env: Record<string, string> = {};
  for (const name of INHERITED_ENV_ALLOWLIST) {
    const value = parent[name];
    if (typeof value === 'string') env[name] = value;
  }
  // Runner-owned, set BEFORE the caller overrides and not caller-allow-listed, so a
  // provider can neither read nor redirect another child's temporary directory.
  env.TMPDIR = temporaryDirectory;
  if (callerEnv) {
    for (const name of Object.keys(callerEnv)) {
      if (!CALLER_ENV_ALLOWED.has(name)) {
        return { ok: false, reason: DISALLOWED_ENV_REASON };
      }
      const value = callerEnv[name];
      if (typeof value === 'string') env[name] = value;
    }
  }
  return { ok: true, env };
}

// ---------------------------------------------------------------------------
// Contained runner
// ---------------------------------------------------------------------------

type SpawnLike = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

/** Test seams. Production always uses the real defaults; no behaviour is branched on them. */
export interface ContainedRunnerHooks {
  spawnFn?: SpawnLike;
  createTempDir?: () => string;
  removeTempDir?: (dir: string) => void;
  killGraceMs?: number;
  parentEnv?: NodeJS.ProcessEnv;
}

function createChildTempDir(): string {
  return mkdtempSync(join(realpathSync(tmpdir()), CHILD_TEMP_PREFIX));
}

function removeChildTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 2 });
}

const boundedSpawnError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeTerminalOutput(message).slice(0, MAX_SPAWN_ERROR_CHARS);
};

type StdinFailure = 'none' | 'unavailable' | 'delivery';

/**
 * Runs ONE command with an ARGUMENT ARRAY (never a shell string, never `shell: true`),
 * a required timeout, cwd = the caller's directory, and **bounded child containment**:
 *
 *  - **No parent-environment inheritance.** The child receives only
 *    {@link INHERITED_ENV_ALLOWLIST} + a runner-owned `TMPDIR` + the caller's
 *    {@link CALLER_ENV_ALLOWLIST} names; any other caller name is refused BEFORE spawn.
 *  - **Runner-owned temporary directory** per child, created under OS temp (never inside
 *    the repository) and removed once the child has settled. A cleanup failure is
 *    reported as a bounded diagnostic, never silently swallowed.
 *  - **Independent per-stream BYTE bounds** (not character counts). Exceeding one stops
 *    accumulating, stops the child (SIGTERM → grace → SIGKILL), and returns a bounded
 *    generic failure — never a success and never the oversized content.
 *  - **UTF-8-safe streaming** via one `StringDecoder` per stream (never shared), flushed
 *    on close, so a multi-byte sequence split across chunks is restored correctly.
 *  - **Single-settle + single-finalize**: the promise resolves once AND timers, listeners,
 *    and the temporary directory are released exactly once.
 *  - **Diagnostic-only sanitation**: a successful `stdout` is passed through byte-for-byte
 *    (the provider adapters own response-text sanitation); terminal control sequences are
 *    stripped only from the diagnostic `stderr`/failure preview.
 *
 * There is **no retry** at this layer — not for a spawn failure, not for a timeout, not
 * for a non-zero exit. Retry is a future Loop control-policy concern.
 */
export function createContainedCliRunner(hooks: ContainedRunnerHooks = {}): CliRunner {
  const spawnFn = hooks.spawnFn ?? (spawn as unknown as SpawnLike);
  const createTempDir = hooks.createTempDir ?? createChildTempDir;
  const removeTempDir = hooks.removeTempDir ?? removeChildTempDir;
  const killGraceMs = hooks.killGraceMs ?? KILL_GRACE_MS;
  const parentEnvOf = (): NodeJS.ProcessEnv => hooks.parentEnv ?? process.env;

  return (bin, args, options) =>
    new Promise<CliRunResult>((resolve) => {
      let temporaryDirectory: string;
      try {
        temporaryDirectory = createTempDir();
      } catch {
        // Nothing was spawned and nothing was created: fail closed immediately.
        resolve({ code: null, stdout: '', stderr: TEMP_CREATE_FAILED_REASON, timedOut: false });
        return;
      }

      const childEnv = buildChildEnvironment(parentEnvOf(), temporaryDirectory, options.env);
      if (!childEnv.ok) {
        let cleanupReason = '';
        try {
          removeTempDir(temporaryDirectory);
        } catch {
          cleanupReason = `\n${TEMP_CLEANUP_FAILED_REASON}`;
        }
        // Refused before any process exists — `code: null` keeps the providers'
        // existing "could not run" mapping (UNAVAILABLE).
        resolve({
          code: null,
          stdout: '',
          stderr: `${childEnv.reason}${cleanupReason}`,
          timedOut: false,
        });
        return;
      }

      const stdoutDecoder = new StringDecoder('utf8');
      const stderrDecoder = new StringDecoder('utf8');
      let stdout = '';
      let stderr = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let stdoutOverflowed = false;
      let stderrOverflowed = false;
      let timedOut = false;
      let spawnFailure: string | null = null;
      let stdinFailure: StdinFailure = 'none';
      let cleanupFailed = false;
      let killRequested = false;
      let settled = false;
      let finalized = false;
      let timeoutTimer: NodeJS.Timeout | undefined;
      let forceKillTimer: NodeJS.Timeout | undefined;
      let child: ChildProcess | undefined;

      const overflowed = (): boolean => stdoutOverflowed || stderrOverflowed;

      /**
       * Releases every child-lifecycle resource EXACTLY once — timers, stream and
       * process listeners, and the runner-owned temporary directory. Deliberately
       * separate from `settled`: resolving the promise once is not the same as
       * releasing resources once.
       */
      const finalize = (): void => {
        if (finalized) return;
        finalized = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        child?.stdout?.removeAllListeners();
        child?.stderr?.removeAllListeners();
        child?.stdin?.removeAllListeners();
        child?.removeAllListeners();
        try {
          removeTempDir(temporaryDirectory);
        } catch {
          cleanupFailed = true;
        }
      };

      const withDiagnostics = (reason: string): string =>
        cleanupFailed ? `${reason}\n${TEMP_CLEANUP_FAILED_REASON}` : reason;

      const finishResult = (code: number | null): CliRunResult => {
        if (spawnFailure !== null) {
          return { code: null, stdout: '', stderr: withDiagnostics(spawnFailure), timedOut };
        }
        if (overflowed()) {
          // Bounded generic failure: the oversized content is dropped, never echoed.
          return {
            code: null,
            stdout: '',
            stderr: withDiagnostics(stdoutOverflowed ? STDOUT_OVERFLOW_REASON : STDERR_OVERFLOW_REASON),
            timedOut: false,
          };
        }
        if (stdinFailure !== 'none') {
          return {
            code: null,
            stdout: '',
            stderr: withDiagnostics(
              stdinFailure === 'unavailable' ? STDIN_UNAVAILABLE_REASON : STDIN_DELIVERY_REASON,
            ),
            timedOut: false,
          };
        }
        // Success/normal-exit path: `stdout` is returned untouched (the provider
        // adapters own response-text semantics); only the diagnostic stream is sanitized.
        const diagnostic = sanitizeTerminalOutput(stderr);
        return {
          code,
          stdout,
          stderr: cleanupFailed
            ? [diagnostic, TEMP_CLEANUP_FAILED_REASON].filter((part) => part.length > 0).join('\n')
            : diagnostic,
          timedOut,
        };
      };

      const settle = (code: number | null): void => {
        if (settled) return;
        settled = true;
        finalize(); // must run first: it decides `cleanupFailed`
        resolve(finishResult(code));
      };

      const terminate = (): void => {
        if (killRequested || !child) return;
        killRequested = true;
        try {
          child.kill('SIGTERM');
        } catch {
          /* already gone */
        }
        forceKillTimer = setTimeout(() => {
          try {
            child?.kill('SIGKILL');
          } catch {
            /* already gone */
          }
        }, killGraceMs);
        // A child that exits inside the grace period clears this timer via finalize(),
        // so SIGKILL is never sent.
        forceKillTimer.unref?.();
      };

      try {
        child = spawnFn(bin, args, {
          cwd: options.cwd, // caller's cwd contract is preserved verbatim
          env: { ...childEnv.env },
          shell: false, // explicit: argv vector, never a shell string
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (error) {
        spawnFailure = boundedSpawnError(error);
        settle(null);
        return;
      }

      const append = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
        if (settled) return;
        const isStdout = stream === 'stdout';
        const limit = isStdout ? MAX_STDOUT_CAPTURE_BYTES : MAX_STDERR_CAPTURE_BYTES;
        const total = (isStdout ? stdoutBytes : stderrBytes) + chunk.byteLength;
        if (isStdout) stdoutBytes = total;
        else stderrBytes = total;
        // Decode even when discarding, so the per-stream decoder state stays consistent.
        const text = (isStdout ? stdoutDecoder : stderrDecoder).write(chunk);
        if (total > limit) {
          if (isStdout) {
            stdoutOverflowed = true;
            stdout = '';
          } else {
            stderrOverflowed = true;
            stderr = '';
          }
          terminate();
          return;
        }
        if (overflowed()) return;
        if (isStdout) stdout += text;
        else stderr += text;
      };

      child.stdout?.on('data', (chunk: Buffer) => append('stdout', chunk));
      child.stderr?.on('data', (chunk: Buffer) => append('stderr', chunk));

      child.on('error', (error: unknown) => {
        if (spawnFailure === null) spawnFailure = boundedSpawnError(error);
        settle(null);
      });

      /**
       * Flush both decoders at stream end. The trailing bytes were already counted
       * when their chunk arrived, so the tails are appended WITHOUT re-counting.
       */
      const flushDecoders = (): void => {
        const stdoutTail = stdoutDecoder.end();
        const stderrTail = stderrDecoder.end();
        if (overflowed()) return;
        if (stdoutTail.length > 0) stdout += stdoutTail;
        if (stderrTail.length > 0) stderr += stderrTail;
      };

      child.on('close', (code: number | null) => {
        // Deferred one macrotask so a pending stdin EPIPE (a child that exited before
        // consuming the prompt) is recorded BEFORE the result is shaped — otherwise an
        // undelivered prompt could be reported as a successful response.
        setImmediate(() => {
          if (settled) return;
          flushDecoders();
          settle(code);
        });
      });

      timeoutTimer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, options.timeoutMs);
      timeoutTimer.unref?.();

      const stdin = child.stdin;
      if (!stdin) {
        stdinFailure = 'unavailable';
        terminate();
        return;
      }
      /** An EPIPE while delivering nothing (an availability probe) is harmless. */
      const recordStdinFailure = (): void => {
        if (stdinFailure !== 'none' || options.input.length === 0) return;
        stdinFailure = 'delivery';
        terminate();
      };
      stdin.on('error', recordStdinFailure);
      if (options.input.length > 0) {
        stdin.write(options.input, (error) => {
          if (error) recordStdinFailure();
        });
      }
      try {
        stdin.end();
      } catch {
        recordStdinFailure();
      }
    });
}

/** Default runner: the contained runner with production spawn/temp behaviour. */
export const defaultCliRunner: CliRunner = createContainedCliRunner();

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
