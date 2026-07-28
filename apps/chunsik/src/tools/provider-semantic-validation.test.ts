import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL,
  FIXTURE_VERSION,
  GENERATION_TIMEOUT_MS,
  HarnessBlockedError,
  MAX_CAPTURE_BYTES,
  MAX_PREVIEW_BYTES,
  PROMPT_CONTRACT_VERSION,
  ProviderSemanticHarness,
  SEMANTIC_SCENARIOS,
  buildAllowlistedEnvironment,
  computeRevisionBinding,
  detectPromptLeak,
  evaluateScenario,
  makeEvidenceRecord,
  renderScenario,
  toCliRunner,
  validateFixtures,
} from './provider-semantic-validation';
import type {
  HarnessConfig,
  ProcessAdapter,
  ProcessRequest,
  ProcessResult,
  RevisionInspector,
  RevisionState,
  ScenarioId,
} from './provider-semantic-validation';

const repoRoot = resolve(__dirname, '../../../..');
const state: RevisionState = {
  branch: 'main',
  head: 'a'.repeat(40),
  originMain: 'a'.repeat(40),
  trackedClean: true,
};

class StaticInspector implements RevisionInspector {
  constructor(private readonly value: RevisionState = state) {}
  inspect(): RevisionState {
    return this.value;
  }
}

const result = (
  overrides: Partial<ProcessResult> = {},
): ProcessResult => ({
  code: 0,
  stdout: '',
  stderr: '',
  timedOut: false,
  outputLimited: false,
  durationMs: 1,
  ...overrides,
});

class QueueAdapter implements ProcessAdapter {
  readonly requests: ProcessRequest[] = [];
  constructor(private readonly results: ProcessResult[]) {}
  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request);
    const next = this.results.shift();
    if (!next) throw new Error('No fake process result');
    return next;
  }
}

const binding = (): string =>
  computeRevisionBinding(state, repoRoot).binding;

const config = (overrides: Partial<HarnessConfig> = {}): HarnessConfig => ({
  repoRoot,
  bin: 'ollama',
  model: DEFAULT_MODEL,
  expectedHead: state.head,
  expectedBinding: binding(),
  calls: 1,
  parentEnv: {
    PATH: '/usr/local/bin:/usr/bin',
    HOME: '/tmp/synthetic-home',
    LANG: 'C',
    DISCORD_BOT_TOKEN: 'must-not-pass',
    API_KEY: 'must-not-pass',
  },
  ...overrides,
});

const passingResponse: Record<ScenarioId, string> = {
  A: 'I do not have a verified current status. Which external system do you mean?',
  B: 'I do not have authoritative current evidence, so I cannot verify its status.',
  C: 'The release checklist name is Blue Lantern.',
  D: 'This request was received through semantic-validation.',
  E: 'Service Atlas is the target, but its current connection status is not provided.',
};

describe('Stage 2A provider semantic validation fixtures', () => {
  it('keeps Scenario A-E isolated and structurally valid', () => {
    const validation = validateFixtures();
    expect(validation.fixtureVersion).toBe(FIXTURE_VERSION);
    expect(validation.promptContractVersion).toBe(PROMPT_CONTRACT_VERSION);
    expect(validation.scenarios.map((item) => item.id)).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
    ]);
    expect(validation.scenarios.every((item) => item.structureValid)).toBe(true);
    expect(new Set(validation.scenarios.map((item) => item.promptSha256)).size).toBe(5);
  });

  it('encodes each scenario-specific continuity and authority boundary', () => {
    const fixtureById = Object.fromEntries(
      SEMANTIC_SCENARIOS.map((fixture) => [fixture.id, fixture]),
    ) as Record<ScenarioId, (typeof SEMANTIC_SCENARIOS)[number]>;
    expect(fixtureById.A.task.description).toBe('Is it connected right now?');
    expect(
      fixtureById.B.bundle.conversationTranscript.filter(
        (entry) => entry.provenance === 'ASSISTANT',
      ),
    ).toHaveLength(2);
    expect(
      fixtureById.C.bundle.conversationTranscript.some((entry) =>
        entry.content.includes('Blue Lantern'),
      ),
    ).toBe(true);
    const renderedD = renderScenario(fixtureById.D).prompt;
    expect({
      authoritativeSemanticValidation:
        renderedD.indexOf('platform \\"semantic-validation\\"') >= 0,
      staleDiscordTranscript:
        renderedD.indexOf('The current platform is discord.') >= 0,
      factsBeforeTranscript:
        renderedD.indexOf('Current-turn facts supplied by Core') <
        renderedD.indexOf('Conversation transcript'),
    }).toEqual({
      authoritativeSemanticValidation: true,
      staleDiscordTranscript: true,
      factsBeforeTranscript: true,
    });
    expect(fixtureById.E.task.description).toContain('service Atlas');
  });

  it.each(['A', 'B', 'C', 'D', 'E'] as const)(
    'Scenario %s passing response satisfies every bounded semantic check',
    (id) => {
      const checks = evaluateScenario(id, passingResponse[id]);
      expect(checks.length).toBeGreaterThan(0);
      expect(checks.every((check) => check.passed)).toBe(true);
    },
  );

  it('does not false-pass prohibited certainty, stale authority, re-ask, or target loss', () => {
    expect(
      evaluateScenario('A', 'It is currently connected.').every(
        (check) => check.passed,
      ),
    ).toBe(false);
    expect(
      evaluateScenario('B', 'I already verified it and it is still connected.').every(
        (check) => check.passed,
      ),
    ).toBe(false);
    expect(
      evaluateScenario('C', 'Please confirm the checklist name again.').every(
        (check) => check.passed,
      ),
    ).toBe(false);
    expect(
      evaluateScenario('D', 'The current platform is Discord.').every(
        (check) => check.passed,
      ),
    ).toBe(false);
    expect(
      evaluateScenario('E', 'Which service do you mean?').every(
        (check) => check.passed,
      ),
    ).toBe(false);
  });
});

