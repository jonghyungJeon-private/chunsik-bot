import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  FINAL_SETTLEMENT_EPSILON_MS,
  ExternalEgressControl,
  INVENTORY_STDOUT_LIMIT,
  KILL_GRACE_MS,
  MAX_EXECUTABLE_BYTES,
  OllamaPreflightCommandCategory,
  OllamaPreflightFailureCode,
  OllamaPreflightStatus,
  REQUIRED_OLLAMA_MODELS,
  STDERR_LIMIT,
  VERSION_STDOUT_LIMIT,
} from './contracts';
import {
  resolveOllamaExecutableIdentity,
} from './executable-identity';
import type { OllamaPreflightFileSystem, PreflightFileStat } from './executable-identity';
import { observesModelDownload, parseOllamaInventory, parseOllamaVersion } from './parsers';
import {
  argvFor,
  assertAllowedOllamaPreflightCommand,
  assertIsolatedOllamaEnvironment,
  buildIsolatedOllamaEnvironment,
  parseApprovedLoopbackEndpoint,
} from './policy';
import type {
  OllamaPreflightProcessRequest,
  OllamaPreflightProcessResult,
  OllamaPreflightProcessRunner,
  PreflightRunnerTimers,
} from './process-runner';
import { ContainedOllamaPreflightProcessRunner } from './process-runner';
import { OllamaInventoryPreflight } from './preflight';

class FakeFileSystem implements OllamaPreflightFileSystem {
  real = '/real/ollama';
  statValue: PreflightFileStat;
  contents: Uint8Array[];
  reads = 0;

  constructor(content = Buffer.from('binary')) {
    this.contents = [content];
    this.statValue = { kind: 'file', sizeBytes: content.byteLength, mode: 0o755 };
  }

  realpath(path: string): string {
    if (path === '/missing/ollama') throw new Error('missing');
    return this.real;
  }
  stat(): PreflightFileStat { return this.statValue; }
  *readChunks(): Iterable<Uint8Array> {
    const selected = this.contents[Math.min(this.reads, this.contents.length - 1)] as Uint8Array;
    this.reads += 1;
    yield selected;
  }
}

const digest = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');
const processResult = (
  stdout: string,
  patch: Partial<OllamaPreflightProcessResult> = {},
): OllamaPreflightProcessResult => {
  const out = Buffer.from(stdout);
  const err = Buffer.from('');
  return {
    exitCode: 0, stdout: out, stderr: err, stdoutBytes: out.byteLength, stderrBytes: 0,
    stdoutSha256: digest(out), stderrSha256: digest(err), durationMs: 1,
    timedOut: false, outputLimited: false, spawnFailed: false, cleanupFailed: false,
    containmentFailed: false, killEscalated: false, downloadObserved: false,
    networkClass: 'LOOPBACK_DAEMON', ...patch,
  };
};

class FakeRunner implements OllamaPreflightProcessRunner {
  readonly requests: OllamaPreflightProcessRequest[] = [];
  constructor(private readonly results: OllamaPreflightProcessResult[]) {}
  async run(request: OllamaPreflightProcessRequest): Promise<OllamaPreflightProcessResult> {
    this.requests.push(request);
    const result = this.results.shift();
    if (!result) throw new Error('unexpected command');
    return result;
  }
}

async function configured(
  runner: FakeRunner,
  fileSystem = new FakeFileSystem(),
  patch: Partial<Parameters<OllamaInventoryPreflight['execute']>[0]> = {},
) {
  const approvedExecutable = resolveOllamaExecutableIdentity('/approved/ollama', fileSystem);
  const service = new OllamaInventoryPreflight(fileSystem, runner);
  return service.execute({
    executablePath: '/approved/ollama', approvedExecutable,
    loopbackEndpoint: 'http://127.0.0.1:11434',
    externalEgressControl: ExternalEgressControl.CONFIG_RESTRICTED_RISK_ACCEPTED,
    externalEgressIsolationVerified: false,
    ...patch,
  });
}

