import { describe, expect, it } from 'vitest';
import {
  ApprovalStatus,
  Capability,
  CodeGenerationStatus,
  CommandExecutionStatus,
  IntentType,
  RiskLevel,
  SessionStatus,
} from '../domain';
import type {
  Actor,
  ApprovalRequest,
  CodeGeneration,
  CodeProposal,
  CommandExecution,
  ConversationContext,
  GenerateCodeInput,
  InboundMessage,
  Intent,
  Project,
  Session,
  Task,
  WorkspaceRef,
} from '../domain';
import type { Logger } from '../ports';
import { ResponseComposer } from './response-composer';
import { IntentClassifier } from './intent-classifier';
import type { CapabilityRouter } from './capability-router';
import { IntentResolver } from './intent-resolver';
import { ExecutionOutcomeStatus, ExecutionStage } from './execution-orchestrator';
import type { ExecutionOutcome, ExecutionRequest } from './execution-orchestrator';
import { ConversationRuntime, toCodeChangePreview } from './conversation-runtime';
import type { ApprovalFlow, ConversationRuntimeDeps, PendingScopeClarification, ScopeClarificationFlow } from './conversation-runtime';
import { StatelessApprovalFlow } from './stateless-approval-flow';

const TS = '2026-07-01T00:00:00.000Z';
const CTX: ConversationContext = { platform: 'test', channelId: 'c1', userId: 'u1' };
const ACTOR: Actor = { id: 'actor-1' } as Actor;
const WORKSPACE: WorkspaceRef = { id: 'ws-1', rootPath: '/repo', kind: 'local-clone' };
const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

const sessionOf = (o: Partial<Session> = {}): Session => ({
  id: 'sess-1',
  actorId: 'actor-1',
  context: CTX,
  status: SessionStatus.ACTIVE,
  activeProjectId: 'proj-1',
  createdAt: TS,
  lastActivityAt: TS,
  ...o,
});

const projectOf = (): Project => ({ id: 'proj-1', name: 'p', rootPath: '/repo', createdAt: TS });

const messageOf = (text: string): InboundMessage => ({ id: 'm1', context: CTX, text, receivedAt: TS });

const intentOf = (
  capability: Capability,
  type: IntentType,
  requiresWork: boolean,
  raw?: Record<string, unknown>,
): Intent => ({ type, capability, confidence: 1, requiresWork, summary: 'do the thing', ...(raw ? { raw } : {}) });

const outcomeOf = (status: ExecutionOutcomeStatus, commandExecutionId?: string): ExecutionOutcome => ({
  status,
  lastStage: ExecutionStage.PLANNING,
  selectedStages: [ExecutionStage.PLANNING],
  refs: { executionPlanRef: { id: 'plan-1', goal: 'g' }, ...(commandExecutionId ? { commandExecutionId } : {}) },
});

const pendingApprovalOf = (): ApprovalRequest => ({
  id: 'appr-1',
  executionPlanRef: { id: 'plan-1', goal: 'g' },
  status: ApprovalStatus.PENDING,
  riskLevel: RiskLevel.HIGH,
  reason: 'needs approval',
  requestedBy: 'actor-1',
  createdAt: TS,
  updatedAt: TS,
});

const commandExecOf = (
  status: CommandExecutionStatus,
  args: string[] = ['test'],
  exitCode?: number,
  streams: { stdout?: string; stderr?: string } = {},
): CommandExecution => ({
  id: 'cmd-1',
  executionPlanRef: { id: 'plan-1', goal: 'g' },
  workspaceRef: WORKSPACE,
  command: 'pnpm',
  args,
  commandHash: 'h',
  status,
  stdout: streams.stdout ?? '',
  stderr: streams.stderr ?? '',
  durationMs: 1,
  riskLevel: RiskLevel.MEDIUM,
  ...(exitCode !== undefined ? { exitCode } : {}),
  createdAt: TS,
  updatedAt: TS,
});

const codeIntent = intentOf(Capability.CODE_IMPLEMENTATION, IntentType.IMPLEMENT_CODE, true);
const testIntent = intentOf(Capability.TEST_EXECUTION, IntentType.RUN_TESTS, true, { kind: 'test' });

/** A validated target file used across Live Code Change Planning tests (Sprint 2o, ADR-0036). */
const TARGET_FILE = 'packages/core/src/application/foo.ts';

/** Fake `workspace.list` that reports an exact hit only for `path`, nothing for anything else. */
const hitsFor = (path: string) => (glob?: string): string[] => (glob === path ? [path] : []);

/** Default SUCCEEDED generation + in-scope proposal used by makeDeps' codeGeneration fake (Sprint 2q). */
const codeGenerationOf = (o: Partial<CodeGeneration> = {}): CodeGeneration => ({
  id: 'gen-1',
  executionPlanRef: { id: 'plan-1', goal: 'g' },
  capability: Capability.CODE_IMPLEMENTATION,
  status: CodeGenerationStatus.SUCCEEDED,
  codeProposalRef: { id: 'prop-1', status: CodeGenerationStatus.SUCCEEDED },
  createdAt: TS,
  updatedAt: TS,
  ...o,
});

const codeProposalOf = (o: Partial<CodeProposal> = {}): CodeProposal => ({
  id: 'prop-1',
  codeGenerationRef: { id: 'gen-1', status: CodeGenerationStatus.SUCCEEDED },
  proposal: [{ path: TARGET_FILE, newContent: 'fixed content' }],
  providerId: 'fake',
  createdAt: TS,
  ...o,
});

interface Calls {
  run: number;
  resume: number;
  decide: number;
  anchor: number;
  sessionTouch: number;
  sessionWrites: Session[];
  lastRunRequest?: ExecutionRequest;
  workspaceList: number;
  classify: number;
  scopeAnchor: number;
  scopeClear: number;
  scopeFindPending: number;
  lastScopeAnchor?: PendingScopeClarification;
  recordAssistant: number;
  codeGenerationGenerate: number;
  codeGenerationGetProposal: number;
  lastCodeGenerationInput?: GenerateCodeInput;
}

interface Opts {
  intent?: Intent;
  session?: Session;
  project?: Project | null;
  workspaceOpenThrows?: boolean;
  commandExec?: CommandExecution | null;
  runOutcome?: ExecutionOutcome;
  resumeOutcome?: ExecutionOutcome;
  pending?: ApprovalRequest | null;
  reconstruct?: { request: ExecutionRequest; prior: ExecutionOutcome } | null;
  /** Fake `workspace.list` result per glob — defaults to reporting no hits at all (Sprint 2o). */
  workspaceList?: (glob?: string) => string[];
  /** Initial pending scope clarification (Sprint 2p) — the fake is stateful: `anchor` sets it,
   *  `clear` nulls it, so a test can drive multiple sequential `handle()` calls realistically. */
  pendingScope?: PendingScopeClarification | null;
  /** `codeGeneration.generate` result (Sprint 2q) — defaults to a SUCCEEDED generation; pass
   *  'throw' to simulate an unexpected error. */
  codeGeneration?: CodeGeneration | 'throw';
  /** `codeGeneration.getProposal` result (Sprint 2q) — defaults to an in-scope proposal for
   *  TARGET_FILE; pass null to simulate a missing proposal. */
  codeProposal?: CodeProposal | null;
}

