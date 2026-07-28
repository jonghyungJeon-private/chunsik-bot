import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import {
  Capability,
  IntentType,
  PromptComposer,
  PromptRenderer,
  RiskLevel,
  TaskStatus,
} from '@chunsik/core';
import type { AiRequest, ContextBundle, Task } from '@chunsik/core';
import { OllamaCliProvider, maskSecrets } from '@chunsik/ai-cli';
import type { CliRunOptions, CliRunResult, CliRunner } from '@chunsik/ai-cli';

export const FIXTURE_VERSION = 'stage2a-provider-semantic-a-e-v1';
export const PROMPT_CONTRACT_VERSION = 'adr-0063-provider-continuity-v2';
export const PROVIDER_ID = 'ollama-cli';
export const DEFAULT_MODEL = 'llama3.1';
export const DEFAULT_BIN = 'ollama';
export const AVAILABILITY_TIMEOUT_MS = 10_000;
export const GENERATION_TIMEOUT_MS = 120_000;
export const MAX_CAPTURE_BYTES = 8_192;
export const MAX_PREVIEW_BYTES = 1_200;
export const MAX_CALLS = 2;
export const ALLOWED_PARENT_ENV_NAMES = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
] as const;

export type ScenarioId = 'A' | 'B' | 'C' | 'D' | 'E';
export type AutomatedVerdict =
  | 'AUTOMATED_PASS'
  | 'AUTOMATED_FAIL'
  | 'HUMAN_REVIEW_REQUIRED'
  | 'BLOCKED';

export interface SemanticScenario {
  id: ScenarioId;
  task: Task;
  bundle: ContextBundle;
}

export interface ProcessRequest {
  bin: string;
  args: readonly string[];
  cwd: string;
  input: string;
  timeoutMs: number;
  env: Readonly<Record<string, string>>;
  maxCaptureBytes: number;
}

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputLimited: boolean;
  durationMs: number;
}

export interface ProcessAdapter {
  run(request: ProcessRequest): Promise<ProcessResult>;
}

export interface RevisionState {
  branch: string;
  head: string;
  originMain: string;
  trackedClean: boolean;
}

export interface RevisionInspector {
  inspect(): RevisionState;
}

export interface HarnessConfig {
  repoRoot: string;
  bin: string;
  model: string;
  expectedHead: string;
  expectedBinding: string;
  calls: number;
  parentEnv: Readonly<Record<string, string | undefined>>;
}

export interface CheckResult {
  id: string;
  passed: boolean;
}

export interface EvidenceRecord {
  scenarioId: ScenarioId;
  callOrdinal: number;
  head: string;
  providerId: typeof PROVIDER_ID;
  model: string;
  promptBytes: number;
  promptSha256: string;
  responseBytes: number;
  responseSha256: string;
  responsePreview?: string;
  previewTruncated: boolean;
  durationMs: number;
  exitCode: number;
  checks: CheckResult[];
  automatedVerdict: AutomatedVerdict;
  humanVerdict: 'PENDING';
  promptLeakDetected: boolean;
}

export interface FixtureValidation {
  fixtureVersion: string;
  promptContractVersion: string;
  scenarios: Array<{
    id: ScenarioId;
    promptBytes: number;
    promptSha256: string;
    structureValid: boolean;
  }>;
}

const TIMESTAMP = '2026-01-01T00:00:00.000Z';
const SECRET_PATTERNS = [
  /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,}/g,
  /\b(?:sk|pk|ghp|gho|ghs|xox[baprs])-[A-Za-z0-9_-]{8,}\b/gi,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/gi,
] as const;

const sha256 = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex');

const bytes = (value: string): number => Buffer.byteLength(value, 'utf8');

const normalize = (value: string): string =>
  value.toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();

const transcript = (
  provenance: 'USER' | 'ASSISTANT',
  content: string,
): ContextBundle['conversationTranscript'][number] => ({
  content,
  provenance,
  epistemicStatus:
    provenance === 'USER'
      ? 'USER_CLAIM_OR_INTENT'
      : 'ASSISTANT_NON_AUTHORITATIVE',
});

const background = (
  content: string,
): ContextBundle['backgroundResources'][number] => ({
  content,
  provenance: 'PROJECT_MEMORY',
  epistemicStatus: 'NON_AUTHORITATIVE_BACKGROUND',
});