describe('Ollama executable identity', () => {
  it('rejects bare/relative, missing, non-file, non-executable, zero and oversized inputs', () => {
    expect(() => resolveOllamaExecutableIdentity('ollama', new FakeFileSystem())).toThrow(/INVALID_PREFLIGHT_CONFIGURATION/);
    expect(() => resolveOllamaExecutableIdentity('./ollama', new FakeFileSystem())).toThrow(/INVALID_PREFLIGHT_CONFIGURATION/);
    expect(() => resolveOllamaExecutableIdentity('/missing/ollama', new FakeFileSystem())).toThrow(/EXECUTABLE_NOT_FOUND/);
    for (const stat of [
      { kind: 'directory', sizeBytes: 6, mode: 0o755 },
      { kind: 'file', sizeBytes: 6, mode: 0o644 },
      { kind: 'file', sizeBytes: 0, mode: 0o755 },
      { kind: 'file', sizeBytes: MAX_EXECUTABLE_BYTES + 1, mode: 0o755 },
    ] as const) {
      const fs = new FakeFileSystem(); fs.statValue = stat;
      expect(() => resolveOllamaExecutableIdentity('/approved/ollama', fs)).toThrow(/EXECUTABLE_NOT_RUNNABLE/);
    }
  });

  it('resolves a symlink-like input to a deterministic immutable bounded identity', () => {
    const fs = new FakeFileSystem(Buffer.from('same-binary'));
    const first = resolveOllamaExecutableIdentity('/approved/link', fs);
    const second = resolveOllamaExecutableIdentity('/approved/link', fs);
    expect(first.realPath).toBe('/real/ollama');
    expect(second.identity).toEqual(first.identity);
    expect(first.identity.identityDigest).toBe(digest(Buffer.from('same-binary')));
    expect(Object.isFrozen(first.identity)).toBe(true);
    expect(JSON.stringify(first.identity)).not.toContain('/real/ollama');
  });
});

describe('Ollama preflight command and environment policy', () => {
  it('allows only exact VERSION and INVENTORY argv', () => {
    expect(argvFor(OllamaPreflightCommandCategory.VERSION)).toEqual(['--version']);
    expect(argvFor(OllamaPreflightCommandCategory.INVENTORY)).toEqual(['list']);
    expect(() => assertAllowedOllamaPreflightCommand(OllamaPreflightCommandCategory.VERSION, ['--version', '--json'])).toThrow();
    for (const command of ['run', 'pull', 'create', 'rm', 'cp', 'serve', 'stop', 'push']) {
      expect(() => assertAllowedOllamaPreflightCommand(OllamaPreflightCommandCategory.INVENTORY, [command])).toThrow();
    }
  });

  it('builds only the isolated allowlisted environment', () => {
    const env = buildIsolatedOllamaEnvironment({
      home: '/sandbox/home', tmpdir: '/sandbox/tmp', loopbackEndpoint: 'http://localhost:11434',
    });
    expect(env).toEqual({ HOME: '/sandbox/home', TMPDIR: '/sandbox/tmp', LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8', NO_COLOR: '1', CLICOLOR: '0', CLICOLOR_FORCE: '0',
      OLLAMA_HOST: 'http://localhost:11434' });
    for (const forbidden of ['PATH', 'HTTP_PROXY', 'GITHUB_TOKEN', 'OLLAMA_MODELS', 'NODE_OPTIONS']) {
      expect(env).not.toHaveProperty(forbidden);
    }
  });

  it('accepts only exact loopback HTTP endpoints', () => {
    for (const value of ['http://127.0.0.1:1', 'http://localhost:65535', 'http://[::1]:11434']) {
      expect(parseApprovedLoopbackEndpoint(value)).toBe(value);
    }
    for (const value of ['https://localhost:1', 'http://example.com:1', 'http://user@localhost:1',
      'http://localhost:1/path', 'http://localhost:1?q=1', 'http://localhost:0', 'http://localhost:65536']) {
      expect(() => parseApprovedLoopbackEndpoint(value)).toThrow(/REMOTE_HOST_CONFIGURATION_DETECTED/);
    }
  });
});

class FakeChildProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly signals: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    return true;
  }
}

