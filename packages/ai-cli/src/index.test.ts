import { describe, expect, it } from 'vitest';
import { AiFailureKind, AiProviderError, ArtifactKind, Capability } from '@chunsik/core';
import type { PromptSpec } from '@chunsik/core';
import { ClaudeCliProvider, maskSecrets } from './index';
import type { CliRunOptions, CliRunner, CliRunResult } from './cli-runner';

const spec: PromptSpec = { system: 'SYS', developer: 'DEV', context: '', task: 'do the thing' };

const runnerOf = (r: CliRunResult): CliRunner => async () => r;
const exec = (r: CliRunResult) =>
  new ClaudeCliProvider('claude', { runner: runnerOf(r) }).execute({
    capability: Capability.GENERAL_CHAT,
    promptSpec: spec,
  });

describe('ClaudeCliProvider', () => {
  it('success → runs `claude -p` with prompt on stdin (neutral cwd) and returns a MARKDOWN_REPORT artifact', async () => {
    const calls: Array<{ bin: string; args: string[]; opts: CliRunOptions }> = [];
    const runner: CliRunner = async (bin, args, opts) => {
      calls.push({ bin, args, opts });
      return { code: 0, stdout: '  hi there  ', stderr: '', timedOut: false };
    };
    const res = await new ClaudeCliProvider('claude', { runner }).execute({
      capability: Capability.GENERAL_CHAT,
      promptSpec: spec,
    });
    expect(calls[0]?.bin).toBe('claude');
    expect(calls[0]?.args).toEqual(['-p']);
    expect(calls[0]?.opts.input).toContain('do the thing');
    expect(calls[0]?.opts.cwd).toBeTruthy();
    expect(res.text).toBe('hi there');
    expect(res.artifacts?.[0]?.kind).toBe(ArtifactKind.MARKDOWN_REPORT);
  });

  it('timeout → AiProviderError(TIMEOUT)', async () => {
    await expect(exec({ code: null, stdout: '', stderr: '', timedOut: true })).rejects.toMatchObject({
      kind: AiFailureKind.TIMEOUT,
    });
  });

  it('spawn failure (code null) → UNAVAILABLE', async () => {
    await expect(
      exec({ code: null, stdout: '', stderr: 'spawn claude ENOENT', timedOut: false }),
    ).rejects.toMatchObject({ kind: AiFailureKind.UNAVAILABLE });
  });

  it('auth stderr → AUTH_REQUIRED', async () => {
    await expect(
      exec({ code: 1, stdout: '', stderr: 'Error: Not logged in. Please run claude login', timedOut: false }),
    ).rejects.toMatchObject({ kind: AiFailureKind.AUTH_REQUIRED });
  });

  it('other non-zero exit → EXECUTION_FAILED', async () => {
    await expect(
      exec({ code: 2, stdout: '', stderr: 'segfault', timedOut: false }),
    ).rejects.toMatchObject({ kind: AiFailureKind.EXECUTION_FAILED });
  });

  it('empty stdout on success → EMPTY_OUTPUT', async () => {
    await expect(exec({ code: 0, stdout: '   ', stderr: '', timedOut: false })).rejects.toMatchObject({
      kind: AiFailureKind.EMPTY_OUTPUT,
    });
  });

  it('failures are AiProviderError instances', async () => {
    await expect(exec({ code: 1, stdout: '', stderr: 'x', timedOut: false })).rejects.toBeInstanceOf(
      AiProviderError,
    );
  });

  it('isAvailable is true when `--version` exits 0', async () => {
    const runner: CliRunner = async (_bin, args) => ({
      code: args[0] === '--version' ? 0 : 1,
      stdout: '',
      stderr: '',
      timedOut: false,
    });
    expect(await new ClaudeCliProvider('claude', { runner }).isAvailable()).toBe(true);
  });
});

describe('maskSecrets', () => {
  it('redacts token-shaped substrings', () => {
    // Assemble a fake token-shaped string from parts so no secret literal exists
    // in source (avoids triggering secret-scanning push protection).
    const fakeToken = ['A'.repeat(24), 'B'.repeat(6), 'C'.repeat(30)].join('.');
    const masked = maskSecrets(`tok ${fakeToken} end`);
    expect(masked).toContain('***redacted***');
    expect(masked).not.toContain(fakeToken);
  });
});