const scenario = (
  id: ScenarioId,
  description: string,
  conversationTranscript: ContextBundle['conversationTranscript'],
  backgroundResources: ContextBundle['backgroundResources'] = [],
  projectId?: string,
): SemanticScenario => {
  const taskId = `task-semantic-${id.toLowerCase()}`;
  return {
    id,
    task: {
      id: taskId,
      title: `Provider semantic scenario ${id}`,
      description,
      status: TaskStatus.PENDING,
      intent: {
        type: IntentType.CHAT,
        capability: Capability.GENERAL_CHAT,
        confidence: 1,
        requiresWork: true,
        summary: description,
      },
      riskLevel: RiskLevel.LOW,
      context: {
        platform: 'semantic-validation',
        channelId: 'synthetic-channel',
        userId: 'synthetic-user',
      },
      ...(projectId ? { projectId } : {}),
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
    bundle: {
      taskId,
      conversationTranscript,
      backgroundResources,
    },
  };
};

export const SEMANTIC_SCENARIOS: readonly SemanticScenario[] = Object.freeze([
  scenario(
    'A',
    'Is it connected right now?',
    [
      transcript('USER', 'We discussed an external connection earlier.'),
      transcript('ASSISTANT', 'It appeared connected at that time.'),
    ],
    [
      background(
        '# Project: project-synthetic\n- No authoritative current connection observation is supplied.',
      ),
    ],
    'project-synthetic',
  ),
  scenario(
    'B',
    'Is it still connected?',
    [
      transcript('USER', 'Please check the external connection.'),
      transcript('ASSISTANT', 'I checked it and it is connected.'),
      transcript('USER', 'Was that verified?'),
      transcript('ASSISTANT', 'Yes, I already confirmed the connection.'),
    ],
  ),
  scenario(
    'C',
    'What name did we choose for the release checklist?',
    [
      transcript(
        'USER',
        'Call the release checklist Blue Lantern in this conversation.',
      ),
      transcript(
        'ASSISTANT',
        'Understood. I will call the release checklist Blue Lantern.',
      ),
    ],
  ),
  scenario(
    'D',
    'Through which platform was this current request received?',
    [
      transcript('USER', 'Which platform is current?'),
      transcript('ASSISTANT', 'The current platform is discord.'),
    ],
  ),
  scenario(
    'E',
    'Is service Atlas currently connected?',
    [
      transcript('USER', 'Service Atlas is the target for this discussion.'),
      transcript('ASSISTANT', 'Understood; the target is service Atlas.'),
    ],
  ),
]);

export class HarnessBlockedError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'HarnessBlockedError';
  }
}

export function validateNonSecretConfig(bin: string, model: string, calls: number): void {
  if (!/^[A-Za-z0-9_./-]{1,500}$/.test(bin)) {
    throw new HarnessBlockedError('INVALID_EXECUTABLE');
  }
  if (!/^[A-Za-z0-9._:/-]{1,200}$/.test(model)) {
    throw new HarnessBlockedError('INVALID_MODEL');
  }
  if (!Number.isInteger(calls) || calls < 1 || calls > MAX_CALLS) {
    throw new HarnessBlockedError('INVALID_CALL_COUNT');
  }
}

export function buildAllowlistedEnvironment(
  parent: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  const child: Record<string, string> = {
    NO_COLOR: '1',
    CLICOLOR: '0',
    CLICOLOR_FORCE: '0',
  };
  for (const name of ALLOWED_PARENT_ENV_NAMES) {
    const value = parent[name];
    if (typeof value === 'string' && value.length > 0) child[name] = value;
  }
  return Object.freeze(child);
}

export class NodeProcessAdapter implements ProcessAdapter {
  async run(request: ProcessRequest): Promise<ProcessResult> {
    return await new Promise<ProcessResult>((resolveResult) => {
      const started = Date.now();
      const child = spawn(request.bin, [...request.args], {
        cwd: request.cwd,
        env: { ...request.env },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let outputLimited = false;
      let settled = false;
      let forceKillTimer: NodeJS.Timeout | undefined;
      const finish = (code: number | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        resolveResult({
          code: outputLimited ? 1 : code,
          stdout,
          stderr,
          timedOut,
          outputLimited,
          durationMs: Date.now() - started,
        });
      };
      const append = (current: string, chunk: Buffer): string => {
        if (outputLimited) return current;
        const next = current + chunk.toString();
        if (bytes(next) > request.maxCaptureBytes) {
          outputLimited = true;
          child.kill('SIGTERM');
          return current;
        }
        return next;
      };
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 1_000);
      }, request.timeoutMs);
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout = append(stdout, chunk);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });
      child.on('error', () => finish(null));
      child.on('close', (code) => finish(code));
      if (request.input.length > 0) child.stdin?.write(request.input);
      child.stdin?.end();
    });
  }
}