class FakeTimers implements PreflightRunnerTimers {
  private clock = 0;
  private sequence = 0;
  private readonly scheduled: Array<{
    id: number; at: number; active: boolean; handler: () => void;
  }> = [];

  setTimeout(handler: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    const timer = { id: this.sequence += 1, at: this.clock + delayMs, active: true, handler };
    this.scheduled.push(timer);
    return timer as unknown as ReturnType<typeof setTimeout>;
  }

  clearTimeout(handle: ReturnType<typeof setTimeout>): void {
    const timer = handle as unknown as { active: boolean };
    timer.active = false;
  }

  advance(milliseconds: number): void {
    const target = this.clock + milliseconds;
    while (true) {
      const next = this.scheduled
        .filter((timer) => timer.active && timer.at <= target)
        .sort((left, right) => left.at - right.at || left.id - right.id)[0];
      if (!next) break;
      this.clock = next.at;
      next.active = false;
      next.handler();
    }
    this.clock = target;
  }
}

const approvedExecutable = Object.freeze({
  realPath: '/approved/ollama',
  identity: Object.freeze({
    contractVersion: 'stage2b-ollama-executable-identity-v1' as const,
    identityDigest: '0'.repeat(64), sizeBytes: 6, modeClass: 'EXECUTABLE' as const,
    pathKind: 'ABSOLUTE_REALPATH' as const,
  }),
});

const containedRequest = (patch: Partial<OllamaPreflightProcessRequest> = {}): OllamaPreflightProcessRequest => ({
  executable: approvedExecutable,
  category: OllamaPreflightCommandCategory.VERSION,
  argv: ['--version'],
  approvedLoopbackEndpoint: 'http://127.0.0.1:11434',
  timeoutMs: 50,
  stdoutLimitBytes: VERSION_STDOUT_LIMIT,
  stderrLimitBytes: STDERR_LIMIT,
  ...patch,
});

