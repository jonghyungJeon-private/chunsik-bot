import { createHash } from 'node:crypto';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import {
  FINAL_SETTLEMENT_EPSILON_MS,
  KILL_GRACE_MS,
  OllamaPreflightCommandCategory,
  STDERR_LIMIT,
} from './contracts';
import type { ApprovedOllamaExecutable, OllamaPreflightNetworkClass } from './contracts';
import {
  assertAllowedOllamaPreflightCommand,
  assertIsolatedOllamaEnvironment,
  buildIsolatedOllamaEnvironment,
} from './policy';
import { observesModelDownload } from './parsers';

export interface OllamaPreflightProcessRequest {
  readonly executable: ApprovedOllamaExecutable;
  readonly category: OllamaPreflightCommandCategory;
  readonly argv: readonly string[];
  readonly approvedLoopbackEndpoint: string;
  readonly timeoutMs: number;
  readonly stdoutLimitBytes: number;
  readonly stderrLimitBytes: typeof STDERR_LIMIT;
}

export interface OllamaPreflightProcessResult {
  readonly exitCode: number | null;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly outputLimited: boolean;
  readonly spawnFailed: boolean;
  readonly cleanupFailed: boolean;
  readonly containmentFailed: boolean;
  readonly killEscalated: boolean;
  readonly downloadObserved: boolean;
  readonly networkClass: OllamaPreflightNetworkClass | null;
}

export interface OllamaPreflightProcessRunner {
  run(request: OllamaPreflightProcessRequest): Promise<OllamaPreflightProcessResult>;
}

type SpawnLike = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
type TimerHandle = ReturnType<typeof setTimeout>;

