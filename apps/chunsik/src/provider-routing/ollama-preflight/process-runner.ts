import { createHash } from 'node:crypto';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import {
  KILL_GRACE_MS,
  OllamaPreflightCommandCategory,
  STDERR_LIMIT,
} from './contracts';
import type { ApprovedOllamaExecutable, OllamaPreflightNetworkClass } from './contracts';
import { assertAllowedOllamaPreflightCommand } from './policy';
import { observesModelDownload } from './parsers';

export interface OllamaPreflightProcessRequest {
  readonly executable: ApprovedOllamaExecutable;
  readonly category: OllamaPreflightCommandCategory;
  readonly argv: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly stdoutLimitBytes: number;
  readonly stderrLimitBytes: typeof STDERR_LIMIT;
  readonly networkClass: OllamaPreflightNetworkClass;
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
  readonly killEscalated: boolean;
  readonly downloadObserved: boolean;
}

export interface OllamaPreflightProcessRunner {
  run(request: OllamaPreflightProcessRequest): Promise<OllamaPreflightProcessResult>;
}

type SpawnLike = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface PreflightSandbox {
  readonly home: string;
  readonly tmpdir: string;
  cleanup(): void;
}

export class ContainedOllamaPreflightProcessRunner implements OllamaPreflightProcessRunner {
  constructor(
    private readonly spawnFn: SpawnLike,
    private readonly sandboxFactory: () => PreflightSandbox,
    private readonly now: () => number = Date.now,
  ) {}

  run(request: OllamaPreflightProcessRequest): Promise<OllamaPreflightProcessResult> {
    assertAllowedOllamaPreflightCommand(request.category, request.argv);
    return new Promise((resolve) => {
      const started = this.now();
      let sandbox: PreflightSandbox;
      try {
        sandbox = this.sandboxFactory();
      } catch {
        resolve(this.emptyResult(started, { spawnFailed: true, cleanupFailed: true }));
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
      let killEscalated = false;
      let settled = false;
      let timeout: NodeJS.Timeout | undefined;
      let forceKill: NodeJS.Timeout | undefined;

      const terminate = (): void => {
        try { child?.kill('SIGTERM'); } catch { /* already stopped */ }
        forceKill = setTimeout(() => {
          killEscalated = true;
          try { child?.kill('SIGKILL'); } catch { /* already stopped */ }
        }, KILL_GRACE_MS);
        forceKill.unref?.();
      };
      const finish = (exitCode: number | null): void => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        if (forceKill) clearTimeout(forceKill);
        let cleanupFailed = false;
        try { sandbox.cleanup(); } catch { cleanupFailed = true; }
        const safeStdout = outputLimited || spawnFailed ? Buffer.alloc(0) : stdout;
        const safeStderr = outputLimited || spawnFailed ? Buffer.alloc(0) : stderr;
        resolve(Object.freeze({
          exitCode: spawnFailed ? null : exitCode,
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
          killEscalated,
          downloadObserved: observesModelDownload(stdout, stderr),
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
          env: { ...request.environment, HOME: sandbox.home, TMPDIR: sandbox.tmpdir },
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
      child.on('close', (code: number | null) => finish(code));
      child.stdin?.end();
      timeout = setTimeout(() => { timedOut = true; terminate(); }, request.timeoutMs);
      timeout.unref?.();
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
      spawnFailed: false, cleanupFailed: false, killEscalated: false, downloadObserved: false,
      ...patch,
    });
  }
}
