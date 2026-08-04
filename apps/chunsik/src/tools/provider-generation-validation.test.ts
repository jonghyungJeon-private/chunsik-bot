import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OllamaCliProvider } from '@chunsik/ai-cli';
import type { AiProvider, AiRequest } from '@chunsik/core';
import { ExternalEgressControl } from '../provider-routing/ollama-preflight/contracts';
import {
  EXPECTED_VALIDATION_OUTPUT,
  ModelAcquisitionControl,
  VALIDATION_ADAPTER_ID,
  VALIDATION_MODEL_ID,
  VALIDATION_PROMPT,
  VALIDATION_PROMPT_DIGEST,
  VALIDATION_PROVIDER_ID,
  executeProviderGenerationValidation,
  validationPromptDigest,
} from './provider-generation-validation';
import type {
  GenerationInventorySnapshot,
  ProviderGenerationValidationDependencies,
  ProviderGenerationValidationInput,
} from './provider-generation-validation';

const input = (
  control: ModelAcquisitionControl =
    ModelAcquisitionControl.PRECHECK_OBSERVE_POSTCHECK_RISK_ACCEPTED,
): ProviderGenerationValidationInput => ({
  executableRealpath: '/approved/ollama',
  approvedLoopbackEndpoint: 'http://127.0.0.1:11434',
  modelAcquisitionControl: control,
});

const snapshot = (overrides: Partial<GenerationInventorySnapshot> = {}): GenerationInventorySnapshot => ({
  passed: true,
  requiredModelPresent: true,
  inventoryFingerprint: 'a'.repeat(64),
  externalEgressControl: ExternalEgressControl.CONFIG_RESTRICTED_RISK_ACCEPTED,
  externalEgressIsolationVerified: false,
  networkClass: 'LOOPBACK_DAEMON',
  ...overrides,
});

function dependencies(
  outputs: readonly GenerationInventorySnapshot[] = [snapshot(), snapshot()],
  response = EXPECTED_VALIDATION_OUTPUT,
): ProviderGenerationValidationDependencies & { readonly phases: string[]; readonly calls: { value: number } } {
  const phases: string[] = [];
  const calls = { value: 0 };
  return {
    phases,
    calls,
    runPreflight: async (phase) => {
      phases.push(phase);
      return outputs[phases.length - 1] as GenerationInventorySnapshot;
    },
    generationRunner: async (bin, args, options) => {
      calls.value += 1;
      expect(bin).toBe('/approved/ollama');
      expect(args).toEqual(['run', 'llama3.1:8b']);
      expect(options).toMatchObject({
        input: VALIDATION_PROMPT,
        timeoutMs: 45_000,
        environmentProfile: 'ISOLATED_OLLAMA_VALIDATION',
        downloadMarkerPolicy: 'OLLAMA_PULL',
        env: {
          OLLAMA_HOST: 'http://127.0.0.1:11434', OLLAMA_NO_CLOUD: '1',
          NO_COLOR: '1', CLICOLOR: '0', CLICOLOR_FORCE: '0',
        },
      });
      return { code: 0, stdout: response, stderr: '', timedOut: false, downloadObserved: false };
    },
  };
}