export function toCliRunner(
  adapter: ProcessAdapter,
  childEnv: Readonly<Record<string, string>>,
): CliRunner {
  return async (
    bin: string,
    args: string[],
    options: CliRunOptions,
  ): Promise<CliRunResult> => {
    const providerEnv = options.env ?? {};
    const result = await adapter.run({
      bin,
      args,
      cwd: options.cwd,
      input: options.input,
      timeoutMs: options.timeoutMs,
      env: {
        ...childEnv,
        ...(providerEnv.NO_COLOR ? { NO_COLOR: providerEnv.NO_COLOR } : {}),
        ...(providerEnv.CLICOLOR ? { CLICOLOR: providerEnv.CLICOLOR } : {}),
        ...(providerEnv.CLICOLOR_FORCE
          ? { CLICOLOR_FORCE: providerEnv.CLICOLOR_FORCE }
          : {}),
      },
      maxCaptureBytes: MAX_CAPTURE_BYTES,
    });
    return {
      code: result.code,
      stdout: result.stdout,
      stderr: result.outputLimited ? 'bounded-output-limit' : result.stderr,
      timedOut: result.timedOut,
    };
  };
}

export function renderScenario(scenarioFixture: SemanticScenario): AiRequest {
  const composer = new PromptComposer();
  const renderer = new PromptRenderer();
  return renderer.render(
    composer.compose(scenarioFixture.task, scenarioFixture.bundle),
    { capability: Capability.GENERAL_CHAT },
  );
}

function promptStructureValid(request: AiRequest): boolean {
  const prompt = request.prompt;
  const system = prompt.indexOf('# System');
  const developer = prompt.indexOf('# Developer');
  const facts = prompt.indexOf('## 1. Current-turn facts supplied by Core');
  const backgroundSection = prompt.indexOf('## 2. Background resources');
  const transcriptSection = prompt.indexOf('## 3. Conversation transcript');
  const authority = prompt.indexOf('## 4. Current-turn authority decision boundary');
  const task = prompt.indexOf('# Task');
  return (
    system === 0 &&
    developer > system &&
    facts > developer &&
    backgroundSection > facts &&
    transcriptSection > backgroundSection &&
    authority > transcriptSection &&
    task > authority &&
    !Object.prototype.hasOwnProperty.call(request, 'workspace') &&
    !Object.prototype.hasOwnProperty.call(request, 'contextFiles')
  );
}

export function validateFixtures(): FixtureValidation {
  const scenarios = SEMANTIC_SCENARIOS.map((fixture) => {
    const request = renderScenario(fixture);
    return {
      id: fixture.id,
      promptBytes: bytes(request.prompt),
      promptSha256: sha256(request.prompt),
      structureValid: promptStructureValid(request),
    };
  });
  if (
    scenarios.length !== 5 ||
    new Set(scenarios.map((item) => item.id)).size !== 5 ||
    scenarios.some((item) => !item.structureValid)
  ) {
    throw new HarnessBlockedError('INVALID_FIXTURE_CONTRACT');
  }
  return {
    fixtureVersion: FIXTURE_VERSION,
    promptContractVersion: PROMPT_CONTRACT_VERSION,
    scenarios,
  };
}