describe('environment, revision, and process safety', () => {
  it('passes only allowlisted non-secret parent environment names', () => {
    const env = buildAllowlistedEnvironment(config().parentEnv);
    expect(Object.keys(env).sort()).toEqual([
      'CLICOLOR',
      'CLICOLOR_FORCE',
      'HOME',
      'LANG',
      'NO_COLOR',
      'PATH',
    ]);
    expect(JSON.stringify(env)).not.toContain('must-not-pass');
    expect(env.DISCORD_BOT_TOKEN).toBeUndefined();
    expect(env.API_KEY).toBeUndefined();
  });

  it('does not allow provider-owned environment overrides outside color controls', async () => {
    const adapter = new QueueAdapter([result()]);
    const runner = toCliRunner(adapter, { PATH: '/usr/bin' });
    await runner('ollama', ['--version'], {
      cwd: tmpdir(),
      input: '',
      timeoutMs: 10,
      env: {
        NO_COLOR: '1',
        DISCORD_BOT_TOKEN: 'must-not-pass',
        API_KEY: 'must-not-pass',
      },
    });
    expect(adapter.requests[0]?.env).toEqual({
      PATH: '/usr/bin',
      NO_COLOR: '1',
    });
  });

  it('fails closed on HEAD, origin, tracked state, or compiled binding mismatch', () => {
    const adapter = new QueueAdapter([]);
    const headMismatch = new ProviderSemanticHarness(
      adapter,
      new StaticInspector({ ...state, head: 'b'.repeat(40) }),
    );
    expect(() => headMismatch.validateConfig(config())).toThrowError(
      HarnessBlockedError,
    );
    const bindingMismatch = new ProviderSemanticHarness(
      adapter,
      new StaticInspector(),
    );
    expect(() =>
      bindingMismatch.validateConfig(config({ expectedBinding: '0'.repeat(64) })),
    ).toThrowError(HarnessBlockedError);
  });

  it('uses an argv process with shell disabled and never names a repository evidence path', () => {
    const source = readFileSync(
      resolve(__dirname, 'provider-semantic-validation.ts'),
      'utf8',
    );
    expect(source.includes('shell: false')).toBe(true);
    expect(source.includes('shell: true')).toBe(false);
    expect(source.includes("child.kill('SIGTERM')")).toBe(true);
    expect(source.includes("child.kill('SIGKILL')")).toBe(true);
    expect(source.includes('docs/plans')).toBe(false);
    expect(source.includes('writeFileSync')).toBe(false);
    expect(source.includes('renameSync')).toBe(false);
  });

  it('blocks timeout, non-zero inventory, and oversized probe output', async () => {
    for (const blockedResult of [
      result({ code: null, timedOut: true }),
      result({ code: 2 }),
      result({ code: 1, outputLimited: true }),
    ]) {
      const adapter = new QueueAdapter([blockedResult]);
      const harness = new ProviderSemanticHarness(adapter, new StaticInspector());
      await expect(harness.probeProvider(config())).rejects.toBeInstanceOf(
        HarnessBlockedError,
      );
      expect(adapter.requests).toHaveLength(1);
    }
  });

  it('blocks generation when the configured model is absent from inventory', async () => {
    const adapter = new QueueAdapter([
      result({ stdout: 'ollama version synthetic' }),
      result({ stdout: 'NAME ID SIZE\nother-model:latest abc 1GB' }),
    ]);
    const harness = new ProviderSemanticHarness(adapter, new StaticInspector());
    await expect(harness.run(config(), ['C'])).rejects.toMatchObject({
      code: 'MODEL_NOT_INSTALLED',
    });
    expect(adapter.requests.map((request) => request.args)).toEqual([
      ['--version'],
      ['list'],
    ]);
  });

  it('uses stdin, temp cwd, separate argv, bounded capture, and no automatic retry', async () => {
    const adapter = new QueueAdapter([
      result({ stdout: 'ollama version synthetic' }),
      result({ stdout: 'NAME ID SIZE\nllama3.1:latest abc 1GB' }),
      result({ stdout: passingResponse.C }),
    ]);
    const harness = new ProviderSemanticHarness(adapter, new StaticInspector());
    const records = await harness.run(config({ calls: 1 }), ['C']);
    expect(records).toHaveLength(1);
    expect(adapter.requests).toHaveLength(3);
    const generation = adapter.requests[2];
    expect(generation?.args).toEqual(['run', 'llama3.1']);
    expect(generation?.input.length).toBeGreaterThan(0);
    expect(generation?.args.join(' ')).not.toContain(generation?.input ?? '');
    expect(generation?.cwd).toBe(tmpdir());
    expect(generation?.timeoutMs).toBe(GENERATION_TIMEOUT_MS);
    expect(generation?.maxCaptureBytes).toBe(MAX_CAPTURE_BYTES);
  });

  it('does not retry a non-zero generation result', async () => {
    const adapter = new QueueAdapter([
      result({ stdout: 'ollama version synthetic' }),
      result({ stdout: 'NAME ID SIZE\nllama3.1:latest abc 1GB' }),
      result({ code: 7, stderr: 'synthetic failure' }),
    ]);
    const harness = new ProviderSemanticHarness(adapter, new StaticInspector());
    await expect(harness.run(config({ calls: 2 }), ['A'])).rejects.toBeDefined();
    expect(adapter.requests).toHaveLength(3);
  });

  it('blocks an empty Provider response', async () => {
    const adapter = new QueueAdapter([
      result({ stdout: 'ollama version synthetic' }),
      result({ stdout: 'NAME ID SIZE\nllama3.1:latest abc 1GB' }),
      result({ stdout: '   ' }),
    ]);
    const harness = new ProviderSemanticHarness(adapter, new StaticInspector());
    await expect(harness.run(config(), ['A'])).rejects.toBeDefined();
  });
});