function makeDeps(opts: Opts = {}): { deps: ConversationRuntimeDeps; calls: Calls } {
  const calls: Calls = {
    run: 0,
    resume: 0,
    decide: 0,
    anchor: 0,
    sessionTouch: 0,
    sessionWrites: [],
    workspaceList: 0,
    classify: 0,
    scopeAnchor: 0,
    scopeClear: 0,
    scopeFindPending: 0,
    recordAssistant: 0,
    codeGenerationGenerate: 0,
    codeGenerationGetProposal: 0,
  };
  const composer = new ResponseComposer();
  const intentResolver = new IntentResolver();

  const approvalFlow: ApprovalFlow = {
    async findPending() {
      return opts.pending ?? null;
    },
    async anchor() {
      calls.anchor++;
    },
    async reconstructResume() {
      return opts.reconstruct === undefined
        ? { request: { goal: 'g', instruction: 'g', requiredCapabilities: [Capability.CODE_IMPLEMENTATION], requestedBy: 'actor-1' }, prior: outcomeOf(ExecutionOutcomeStatus.AWAITING_APPROVAL) }
        : opts.reconstruct;
    },
  };

  // Stateful fake (Sprint 2p): anchor()/clear() actually mutate what findPending() next reports,
  // so a test can drive several sequential handle() calls and see realistic next-turn-only behavior.
  let currentPendingScope: PendingScopeClarification | null = opts.pendingScope ?? null;
  const scopeClarificationFlow: ScopeClarificationFlow = {
    async findPending() {
      calls.scopeFindPending++;
      return currentPendingScope;
    },
    async anchor(_session, pending) {
      calls.scopeAnchor++;
      calls.lastScopeAnchor = pending;
      currentPendingScope = pending;
    },
    async clear() {
      calls.scopeClear++;
      currentPendingScope = null;
    },
  };

  const deps: ConversationRuntimeDeps = {
    actors: { async resolveFromContext() { return ACTOR; } },
    sessions: {
      async openForContext() { return opts.session ?? sessionOf(); },
      async touch(s) { calls.sessionTouch++; calls.sessionWrites.push(s); return s; },
    },
    memory: {
      async recordShortTerm() { return { id: 'mem-1' }; },
      async recordAssistant() { calls.recordAssistant++; return undefined; },
      async recordToolMemory() { return undefined; },
    },
    classifier: {
      async classify() {
        calls.classify++;
        return opts.intent ?? intentOf(Capability.GENERAL_CHAT, IntentType.CHAT, false);
      },
    },
    projects: {
      async register() { return { ok: true, message: 'registered' }; },
      async get() { return opts.project === undefined ? projectOf() : opts.project; },
    },
    analyzer: { async prepare() { return { ready: true }; } },
    tasks: {
      async createTask() { throw new Error('createTask not expected'); },
      async transition(t) { return t; },
      async startRun() { throw new Error('startRun not expected'); },
      async completeRun() { return undefined; },
      async failRun() { return undefined; },
    },
    workspace: {
      async prepare() { return undefined; },
      async open() {
        if (opts.workspaceOpenThrows) throw new Error('open failed');
        return WORKSPACE;
      },
      async list(_ref, glob) {
        calls.workspaceList++;
        return opts.workspaceList ? opts.workspaceList(glob) : [];
      },
    },
    commandExecutions: {
      async get() { return opts.commandExec === undefined ? commandExecOf(CommandExecutionStatus.SUCCEEDED) : opts.commandExec; },
    },
    contextBuilder: { async build() { throw new Error('build not expected'); } },
    promptComposer: { compose() { throw new Error('compose not expected'); } },
    promptRenderer: { render() { throw new Error('render not expected'); } },
    router: {
      async select() {
        return {
          id: 'fake',
          capabilities: [],
          async isAvailable() { return true; },
          async execute() { return { text: 'hello', artifacts: [] }; },
        };
      },
    },
    artifacts: { async persistAll() { return []; } },
    composer,
    risk: { requiresApproval: (l) => l === RiskLevel.HIGH || l === RiskLevel.CRITICAL },
    intentResolver,
    orchestrator: {
      async run(request) { calls.run++; calls.lastRunRequest = request; return opts.runOutcome ?? outcomeOf(ExecutionOutcomeStatus.COMPLETED); },
      async resume() { calls.resume++; return opts.resumeOutcome ?? outcomeOf(ExecutionOutcomeStatus.COMPLETED); },
    },
    approvals: {
      async decide(id) { calls.decide++; return { ...pendingApprovalOf(), id, status: ApprovalStatus.REJECTED }; },
    },
    approvalFlow,
    scopeClarificationFlow,
    codeGeneration: {
      async generate(input) {
        calls.codeGenerationGenerate++;
        calls.lastCodeGenerationInput = input;
        if (opts.codeGeneration === 'throw') throw new Error('boom');
        return opts.codeGeneration ?? codeGenerationOf();
      },
      async getProposal() {
        calls.codeGenerationGetProposal++;
        return opts.codeProposal === undefined ? codeProposalOf() : opts.codeProposal;
      },
    },
    logger: silentLogger,
  };
  return { deps, calls };
}

// ── Sprint 2k — Conversation Runtime core ───────────────────────────────────────────────────────

