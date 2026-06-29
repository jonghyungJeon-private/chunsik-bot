import { describe, expect, it } from 'vitest';
import { ArtifactKind, Capability } from '@chunsik/core';
import type { PromptSpec } from '@chunsik/core';
import { ClaudeCliProvider } from './index';
import type { CliRunOptions, CliRunner, CliRunResult } from './cli-runner';

const spec: PromptSpec = { system: 'SYS', developer: 'DEV', context: '', task: 'do the thing' };

function recordingRunner(result: CliRunResult): { runner: CliRunner; calls: Array<{ bin: string; args: string[]; opts: CliRunOptions }> } {
  const calls: Array<{ bin: string; args: string[]; opts: CliRunOptions }> = [];
  const runner: CliRunner = async (bin, args, opts) => {
    calls.push({ bin, args, opts });
    return result;
  };
  return { runner, calls };
}

describe('ClaudeCliProvider command construction', () => {
  it('runs `claude -p` with the prompt on stdin in a neutral cwd; returns a MARKDOWN_REPORT artifact', async () => {
    const { runner, calls } = recordingRunner({ code: 0, stdout: '  hello world  ', stderr: '', timedOut: false });
    const provider = new ClaudeCliProvider('claude', { runner });

    const result = await provider.execute({ capability: Capability.GENERAL_CHAT, promptSpec: spec });

    expect(calls[0]?.bin).toBe('claude');
    expect(calls[0]?.args).toEqual(['-p']);
    expect(calls[0]?.opts.input).toContain('SYS');
    expect(calls[0]?.opts.input).toContain('do the thing');
    expect(calls[0]?.opts.cwd).toBeTruthy();
    expect(result.text).toBe('hello world');
    expect(result.artifacts?.[0]?.kind).toBe(ArtifactKind.MARKDOWN_REPORT);
  });

  it('throws on non-zero exit (→ TaskRun FAILED upstream)', async () => {
    const { runner } = recordingRunner({ code: 1, stdout: '', stderr: 'boom', timedOut: false });
    const provider = new ClaudeCliProvider('claude', { runner });
    await expect(provider.execute({ capability: Capability.GENERAL_CHAT, promptSpec: spec })).rejects.toThrow(/exited/);
  });

  it('throws on timeout', async () => {
    const { runner } = recordingRunner({ code: null, stdout: '', stderr: '', timedOut: true });
    const provider = new ClaudeCliProvider('claude', { runner });
    await expect(provider.execute({ capability: Capability.GENERAL_CHAT, promptSpec: spec })).rejects.toThrow(/timed out/);
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
