import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { AiFailureKind, AiProviderError, ArtifactKind, Capability, NotImplementedError } from '@chunsik/core';
import { ClaudeCliProvider, CodexCliProvider, OllamaCliProvider, maskSecrets } from './index';
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

describe('OllamaCliProvider (CAP-009, ADR-0030) — suggest-only local code generation', () => {
  const ollamaExec = (r: CliRunResult) =>
    new OllamaCliProvider({ runner: runnerOf(r) }).execute({
      capability: Capability.CODE_IMPLEMENTATION,
      prompt: PROMPT,
    });

  it('success → `ollama run <model>` with prompt on stdin (neutral cwd) and a MARKDOWN_REPORT artifact', async () => {
    const calls: Array<{ bin: string; args: string[]; opts: CliRunOptions }> = [];
    const runner: CliRunner = async (bin, args, opts) => {
      calls.push({ bin, args, opts });
      return { code: 0, stdout: '  proposed change  ', stderr: '', timedOut: false };
    };
    const res = await new OllamaCliProvider({ runner }).execute({
      capability: Capability.CODE_IMPLEMENTATION,
      prompt: PROMPT,
    });
    expect(calls[0]?.bin).toBe('ollama');
    // Exactly `run <model>` — no agent/exec/auto-apply flag (suggest-only).
    expect(calls[0]?.args).toEqual(['run', 'llama3.1']);
    expect(calls[0]?.opts.input).toContain('do the thing'); // prompt via stdin, not argv
    expect(calls[0]?.opts.cwd).toBe(tmpdir()); // neutral cwd
    expect(res.text).toBe('proposed change');
    expect(res.artifacts?.[0]?.kind).toBe(ArtifactKind.MARKDOWN_REPORT);
  });

  it('honors a custom model in argv: `ollama run <model>`', async () => {
    const calls: Array<{ args: string[] }> = [];
    const runner: CliRunner = async (_bin, args) => {
      calls.push({ args });
      return { code: 0, stdout: 'ok', stderr: '', timedOut: false };
    };
    await new OllamaCliProvider({ model: 'codellama', runner }).execute({
      capability: Capability.CODE_IMPLEMENTATION,
      prompt: PROMPT,
    });
    expect(calls[0]?.args).toEqual(['run', 'codellama']);
  });

  it('always runs in a neutral cwd — a workspace on the request is ignored (suggest-only)', async () => {
    const calls: Array<{ opts: CliRunOptions }> = [];
    const runner: CliRunner = async (_bin, _args, opts) => {
      calls.push({ opts });
      return { code: 0, stdout: 'ok', stderr: '', timedOut: false };
    };
    await new OllamaCliProvider({ runner }).execute({
      capability: Capability.CODE_IMPLEMENTATION,
      prompt: PROMPT,
      workspace: { id: 'w1', rootPath: '/repo/should-not-be-used', kind: 'local-clone' },
    });
    expect(calls[0]?.opts.cwd).toBe(tmpdir());
    expect(calls[0]?.opts.cwd).not.toBe('/repo/should-not-be-used');
  });

  it('timeout → AiProviderError(TIMEOUT)', async () => {
    await expect(ollamaExec({ code: null, stdout: '', stderr: '', timedOut: true })).rejects.toMatchObject({
      kind: AiFailureKind.TIMEOUT,
    });
  });

  it('spawn failure (code null) → UNAVAILABLE (ollama not installed / cannot run)', async () => {
    await expect(
      ollamaExec({ code: null, stdout: '', stderr: 'spawn ollama ENOENT', timedOut: false }),
    ).rejects.toMatchObject({ kind: AiFailureKind.UNAVAILABLE });
  });

  it('non-zero exit → EXECUTION_FAILED (no AUTH path; ollama is local/auth-free)', async () => {
    await expect(
      ollamaExec({ code: 1, stdout: '', stderr: "Error: model 'x' not found", timedOut: false }),
    ).rejects.toMatchObject({ kind: AiFailureKind.EXECUTION_FAILED });
  });

  it('empty stdout on success → EMPTY_OUTPUT', async () => {
    await expect(ollamaExec({ code: 0, stdout: '   ', stderr: '', timedOut: false })).rejects.toMatchObject({
      kind: AiFailureKind.EMPTY_OUTPUT,
    });
  });

  it('failures are AiProviderError instances', async () => {
    await expect(ollamaExec({ code: 1, stdout: '', stderr: 'x', timedOut: false })).rejects.toBeInstanceOf(
      AiProviderError,
    );
  });

  it('isAvailable is true when `--version` exits 0, false otherwise', async () => {
    const up: CliRunner = async (_bin, args) => ({
      code: args[0] === '--version' ? 0 : 1,
      stdout: '',
      stderr: '',
      timedOut: false,
    });
    const down: CliRunner = async () => ({ code: 1, stdout: '', stderr: 'no', timedOut: false });
    expect(await new OllamaCliProvider({ runner: up }).isAvailable()).toBe(true);
    expect(await new OllamaCliProvider({ runner: down }).isAvailable()).toBe(false);
  });

  it('advertises CODE_IMPLEMENTATION at priority 40 (below Claude 50 — a fallback for code)', () => {
    const ollama = new OllamaCliProvider();
    expect(ollama.id).toBe('ollama-cli');
    const code = ollama.capabilities.find((c) => c.capability === Capability.CODE_IMPLEMENTATION);
    expect(code?.priority).toBe(40);
    const claudeCode = new ClaudeCliProvider('claude').capabilities.find(
      (c) => c.capability === Capability.CODE_IMPLEMENTATION,
    );
    expect(code?.priority).toBeLessThan(claudeCode?.priority ?? 0);
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