describe('Contained Ollama preflight process runner', () => {
  it('owns the exact spawn contract and isolated environment', async () => {
    const child = new FakeChildProcess();
    let cleanupCount = 0;
    let captured: { command: string; args: readonly string[]; options: SpawnOptions } | undefined;
    const runner = new ContainedOllamaPreflightProcessRunner((command, args, options) => {
      captured = { command, args, options };
      return child as unknown as ChildProcess;
    }, () => ({ home: '/sandbox/home', tmpdir: '/sandbox/tmp', cleanup: () => { cleanupCount += 1; } }));
    const pending = runner.run(containedRequest());
    child.stdout.write('ollama version 1.2.3');
    child.emit('close', 0);
    const result = await pending;

    expect(captured).toMatchObject({ command: '/approved/ollama', args: ['--version'],
      options: { cwd: '/sandbox/tmp', shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true } });
    expect(captured?.options.env).toEqual({ HOME: '/sandbox/home', TMPDIR: '/sandbox/tmp',
      LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1', CLICOLOR: '0',
      CLICOLOR_FORCE: '0', OLLAMA_HOST: 'http://127.0.0.1:11434' });
    expect(Object.keys(captured?.options.env ?? {}).sort()).toEqual([
      'CLICOLOR', 'CLICOLOR_FORCE', 'HOME', 'LANG', 'LC_ALL', 'NO_COLOR', 'OLLAMA_HOST', 'TMPDIR',
    ]);
    expect(child.stdin.writableEnded).toBe(true);
    expect(result).toMatchObject({ exitCode: 0, networkClass: 'LOOPBACK_DAEMON', containmentFailed: false });
    expect(cleanupCount).toBe(1);
  });

  it.each(['stdout', 'stderr'] as const)('bounds %s and terminates without exposing output', async (stream) => {
    const child = new FakeChildProcess();
    const runner = new ContainedOllamaPreflightProcessRunner(
      () => child as unknown as ChildProcess,
      () => ({ home: '/h', tmpdir: '/t', cleanup: () => undefined }),
    );
    const pending = runner.run(containedRequest({ stdoutLimitBytes: 2, stderrLimitBytes: 2 }));
    child[stream].write('abc');
    expect(child.signals).toEqual(['SIGTERM']);
    child.emit('close', null);
    const result = await pending;
    expect(result.outputLimited).toBe(true);
    expect(result.stdout).toHaveLength(0);
    expect(result.stderr).toHaveLength(0);
  });

  it('enforces timeout, TERM/KILL escalation, and the final settlement deadline', async () => {
    const child = new FakeChildProcess();
    const timers = new FakeTimers();
    let cleanupCount = 0;
    const runner = new ContainedOllamaPreflightProcessRunner(
      () => child as unknown as ChildProcess,
      () => ({ home: '/h', tmpdir: '/t', cleanup: () => { cleanupCount += 1; } }),
      () => 0,
      timers,
    );
    const pending = runner.run(containedRequest());
    timers.advance(50);
    expect(child.signals).toEqual(['SIGTERM']);
    timers.advance(KILL_GRACE_MS);
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
    timers.advance(FINAL_SETTLEMENT_EPSILON_MS);
    const result = await pending;
    expect(result).toMatchObject({ timedOut: true, killEscalated: true,
      containmentFailed: true, exitCode: null, networkClass: 'LOOPBACK_DAEMON' });
    expect(cleanupCount).toBe(1);
    child.emit('close', 0);
    expect(cleanupCount).toBe(1);
  });

  it('settles an exit-without-close race at the hard deadline exactly once', async () => {
    const child = new FakeChildProcess();
    const timers = new FakeTimers();
    let cleanupCount = 0;
    const runner = new ContainedOllamaPreflightProcessRunner(
      () => child as unknown as ChildProcess,
      () => ({ home: '/h', tmpdir: '/t', cleanup: () => { cleanupCount += 1; } }),
      () => 0,
      timers,
    );
    const pending = runner.run(containedRequest());
    child.emit('exit', 0);
    timers.advance(50 + KILL_GRACE_MS + FINAL_SETTLEMENT_EPSILON_MS);
    expect(await pending).toMatchObject({ containmentFailed: true, exitCode: null,
      networkClass: 'LOOPBACK_DAEMON' });
    expect(cleanupCount).toBe(1);
  });

  it('rejects malformed runner-built environments before spawn', async () => {
    const exact = buildIsolatedOllamaEnvironment({
      home: '/h', tmpdir: '/t', loopbackEndpoint: 'http://127.0.0.1:11434',
    });
    expect(() => assertIsolatedOllamaEnvironment(exact, {
      home: '/h', tmpdir: '/t', loopbackEndpoint: 'http://127.0.0.1:11434',
    })).not.toThrow();
    for (const malformed of [
      { ...exact, PATH: '/bin' },
      { ...exact, HTTP_PROXY: 'http://proxy' },
      { ...exact, GITHUB_TOKEN: 'secret' },
      { ...exact, HOME: '/wrong' },
    ]) {
      let spawnCount = 0;
      const runner = new ContainedOllamaPreflightProcessRunner(
        () => { spawnCount += 1; return new FakeChildProcess() as unknown as ChildProcess; },
        () => ({ home: '/h', tmpdir: '/t', cleanup: () => undefined }),
        () => 0,
        new FakeTimers(),
        () => malformed,
      );
      const result = await runner.run(containedRequest());
      expect(spawnCount).toBe(0);
      expect(result).toMatchObject({ containmentFailed: true, networkClass: null });
    }
  });

  it('returns bounded facts for synchronous spawn, child error, sandbox, and cleanup failures', async () => {
    const spawnFailure = await new ContainedOllamaPreflightProcessRunner(
      () => { throw new Error('raw spawn detail'); },
      () => ({ home: '/h', tmpdir: '/t', cleanup: () => undefined }),
    ).run(containedRequest());
    expect(spawnFailure).toMatchObject({ spawnFailed: true, containmentFailed: false });
    expect(JSON.stringify(spawnFailure)).not.toContain('raw spawn detail');

    const child = new FakeChildProcess();
    const childRunner = new ContainedOllamaPreflightProcessRunner(
      () => child as unknown as ChildProcess,
      () => ({ home: '/h', tmpdir: '/t', cleanup: () => undefined }),
    );
    const childPending = childRunner.run(containedRequest());
    child.emit('error', new Error('raw child detail'));
    expect(await childPending).toMatchObject({ spawnFailed: true });

    const sandboxFailure = await new ContainedOllamaPreflightProcessRunner(
      () => child as unknown as ChildProcess,
      () => { throw new Error('raw sandbox detail'); },
    ).run(containedRequest());
    expect(sandboxFailure).toMatchObject({ spawnFailed: true, cleanupFailed: true,
      containmentFailed: true, networkClass: null });

    const cleanupChild = new FakeChildProcess();
    const cleanupRunner = new ContainedOllamaPreflightProcessRunner(
      () => cleanupChild as unknown as ChildProcess,
      () => ({ home: '/h', tmpdir: '/t', cleanup: () => { throw new Error('raw cleanup detail'); } }),
    );
    const cleanupPending = cleanupRunner.run(containedRequest());
    cleanupChild.emit('close', 0);
    expect(await cleanupPending).toMatchObject({ cleanupFailed: true });
  });
});