describe('ConversationRuntime', () => {
  it('chat intent → RESPONDED', async () => {
    const { deps, calls } = makeDeps();
    const result = await new ConversationRuntime(deps).handle(messageOf('안녕'));
    expect(result.status).toBe('RESPONDED');
    expect(result.reply.text).toBe('hello');
    expect(calls.run).toBe(0);
  });

  it('execution intent (code, active project, validated target) → COMPLETED execution, RESPONDED turn', async () => {
    const { deps, calls } = makeDeps({
      intent: codeIntent,
      runOutcome: outcomeOf(ExecutionOutcomeStatus.COMPLETED),
      workspaceList: hitsFor(TARGET_FILE),
    });
    const result = await new ConversationRuntime(deps).handle(messageOf(`${TARGET_FILE}에서 이 버그 고쳐줘`));
    expect(calls.run).toBe(1);
    expect(result.executionOutcome?.status).toBe(ExecutionOutcomeStatus.COMPLETED);
    expect(result.status).toBe('RESPONDED');
  });

  it('high-risk execution (validated target) → AWAITING_APPROVAL + anchored', async () => {
    const { deps, calls } = makeDeps({
      intent: codeIntent,
      runOutcome: outcomeOf(ExecutionOutcomeStatus.AWAITING_APPROVAL),
      workspaceList: hitsFor(TARGET_FILE),
    });
    const result = await new ConversationRuntime(deps).handle(messageOf(`${TARGET_FILE}에서 배포해줘`));
    expect(result.status).toBe('AWAITING_APPROVAL');
    expect(calls.anchor).toBe(1);
  });

  it('next turn "승인" → decide + resume', async () => {
    const { deps, calls } = makeDeps({ pending: pendingApprovalOf() });
    const result = await new ConversationRuntime(deps).handle(messageOf('승인'));
    expect(calls.decide).toBe(1);
    expect(calls.resume).toBe(1);
    expect(result.status).toBe('RESPONDED');
  });

  it('next turn "거절" → DENIED, no resume', async () => {
    const { deps, calls } = makeDeps({ pending: pendingApprovalOf() });
    const result = await new ConversationRuntime(deps).handle(messageOf('거절'));
    expect(result.status).toBe('DENIED');
    expect(calls.resume).toBe(0);
  });

  it('next turn "취소" → CANCELLED, no resume', async () => {
    const { deps, calls } = makeDeps({ pending: pendingApprovalOf() });
    const result = await new ConversationRuntime(deps).handle(messageOf('취소'));
    expect(result.status).toBe('CANCELLED');
    expect(calls.resume).toBe(0);
  });

  it('ambiguous while pending → clarification, no decide, no resume', async () => {
    const { deps, calls } = makeDeps({ pending: pendingApprovalOf() });
    const result = await new ConversationRuntime(deps).handle(messageOf('음 글쎄'));
    expect(result.status).toBe('AWAITING_APPROVAL');
    expect(calls.decide).toBe(0);
    expect(calls.resume).toBe(0);
  });

  it('approve but reconstructResume() null → does NOT decide, re-asks', async () => {
    const { deps, calls } = makeDeps({ pending: pendingApprovalOf(), reconstruct: null });
    const result = await new ConversationRuntime(deps).handle(messageOf('승인'));
    expect(calls.decide).toBe(0);
    expect(calls.resume).toBe(0);
    expect(result.status).toBe('AWAITING_APPROVAL');
  });

  it('runtime persists no state of its own (no turn/runtime-state repository in deps)', async () => {
    const { deps } = makeDeps();
    expect(Object.keys(deps)).not.toContain('turnRepository');
    expect(Object.keys(deps)).not.toContain('runtimeStateRepository');
    await new ConversationRuntime(deps).handle(messageOf('안녕'));
  });

  it('no runtime snapshot is written to Session (only lastActivity touch)', async () => {
    const { deps, calls } = makeDeps({ intent: codeIntent, runOutcome: outcomeOf(ExecutionOutcomeStatus.AWAITING_APPROVAL) });
    await new ConversationRuntime(deps).handle(messageOf('배포해줘'));
    expect(calls.sessionTouch).toBe(1);
    for (const s of calls.sessionWrites) {
      expect(s).not.toHaveProperty('runtimeState');
      expect(s).not.toHaveProperty('pendingApprovalId');
    }
  });
});

// ── Sprint 2l — Live Test Execution ─────────────────────────────────────────────────────────────

describe('Live Test Execution — classifier + resolver', () => {
  const classifier = new IntentClassifier({} as unknown as CapabilityRouter);
  const resolver = new IntentResolver();

  it('"테스트 돌려줘" → RUN_TESTS / TEST_EXECUTION intent', async () => {
    const intent = await classifier.classify(messageOf('테스트 돌려줘'));
    expect(intent.type).toBe(IntentType.RUN_TESTS);
    expect(intent.capability).toBe(Capability.TEST_EXECUTION);
    expect(intent.raw?.kind).toBe('test');
  });

  it('"typecheck 돌려줘" → raw.kind typecheck', async () => {
    const intent = await classifier.classify(messageOf('typecheck 돌려줘'));
    expect(intent.raw?.kind).toBe('typecheck');
  });

  it('resolver maps kind "test" → command pnpm test', () => {
    const req = resolver.resolve(testIntent, { requestedBy: 'u', workspaceRef: WORKSPACE });
    expect(req?.command).toEqual({ command: 'pnpm', args: ['test'] });
  });

  it('resolver maps kind "typecheck" → command pnpm typecheck', () => {
    const req = resolver.resolve(intentOf(Capability.TEST_EXECUTION, IntentType.RUN_TESTS, true, { kind: 'typecheck' }), {
      requestedBy: 'u',
    });
    expect(req?.command).toEqual({ command: 'pnpm', args: ['typecheck'] });
  });

  it('user-supplied context.command is IGNORED for TEST_EXECUTION (only fixed commands produced)', () => {
    const req = resolver.resolve(testIntent, { requestedBy: 'u', command: { command: 'rm', args: ['-rf', '/'] } });
    expect(req?.command).toEqual({ command: 'pnpm', args: ['test'] });
  });
});