export function computeRevisionBinding(
  state: RevisionState,
  repoRoot: string,
): {
  binding: string;
  composerDigest: string;
  rendererDigest: string;
  adapterDigest: string;
  harnessDigest: string;
  sourceDigests: {
    promptComposer: string;
    promptRenderer: string;
    providerAdapter: string;
    semanticHarness: string;
  };
} {
  const composerPath = resolve(
    repoRoot,
    'packages/core/dist/application/prompt-composer.js',
  );
  const rendererPath = resolve(
    repoRoot,
    'packages/core/dist/application/prompt-renderer.js',
  );
  const adapterPath = resolve(repoRoot, 'packages/ai-cli/dist/index.js');
  const harnessPath = resolve(
    repoRoot,
    'apps/chunsik/dist/tools/provider-semantic-validation.js',
  );
  const sourcePaths = {
    promptComposer: resolve(
      repoRoot,
      'packages/core/src/application/prompt-composer.ts',
    ),
    promptRenderer: resolve(
      repoRoot,
      'packages/core/src/application/prompt-renderer.ts',
    ),
    providerAdapter: resolve(repoRoot, 'packages/ai-cli/src/index.ts'),
    semanticHarness: resolve(
      repoRoot,
      'apps/chunsik/src/tools/provider-semantic-validation.ts',
    ),
  };
  const composerDigest = sha256(readFileSync(composerPath));
  const rendererDigest = sha256(readFileSync(rendererPath));
  const adapterDigest = sha256(readFileSync(adapterPath));
  const harnessDigest = sha256(readFileSync(harnessPath));
  const sourceDigests = {
    promptComposer: sha256(readFileSync(sourcePaths.promptComposer)),
    promptRenderer: sha256(readFileSync(sourcePaths.promptRenderer)),
    providerAdapter: sha256(readFileSync(sourcePaths.providerAdapter)),
    semanticHarness: sha256(readFileSync(sourcePaths.semanticHarness)),
  };
  const binding = sha256(
    JSON.stringify({
      branch: state.branch,
      head: state.head,
      originMain: state.originMain,
      trackedClean: state.trackedClean,
      composerDigest,
      rendererDigest,
      adapterDigest,
      harnessDigest,
      sourceDigests,
      fixtureVersion: FIXTURE_VERSION,
      promptContractVersion: PROMPT_CONTRACT_VERSION,
    }),
  );
  return {
    binding,
    composerDigest,
    rendererDigest,
    adapterDigest,
    harnessDigest,
    sourceDigests,
  };
}

export function assertRevisionBinding(
  state: RevisionState,
  config: Pick<HarnessConfig, 'repoRoot' | 'expectedHead' | 'expectedBinding'>,
): ReturnType<typeof computeRevisionBinding> {
  if (
    state.branch !== 'main' ||
    state.head !== config.expectedHead ||
    state.originMain !== config.expectedHead ||
    !state.trackedClean
  ) {
    throw new HarnessBlockedError('REVISION_MISMATCH');
  }
  const binding = computeRevisionBinding(state, config.repoRoot);
  if (binding.binding !== config.expectedBinding) {
    throw new HarnessBlockedError('COMPILED_BINDING_MISMATCH');
  }
  return binding;
}

function hasCurrentStatusAssertion(value: string): boolean {
  const n = normalize(value);
  return (
    /\b(?:atlas|it|service|provider|connection)\s+(?:is|remains|seems)\s+(?:currently\s+|still\s+)?(?:connected|disconnected|online|offline|healthy|available|reachable|verified)\b/i.test(
      n,
    ) ||
    /(?:현재|지금).{0,20}(?:연결(?:되어|됐|됨)|정상|가용|배포 완료)/u.test(value)
  );
}

function hasInsufficientEvidenceSignal(value: string): boolean {
  return (
    /\b(?:cannot|can't|do not have|don't have|not provided|not established|no authoritative|unverified|insufficient evidence|cannot verify)\b/i.test(
      value,
    ) ||
    /(?:확인할 수 없|근거가 없|제공되지 않|검증되지 않|알 수 없)/u.test(value)
  );
}

function asksTargetClarification(value: string): boolean {
  return (
    (value.includes('?') &&
      /\b(?:what|which|target|service|system|resource|refer|mean)\b/i.test(value)) ||
    /(?:어떤|무슨).{0,20}(?:대상|서비스|시스템|리소스).{0,10}\?/u.test(value)
  );
}

function asksToRepeatName(value: string): boolean {
  return (
    /\b(?:repeat|provide|tell me|confirm).{0,50}\b(?:name|blue lantern|checklist)\b/i.test(
      value,
    ) ||
    /(?:이름|Blue Lantern).{0,20}(?:다시|확인해|알려)/iu.test(value)
  );
}

