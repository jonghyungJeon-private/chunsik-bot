import { describe, expect, it } from 'vitest';
import {
  ApprovalStatus,
  Capability,
  CommandExecutionStatus,
  IntentType,
  RiskLevel,
  SessionStatus,
} from '../domain';
import type {
  Actor,
  ApprovalRequest,
  CommandExecution,
  ConversationContext,
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
import { ConversationRuntime } from './conversation-runtime';
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
      async recordAssistant() { return undefined; },
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

  it('next turn "승인" on a planningOnly pending approval → composePlanningOnlyApproved, never a fake "완료"', async () => {
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
    const result = await new ConversationRuntime(deps).handle(messageOf('승인'));
    expect(calls.decide).toBe(1);
    expect(calls.resume).toBe(1);
    expect(result.status).toBe('RESPONDED');
    expect(result.reply.text).toBe(new ResponseComposer().composePlanningOnlyApproved(CTX).text);
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

    const result = await new ConversationRuntime(deps).handle(messageOf('node_modules/foo.ts')); // turn 2: invalid

    expect(calls.run).toBe(0);
    expect(calls.scopeClear).toBe(1);
    expect(calls.scopeAnchor).toBe(1); // still just the original anchor — no re-anchor on failure
    expect(result.reply.text).toBe(new ResponseComposer().composeTargetScopeClarification(CTX).text);
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

    const base = makeDeps({
      intent: codeIntent,
      runOutcome: outcomeOf(ExecutionOutcomeStatus.AWAITING_APPROVAL),
      workspaceList: hitsFor(TARGET_FILE),
    }).deps;
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
  });
});