describe('Ollama preflight parsers', () => {
  it('parses one version token from stdout or stderr and strips ANSI/leading v', () => {
    expect(parseOllamaVersion(Buffer.from('\x1b[32mollama version v1.2.3-beta.1\x1b[0m'), Buffer.alloc(0))).toBe('1.2.3-beta.1');
    expect(parseOllamaVersion(Buffer.alloc(0), Buffer.from('0.5.7'))).toBe('0.5.7');
  });

  it('rejects empty, dual-stream, multiline, multiple-token, oversized and invalid UTF-8 version output', () => {
    expect(() => parseOllamaVersion(Buffer.alloc(0), Buffer.alloc(0))).toThrow(/VERSION_OUTPUT_INVALID/);
    expect(() => parseOllamaVersion(Buffer.from('1.2.3'), Buffer.from('1.2.3'))).toThrow(/VERSION_OUTPUT_INVALID/);
    expect(() => parseOllamaVersion(Buffer.from('1.2.3\ntext'), Buffer.alloc(0))).toThrow(/VERSION_OUTPUT_INVALID/);
    expect(() => parseOllamaVersion(Buffer.from('1.2.3 2.3.4'), Buffer.alloc(0))).toThrow(/VERSION_OUTPUT_INVALID/);
    expect(() => parseOllamaVersion(Buffer.from(`1.2.3 ${'x'.repeat(260)}`), Buffer.alloc(0))).toThrow(/VERSION_OUTPUT_INVALID/);
    expect(() => parseOllamaVersion(Uint8Array.from([0xff]), Buffer.alloc(0))).toThrow(/INVALID_UTF8/);
  });

  it('parses exact required tags with CRLF and counts but does not expose additional models', () => {
    const parsed = parseOllamaInventory(Buffer.from(
      'NAME ID SIZE MODIFIED\r\nllama3.1:8b a 1GB now\r\ngranite3.3:8b b 2GB now\r\nextra:1 c 3GB now\r\n',
    ));
    expect(parsed).toEqual({ installedRequiredModels: REQUIRED_OLLAMA_MODELS,
      missingRequiredModels: [], additionalModelCount: 1,
      inventoryFingerprint: '74cc1eb161de3d8d97ec3a9afa76b01e088a553145245409d0bd8d8a3c554e5c' });
    expect(JSON.stringify(parsed)).not.toContain('extra:1');
  });

  it('does exact tag matching and rejects duplicate, malformed, bad header, row overflow and invalid UTF-8', () => {
    expect(parseOllamaInventory(Buffer.from('NAME ID SIZE MODIFIED\nllama3.1 a 1 now\ngranite3.3:8b b 1 now'))
      .missingRequiredModels).toEqual(['llama3.1:8b']);
    for (const text of [
      'MODEL ID SIZE MODIFIED\nllama3.1:8b a 1 now',
      'NAME ID SIZE MODIFIED\nllama3.1:8b a 1 now\nllama3.1:8b b 1 now',
      'NAME ID SIZE MODIFIED\nbad*tag a 1 now',
      'NAME ID SIZE MODIFIED\nmissing-columns',
    ]) expect(() => parseOllamaInventory(Buffer.from(text))).toThrow(/INVENTORY_OUTPUT_INVALID/);
    const rows = Array.from({ length: 513 }, (_, index) => `extra:${index} a 1 now`).join('\n');
    expect(() => parseOllamaInventory(Buffer.from(`NAME ID SIZE MODIFIED\n${rows}`))).toThrow(/INVENTORY_OUTPUT_INVALID/);
    expect(() => parseOllamaInventory(Uint8Array.from([0xff]))).toThrow(/INVALID_UTF8/);
  });

  it('observes bounded download markers without claiming proof of absence', () => {
    expect(observesModelDownload(Buffer.from('pulling manifest'), Buffer.alloc(0))).toBe(true);
    expect(observesModelDownload(Buffer.from('NAME ID SIZE MODIFIED'), Buffer.alloc(0))).toBe(false);
  });
});

