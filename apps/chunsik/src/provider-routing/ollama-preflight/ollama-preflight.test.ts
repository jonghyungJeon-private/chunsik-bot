import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  INVENTORY_STDOUT_LIMIT,
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
  buildIsolatedOllamaEnvironment,
  parseApprovedLoopbackEndpoint,
} from './policy';
import type {
  OllamaPreflightProcessRequest,
  OllamaPreflightProcessResult,
  OllamaPreflightProcessRunner,
} from './process-runner';
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
    killEscalated: false, downloadObserved: false, ...patch,
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
    loopbackEndpoint: 'http://127.0.0.1:11434', sandboxHome: '/sandbox/home',
    sandboxTmpdir: '/sandbox/tmp', externalEgressDenied: true, ...patch,
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
      missingRequiredModels: [], additionalModelCount: 1 });
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

  it('blocks before commands when egress containment is unavailable or executable changes', async () => {
    const noNetworkRunner = new FakeRunner([]);
    expect((await configured(noNetworkRunner, new FakeFileSystem(), { externalEgressDenied: false })).failureCode)
      .toBe(OllamaPreflightFailureCode.NETWORK_CONTAINMENT_UNAVAILABLE);
    expect(noNetworkRunner.requests).toHaveLength(0);

    const fs = new FakeFileSystem(Buffer.from('first'));
    fs.contents = [Buffer.from('first'), Buffer.from('changed')];
    fs.statValue = { kind: 'file', sizeBytes: 5, mode: 0o755 };
    const mismatchRunner = new FakeRunner([]);
    const mismatch = await configured(mismatchRunner, fs);
    expect(mismatch).toMatchObject({ status: OllamaPreflightStatus.BLOCKED,
      failureCode: OllamaPreflightFailureCode.EXECUTABLE_IDENTITY_MISMATCH, commandCount: 0 });
    expect(mismatchRunner.requests).toHaveLength(0);
  });
});
