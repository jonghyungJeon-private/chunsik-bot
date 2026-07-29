import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  CALLER_ENV_ALLOWLIST,
  INHERITED_ENV_ALLOWLIST,
  MAX_STDERR_CAPTURE_BYTES,
  MAX_STDOUT_CAPTURE_BYTES,
  buildChildEnvironment,
  createContainedCliRunner,
} from './cli-runner';
import type { CliRunOptions, CliRunResult } from './cli-runner';

/** Control characters built from char codes so no raw control byte lives in this source. */
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const NUL = String.fromCharCode(0x00);
const REPLACEMENT = String.fromCharCode(0xfffd);

// ---------------------------------------------------------------------------
// Fake child process (no real process is ever spawned in this suite)
// ---------------------------------------------------------------------------

interface StdinBehavior {
  /** Error handed to the `write` callback. */
  writeError?: Error;
  /** Error emitted on the stdin stream during `write`. */
  emitError?: Error;
  /** Error thrown synchronously by `end()` (write/end race). */
  endThrows?: Error;
}

class FakeStdin extends EventEmitter {
  readonly written: string[] = [];
  ended = false;

  constructor(private readonly behavior: StdinBehavior = {}) {
    super();
  }

  write(data: string, callback?: (error?: Error | null) => void): boolean {
    this.written.push(data);
    callback?.(this.behavior.writeError ?? null);
    if (this.behavior.emitError) this.emit('error', this.behavior.emitError);
    return true;
  }

  end(): void {
    if (this.behavior.endThrows) throw this.behavior.endThrows;
    this.ended = true;
  }
}

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly signals: string[] = [];
  readonly stdin: FakeStdin | null;

  constructor(stdin: FakeStdin | null = new FakeStdin()) {
    super();
    this.stdin = stdin;
  }

  kill(signal?: string): boolean {
    this.signals.push(signal ?? 'SIGTERM');
    return true;
  }
}

interface SpawnRecord {
  bin: string;
  args: readonly string[];
  options: SpawnOptions;
}

interface StartConfig {
  stdin?: FakeStdin | null;
  spawnThrows?: Error;
  createThrows?: boolean;
  removeThrows?: boolean;
  parentEnv?: NodeJS.ProcessEnv;
  killGraceMs?: number;
  timeoutMs?: number;
  input?: string;
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  bin?: string;
  args?: string[];
  /** Use the production temp-dir implementation instead of the recording wrapper. */
  productionTempDir?: boolean;
}

interface StartedRun {
  result: Promise<CliRunResult>;
  child?: FakeChild;
  spawns: SpawnRecord[];
  created: string[];
  removed: string[];
}

const PARENT_WITH_SECRETS: NodeJS.ProcessEnv = {
  PATH: '/usr/bin:/bin',
  HOME: '/Users/tester',
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
  LC_CTYPE: 'UTF-8',
  TMPDIR: '/parent/tmp',
  TMP: '/parent/tmp',
  TEMP: '/parent/tmp',
  ANTHROPIC_API_KEY: 'parent-api-key',
  OPENAI_API_KEY: 'parent-api-key',
  GITHUB_TOKEN: 'parent-token',
  DISCORD_BOT_TOKEN: 'parent-bot-token',
  DATABASE_URL: 'parent-database-credential',
  AWS_SECRET_ACCESS_KEY: 'parent-credential',
  NPM_PASSWORD: 'parent-password',
  HTTP_PROXY: 'http://proxy:8080',
  HTTPS_PROXY: 'http://proxy:8080',
  NO_PROXY: 'localhost',
  SSL_CERT_FILE: '/parent/ca.pem',
  NODE_EXTRA_CA_CERTS: '/parent/ca.pem',
  NODE_OPTIONS: '--require /parent/preload.js',
  NODE_PATH: '/parent/node_modules',
  LD_PRELOAD: '/parent/evil.so',
  DYLD_INSERT_LIBRARIES: '/parent/evil.dylib',
  BASH_ENV: '/parent/bashrc',
  ZDOTDIR: '/parent/zsh',
  SHELL: '/bin/zsh',
  OLLAMA_HOST: 'http://elsewhere:11434',
  OLLAMA_MODEL: 'parent-model',
};

