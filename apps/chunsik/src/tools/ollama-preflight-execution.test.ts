import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  ExternalEgressControl,
  OllamaPreflightFailureCode,
  OllamaPreflightStatus,
} from '../provider-routing/ollama-preflight/contracts';
import type {
  OllamaPreflightFileSystem,
  PreflightFileStat,
} from '../provider-routing/ollama-preflight/executable-identity';
import {
  NodeOllamaPreflightFileSystem,
  executeOllamaPreflightInvocation,
  parseOllamaPreflightInvocation,
} from './ollama-preflight-execution';

const binary = Buffer.from('binary');
const sha256 = createHash('sha256').update(binary).digest('hex');

const invocation = (
  control: ExternalEgressControl = ExternalEgressControl.CONFIG_RESTRICTED_RISK_ACCEPTED,
): string[] => [
  '--executable-realpath', '/approved/ollama',
  '--expected-executable-sha256', sha256,
  '--expected-executable-size-bytes', String(binary.byteLength),
  '--approved-loopback-endpoint', 'http://127.0.0.1:11434',
  '--external-egress-control', control,
];

class FakeFileSystem implements OllamaPreflightFileSystem {
  reads = 0;
  realpath(path: string): string { return path; }
  stat(): PreflightFileStat { return { kind: 'file', sizeBytes: binary.byteLength, mode: 0o755 }; }
  *readChunks(): Iterable<Uint8Array> { this.reads += 1; yield binary; }
}

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  kill(): boolean { return true; }
}

function fakeSpawn(
  versionExitCode = 0,
  captures: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = [],
) {
  return (command: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
    captures.push({ command, args, options });
    const child = new FakeChild();
    queueMicrotask(() => {
      if (args[0] === '--version') {
        if (versionExitCode === 0) child.stdout.write('ollama version 1.2.3');
        child.emit('close', versionExitCode);
      } else {
        child.stdout.write(
          'NAME ID SIZE MODIFIED\nllama3.1:8b a 1 now\ngranite3.3:8b b 1 now',
        );
        child.emit('close', 0);
      }
    });
    return child as unknown as ChildProcess;
  };
}

describe('Ollama preflight strict invocation parser', () => {
  it('accepts only explicit bounded inputs and performs no PATH lookup', () => {
    expect(parseOllamaPreflightInvocation(invocation())).toEqual({
      executableRealpath: '/approved/ollama',
      expectedExecutableSha256: sha256,
      expectedExecutableSizeBytes: binary.byteLength,
      approvedLoopbackEndpoint: 'http://127.0.0.1:11434',
      externalEgressControl: ExternalEgressControl.CONFIG_RESTRICTED_RISK_ACCEPTED,
    });
  });

  it.each([
    ['relative executable', invocation().map((value) => value === '/approved/ollama' ? 'ollama' : value)],
    ['malformed digest', invocation().map((value) => value === sha256 ? 'ABC' : value)],
    ['zero size', invocation().map((value) => value === String(binary.byteLength) ? '0' : value)],
    ['remote endpoint', invocation().map((value) => value === 'http://127.0.0.1:11434' ? 'http://example.com:11434' : value)],
    ['unknown control', invocation().map((value) => value === ExternalEgressControl.CONFIG_RESTRICTED_RISK_ACCEPTED ? 'UNVERIFIED' : value)],
    ['unknown flag', [...invocation(), '--extra', 'value']],
    ['duplicate flag', [...invocation(), '--approved-loopback-endpoint', 'http://localhost:11434']],
    ['missing flag', invocation().slice(0, -2)],
    ['implicit endpoint', invocation().filter((_, index) => index !== 6 && index !== 7)],
  ])('rejects %s before composition', (_label, argv) => {
    expect(() => parseOllamaPreflightInvocation(argv)).toThrow(/INVALID_INVOCATION/);
  });
});