describe('Ollama inventory preflight orchestration', () => {
  const inventory = 'NAME ID SIZE MODIFIED\nllama3.1:8b a 1 now\ngranite3.3:8b b 1 now';

  it('returns a deep-frozen bounded PASS after exactly two non-generation commands', async () => {
    const runner = new FakeRunner([processResult('ollama version 1.2.3'), processResult(inventory)]);
    const result = await configured(runner);
    expect(result).toMatchObject({ status: OllamaPreflightStatus.PASS, failureCode: null,
      normalizedVersion: '1.2.3', providerExecutionCount: 0,
      downloadCapableCommandInvoked: false, commandCount: 2, inventoryObserved: true });
    expect(runner.requests.map((request) => request.argv)).toEqual([['--version'], ['list']]);
    expect(runner.requests[0]?.stdoutLimitBytes).toBe(VERSION_STDOUT_LIMIT);
    expect(runner.requests[1]?.stdoutLimitBytes).toBe(INVENTORY_STDOUT_LIMIT);
    expect(runner.requests.every((request) => request.stderrLimitBytes === STDERR_LIMIT)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.checks)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('/approved/ollama');
    expect(JSON.stringify(result)).not.toContain('/sandbox/');
  });

  it('fails closed after VERSION failure with zero inventory commands and no retry', async () => {
    const runner = new FakeRunner([processResult('', { exitCode: 1 })]);
    const result = await configured(runner);
    expect(result).toMatchObject({ status: OllamaPreflightStatus.FAIL,
      failureCode: OllamaPreflightFailureCode.VERSION_CHECK_FAILED, commandCount: 1,
      providerExecutionCount: 0 });
    expect(runner.requests).toHaveLength(1);
  });

  it('fails missing required models without any recovery command', async () => {
    const runner = new FakeRunner([processResult('1.2.3'),
      processResult('NAME ID SIZE MODIFIED\nllama3.1:8b a 1 now')]);
    const result = await configured(runner);
    expect(result).toMatchObject({ status: OllamaPreflightStatus.FAIL,
      failureCode: OllamaPreflightFailureCode.REQUIRED_MODEL_MISSING,
      missingRequiredModels: ['granite3.3:8b'], commandCount: 2 });
    expect(runner.requests.map((request) => request.argv)).toEqual([['--version'], ['list']]);
  });

  it.each([
    [OllamaPreflightFailureCode.TIMEOUT, { timedOut: true }],
    [OllamaPreflightFailureCode.OUTPUT_LIMIT_EXCEEDED, { outputLimited: true }],
    [OllamaPreflightFailureCode.PROCESS_CONTAINMENT_FAILED, { cleanupFailed: true }],
    [OllamaPreflightFailureCode.MODEL_DOWNLOAD_DETECTED, { downloadObserved: true }],
  ] as const)('maps bounded process failure %s and stops', async (expected, patch) => {
    const runner = new FakeRunner([processResult('1.2.3', patch)]);
    const result = await configured(runner);
    expect(result.failureCode).toBe(expected);
    expect(result.commandCount).toBe(1);
    expect(runner.requests).toHaveLength(1);
  });

  it('blocks before commands when egress control is invalid or executable changes', async () => {
    const noNetworkRunner = new FakeRunner([]);
    const noNetwork = await configured(noNetworkRunner, new FakeFileSystem(), {
      externalEgressControl: ExternalEgressControl.OS_DENIED_VERIFIED,
      externalEgressIsolationVerified: false,
    });
    expect(noNetwork.failureCode).toBe(OllamaPreflightFailureCode.NETWORK_CONTAINMENT_UNAVAILABLE);
    expect(noNetwork.networkClass).toBeNull();
    expect(noNetworkRunner.requests).toHaveLength(0);

    const remoteRunner = new FakeRunner([]);
    const remote = await configured(remoteRunner, new FakeFileSystem(), {
      loopbackEndpoint: 'http://example.com:11434',
    });
    expect(remote).toMatchObject({
      failureCode: OllamaPreflightFailureCode.REMOTE_HOST_CONFIGURATION_DETECTED,
      networkClass: null,
    });
    expect(remoteRunner.requests).toHaveLength(0);

    const fs = new FakeFileSystem(Buffer.from('first'));
    fs.contents = [Buffer.from('first'), Buffer.from('changed')];
    fs.statValue = { kind: 'file', sizeBytes: 5, mode: 0o755 };
    const mismatchRunner = new FakeRunner([]);
    const mismatch = await configured(mismatchRunner, fs);
    expect(mismatch).toMatchObject({ status: OllamaPreflightStatus.BLOCKED,
      failureCode: OllamaPreflightFailureCode.EXECUTABLE_IDENTITY_MISMATCH, commandCount: 0 });
    expect(mismatchRunner.requests).toHaveLength(0);
    expect(mismatch.networkClass).toBeNull();
  });

  it.each([
    [ExternalEgressControl.OS_DENIED_VERIFIED, true],
    [ExternalEgressControl.CONFIG_RESTRICTED_RISK_ACCEPTED, false],
  ] as const)('projects explicit egress control %s independently from network class', async (
    externalEgressControl,
    externalEgressIsolationVerified,
  ) => {
    const runner = new FakeRunner([processResult('1.2.3', { timedOut: true })]);
    const result = await configured(runner, new FakeFileSystem(), {
      externalEgressControl,
      externalEgressIsolationVerified,
    });
    expect(result).toMatchObject({ externalEgressControl, externalEgressIsolationVerified,
      networkClass: 'LOOPBACK_DAEMON' });
  });

  it.each([
    ['UNKNOWN' as ExternalEgressControl, false],
    [undefined as unknown as ExternalEgressControl, false],
    [ExternalEgressControl.CONFIG_RESTRICTED_RISK_ACCEPTED, true],
  ] as const)('blocks unknown, missing, or inconsistent egress control %#', async (
    externalEgressControl,
    externalEgressIsolationVerified,
  ) => {
    const runner = new FakeRunner([]);
    const result = await configured(runner, new FakeFileSystem(), {
      externalEgressControl,
      externalEgressIsolationVerified,
    });
    expect(result).toMatchObject({ status: OllamaPreflightStatus.BLOCKED,
      failureCode: OllamaPreflightFailureCode.NETWORK_CONTAINMENT_UNAVAILABLE,
      externalEgressControl: null, externalEgressIsolationVerified: false, networkClass: null });
    expect(runner.requests).toHaveLength(0);
  });

  it('revalidates executable identity after VERSION and before INVENTORY', async () => {
    const fs = new FakeFileSystem(Buffer.from('first'));
    fs.contents = [Buffer.from('first'), Buffer.from('first'), Buffer.from('changed')];
    fs.statValue = { kind: 'file', sizeBytes: 5, mode: 0o755 };
    const runner = new FakeRunner([processResult('1.2.3')]);
    const result = await configured(runner, fs);
    expect(result).toMatchObject({ status: OllamaPreflightStatus.BLOCKED,
      failureCode: OllamaPreflightFailureCode.EXECUTABLE_IDENTITY_MISMATCH, commandCount: 1 });
    expect(runner.requests).toHaveLength(1);
  });
});