describe('Live Test Execution — runtime', () => {
  it('no active project → no orchestrator.run + composeNeedsProject reply', async () => {
    const { deps, calls } = makeDeps({ intent: testIntent, session: sessionOf({ activeProjectId: undefined }) });
    const result = await new ConversationRuntime(deps).handle(messageOf('테스트 돌려줘'));
    expect(calls.run).toBe(0);
    expect(result.reply.text).toBe(new ResponseComposer().composeNeedsProject(CTX).text);
  });

  it('workspace open failure → no run + composeWorkspaceUnavailable', async () => {
    const { deps, calls } = makeDeps({ intent: testIntent, workspaceOpenThrows: true });
    const result = await new ConversationRuntime(deps).handle(messageOf('테스트 돌려줘'));
    expect(calls.run).toBe(0);
    expect(result.status).toBe('FAILED');
    expect(result.reply.text).toBe(new ResponseComposer().composeWorkspaceUnavailable(CTX).text);
  });

  it('active project → orchestrator.run invoked with resolved workspaceRef + fixed command', async () => {
    const { deps, calls } = makeDeps({ intent: testIntent, runOutcome: outcomeOf(ExecutionOutcomeStatus.COMPLETED, 'cmd-1') });
    await new ConversationRuntime(deps).handle(messageOf('테스트 돌려줘'));
    expect(calls.run).toBe(1);
    expect(calls.lastRunRequest?.workspaceRef).toEqual(WORKSPACE);
    expect(calls.lastRunRequest?.command).toEqual({ command: 'pnpm', args: ['test'] });
  });

  it('tests pass (exit 0) → composeTestResult passed with detail, RESPONDED', async () => {
    const { deps } = makeDeps({
      intent: testIntent,
      runOutcome: outcomeOf(ExecutionOutcomeStatus.COMPLETED, 'cmd-1'),
      commandExec: commandExecOf(CommandExecutionStatus.SUCCEEDED, ['test'], 0, { stdout: 'ok\n' }),
    });
    const result = await new ConversationRuntime(deps).handle(messageOf('테스트 돌려줘'));
    expect(result.status).toBe('RESPONDED');
    expect(result.reply.text).toContain('통과');
    expect(result.reply.text).toContain('pnpm test');
    expect(result.reply.text).toContain('종료 코드: 0');
  });

  it('tests fail (exit≠0, ran) → composeTestResult failed as a RESULT with detail, not a system error', async () => {
    const { deps } = makeDeps({
      intent: testIntent,
      runOutcome: outcomeOf(ExecutionOutcomeStatus.STOPPED_ON_FAILURE, 'cmd-1'),
      commandExec: commandExecOf(CommandExecutionStatus.FAILED, ['test'], 1, { stdout: 'FAIL src/x.test.ts\n' }),
    });
    const result = await new ConversationRuntime(deps).handle(messageOf('테스트 돌려줘'));
    expect(result.status).toBe('RESPONDED'); // a test result, not FAILED
    expect(result.reply.text).toContain('실패');
    expect(result.reply.text).toContain('종료 코드: 1');
  });

  it('command timed out → composeTestTimedOut (distinct from composeCommandUnavailable), system failure', async () => {
    const { deps } = makeDeps({
      intent: testIntent,
      runOutcome: outcomeOf(ExecutionOutcomeStatus.STOPPED_ON_FAILURE, 'cmd-1'),
      commandExec: commandExecOf(CommandExecutionStatus.TIMED_OUT, ['test']),
    });
    const result = await new ConversationRuntime(deps).handle(messageOf('테스트 돌려줘'));
    expect(result.status).toBe('FAILED');
    expect(result.reply.text).not.toBe(new ResponseComposer().composeCommandUnavailable(CTX).text);
    expect(result.reply.text).toContain('제한 시간');
    expect(result.reply.text).not.toContain('종료 코드');
  });

  it('command never ran at all (no CommandExecution) → composeCommandUnavailable, unchanged', async () => {
    const { deps } = makeDeps({
      intent: testIntent,
      runOutcome: outcomeOf(ExecutionOutcomeStatus.STOPPED_ON_FAILURE),
      commandExec: null,
    });
    const result = await new ConversationRuntime(deps).handle(messageOf('테스트 돌려줘'));
    expect(result.status).toBe('FAILED');
    expect(result.reply.text).toBe(new ResponseComposer().composeCommandUnavailable(CTX).text);
  });
});

// ── Sprint 2n — Live Code Change Planning (ADR-0035) ────────────────────────────────────────────

describe('Live Code Change Planning — runtime', () => {
  it('no active project → no orchestrator.run + composeNeedsProject reply', async () => {
    const { deps, calls } = makeDeps({ intent: codeIntent, session: sessionOf({ activeProjectId: undefined }) });
    const result = await new ConversationRuntime(deps).handle(messageOf('이 버그 고쳐줘'));
    expect(calls.run).toBe(0);
    expect(result.reply.text).toBe(new ResponseComposer().composeNeedsProject(CTX).text);
  });

  it('the resolved ExecutionRequest is marked planningOnly (real IntentResolver, ADR-0035)', async () => {
    const { deps, calls } = makeDeps({
      intent: codeIntent,
      runOutcome: outcomeOf(ExecutionOutcomeStatus.AWAITING_APPROVAL),
      workspaceList: hitsFor(TARGET_FILE),
    });
    await new ConversationRuntime(deps).handle(messageOf(`${TARGET_FILE}에서 이 버그 고쳐줘`));
    expect(calls.lastRunRequest?.planningOnly).toBe(true);
  });

  it('active project + validated target → AWAITING_APPROVAL uses the code-change-specific prompt, not the generic one', async () => {
    const { deps, calls } = makeDeps({
      intent: codeIntent,
      runOutcome: outcomeOf(ExecutionOutcomeStatus.AWAITING_APPROVAL),
      workspaceList: hitsFor(TARGET_FILE),
    });
    const result = await new ConversationRuntime(deps).handle(messageOf(`${TARGET_FILE}에서 이 버그 고쳐줘`));
    expect(result.status).toBe('AWAITING_APPROVAL');
    expect(calls.anchor).toBe(1);
    expect(result.reply.text).toBe(new ResponseComposer().composeCodeChangeApprovalRequired(CTX).text);
    expect(result.reply.text).not.toBe(new ResponseComposer().composeApprovalRequired(CTX).text);
  });

  it('next turn "승인" on a planningOnly pending approval with no workspaceRef/targetFiles → guarded preview failure, never a fake "완료" (ADR-0038 supersedes composePlanningOnlyApproved)', async () => {
    const { deps, calls } = makeDeps({
      pending: pendingApprovalOf(),
      reconstruct: {
        request: {
          goal: 'g',
          instruction: 'g',
          requiredCapabilities: [Capability.CODE_IMPLEMENTATION],
          requestedBy: 'actor-1',
          planningOnly: true,
          // No workspaceRef/targetFiles — Sprint 2q's guard must reject this before calling
          // codeGeneration.generate at all, exactly as it would for any pre-Sprint-2o request.
        },
        prior: outcomeOf(ExecutionOutcomeStatus.AWAITING_APPROVAL),
      },
    });
    const result = await new ConversationRuntime(deps).handle(messageOf('승인'));
    expect(calls.decide).toBe(1);
    expect(calls.resume).toBe(1);
    expect(calls.codeGenerationGenerate).toBe(0);
    expect(result.status).toBe('FAILED');
    expect(result.reply.text).toBe(new ResponseComposer().composeCodeGenerationPreviewFailed(CTX).text);
    expect(result.reply.text).not.toBe(new ResponseComposer().composeExecutionResult(CTX, 'COMPLETED').text);
    expect(result.reply.text).not.toContain('완료');
  });

  it('next turn "취소" on the same planningOnly pending approval still cancels normally (no resume)', async () => {
    const { deps, calls } = makeDeps({
      pending: pendingApprovalOf(),
      reconstruct: {
        request: {
          goal: 'g',
          instruction: 'g',
          requiredCapabilities: [Capability.CODE_IMPLEMENTATION],
          requestedBy: 'actor-1',
          planningOnly: true,
        },
        prior: outcomeOf(ExecutionOutcomeStatus.AWAITING_APPROVAL),
      },
    });
    const result = await new ConversationRuntime(deps).handle(messageOf('취소'));
    expect(result.status).toBe('CANCELLED');
    expect(calls.resume).toBe(0);
  });
});

// ── Sprint 2o — Code Change Scope Collection (ADR-0036) ─────────────────────────────────────────

