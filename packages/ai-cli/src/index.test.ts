import { describe, expect, it } from 'vitest';
import { AiFailureKind, AiProviderError, ArtifactKind, Capability, NotImplementedError } from '@chunsik/core';
import { ClaudeCliProvider, CodexCliProvider, maskSecrets } from './index';
import type { CliRunOptions, CliRunner, CliRunResult } from './cli-runner';

const PROMPT = 'do the thing';

const runnerOf = (r: CliRunResult): CliRunner => async () => r;
const exec = (r: CliRunResult) =>
  new ClaudeCliProvider('claude', { runner: runnerOf(r) }).execute({
    capability: Capability.GENERAL_CHAT,
    prompt: PROMPT,
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
      prompt: PROMPT,
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

describe('CodexCliProvider (CAP-008, ADR-0029) — suggest-only contract not yet satisfiable', () => {
  // The Codex CLI has no deterministic suggest-only / no-tool / no-exec mode, so the
  // adapter must NOT run an agentic `codex exec` (CAP-008 review, MB-1). execute() stays
  // NotImplemented and the provider is treated as unavailable — never auto-applying,
  // never bypassing Workspace via a workspace cwd.
  it('advertises code capabilities but does NOT implement execute() (no agentic run)', async () => {
    const codex = new CodexCliProvider('codex');
    expect(codex.id).toBe('codex-cli');
    expect(codex.capabilities.some((c) => c.capability === Capability.CODE_IMPLEMENTATION)).toBe(true);
    await expect(
      codex.execute({ capability: Capability.CODE_IMPLEMENTATION, prompt: PROMPT }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('is treated as unavailable (isAvailable is not implemented → never selected)', async () => {
    await expect(new CodexCliProvider('codex').isAvailable()).rejects.toBeInstanceOf(NotImplementedError);
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