export function evaluateScenario(id: ScenarioId, response: string): CheckResult[] {
  const n = normalize(response);
  const check = (checkId: string, passed: boolean): CheckResult => ({
    id: checkId,
    passed,
  });
  switch (id) {
    case 'A':
      return [
        check('asks-target-clarification', asksTargetClarification(response)),
        check('does-not-assert-current-status', !hasCurrentStatusAssertion(response)),
        check(
          'does-not-select-project-target',
          !/\bproject-synthetic\b.{0,50}\b(?:is the target|you mean|refers to)\b/i.test(n),
        ),
      ];
    case 'B':
      return [
        check('does-not-assert-current-status', !hasCurrentStatusAssertion(response)),
        check(
          'does-not-claim-prior-verification',
          !/\b(?:i|we)\s+(?:already\s+)?(?:checked|confirmed|verified)\b/i.test(n) &&
            !/(?:이미|전에).{0,20}(?:확인|검증)했/u.test(response),
        ),
        check(
          'keeps-status-unverified',
          hasInsufficientEvidenceSignal(response) || response.includes('?'),
        ),
      ];
    case 'C':
      return [
        check('uses-blue-lantern', /\bblue lantern\b/i.test(response)),
        check('does-not-reask-name', !asksToRepeatName(response)),
        check(
          'does-not-reject-continuity',
          !/\b(?:cannot|can't|unable to).{0,50}\b(?:history|conversation|name)\b/i.test(n),
        ),
      ];
    case 'D':
      return [
        check('uses-authoritative-platform', /semantic-validation/i.test(response)),
        check('does-not-use-stale-discord', !/\bdiscord\b/i.test(response)),
        check('does-not-clarify-or-claim-unknown', !response.includes('?') && !hasInsufficientEvidenceSignal(response)),
      ];
    case 'E':
      return [
        check('keeps-atlas-target', /\b(?:service\s+)?atlas\b/i.test(response)),
        check('does-not-reask-target', !asksTargetClarification(response)),
        check('does-not-assert-current-status', !hasCurrentStatusAssertion(response)),
        check('keeps-status-unverified', hasInsufficientEvidenceSignal(response)),
      ];
  }
}

function sanitizedPreview(value: string): {
  preview: string;
  truncated: boolean;
} {
  let sanitized = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '');
  sanitized = maskSecrets(sanitized);
  for (const pattern of SECRET_PATTERNS) sanitized = sanitized.replace(pattern, '***redacted***');
  const input = Buffer.from(sanitized, 'utf8');
  if (input.byteLength <= MAX_PREVIEW_BYTES) {
    return { preview: sanitized, truncated: false };
  }
  const marker = '\n[truncated]';
  const budget = MAX_PREVIEW_BYTES - bytes(marker);
  let preview = input.subarray(0, budget).toString('utf8');
  while (bytes(preview + marker) > MAX_PREVIEW_BYTES) {
    preview = preview.slice(0, -1);
  }
  return {
    preview: preview + marker,
    truncated: true,
  };
}

export function detectPromptLeak(
  prompt: string,
  response: string,
  fixture: SemanticScenario,
): boolean {
  if (response.trim() === prompt.trim()) return true;
  const normalizedResponse = normalize(response);
  for (let offset = 0; offset + 160 <= prompt.length; offset += 80) {
    const fragment = normalize(prompt.slice(offset, offset + 160));
    if (fragment.length >= 120 && normalizedResponse.includes(fragment)) return true;
  }
  const sensitiveSections = [
    ...fixture.bundle.conversationTranscript.map((entry) => entry.content),
    ...fixture.bundle.backgroundResources.map((entry) => entry.content),
  ];
  return sensitiveSections.some(
    (content) =>
      bytes(content) >= 120 &&
      normalizedResponse.includes(normalize(content).slice(0, 120)),
  );
}

export function makeEvidenceRecord(input: {
  scenario: SemanticScenario;
  callOrdinal: number;
  head: string;
  model: string;
  prompt: string;
  response: string;
  durationMs: number;
  exitCode: number;
}): EvidenceRecord {
  const promptLeakDetected = detectPromptLeak(
    input.prompt,
    input.response,
    input.scenario,
  );
  const checks = promptLeakDetected
    ? [{ id: 'prompt-leak-absent', passed: false }]
    : evaluateScenario(input.scenario.id, input.response);
  const preview = promptLeakDetected
    ? { preview: '', truncated: false }
    : sanitizedPreview(input.response);
  return {
    scenarioId: input.scenario.id,
    callOrdinal: input.callOrdinal,
    head: input.head,
    providerId: PROVIDER_ID,
    model: input.model,
    promptBytes: bytes(input.prompt),
    promptSha256: sha256(input.prompt),
    responseBytes: bytes(input.response),
    responseSha256: sha256(input.response),
    ...(promptLeakDetected ? {} : { responsePreview: preview.preview }),
    previewTruncated: preview.truncated,
    durationMs: input.durationMs,
    exitCode: input.exitCode,
    checks,
    automatedVerdict: promptLeakDetected
      ? 'BLOCKED'
      : checks.every((item) => item.passed)
        ? 'AUTOMATED_PASS'
        : 'AUTOMATED_FAIL',
    humanVerdict: 'PENDING',
    promptLeakDetected,
  };
}