/**
 * Names that must NEVER reach a child, derived from the allow-list itself. `TMPDIR`
 * is excluded because the runner OWNS it: it is always set, but never to the parent's
 * value — asserted separately below.
 */
const FORBIDDEN_CHILD_ENV_NAMES = Object.keys(PARENT_WITH_SECRETS).filter(
  (name) =>
    name !== 'TMPDIR' &&
    !INHERITED_ENV_ALLOWLIST.includes(name as (typeof INHERITED_ENV_ALLOWLIST)[number]),
);

function startRun(config: StartConfig = {}): StartedRun {
  const spawns: SpawnRecord[] = [];
  const created: string[] = [];
  const removed: string[] = [];
  let child: FakeChild | undefined;

  const tempHooks = config.productionTempDir
    ? {}
    : {
        createTempDir: (): string => {
          if (config.createThrows) throw new Error('temp create failed');
          const dir = mkdtempSync(join(realpathSync(tmpdir()), 'chunsik-cli-test-'));
          created.push(dir);
          return dir;
        },
        removeTempDir: (dir: string): void => {
          removed.push(dir);
          if (config.removeThrows) throw new Error('temp remove failed');
          rmSync(dir, { recursive: true, force: true });
        },
      };

  const runner = createContainedCliRunner({
    ...tempHooks,
    parentEnv: config.parentEnv ?? PARENT_WITH_SECRETS,
    killGraceMs: config.killGraceMs ?? 30,
    spawnFn: (bin, args, options) => {
      spawns.push({ bin, args, options });
      if (config.spawnThrows) throw config.spawnThrows;
      child = new FakeChild(config.stdin === undefined ? new FakeStdin() : config.stdin);
      return child as unknown as ChildProcess;
    },
  });

  const options: CliRunOptions = {
    cwd: config.cwd ?? '/neutral/cwd',
    input: config.input ?? 'the prompt',
    timeoutMs: config.timeoutMs ?? 5_000,
    ...(config.env ? { env: config.env } : {}),
  };
  const result = runner(config.bin ?? 'provider-cli', config.args ?? ['-p'], options);
  return { result, child, spawns, created, removed };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Emit a normal close (the runner defers close handling by one macrotask). */
async function closeWith(run: StartedRun, code: number | null = 0): Promise<CliRunResult> {
  run.child?.emit('close', code, null);
  return run.result;
}

const childEnvOf = (run: StartedRun): Record<string, string> =>
  (run.spawns[0]?.options.env ?? {}) as Record<string, string>;

// ---------------------------------------------------------------------------

describe('contained CLI runner: parent environment isolation', () => {
  it('forwards only allow-listed parent names plus a runner-owned TMPDIR', async () => {
    const run = startRun();
    await closeWith(run);
    const env = childEnvOf(run);
    expect(Object.keys(env).sort()).toEqual([...INHERITED_ENV_ALLOWLIST, 'TMPDIR'].sort());
    expect(env.PATH).toBe('/usr/bin:/bin');
    expect(env.HOME).toBe('/Users/tester');
    expect(env.LANG).toBe('en_US.UTF-8');
    expect(env.LC_ALL).toBe('en_US.UTF-8');
    expect(env.LC_CTYPE).toBe('UTF-8');
  });

  it('never forwards a secret-like, proxy, certificate, preload, or shell parent variable', async () => {
    const run = startRun();
    await closeWith(run);
    const env = childEnvOf(run);
    for (const name of FORBIDDEN_CHILD_ENV_NAMES) {
      expect(env[name], `${name} must not reach the child`).toBeUndefined();
    }
    const serialized = JSON.stringify(env);
    for (const value of [
      'parent-api-key',
      'parent-token',
      'parent-bot-token',
      'parent-credential',
      'parent-password',
      'parent-model',
      'proxy:8080',
      'preload.js',
    ]) {
      expect(serialized).not.toContain(value);
    }
  });

  it('never forwards the parent TMPDIR/TMP/TEMP: TMPDIR is runner-owned', async () => {
    const run = startRun();
    await closeWith(run);
    const env = childEnvOf(run);
    expect(env.TMPDIR).not.toBe('/parent/tmp');
    expect(env.TMPDIR).toBe(run.created[0]);
    expect(env.TMP).toBeUndefined();
    expect(env.TEMP).toBeUndefined();
  });

  it('accepts the allow-listed caller environment names', async () => {
    const run = startRun({ env: { NO_COLOR: '1', CLICOLOR: '0', CLICOLOR_FORCE: '0' } });
    await closeWith(run);
    const env = childEnvOf(run);
    expect(env.NO_COLOR).toBe('1');
    expect(env.CLICOLOR).toBe('0');
    expect(env.CLICOLOR_FORCE).toBe('0');
    expect(Object.keys(env).sort()).toEqual(
      [...INHERITED_ENV_ALLOWLIST, 'TMPDIR', ...CALLER_ENV_ALLOWLIST].sort(),
    );
  });

  it('refuses a non-allow-listed caller name WITHOUT spawning (no bypass path)', async () => {
    const rogueEnvironments: Array<Record<string, string>> = [
      { ANTHROPIC_API_KEY: 'injected' },
      { NODE_OPTIONS: '--require /evil.js' },
      { HTTP_PROXY: 'http://evil' },
      { OLLAMA_HOST: 'http://elsewhere' },
      { PATH: '/evil/bin' },
      { HOME: '/evil/home' },
      { TMPDIR: '/evil/tmp' },
      { NO_COLOR: '1', GITHUB_TOKEN: 'injected' },
    ];
    for (const rogue of rogueEnvironments) {
      const run = startRun({ env: rogue });
      const result = await run.result;
      expect(run.spawns).toHaveLength(0);
      expect(run.child).toBeUndefined();
      expect(result.code).toBeNull();
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('not allow-listed');
      expect(result.timedOut).toBe(false);
      // A refused run still cleans up its own temporary directory.
      expect(run.removed).toEqual(run.created);
      expect(existsSync(run.created[0] ?? '')).toBe(false);
    }
  });

  it('buildChildEnvironment is pure and fails closed on any unknown caller name', () => {
    const allowed = buildChildEnvironment(PARENT_WITH_SECRETS, '/tmp/owned', { NO_COLOR: '1' });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.env.TMPDIR).toBe('/tmp/owned');
      expect(allowed.env.NO_COLOR).toBe('1');
      expect(allowed.env.ANTHROPIC_API_KEY).toBeUndefined();
    }
    const refused = buildChildEnvironment(PARENT_WITH_SECRETS, '/tmp/owned', { SOMETHING_ELSE: 'x' });
    expect(refused.ok).toBe(false);
    const sparseParent = buildChildEnvironment({ PATH: '/bin' }, '/tmp/owned');
    expect(sparseParent.ok).toBe(true);
    if (sparseParent.ok) {
      // An absent parent name is simply not set, never set to an empty string.
      expect(Object.keys(sparseParent.env).sort()).toEqual(['PATH', 'TMPDIR']);
    }
  });
});