describe('Code Change Scope Collection — runtime', () => {
  it('no path candidate ("이 버그 고쳐줘") → composeTargetScopeClarification, orchestrator.run never called', async () => {
    const { deps, calls } = makeDeps({ intent: codeIntent });
    const result = await new ConversationRuntime(deps).handle(messageOf('이 버그 고쳐줘'));
    expect(calls.run).toBe(0);
    expect(calls.workspaceList).toBe(0); // no candidates to try
    expect(result.status).toBe('RESPONDED');
    expect(result.reply.text).toBe(new ResponseComposer().composeTargetScopeClarification(CTX).text);
    expect(calls.scopeAnchor).toBe(1); // ADR-0037: anchors so the next turn can recover this request
  });

  it('module/area text only ("로그인 처리 부분 수정해줘") → clarification, no run (CA Case 3)', async () => {
    const { deps, calls } = makeDeps({ intent: codeIntent });
    const result = await new ConversationRuntime(deps).handle(messageOf('로그인 처리 부분 수정해줘'));
    expect(calls.run).toBe(0);
    expect(result.reply.text).toBe(new ResponseComposer().composeTargetScopeClarification(CTX).text);
    expect(calls.scopeAnchor).toBe(1);
  });

  it('a path candidate that does not validate (fake workspace.list returns []) → clarification, no run', async () => {
    const { deps, calls } = makeDeps({ intent: codeIntent, workspaceList: () => [] });
    const result = await new ConversationRuntime(deps).handle(messageOf(`${TARGET_FILE}에서 이 버그 고쳐줘`));
    expect(calls.run).toBe(0);
    expect(result.reply.text).toBe(new ResponseComposer().composeTargetScopeClarification(CTX).text);
  });

  it('a workspace.list hit that does not normalize-equal the candidate is not trusted (glob false-positive guard)', async () => {
    const { deps, calls } = makeDeps({
      intent: codeIntent,
      // A hit is returned, but for a DIFFERENT path than the candidate — must not be accepted.
      workspaceList: () => ['packages/core/src/application/other.ts'],
    });
    const result = await new ConversationRuntime(deps).handle(messageOf(`${TARGET_FILE}에서 이 버그 고쳐줘`));
    expect(calls.run).toBe(0);
    expect(result.reply.text).toBe(new ResponseComposer().composeTargetScopeClarification(CTX).text);
  });

  it('a validated candidate threads the Workspace-returned hit into targetFiles, not the raw candidate', async () => {
    const { deps, calls } = makeDeps({
      intent: codeIntent,
      runOutcome: outcomeOf(ExecutionOutcomeStatus.AWAITING_APPROVAL),
      // Workspace returns a differently-formatted-but-equal path; targetFiles must carry THIS value.
      workspaceList: (glob) => (glob === TARGET_FILE ? [`./${TARGET_FILE}`] : []),
    });
    await new ConversationRuntime(deps).handle(messageOf(`${TARGET_FILE}에서 이 버그 고쳐줘`));
    expect(calls.lastRunRequest?.targetFiles).toEqual([`./${TARGET_FILE}`]);
  });

  it('secret/ignored/outside-workspace mentions all fail validation (mirrors the real provider, workspace-local/src/index.test.ts:147)', async () => {
    for (const text of [
      '.env에서 이 버그 고쳐줘',
      'node_modules/foo.ts에서 이 버그 고쳐줘',
      '/etc/passwd에서 이 버그 고쳐줘',
    ]) {
      const { deps, calls } = makeDeps({ intent: codeIntent, workspaceList: () => [] });
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.run).toBe(0);
      expect(result.reply.text).toBe(new ResponseComposer().composeTargetScopeClarification(CTX).text);
    }
  });

  it('a traversal mention ("../escape.ts") never reaches workspace.list at all (rejected at extraction)', async () => {
    const { deps, calls } = makeDeps({ intent: codeIntent });
    const result = await new ConversationRuntime(deps).handle(messageOf('../escape.ts에서 이 버그 고쳐줘'));
    expect(calls.workspaceList).toBe(0);
    expect(calls.run).toBe(0);
    expect(result.reply.text).toBe(new ResponseComposer().composeTargetScopeClarification(CTX).text);
  });

  it('bounds validation attempts at MAX_TARGET_CANDIDATES (5) even with more candidates in one message', async () => {
    const manyPaths = Array.from({ length: 8 }, (_, i) => `packages/core/src/f${i}.ts`);
    const { deps, calls } = makeDeps({ intent: codeIntent, workspaceList: () => [] });
    await new ConversationRuntime(deps).handle(messageOf(`${manyPaths.join(' ')} 고쳐줘`));
    expect(calls.workspaceList).toBe(5);
  });

  it('TEST_EXECUTION never calls workspace.list nor anchors a scope clarification (gate is CODE_IMPLEMENTATION-only)', async () => {
    const { deps, calls } = makeDeps({ intent: testIntent, runOutcome: outcomeOf(ExecutionOutcomeStatus.COMPLETED, 'cmd-1') });
    await new ConversationRuntime(deps).handle(messageOf('테스트 돌려줘'));
    expect(calls.workspaceList).toBe(0);
    expect(calls.scopeAnchor).toBe(0);
  });

  it('PROJECT_ANALYSIS never calls workspace.list nor anchors a scope clarification', async () => {
    // PROJECT_ANALYSIS isn't an execution capability — it never reaches handleExecutionIntent at
    // all, so it can't hit this sprint's new gate; gate the analyzer itself to keep the fake
    // harness from exercising the unrelated work-turn/task machinery.
    const { deps, calls } = makeDeps({ intent: intentOf(Capability.PROJECT_ANALYSIS, IntentType.PROJECT_ANALYSIS, true) });
    const notReady = { ...deps, analyzer: { async prepare() { return { ready: false, message: '아직 준비되지 않았어요.' }; } } };
    await new ConversationRuntime(notReady).handle(messageOf('이 프로젝트 구조 설명해줘'));
    expect(calls.workspaceList).toBe(0);
    expect(calls.scopeAnchor).toBe(0);
  });

  it('CHAT never calls workspace.list nor anchors a scope clarification', async () => {
    const { deps, calls } = makeDeps();
    await new ConversationRuntime(deps).handle(messageOf('안녕'));
    expect(calls.workspaceList).toBe(0);
    expect(calls.scopeAnchor).toBe(0);
  });

  it('no active project + a path in the message → still composeNeedsProject, no run, no workspace.list, no anchor', async () => {
    const { deps, calls } = makeDeps({ intent: codeIntent, session: sessionOf({ activeProjectId: undefined }) });
    const result = await new ConversationRuntime(deps).handle(messageOf(`${TARGET_FILE}에서 이 버그 고쳐줘`));
    expect(calls.run).toBe(0);
    expect(calls.workspaceList).toBe(0);
    expect(result.reply.text).toBe(new ResponseComposer().composeNeedsProject(CTX).text);
    expect(calls.scopeAnchor).toBe(0); // CA Round 1 Required Change #10 — anchor requires an active project
  });

  it('workspace-open failure + a path in the message → still composeWorkspaceUnavailable, no run, no anchor', async () => {
    const { deps, calls } = makeDeps({ intent: codeIntent, workspaceOpenThrows: true });
    const result = await new ConversationRuntime(deps).handle(messageOf(`${TARGET_FILE}에서 이 버그 고쳐줘`));
    expect(calls.run).toBe(0);
    expect(result.reply.text).toBe(new ResponseComposer().composeWorkspaceUnavailable(CTX).text);
    expect(calls.scopeAnchor).toBe(0); // CA Round 1 Required Change #10 — anchor requires the workspace to open
  });
});