describe('Stage 2B primary-only Provider generation validation', () => {
  it('uses the exact prompt contract and the real primary-only routing chain once', async () => {
    const deps = dependencies();
    const result = await executeProviderGenerationValidation(input(), deps);

    expect(Buffer.byteLength(VALIDATION_PROMPT, 'utf8')).toBe(74);
    expect(validationPromptDigest()).toBe(VALIDATION_PROMPT_DIGEST);
    expect(result).toMatchObject({
      status: 'PASS', failureCode: null, selectedProviderId: VALIDATION_PROVIDER_ID,
      selectedAdapterId: VALIDATION_ADAPTER_ID, selectedModelId: VALIDATION_MODEL_ID,
      planAttemptCount: 1, providerExecutionCount: 1, retryCount: 0,
      fallbackCount: 0, escalationCount: 0, normalizedOutput: EXPECTED_VALIDATION_OUTPUT,
      expectedOutputMatched: true, modelDownloadPreventionVerified: false,
      downloadCapableCommandInvoked: true, downloadObserved: false,
      preflightPassed: true, postflightPassed: true, inventoryUnchanged: true,
    });
    expect(deps.calls.value).toBe(1);
    expect(deps.phases).toEqual(['PRE', 'POST']);
  });

  it.each([
    ['missing model', snapshot({ requiredModelPresent: false }), 'MODEL_NOT_AVAILABLE'],
    ['failed preflight', snapshot({ passed: false }), 'PRE_GENERATION_PREFLIGHT_FAILED'],
    ['unfingerprinted inventory', snapshot({ inventoryFingerprint: null }), 'PRE_GENERATION_PREFLIGHT_FAILED'],
  ])('blocks %s before Provider execution', async (_label, preflight, code) => {
    const deps = dependencies([preflight]);
    const result = await executeProviderGenerationValidation(input(), deps);
    expect(result).toMatchObject({ status: 'BLOCKED', failureCode: code, providerExecutionCount: 0 });
    expect(deps.calls.value).toBe(0);
  });

  it('blocks invalid binding identity before Provider execution', async () => {
    const deps = dependencies();
    const result = await executeProviderGenerationValidation(input(), {
      ...deps,
      providerFactory: () => new (class implements AiProvider {
        readonly id = 'ollama-cli:wrong';
        readonly capabilities = [];
        async isAvailable(): Promise<boolean> { return true; }
        async execute(_request: AiRequest) { return { text: EXPECTED_VALIDATION_OUTPUT }; }
      })(),
    });
    expect(result).toMatchObject({
      status: 'BLOCKED', failureCode: 'PROVIDER_BINDING_MISMATCH', providerExecutionCount: 0,
    });
    expect(deps.calls.value).toBe(0);
  });

  it.each([
    ['http://example.com:11434', 'remote'],
    ['http://localhost:11434', 'implicit alias'],
    ['', 'missing'],
  ])('rejects %s host before preflight', async (host) => {
    const deps = dependencies();
    const result = await executeProviderGenerationValidation(
      { ...input(), approvedLoopbackEndpoint: host }, deps,
    );
    expect(result).toMatchObject({ status: 'BLOCKED', providerExecutionCount: 0 });
    expect(deps.phases).toEqual([]);
  });

  it('requires a successful independent verifier for denied-verified mode', async () => {
    for (const verifyModelAcquisitionDenied of [() => false, () => { throw new Error('raw'); }]) {
      const deps = dependencies();
      const result = await executeProviderGenerationValidation(
        input(ModelAcquisitionControl.DENIED_VERIFIED),
        { ...deps, verifyModelAcquisitionDenied },
      );
      expect(result).toMatchObject({
        status: 'BLOCKED', failureCode: 'MODEL_DOWNLOAD_RISK_UNCONTROLLED',
        modelDownloadPreventionVerified: false, providerExecutionCount: 0,
      });
    }
  });

  it('prioritizes download observation over an expected output and hides raw markers', async () => {
    const deps = dependencies();
    const result = await executeProviderGenerationValidation(input(), {
      ...deps,
      generationRunner: async () => ({
        code: 0, stdout: EXPECTED_VALIDATION_OUTPUT, stderr: 'pulling manifest raw',
        timedOut: false, downloadObserved: true,
      }),
    });
    expect(result).toMatchObject({
      status: 'FAIL', failureCode: 'MODEL_DOWNLOAD_DETECTED', downloadObserved: true,
      providerExecutionCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain('pulling manifest raw');
  });

  it('fails changed/postflight inventory without retry or fallback', async () => {
    const changed = snapshot({ inventoryFingerprint: 'b'.repeat(64) });
    const deps = dependencies([snapshot(), changed]);
    const result = await executeProviderGenerationValidation(input(), deps);
    expect(result).toMatchObject({
      status: 'FAIL', failureCode: 'INVENTORY_CHANGED', inventoryUnchanged: false,
      providerExecutionCount: 1, retryCount: 0, fallbackCount: 0, escalationCount: 0,
    });
  });

  it.each([
    [` ${EXPECTED_VALIDATION_OUTPUT}\n`, 'PASS', null],
    [EXPECTED_VALIDATION_OUTPUT.toLowerCase(), 'FAIL', 'EXPECTED_OUTPUT_MISMATCH'],
    [`${EXPECTED_VALIDATION_OUTPUT}.`, 'FAIL', 'EXPECTED_OUTPUT_MISMATCH'],
    ['x'.repeat(129), 'FAIL', 'OUTPUT_OVERFLOW'],
  ])('applies only whitespace normalization to bounded output', async (response, status, failureCode) => {
    const result = await executeProviderGenerationValidation(input(), dependencies(undefined, response));
    expect(result).toMatchObject({ status, failureCode });
  });

  it('keeps the projection bounded and the validation tool unwired', async () => {
    const result = await executeProviderGenerationValidation(input(), dependencies());
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      VALIDATION_PROMPT, '/approved/ollama', 'HOME', 'TMPDIR', 'OLLAMA_HOST',
      'pulling manifest', 'raw stdout', 'raw stderr', 'NAME ID SIZE MODIFIED',
    ]) expect(serialized).not.toContain(forbidden);
    const appModule = readFileSync(resolve(__dirname, '../app.module.ts'), 'utf8');
    expect(appModule).not.toContain('provider-generation-validation');
  });
});