describe('contained CLI runner: runner-owned temporary directory', () => {
  it('gives each child an independent temp dir under OS temp, outside the repository', async () => {
    const first = startRun({ productionTempDir: true });
    const second = startRun({ productionTempDir: true });
    await closeWith(first);
    await closeWith(second);
    const a = childEnvOf(first).TMPDIR ?? '';
    const b = childEnvOf(second).TMPDIR ?? '';
    expect(a).not.toBe('');
    expect(a).not.toBe(b);
    const osTemp = realpathSync(tmpdir());
    expect(a.startsWith(osTemp)).toBe(true);
    expect(b.startsWith(osTemp)).toBe(true);
    expect(a.startsWith(process.cwd())).toBe(false);
    expect(b.startsWith(process.cwd())).toBe(false);
    expect(a).toContain('chunsik-cli-');
    // Removed by the production cleanup path once each child settled.
    expect(existsSync(a)).toBe(false);
    expect(existsSync(b)).toBe(false);
  });

  it('removes the temp dir exactly once after the child settles', async () => {
    const run = startRun();
    expect(run.removed).toHaveLength(0);
    await closeWith(run);
    expect(run.removed).toEqual(run.created);
    expect(run.removed).toHaveLength(1);
    expect(existsSync(run.created[0] ?? '')).toBe(false);
  });

  it('reports a cleanup failure instead of hiding it, without altering successful stdout', async () => {
    const run = startRun({ removeThrows: true });
    run.child?.stdout.emit('data', Buffer.from('real response', 'utf8'));
    const result = await closeWith(run, 0);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('real response'); // untouched
    expect(result.stderr).toContain('could not remove its temporary directory');
    rmSync(run.created[0] ?? '', { recursive: true, force: true });
  });

  it('fails closed without spawning when the temp dir cannot be created', async () => {
    const run = startRun({ createThrows: true });
    const result = await run.result;
    expect(run.spawns).toHaveLength(0);
    expect(result.code).toBeNull();
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('could not create its temporary directory');
  });
});