// ── Sprint 2p — Multi-turn Code Scope Clarification (ADR-0037) ─────────────────────────────────

describe('Multi-turn Code Scope Clarification — runtime', () => {
  it('Case 2: a bare path reply (no verb) recovers the original request using ITS summary, not the follow-up text', async () => {
    const { deps, calls } = makeDeps({
      intent: codeIntent, // classifier fake returns this for turn 1 only — turn 2 never calls it
      runOutcome: outcomeOf(ExecutionOutcomeStatus.AWAITING_APPROVAL),
      workspaceList: hitsFor(TARGET_FILE),
    });
    await new ConversationRuntime(deps).handle(messageOf('이 버그 고쳐줘')); // turn 1: anchors
    expect(calls.scopeAnchor).toBe(1);
    expect(calls.lastScopeAnchor?.summary).toBe(codeIntent.summary);

    const classifyCallsBeforeTurn2 = calls.classify;
    const result = await new ConversationRuntime(deps).handle(messageOf(TARGET_FILE)); // turn 2: bare path

    expect(calls.classify).toBe(classifyCallsBeforeTurn2); // classifier never consulted for this turn (Q6)
    expect(calls.run).toBe(1);
    expect(calls.lastRunRequest?.goal).toBe(codeIntent.summary); // original summary, not "TARGET_FILE"
    expect(calls.lastRunRequest?.instruction).toBe(codeIntent.summary);
    expect(calls.lastRunRequest?.targetFiles).toEqual([TARGET_FILE]);
    expect(calls.lastRunRequest?.planningOnly).toBe(true);
    expect(result.status).toBe('AWAITING_APPROVAL');
    expect(result.reply.text).toBe(new ResponseComposer().composeCodeChangeApprovalRequired(CTX).text);
  });

  it('Case 3: an invalid path reply clears the anchor without recovering, and does not re-anchor', async () => {
    const { deps, calls } = makeDeps({ intent: codeIntent, workspaceList: () => [] });
    await new ConversationRuntime(deps).handle(messageOf('이 버그 고쳐줘')); // turn 1: anchors
    expect(calls.scopeAnchor).toBe(1);

    const recordAssistantBeforeTurn2 = calls.recordAssistant;
    const result = await new ConversationRuntime(deps).handle(messageOf('node_modules/foo.ts')); // turn 2: invalid

    expect(calls.run).toBe(0);
    expect(calls.scopeClear).toBe(1);
    expect(calls.scopeAnchor).toBe(1); // still just the original anchor — no re-anchor on failure
    expect(result.reply.text).toBe(new ResponseComposer().composeTargetScopeClarification(CTX).text);
    // CA Implementation Review (Round 1): the clarification reply must be recorded to memory exactly
    // once per turn, not twice (respondComposed already records it — no separate manual call).
    expect(calls.recordAssistant - recordAssistantBeforeTurn2).toBe(1);
  });

  it('Case 4: "취소" while pending clears the anchor and never claims a plan/patch/execution existed', async () => {
    const { deps, calls } = makeDeps({ intent: codeIntent });
    await new ConversationRuntime(deps).handle(messageOf('이 버그 고쳐줘')); // turn 1: anchors

    const result = await new ConversationRuntime(deps).handle(messageOf('취소')); // turn 2: cancel

    expect(calls.run).toBe(0);
    expect(calls.scopeClear).toBe(1);
    expect(result.status).toBe('CANCELLED');
    expect(result.reply.text).toBe(new ResponseComposer().composeScopeClarificationCancelled(CTX).text);
    expect(result.reply.text).not.toContain('완료');
    expect(result.reply.text).not.toContain('계획');
  });

  it('next-turn-only: after a failed retry clears the anchor, a bare path alone is not classified as code-change either', async () => {
    const { deps, calls } = makeDeps({ intent: codeIntent, workspaceList: () => [] });
    await new ConversationRuntime(deps).handle(messageOf('이 버그 고쳐줘')); // turn 1: anchors
    await new ConversationRuntime(deps).handle(messageOf('node_modules/foo.ts')); // turn 2: fails, clears
    expect(calls.scopeClear).toBe(1);

    // The anchor is genuinely gone (stateful fake mirrors StatelessScopeClarificationFlow.clear()).
    expect(await deps.scopeClarificationFlow.findPending(sessionOf())).toBeNull();

    // And without an anchor, the real classifier would not mistake a bare path for a code-change
    // request either (no fix/change/refactor verb) — so a third message could never be silently
    // recovered even by accident.
    const realClassifier = new IntentClassifier({} as unknown as CapabilityRouter);
    const intent = await realClassifier.classify(messageOf(TARGET_FILE));
    expect(intent.type).not.toBe(IntentType.IMPLEMENT_CODE);
  });

  it('ordering: when an approval is pending, scopeClarificationFlow is never consulted', async () => {
    const { deps, calls } = makeDeps({ pending: pendingApprovalOf() });
    await new ConversationRuntime(deps).handle(messageOf(TARGET_FILE)); // could look like a clarification answer
    expect(calls.scopeFindPending).toBe(0); // approvalFlow handled the turn first
    expect(calls.scopeClear).toBe(0);
    expect(calls.scopeAnchor).toBe(0);
  });
});

// ── Sprint 2q — AI Code Generation Preview (ADR-0038) ───────────────────────────────────────────

/** A resumable planningOnly ExecutionRequest with the workspaceRef/targetFiles a real Sprint 2o/2p
 *  flow would have anchored (Sprint 2q tests default to the "everything present" happy path). */
const planningOnlyRequestOf = (o: Partial<ExecutionRequest> = {}): ExecutionRequest => ({
  goal: '이 버그 고쳐줘',
  instruction: '이 버그 고쳐줘',
  requiredCapabilities: [Capability.CODE_IMPLEMENTATION],
  requestedBy: 'actor-1',
  planningOnly: true,
  workspaceRef: WORKSPACE,
  targetFiles: [TARGET_FILE],
  ...o,
});

