import { describe, expect, it } from 'vitest';
import type { CliRunner } from '@chunsik/ai-cli';
import { Capability } from '@chunsik/core';
import {
  CANONICAL_RECALL_SCENARIO,
  createCanonicalRecallRequest,
  evaluateRecall,
  runComparison,
} from './provider-recall-diagnostic';

describe('provider recall diagnostic', () => {
  it('constructs the canonical GENERAL_CHAT scenario through PromptComposer and PromptRenderer', () => {
    const request = createCanonicalRecallRequest();

    expect(request.capability).toBe(Capability.GENERAL_CHAT);
    expect(request.prompt).toContain('# System\n');
    expect(request.prompt).toContain('# Developer\n');
    expect(request.prompt).toContain(CANONICAL_RECALL_SCENARIO.previousUserMessage);
    expect(request.prompt).toContain(CANONICAL_RECALL_SCENARIO.previousAssistantMessage);
    expect(request.prompt).toContain(CANONICAL_RECALL_SCENARIO.currentUserMessage);
    expect(request.prompt).toContain('[Turn 1] User:');
    expect(request.prompt).toContain('[Turn 1] Assistant:');
  });

  it('uses provider serialization, verifies prior-turn presence, and reports input size', async () => {
    const generationInputs: Array<{ args: readonly string[]; input: string }> = [];
    const runner: CliRunner = async (_bin, args, options) => {
      if (args[0] === '--version') {
        return { code: 0, stdout: 'available', stderr: '', timedOut: false };
      }
      generationInputs.push({ args, input: options.input });
      const output = args[0] === 'run' && args[1] === 'granite3.3:8b'
        ? '직전 질문을 기억하지 못해요.'
        : '직전에 안녕?이라고 질문했어요.';
      return { code: 0, stdout: output, stderr: '', timedOut: false };
    };
    let clock = 0;

    const results = await runComparison({ runner, now: () => (clock += 5) });

    expect(results).toHaveLength(3);
    expect(generationInputs).toHaveLength(3);
    expect(results.map((result) => result.providerId)).toEqual([
      'ollama-cli:llama3.1:8b',
      'ollama-cli:granite3.3:8b',
      'claude-cli',
    ]);
    for (const [index, result] of results.entries()) {
      const serializedInput = generationInputs[index]?.input ?? '';
      expect(serializedInput).toContain(CANONICAL_RECALL_SCENARIO.previousUserMessage);
      expect(serializedInput).toContain(CANONICAL_RECALL_SCENARIO.previousAssistantMessage);
      expect(result.previousTurnPresentAtProviderBoundary).toBe(true);
      expect(result.serializedInputCharacterCount).toBe(serializedInput.length);
      expect(result.serializedInputCharacterCount).toBeGreaterThan(0);
      expect(result.contextTruncationOccurred).toBe(false);
      expect(result.generationLatencyMs).toBe(5);
    }
    expect(generationInputs[0]?.input).toContain('# Role-attributed conversation');
    expect(generationInputs[1]?.input).toBe(createCanonicalRecallRequest().prompt);
    expect(generationInputs[2]?.input).toBe(createCanonicalRecallRequest().prompt);
    expect(results.map((result) => result.recallResult)).toEqual(['PASS', 'FAIL', 'PASS']);
  });

  it('includes Claude only when ClaudeCliProvider reports availability', async () => {
    const runner: CliRunner = async (_bin, args) => {
      if (args[0] === '--version') {
        return { code: 1, stdout: '', stderr: 'unavailable', timedOut: false };
      }
      return { code: 0, stdout: '안녕이 직전 질문이었어요.', stderr: '', timedOut: false };
    };

    const results = await runComparison({ runner });

    expect(results.map((result) => result.providerId)).toEqual([
      'ollama-cli:llama3.1:8b',
      'ollama-cli:granite3.3:8b',
    ]);
  });

  it('checks recall semantically by the presence of the 안녕 substring', () => {
    expect(evaluateRecall('직전에 안녕?이라고 물었어요.')).toBe('PASS');
    expect(evaluateRecall('직전 문장은 기억하지 못해요.')).toBe('FAIL');
    expect(evaluateRecall('네, 안녕하세요는 Assistant 답변이었어요.')).toBe('PASS');
  });
});