describe('contained CLI runner: output byte bounds', () => {
  it('bounds stdout by BYTES and returns a bounded generic failure, not a success', async () => {
    const run = startRun();
    run.child?.stdout.emit('data', Buffer.alloc(MAX_STDOUT_CAPTURE_BYTES + 1, 0x61));
    const result = await closeWith(run, 0);
    expect(result.code).toBeNull(); // never a success
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('stdout exceeded the capture limit');
    expect(result.stderr).not.toContain('aaaa'); // oversized content is never echoed
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(MAX_STDOUT_CAPTURE_BYTES);
    expect(run.child?.signals).toContain('SIGTERM');
  });

  it('bounds stderr by BYTES independently of stdout', async () => {
    const run = startRun();
    run.child?.stdout.emit('data', Buffer.from('small', 'utf8'));
    run.child?.stderr.emit('data', Buffer.alloc(MAX_STDERR_CAPTURE_BYTES + 1, 0x62));
    const result = await closeWith(run, 0);
    expect(result.code).toBeNull();
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('stderr exceeded the capture limit');
    expect(result.stderr).not.toContain('bbbb');
    expect(run.child?.signals).toContain('SIGTERM');
  });

  it('applies the two limits independently (a stdout above the stderr bound still succeeds)', async () => {
    const run = startRun();
    run.child?.stdout.emit('data', Buffer.alloc(MAX_STDERR_CAPTURE_BYTES + 2_048, 0x61));
    run.child?.stderr.emit('data', Buffer.alloc(MAX_STDERR_CAPTURE_BYTES - 1_024, 0x62));
    const result = await closeWith(run, 0);
    expect(result.code).toBe(0);
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBe(MAX_STDERR_CAPTURE_BYTES + 2_048);
    expect(Buffer.byteLength(result.stderr, 'utf8')).toBe(MAX_STDERR_CAPTURE_BYTES - 1_024);
  });

  it('accumulates a many-chunk stream up to the bound without exceeding it', async () => {
    const run = startRun();
    const chunk = Buffer.alloc(16_384, 0x63);
    for (let i = 0; i < MAX_STDOUT_CAPTURE_BYTES / 16_384; i += 1) {
      run.child?.stdout.emit('data', chunk);
    }
    const result = await closeWith(run, 0);
    expect(result.code).toBe(0);
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBe(MAX_STDOUT_CAPTURE_BYTES);
  });
});

describe('contained CLI runner: UTF-8-safe streaming', () => {
  it('restores a multi-byte sequence split across chunks', async () => {
    const run = startRun();
    const bytes = Buffer.from('한글 응답', 'utf8');
    run.child?.stdout.emit('data', bytes.subarray(0, 2)); // splits the first code point
    run.child?.stdout.emit('data', bytes.subarray(2, 7));
    run.child?.stdout.emit('data', bytes.subarray(7));
    const result = await closeWith(run, 0);
    expect(result.stdout).toBe('한글 응답');
    expect(result.stdout).not.toContain(REPLACEMENT);
  });

  it('uses an independent decoder per stream (interleaved partial sequences do not mix)', async () => {
    const run = startRun();
    const out = Buffer.from('한', 'utf8');
    const err = Buffer.from('글', 'utf8');
    run.child?.stdout.emit('data', out.subarray(0, 2));
    run.child?.stderr.emit('data', err.subarray(0, 2));
    run.child?.stdout.emit('data', out.subarray(2));
    run.child?.stderr.emit('data', err.subarray(2));
    const result = await closeWith(run, 0);
    expect(result.stdout).toBe('한');
    expect(result.stderr).toBe('글');
    expect(result.stdout).not.toContain(REPLACEMENT);
    expect(result.stderr).not.toContain(REPLACEMENT);
  });

  it('flushes the decoder at stream end for a trailing incomplete sequence', async () => {
    const run = startRun();
    const bytes = Buffer.from('가', 'utf8');
    run.child?.stdout.emit('data', bytes.subarray(0, 2)); // never completed
    const result = await closeWith(run, 0);
    // The incomplete tail surfaces as a replacement character rather than vanishing.
    expect(result.code).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(result.stdout).toContain(REPLACEMENT);
  });
});