/** Drive the approval-turn "승인" path with a given reconstructed request/resume-outcome. */
async function approveWith(
  opts: Opts,
  request: ExecutionRequest,
  resumeOutcome?: ExecutionOutcome,
): Promise<{ result: Awaited<ReturnType<ConversationRuntime['handle']>>; calls: Calls }> {
  const { deps, calls } = makeDeps({
    ...opts,
    pending: pendingApprovalOf(),
    reconstruct: { request, prior: outcomeOf(ExecutionOutcomeStatus.AWAITING_APPROVAL) },
    ...(resumeOutcome ? { resumeOutcome } : {}),
  });
  const result = await new ConversationRuntime(deps).handle(messageOf('승인'));
  return { result, calls };
}

describe('AI Code Generation Preview — runtime', () => {
  it('successful in-scope proposal → composeCodeGenerationPreview, RESPONDED, generate called exactly once', async () => {
    const { result, calls } = await approveWith({}, planningOnlyRequestOf());
    expect(calls.codeGenerationGenerate).toBe(1);
    expect(calls.codeGenerationGetProposal).toBe(1);
    expect(result.status).toBe('RESPONDED');
    expect(result.reply.text).toBe(
      new ResponseComposer().composeCodeGenerationPreview(CTX, {
        changes: [{ path: TARGET_FILE, kind: 'update', excerpt: 'fixed content' }],
        outOfScopeWarnings: [],
      }).text,
    );
  });

  it('generate() input uses the original summary, the resumed plan ref, and the validated workspaceRef/targetFiles', async () => {
    const { calls } = await approveWith({}, planningOnlyRequestOf());
    expect(calls.lastCodeGenerationInput?.executionPlanRef).toEqual({ id: 'plan-1', goal: 'g' });
    expect(calls.lastCodeGenerationInput?.instruction).toBe('이 버그 고쳐줘');
    expect(calls.lastCodeGenerationInput?.workspaceRef).toEqual(WORKSPACE);
    expect(calls.lastCodeGenerationInput?.targetFiles).toEqual([TARGET_FILE]);
    expect(calls.lastCodeGenerationInput?.capability).toBe(Capability.CODE_IMPLEMENTATION);
  });

  it('missing executionPlanRef on the resume outcome → generate never called, failed preview, FAILED', async () => {
    const noRefOutcome: ExecutionOutcome = {
      status: ExecutionOutcomeStatus.COMPLETED,
      lastStage: ExecutionStage.APPROVAL,
      selectedStages: [ExecutionStage.PLANNING, ExecutionStage.APPROVAL],
      refs: {},
    };
    const { result, calls } = await approveWith({}, planningOnlyRequestOf(), noRefOutcome);
    expect(calls.codeGenerationGenerate).toBe(0);
    expect(result.status).toBe('FAILED');
    expect(result.reply.text).toBe(new ResponseComposer().composeCodeGenerationPreviewFailed(CTX).text);
  });

  it('missing workspaceRef on the reconstructed request → generate never called, failed preview, FAILED', async () => {
    const { result, calls } = await approveWith({}, planningOnlyRequestOf({ workspaceRef: undefined }));
    expect(calls.codeGenerationGenerate).toBe(0);
    expect(result.status).toBe('FAILED');
    expect(result.reply.text).toBe(new ResponseComposer().composeCodeGenerationPreviewFailed(CTX).text);
  });

  it('undefined targetFiles → generate never called, failed preview, FAILED', async () => {
    const { result, calls } = await approveWith({}, planningOnlyRequestOf({ targetFiles: undefined }));
    expect(calls.codeGenerationGenerate).toBe(0);
    expect(result.status).toBe('FAILED');
    expect(result.reply.text).toBe(new ResponseComposer().composeCodeGenerationPreviewFailed(CTX).text);
  });

  it('empty targetFiles ([]) → generate never called, failed preview, FAILED', async () => {
    const { result, calls } = await approveWith({}, planningOnlyRequestOf({ targetFiles: [] }));
    expect(calls.codeGenerationGenerate).toBe(0);
    expect(result.status).toBe('FAILED');
    expect(result.reply.text).toBe(new ResponseComposer().composeCodeGenerationPreviewFailed(CTX).text);
  });

  it('FAILED generation → getProposal not called, failed preview, FAILED', async () => {
    const { result, calls } = await approveWith(
      { codeGeneration: codeGenerationOf({ status: CodeGenerationStatus.FAILED, codeProposalRef: undefined }) },
      planningOnlyRequestOf(),
    );
    expect(calls.codeGenerationGetProposal).toBe(0);
    expect(result.status).toBe('FAILED');
    expect(result.reply.text).toBe(new ResponseComposer().composeCodeGenerationPreviewFailed(CTX).text);
  });

  it('generate() throws → failed preview, FAILED, never an unhandled rejection', async () => {
    const { result } = await approveWith({ codeGeneration: 'throw' }, planningOnlyRequestOf());
    expect(result.status).toBe('FAILED');
    expect(result.reply.text).toBe(new ResponseComposer().composeCodeGenerationPreviewFailed(CTX).text);
  });

  it('SUCCEEDED generation with a null proposal → failed preview, FAILED', async () => {
    const { result } = await approveWith({ codeProposal: null }, planningOnlyRequestOf());
    expect(result.status).toBe('FAILED');
    expect(result.reply.text).toBe(new ResponseComposer().composeCodeGenerationPreviewFailed(CTX).text);
  });

  it('a proposal path outside targetFiles is never rendered as content, only as a warning', async () => {
    const { result } = await approveWith(
      { codeProposal: codeProposalOf({ proposal: [{ path: 'packages/core/other.ts', newContent: 'x' }] }) },
      planningOnlyRequestOf(),
    );
    expect(result.status).toBe('FAILED'); // the only proposed path was out of scope — no valid change
    expect(result.reply.text).toBe(
      new ResponseComposer().composeCodeGenerationPreviewNoValidChange(CTX, ['packages/core/other.ts']).text,
    );
    expect(result.reply.text).not.toContain('x'); // out-of-scope content is never rendered
  });

  it('a mix of in-scope and out-of-scope paths renders only the in-scope one, with a warning for the rest', async () => {
    const { result } = await approveWith(
      {
        codeProposal: codeProposalOf({
          proposal: [
            { path: TARGET_FILE, newContent: 'fixed content' },
            { path: 'packages/core/other.ts', newContent: 'unexpected' },
          ],
        }),
      },
      planningOnlyRequestOf(),
    );
    expect(result.status).toBe('RESPONDED');
    expect(result.reply.text).toContain(TARGET_FILE);
    expect(result.reply.text).toContain('fixed content');
    expect(result.reply.text).not.toContain('unexpected');
    expect(result.reply.text).toContain('packages/core/other.ts'); // named only in the warning line
  });

  it('a proposal path that normalizes-equal to targetFiles but is formatted differently still renders using the validated path', async () => {
    const { result } = await approveWith(
      { codeProposal: codeProposalOf({ proposal: [{ path: `./${TARGET_FILE}`, newContent: 'fixed content' }] }) },
      planningOnlyRequestOf(),
    );
    expect(result.status).toBe('RESPONDED');
    expect(result.reply.text).toContain(TARGET_FILE); // the validated targetFiles value, not "./..."
    expect(result.reply.text).not.toContain(`./${TARGET_FILE}`);
  });

  it('deny ("거절") never calls codeGeneration.generate', async () => {
    const { deps, calls } = makeDeps({ pending: pendingApprovalOf() });
    await new ConversationRuntime(deps).handle(messageOf('거절'));
    expect(calls.codeGenerationGenerate).toBe(0);
  });

  it('cancel ("취소") never calls codeGeneration.generate', async () => {
    const { deps, calls } = makeDeps({ pending: pendingApprovalOf() });
    await new ConversationRuntime(deps).handle(messageOf('취소'));
    expect(calls.codeGenerationGenerate).toBe(0);
  });

  it('reconstructResume failure (re-ask) never calls codeGeneration.generate', async () => {
    const { deps, calls } = makeDeps({ pending: pendingApprovalOf(), reconstruct: null });
    await new ConversationRuntime(deps).handle(messageOf('승인'));
    expect(calls.codeGenerationGenerate).toBe(0);
  });

  it('a non-planningOnly approval resume never calls codeGeneration.generate', async () => {
    const { result, calls } = await approveWith({}, {
      goal: 'g',
      instruction: 'g',
      requiredCapabilities: [Capability.CODE_IMPLEMENTATION],
      requestedBy: 'actor-1',
      // planningOnly deliberately absent
    });
    expect(calls.codeGenerationGenerate).toBe(0);
    expect(result.status).toBe('RESPONDED'); // falls through to the existing generic replyForOutcome path
  });

  it('a successful preview TurnResult preserves executionOutcome', async () => {
    const resumeOutcome = outcomeOf(ExecutionOutcomeStatus.COMPLETED);
    const { result } = await approveWith({}, planningOnlyRequestOf(), resumeOutcome);
    expect(result.executionOutcome).toBe(resumeOutcome);
  });

  it('a failed preview TurnResult preserves executionOutcome when one is available', async () => {
    const resumeOutcome = outcomeOf(ExecutionOutcomeStatus.COMPLETED);
    const { result } = await approveWith({ codeGeneration: 'throw' }, planningOnlyRequestOf(), resumeOutcome);
    expect(result.executionOutcome).toBe(resumeOutcome);
  });

});

