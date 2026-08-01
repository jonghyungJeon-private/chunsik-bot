import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  LEGACY_DEFAULT_CONFIGURATION_PATH,
  PRODUCTION_18GB_CONFIGURATION_PATH,
} from './provider-benchmark-config';
import { readExecutionEvidence, runBenchmarkCli } from './provider-benchmark-cli';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'provider-benchmark-cli-test-'));
afterAll(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

describe('provider benchmark CLI', () => {
  it('uses the legacy default when config is omitted', () => {
    expect(runBenchmarkCli(['--mode', 'plan-stage-a1'])).toMatchObject({
      mode: 'plan-stage-a1',
      status: 'PASS',
      providerExecuted: false,
      configurationSource: 'LEGACY_DEFAULT',
      expectedModels: expect.arrayContaining(['llama3.1:8b', 'deepseek-r1:14b']),
      budget: {
        configurations: 10,
        executions: 60,
        generationCalls: 280,
        versionCalls: 60,
        inventoryCalls: 60,
        childCalls: 400,
      },
      campaignFingerprint: null,
      configurationIdentity: expect.stringMatching(/^[0-9a-f]{64}$/),
      campaignComplete: false,
      provisional: true,
      decisionPolicyVersion: 'stage2a-provider-decision-v2.1',
    });
  });

  it('produces the approved production 4-model budget from an explicit config', () => {
    expect(
      runBenchmarkCli([
        '--mode',
        'plan-stage-a1',
        '--config',
        PRODUCTION_18GB_CONFIGURATION_PATH,
      ]),
    ).toMatchObject({
      configurationSource: 'EXPLICIT_FILE',
      expectedModels: ['granite3.3:8b', 'llama3.1:8b', 'llama3.2:3b', 'mistral:7b'],
      budget: {
        configurations: 4,
        executions: 24,
        generationCalls: 112,
        versionCalls: 24,
        inventoryCalls: 24,
        childCalls: 160,
      },
    });
  });

  it('keeps an explicit legacy config equivalent to the omitted default plan', () => {
    const implicit = runBenchmarkCli(['--mode', 'plan-stage-a1']) as Record<string, unknown>;
    const explicit = runBenchmarkCli([
      '--mode',
      'plan-stage-a1',
      '--config',
      LEGACY_DEFAULT_CONFIGURATION_PATH,
    ]) as Record<string, unknown>;
    expect(explicit.configurationSource).toBe('EXPLICIT_FILE');
    expect(explicit.configurationDigest).toBe(implicit.configurationDigest);
    expect(explicit.expectedModels).toEqual(implicit.expectedModels);
    expect(explicit.budget).toEqual(implicit.budget);
  });

  it('keeps existing raw evidence readable and unidentified', () => {
    const path = join(temporaryDirectory, 'legacy.json');
    writeFileSync(
      path,
      JSON.stringify({
        records: [
          {
            scenarioId: 'E',
            callOrdinal: 1,
            head: 'a'.repeat(40),
            providerId: 'ollama-cli',
            model: 'llama3.1:8b',
            promptBytes: 10,
            promptSha256: 'b'.repeat(64),
            responseBytes: 10,
            responseSha256: 'c'.repeat(64),
            previewTruncated: false,
            durationMs: 10,
            exitCode: 0,
            checks: [],
            automatedVerdict: 'HUMAN_REVIEW_REQUIRED',
            humanVerdict: 'PENDING',
            promptLeakDetected: false,
            leakCategory: null,
          },
        ],
      }),
    );
    expect(readExecutionEvidence(path)).toMatchObject({
      campaignFingerprint: null,
      records: [{ model: 'llama3.1:8b' }],
    });
  });

  it('fails closed for relative configs and incomplete summary options', () => {
    expect(() =>
      runBenchmarkCli(['--mode', 'plan-stage-a1', '--config', 'relative.json']),
    ).toThrowError('CONFIG_PATH_NOT_ABSOLUTE');
    expect(() => runBenchmarkCli(['--mode', 'summarize', '--phase', 'A1'])).toThrowError(
      'MISSING_OR_INVALID_SUMMARY_OPTION',
    );
  });
});