describe('contained CLI runner: diagnostic sanitation', () => {
  it('strips ANSI CSI/OSC/ESC and control bytes from the diagnostic stderr', async () => {
    const run = startRun();
    const framed = `${ESC}[31mError:${ESC}[0m ${ESC}]0;title${BEL}boom${NUL}`;
    run.child?.stderr.emit('data', Buffer.from(framed, 'utf8'));
    const result = await closeWith(run, 1);
    expect(result.stderr).toBe('Error: boom');
    expect(result.stderr).not.toContain(ESC);
    expect(result.stderr).not.toContain(BEL);
    expect(result.stderr).not.toContain(NUL);
  });

  it('leaves a successful stdout byte-for-byte unchanged (the adapter owns response semantics)', async () => {
    const run = startRun();
    const raw = `${ESC}[K## result\n\n\`\`\`ts\nconst x = 1;\n\`\`\`${NUL}`;
    run.child?.stdout.emit('data', Buffer.from(raw, 'utf8'));
    const result = await closeWith(run, 0);
    expect(result.stdout).toBe(raw);
    expect(result.stdout).toContain(ESC);
  });
});

describe('contained CLI runner: child lifecycle', () => {
  it('spawns with shell:false, the caller cwd, and a piped stdio triple', async () => {
    const run = startRun({ cwd: '/caller/cwd', bin: 'some-cli', args: ['run', 'a-model'] });
    await closeWith(run);
    expect(run.spawns[0]?.bin).toBe('some-cli');
    expect(run.spawns[0]?.args).toEqual(['run', 'a-model']);
    expect(run.spawns[0]?.options.shell).toBe(false);
    expect(run.spawns[0]?.options.cwd).toBe('/caller/cwd'); // never replaced by the temp dir
    expect(run.spawns[0]?.options.stdio).toEqual(['pipe', 'pipe', 'pipe']);
  });

  it('writes the prompt to stdin and ends it', async () => {
    const stdin = new FakeStdin();
    const run = startRun({ stdin, input: 'my prompt' });
    await closeWith(run);
    expect(stdin.written).toEqual(['my prompt']);
    expect(stdin.ended).toBe(true);
  });

  it('reports a synchronous spawn failure and still cleans up', async () => {
    const run = startRun({ spawnThrows: new Error('spawn some-cli ENOENT') });
    const result = await run.result;
    expect(result.code).toBeNull();
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('ENOENT');
    expect(result.timedOut).toBe(false);
    expect(run.removed).toEqual(run.created);
  });

  it('reports an asynchronous spawn error', async () => {
    const run = startRun();
    run.child?.emit('error', new Error('spawn some-cli EACCES'));
    const result = await run.result;
    expect(result.code).toBeNull();
    expect(result.stderr).toContain('EACCES');
    expect(run.removed).toHaveLength(1);
  });

  it('fails closed when stdin is unavailable', async () => {
    const run = startRun({ stdin: null });
    run.child?.emit('close', 0, null);
    const result = await run.result;
    expect(result.code).toBeNull();
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('could not open the child stdin stream');
    expect(run.child?.signals).toContain('SIGTERM');
  });

  it('fails closed when the stdin write callback errors while a prompt was pending', async () => {
    const stdin = new FakeStdin({ writeError: new Error('EPIPE') });
    const run = startRun({ stdin, input: 'a prompt' });
    run.child?.stdout.emit('data', Buffer.from('partial', 'utf8'));
    const result = await closeWith(run, 0);
    expect(result.code).toBeNull(); // an undelivered prompt is never a success
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('could not deliver the prompt');
  });

  it('fails closed when the stdin stream emits an error while a prompt was pending', async () => {
    const stdin = new FakeStdin({ emitError: new Error('EPIPE') });
    const run = startRun({ stdin, input: 'a prompt' });
    const result = await closeWith(run, 0);
    expect(result.code).toBeNull();
    expect(result.stderr).toContain('could not deliver the prompt');
  });

  it('fails closed on an end()/write race that throws', async () => {
    const stdin = new FakeStdin({ endThrows: new Error('already ended') });
    const run = startRun({ stdin, input: 'a prompt' });
    const result = await closeWith(run, 0);
    expect(result.code).toBeNull();
    expect(result.stderr).toContain('could not deliver the prompt');
  });

  it('ignores a harmless stdin error when there was no prompt to deliver (availability probe)', async () => {
    const stdin = new FakeStdin({ emitError: new Error('EPIPE') });
    const run = startRun({ stdin, input: '', args: ['--version'] });
    run.child?.stdout.emit('data', Buffer.from('1.2.3', 'utf8'));
    const result = await closeWith(run, 0);
    expect(stdin.written).toEqual([]); // nothing written for an empty input
    expect(result.code).toBe(0); // the probe still succeeds
    expect(result.stdout).toBe('1.2.3');
  });

  it('sends SIGTERM on timeout and escalates to SIGKILL after the grace period', async () => {
    const run = startRun({ timeoutMs: 10, killGraceMs: 25 });
    await sleep(90);
    expect(run.child?.signals).toEqual(['SIGTERM', 'SIGKILL']);
    const result = await closeWith(run, null);
    expect(result.timedOut).toBe(true);
    expect(result.code).toBeNull();
  });

  it('does NOT send SIGKILL when the child exits inside the grace period', async () => {
    const run = startRun({ timeoutMs: 10, killGraceMs: 600 });
    await sleep(50);
    expect(run.child?.signals).toEqual(['SIGTERM']);
    const result = await closeWith(run, null);
    expect(result.timedOut).toBe(true);
    await sleep(150);
    expect(run.child?.signals).toEqual(['SIGTERM']); // the force-kill timer was cleared
  });

  it('handles a signal-only close (no exit code)', async () => {
    const run = startRun();
    run.child?.emit('close', null, 'SIGKILL');
    const result = await run.result;
    expect(result.code).toBeNull();
    expect(result.timedOut).toBe(false);
  });

  it('settles exactly once and releases resources once on a close/error race', async () => {
    for (const order of ['close-first', 'error-first'] as const) {
      const run = startRun();
      if (order === 'close-first') {
        run.child?.emit('close', 0, null);
        run.child?.emit('error', new Error('late error'));
      } else {
        run.child?.emit('error', new Error('early error'));
        run.child?.emit('close', 0, null);
      }
      await run.result;
      await sleep(10);
      expect(run.created).toHaveLength(1);
      expect(run.removed).toHaveLength(1);
    }
  });

  it('removes every stream/process listener and timer once settled', async () => {
    const run = startRun({ timeoutMs: 10_000 });
    const child = run.child;
    expect(child?.listenerCount('close')).toBe(1);
    expect(child?.stdout.listenerCount('data')).toBe(1);
    await closeWith(run);
    expect(child?.listenerCount('close')).toBe(0);
    expect(child?.listenerCount('error')).toBe(0);
    expect(child?.stdout.listenerCount('data')).toBe(0);
    expect(child?.stderr.listenerCount('data')).toBe(0);
    expect(child?.stdin?.listenerCount('error')).toBe(0);
    // Late events after settling change nothing.
    child?.stdout.emit('data', Buffer.from('late', 'utf8'));
    child?.emit('close', 1, null);
    await sleep(10);
    expect(run.removed).toHaveLength(1);
  });
});

describe('contained CLI runner: no retry', () => {
  it('spawns exactly once for a non-zero exit', async () => {
    const run = startRun();
    run.child?.stderr.emit('data', Buffer.from('failed', 'utf8'));
    const result = await closeWith(run, 2);
    expect(result.code).toBe(2);
    expect(run.spawns).toHaveLength(1);
  });

  it('spawns exactly once for a timeout', async () => {
    const run = startRun({ timeoutMs: 10, killGraceMs: 600 });
    await sleep(40);
    await closeWith(run, null);
    expect(run.spawns).toHaveLength(1);
  });

  it('spawns exactly once for a spawn error', async () => {
    const run = startRun();
    run.child?.emit('error', new Error('boom'));
    await run.result;
    expect(run.spawns).toHaveLength(1);
  });
});