export interface PreflightRunnerTimers {
  setTimeout(handler: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export interface PreflightSandbox {
  readonly home: string;
  readonly tmpdir: string;
  cleanup(): void;
}

type EnvironmentBuilder = typeof buildIsolatedOllamaEnvironment;

const systemTimers: PreflightRunnerTimers = {
  setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
};

export class ContainedOllamaPreflightProcessRunner implements OllamaPreflightProcessRunner {
  constructor(
    private readonly spawnFn: SpawnLike,
    private readonly sandboxFactory: () => PreflightSandbox,
    private readonly now: () => number = Date.now,
    private readonly timers: PreflightRunnerTimers = systemTimers,
    private readonly environmentBuilder: EnvironmentBuilder = buildIsolatedOllamaEnvironment,
  ) {}

  run(request: OllamaPreflightProcessRequest): Promise<OllamaPreflightProcessResult> {
    assertAllowedOllamaPreflightCommand(request.category, request.argv);
    return new Promise((resolve) => {
      const started = this.now();
      let sandbox: PreflightSandbox;
      try {
        sandbox = this.sandboxFactory();
      } catch {
        resolve(this.emptyResult(started, {
          spawnFailed: true, cleanupFailed: true, containmentFailed: true,
        }));
        return;
      }

      let environment: Readonly<Record<string, string>>;
      try {
        environment = this.environmentBuilder({
          home: sandbox.home,
          tmpdir: sandbox.tmpdir,
          loopbackEndpoint: request.approvedLoopbackEndpoint,
        });
        assertIsolatedOllamaEnvironment(environment, {
          home: sandbox.home,
          tmpdir: sandbox.tmpdir,
          loopbackEndpoint: request.approvedLoopbackEndpoint,
        });
      } catch {
        let cleanupFailed = false;
        try { sandbox.cleanup(); } catch { cleanupFailed = true; }
        resolve(this.emptyResult(started, { cleanupFailed, containmentFailed: true }));
        return;
      }

      let child: ChildProcess | undefined;
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let timedOut = false;
      let outputLimited = false;
      let spawnFailed = false;
      let containmentFailed = false;
      let killEscalated = false;
      let exitObserved = false;
      let settled = false;
      let terminationStarted = false;
      let timeout: TimerHandle | undefined;
      let forceKill: TimerHandle | undefined;
      let finalSettlement: TimerHandle | undefined;

      const terminate = (): void => {
        if (terminationStarted || settled) return;
        terminationStarted = true;
        try { child?.kill('SIGTERM'); } catch { containmentFailed = true; }
        forceKill = this.timers.setTimeout(() => {
          if (settled) return;
          killEscalated = true;
          try { child?.kill('SIGKILL'); } catch { containmentFailed = true; }
        }, KILL_GRACE_MS);
        forceKill.unref?.();
      };
      const finish = (exitCode: number | null): void => {
        if (settled) return;
        settled = true;
        if (timeout) this.timers.clearTimeout(timeout);
        if (forceKill) this.timers.clearTimeout(forceKill);
        if (finalSettlement) this.timers.clearTimeout(finalSettlement);
        child?.stdout?.removeAllListeners('data');
        child?.stderr?.removeAllListeners('data');
        child?.removeAllListeners('error');
        child?.removeAllListeners('exit');
        child?.removeAllListeners('close');
        let cleanupFailed = false;
        try { sandbox.cleanup(); } catch { cleanupFailed = true; }
        const safeStdout = outputLimited || spawnFailed ? Buffer.alloc(0) : stdout;
        const safeStderr = outputLimited || spawnFailed ? Buffer.alloc(0) : stderr;
        resolve(Object.freeze({
          exitCode: spawnFailed || containmentFailed ? null : exitCode,
          stdout: safeStdout,
          stderr: safeStderr,
          stdoutBytes,
          stderrBytes,
          stdoutSha256: createHash('sha256').update(stdout).digest('hex'),
          stderrSha256: createHash('sha256').update(stderr).digest('hex'),
          durationMs: Math.max(0, this.now() - started),
          timedOut,
          outputLimited,
          spawnFailed,
          cleanupFailed,
          containmentFailed,
          killEscalated,
          downloadObserved: observesModelDownload(stdout, stderr),
          networkClass: 'LOOPBACK_DAEMON' as const,
        }));
      };
      const append = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
        if (settled || outputLimited) return;
        if (stream === 'stdout') {
          stdoutBytes += chunk.byteLength;
          if (stdoutBytes > request.stdoutLimitBytes) outputLimited = true;
          else stdout = Buffer.concat([stdout, chunk]);
        } else {
          stderrBytes += chunk.byteLength;
          if (stderrBytes > request.stderrLimitBytes) outputLimited = true;
          else stderr = Buffer.concat([stderr, chunk]);
        }
        if (outputLimited) terminate();
      };
      try {
        child = this.spawnFn(request.executable.realPath, request.argv, {
          cwd: sandbox.tmpdir,
          env: environment,
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch {
        spawnFailed = true;
        finish(null);
        return;
      }
      child.stdout?.on('data', (chunk: Buffer) => append('stdout', chunk));
      child.stderr?.on('data', (chunk: Buffer) => append('stderr', chunk));
      child.on('error', () => { spawnFailed = true; finish(null); });
      child.on('exit', () => { exitObserved = true; });
      child.on('close', (code: number | null) => finish(code));
      child.stdin?.end();
      timeout = this.timers.setTimeout(() => { timedOut = true; terminate(); }, request.timeoutMs);
      timeout.unref?.();
      finalSettlement = this.timers.setTimeout(() => {
        containmentFailed = true;
        if (!exitObserved) terminate();
        finish(null);
      }, request.timeoutMs + KILL_GRACE_MS + FINAL_SETTLEMENT_EPSILON_MS);
      finalSettlement.unref?.();
    });
  }

  private emptyResult(
    started: number,
    patch: Partial<OllamaPreflightProcessResult>,
  ): OllamaPreflightProcessResult {
    const emptyDigest = createHash('sha256').update('').digest('hex');
    return Object.freeze({
      exitCode: null, stdout: new Uint8Array(), stderr: new Uint8Array(), stdoutBytes: 0,
      stderrBytes: 0, stdoutSha256: emptyDigest, stderrSha256: emptyDigest,
      durationMs: Math.max(0, this.now() - started), timedOut: false, outputLimited: false,
      spawnFailed: false, cleanupFailed: false, containmentFailed: false,
      killEscalated: false, downloadObserved: false, networkClass: null,
      ...patch,
    });
  }
}