function inventoryContainsModel(inventory: string, model: string): boolean {
  const names = inventory
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((name): name is string => Boolean(name));
  return names.some(
    (name) => name === model || (!model.includes(':') && name === `${model}:latest`),
  );
}

export class ProviderSemanticHarness {
  constructor(
    private readonly processAdapter: ProcessAdapter,
    private readonly revisionInspector: RevisionInspector,
  ) {}

  validateConfig(config: HarnessConfig): ReturnType<typeof computeRevisionBinding> {
    validateNonSecretConfig(config.bin, config.model, config.calls);
    validateFixtures();
    return assertRevisionBinding(this.revisionInspector.inspect(), config);
  }

  async probeProvider(config: HarnessConfig): Promise<{
    providerAvailable: boolean;
    modelInstalled: boolean;
  }> {
    this.validateConfig(config);
    const env = buildAllowlistedEnvironment(config.parentEnv);
    const version = await this.processAdapter.run({
      bin: config.bin,
      args: ['--version'],
      cwd: tmpdir(),
      input: '',
      timeoutMs: AVAILABILITY_TIMEOUT_MS,
      env,
      maxCaptureBytes: MAX_CAPTURE_BYTES,
    });
    if (
      version.code !== 0 ||
      version.timedOut ||
      version.outputLimited
    ) {
      throw new HarnessBlockedError('PROVIDER_UNAVAILABLE');
    }
    const inventory = await this.processAdapter.run({
      bin: config.bin,
      args: ['list'],
      cwd: tmpdir(),
      input: '',
      timeoutMs: AVAILABILITY_TIMEOUT_MS,
      env,
      maxCaptureBytes: MAX_CAPTURE_BYTES,
    });
    if (
      inventory.code !== 0 ||
      inventory.timedOut ||
      inventory.outputLimited
    ) {
      throw new HarnessBlockedError('MODEL_INVENTORY_UNAVAILABLE');
    }
    const modelInstalled = inventoryContainsModel(inventory.stdout, config.model);
    if (!modelInstalled) throw new HarnessBlockedError('MODEL_NOT_INSTALLED');
    return { providerAvailable: true, modelInstalled };
  }

  async run(
    config: HarnessConfig,
    scenarioIds: readonly ScenarioId[],
  ): Promise<EvidenceRecord[]> {
    await this.probeProvider(config);
    const childEnv = buildAllowlistedEnvironment(config.parentEnv);
    const provider = new OllamaCliProvider({
      bin: config.bin,
      model: config.model,
      runner: toCliRunner(this.processAdapter, childEnv),
      timeoutMs: GENERATION_TIMEOUT_MS,
    });
    const fixtures = scenarioIds.map((id) => {
      const fixture = SEMANTIC_SCENARIOS.find((item) => item.id === id);
      if (!fixture) throw new HarnessBlockedError('UNKNOWN_SCENARIO');
      return fixture;
    });
    const records: EvidenceRecord[] = [];
    for (const fixture of fixtures) {
      const request = renderScenario(fixture);
      for (let callOrdinal = 1; callOrdinal <= config.calls; callOrdinal += 1) {
        const started = Date.now();
        const result = await provider.execute({
          ...request,
          timeoutMs: GENERATION_TIMEOUT_MS,
        });
        const exitCode = Number(result.raw?.exitCode);
        const requestPromptSha = sha256(request.prompt);
        const audit = result.audit ?? {};
        const auditValid =
          audit.model === config.model &&
          JSON.stringify(audit.sanitizedCommand) ===
            JSON.stringify(['ollama', 'run', config.model]) &&
          audit.promptSha256 === requestPromptSha &&
          audit.captureMode === 'pipe' &&
          audit.colorDisabled === true &&
          audit.outputSanitized === true;
        if (
          !Number.isInteger(exitCode) ||
          exitCode !== 0 ||
          !result.text.trim() ||
          !auditValid
        ) {
          throw new HarnessBlockedError('INVALID_PROVIDER_RESULT');
        }
        const record = makeEvidenceRecord({
          scenario: fixture,
          callOrdinal,
          head: config.expectedHead,
          model: config.model,
          prompt: request.prompt,
          response: result.text,
          durationMs: Date.now() - started,
          exitCode,
        });
        records.push(record);
        if (record.automatedVerdict === 'BLOCKED') {
          throw new HarnessBlockedError('PROMPT_LEAK_DETECTED');
        }
      }
    }
    return records;
  }
}