describe('bounded evidence and prompt leakage guard', () => {
  const scenarioC = SEMANTIC_SCENARIOS.find((fixture) => fixture.id === 'C')!;
  const prompt = renderScenario(scenarioC).prompt;

  it('emits bounded metadata without the prompt, transcript, background, or raw stderr', () => {
    const record = makeEvidenceRecord({
      scenario: scenarioC,
      callOrdinal: 1,
      head: state.head,
      model: DEFAULT_MODEL,
      prompt,
      response: passingResponse.C,
      durationMs: 5,
      exitCode: 0,
    });
    const serialized = JSON.stringify(record);
    expect(record.automatedVerdict).toBe('AUTOMATED_PASS');
    expect(record.humanVerdict).toBe('PENDING');
    expect(serialized.includes('# System')).toBe(false);
    expect(serialized.includes('conversationTranscript')).toBe(false);
    expect(serialized.includes('stderr')).toBe(false);
    expect(serialized.includes(prompt)).toBe(false);
  });

  it('masks secret-like previews and limits them to 1,200 UTF-8 bytes', () => {
    const fakeSecret = `sk-${'A'.repeat(40)}`;
    const record = makeEvidenceRecord({
      scenario: scenarioC,
      callOrdinal: 1,
      head: state.head,
      model: DEFAULT_MODEL,
      prompt,
      response: `${passingResponse.C} ${fakeSecret} ${'가'.repeat(800)}`,
      durationMs: 5,
      exitCode: 0,
    });
    expect(record.responsePreview).not.toContain(fakeSecret);
    expect(record.responsePreview).toContain('***redacted***');
    expect(Buffer.byteLength(record.responsePreview ?? '', 'utf8')).toBeLessThanOrEqual(
      MAX_PREVIEW_BYTES,
    );
    expect(record.previewTruncated).toBe(true);
  });

  it('blocks exact or long-substring prompt echo without emitting a response preview', () => {
    expect(detectPromptLeak(prompt, prompt, scenarioC)).toBe(true);
    const echoed = `prefix ${prompt.slice(0, 240)} suffix`;
    expect(detectPromptLeak(prompt, echoed, scenarioC)).toBe(true);
    const record = makeEvidenceRecord({
      scenario: scenarioC,
      callOrdinal: 1,
      head: state.head,
      model: DEFAULT_MODEL,
      prompt,
      response: echoed,
      durationMs: 5,
      exitCode: 0,
    });
    expect(record.automatedVerdict).toBe('BLOCKED');
    expect(record.promptLeakDetected).toBe(true);
    expect(record.responsePreview).toBeUndefined();
    expect(JSON.stringify(record).includes(echoed)).toBe(false);
  });
});