describe('Ollama preflight execution composition', () => {
  it('wires fake filesystem, sandbox, spawn, exact request, and one bounded PASS projection', async () => {
    const fileSystem = new FakeFileSystem();
    const captures: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = [];
    const writes: string[] = [];
    let cleanupCount = 0;
    const outcome = await executeOllamaPreflightInvocation(invocation(), {
      fileSystem,
      spawnAdapter: fakeSpawn(0, captures),
      sandboxFactory: () => ({
        home: '/sandbox/home', tmpdir: '/sandbox/tmp', cleanup: () => { cleanupCount += 1; },
      }),
      writeProjection: (projection) => writes.push(projection),
    });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.projection).toMatchObject({
      status: OllamaPreflightStatus.PASS,
      externalEgressControl: ExternalEgressControl.CONFIG_RESTRICTED_RISK_ACCEPTED,
      externalEgressIsolationVerified: false,
      networkClass: 'LOOPBACK_DAEMON',
      providerExecutionCount: 0,
      downloadCapableCommandInvoked: false,
      commandCount: 2,
    });
    expect(captures.map(({ command, args }) => [command, ...args])).toEqual([
      ['/approved/ollama', '--version'], ['/approved/ollama', 'list'],
    ]);
    expect(captures.every(({ options }) => options.shell === false)).toBe(true);
    expect(captures.every(({ options }) => Object.keys(options.env ?? {}).length === 8)).toBe(true);
    expect(fileSystem.reads).toBe(2);
    expect(cleanupCount).toBe(2);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0] as string)).toEqual(outcome.projection);
    expect(writes[0]).not.toContain('/approved/ollama');
    expect(writes[0]).not.toContain('/sandbox/');
    expect(writes[0]).not.toContain('NAME ID SIZE MODIFIED');
    expect(writes[0]).not.toContain('HOME');
  });

  it('maps FAIL and BLOCKED without raw errors or process execution outside injected fakes', async () => {
    const failWrites: string[] = [];
    const failed = await executeOllamaPreflightInvocation(invocation(), {
      fileSystem: new FakeFileSystem(),
      spawnAdapter: fakeSpawn(1),
      sandboxFactory: () => ({ home: '/h', tmpdir: '/t', cleanup: () => undefined }),
      writeProjection: (projection) => failWrites.push(projection),
    });
    expect(failed).toMatchObject({ exitCode: 2, projection: {
      status: OllamaPreflightStatus.FAIL,
      failureCode: OllamaPreflightFailureCode.VERSION_CHECK_FAILED,
    } });

    let spawnCount = 0;
    const blocked = await executeOllamaPreflightInvocation(
      invocation(ExternalEgressControl.OS_DENIED_VERIFIED),
      {
        fileSystem: new FakeFileSystem(),
        spawnAdapter: (...args) => { spawnCount += 1; return fakeSpawn()(...args); },
        sandboxFactory: () => ({ home: '/h', tmpdir: '/t', cleanup: () => undefined }),
        verifyOsDenied: () => false,
        writeProjection: () => undefined,
      },
    );
    expect(blocked).toMatchObject({ exitCode: 3, projection: {
      status: OllamaPreflightStatus.BLOCKED,
      failureCode: OllamaPreflightFailureCode.NETWORK_CONTAINMENT_UNAVAILABLE,
      externalEgressControl: null,
      externalEgressIsolationVerified: false,
      networkClass: null,
    } });
    expect(spawnCount).toBe(0);
  });

  it('projects OS denial as verified only when the independent verifier succeeds', async () => {
    const outcome = await executeOllamaPreflightInvocation(
      invocation(ExternalEgressControl.OS_DENIED_VERIFIED),
      {
        fileSystem: new FakeFileSystem(),
        spawnAdapter: fakeSpawn(),
        sandboxFactory: () => ({ home: '/h', tmpdir: '/t', cleanup: () => undefined }),
        verifyOsDenied: () => true,
        writeProjection: () => undefined,
      },
    );
    expect(outcome).toMatchObject({ exitCode: 0, projection: {
      externalEgressControl: ExternalEgressControl.OS_DENIED_VERIFIED,
      externalEgressIsolationVerified: true,
      networkClass: 'LOOPBACK_DAEMON',
    } });
  });

  it('maps entrypoint configuration errors to one bounded projection and exit 4', async () => {
    let adapterAccess = 0;
    const writes: string[] = [];
    const outcome = await executeOllamaPreflightInvocation(['--unknown', 'value'], {
      fileSystem: {
        realpath: () => { adapterAccess += 1; throw new Error('raw path'); },
        stat: () => { throw new Error('raw stat'); },
        readChunks: () => [],
      },
      writeProjection: (projection) => writes.push(projection),
    });
    expect(outcome).toMatchObject({ exitCode: 4, projection: {
      status: 'ENTRYPOINT_CONFIGURATION_ERROR', failureCode: 'INVALID_INVOCATION',
      commandCount: 0,
    } });
    expect(adapterAccess).toBe(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toContain('raw');
  });

  it('keeps real adapters app-private and leaves app.module unwired', () => {
    const adapter = new NodeOllamaPreflightFileSystem();
    expect(typeof adapter.realpath).toBe('function');
    expect(typeof adapter.stat).toBe('function');
    expect(typeof adapter.readChunks).toBe('function');
    const appModule = readFileSync(resolve(__dirname, '../app.module.ts'), 'utf8');
    expect(appModule).not.toContain('ollama-preflight-execution');
    expect(appModule).not.toContain('OllamaInventoryPreflight');
  });
});