describe('toCodeChangePreview (Sprint 2q, ADR-0038)', () => {
  it('an in-scope change passes through with its excerpt and the validated target path', () => {
    const preview = toCodeChangePreview([{ path: TARGET_FILE, newContent: 'x' }], [TARGET_FILE]);
    expect(preview.changes).toEqual([{ path: TARGET_FILE, kind: 'update', excerpt: 'x' }]);
    expect(preview.outOfScopeWarnings).toEqual([]);
  });

  it('a delete change has no excerpt', () => {
    const preview = toCodeChangePreview([{ path: TARGET_FILE, delete: true }], [TARGET_FILE]);
    expect(preview.changes).toEqual([{ path: TARGET_FILE, kind: 'delete' }]);
  });

  it('an out-of-scope path is excluded from changes and appears in outOfScopeWarnings using the AI raw string', () => {
    const preview = toCodeChangePreview([{ path: 'other.ts', newContent: 'x' }], [TARGET_FILE]);
    expect(preview.changes).toEqual([]);
    expect(preview.outOfScopeWarnings).toEqual(['other.ts']);
  });

  it('a differently-formatted but normalize-equal path is in-scope and rendered with the validated value', () => {
    const preview = toCodeChangePreview([{ path: `./${TARGET_FILE}`, newContent: 'x' }], [TARGET_FILE]);
    expect(preview.changes).toEqual([{ path: TARGET_FILE, kind: 'update', excerpt: 'x' }]);
  });

  it('an empty targetFiles list treats every proposed path as out of scope', () => {
    const preview = toCodeChangePreview([{ path: TARGET_FILE, newContent: 'x' }], []);
    expect(preview.changes).toEqual([]);
    expect(preview.outOfScopeWarnings).toEqual([TARGET_FILE]);
  });
});

// ── Production-like resume (Sprint 2k, retained) ─────────────────────────────────────────────────

describe('ConversationRuntime + StatelessApprovalFlow (production-like)', () => {
  it('execution halts, then next-turn "승인" reconstructs and reaches orchestrator.resume()', async () => {
    const sessions = new Map<string, Session>();
    const tasks = new Map<string, Task>();
    const approvals: ApprovalRequest[] = [];
    sessions.set('sess-1', sessionOf());
    let resumeCalls = 0;

    const store = {
      sessions: { async save(s: Session) { sessions.set(s.id, s); return s; } },
      tasks: {
        async get(id: string) { return tasks.get(id) ?? null; },
        async save(t: Task) { tasks.set(t.id, t); return t; },
      },
      approvals: { async findByExecutionPlan(planId: string) { return approvals.filter((a) => a.executionPlanRef.id === planId); } },
    };
    const approvalFlow = new StatelessApprovalFlow(store);

    const { deps: base, calls } = makeDeps({
      intent: codeIntent,
      runOutcome: outcomeOf(ExecutionOutcomeStatus.AWAITING_APPROVAL),
      workspaceList: hitsFor(TARGET_FILE),
    });
    const deps: ConversationRuntimeDeps = {
      ...base,
      approvalFlow,
      sessions: {
        async openForContext() { return sessions.get('sess-1')!; },
        async touch(s) { sessions.set(s.id, s); return s; },
      },
      orchestrator: {
        async run() { approvals.push(pendingApprovalOf()); return outcomeOf(ExecutionOutcomeStatus.AWAITING_APPROVAL); },
        async resume() { resumeCalls++; return outcomeOf(ExecutionOutcomeStatus.COMPLETED); },
      },
      approvals: {
        async decide(id) {
          const idx = approvals.findIndex((a) => a.id === id);
          if (idx >= 0) approvals[idx] = { ...approvals[idx]!, status: ApprovalStatus.APPROVED };
          return approvals[idx]!;
        },
      },
    };
    const runtime = new ConversationRuntime(deps);

    const t1 = await runtime.handle(messageOf(`${TARGET_FILE}에서 이 버그 고쳐줘`));
    expect(t1.status).toBe('AWAITING_APPROVAL');
    expect(sessions.get('sess-1')?.activeTaskId).toBeTruthy();

    const t2 = await runtime.handle(messageOf('승인'));
    expect(resumeCalls).toBe(1);
    expect(t2.status).toBe('RESPONDED');
    // ADR-0038: the resumed planningOnly request's real, anchored/reconstructed targetFiles/
    // workspaceRef reach the preview step, and CodeGeneration runs exactly once.
    expect(calls.codeGenerationGenerate).toBe(1);
  });
});
