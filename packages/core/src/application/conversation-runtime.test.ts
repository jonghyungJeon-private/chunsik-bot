import { describe, expect, it } from 'vitest';
import {
  ApprovalStatus,
  Capability,
  IntentType,
  RiskLevel,
  SessionStatus,
} from '../domain';
import type {
  Actor,
  ApprovalRequest,
  ConversationContext,
  InboundMessage,
  Intent,
  Session,
  Task,
} from '../domain';
import type { Logger } from '../ports';
import { ResponseComposer } from './response-composer';
import { IntentResolver } from './intent-resolver';
import { ExecutionOutcomeStatus, ExecutionStage } from './execution-orchestrator';
import type { ExecutionOutcome, ExecutionRequest } from './execution-orchestrator';
import { ConversationRuntime } from './conversation-runtime';
import type { ApprovalFlow, ConversationRuntimeDeps } from './conversation-runtime';
import { StatelessApprovalFlow } from './stateless-approval-flow';

const TS = '2026-07-01T00:00:00.000Z';
const CTX: ConversationContext = { platform: 'test', channelId: 'c1', userId: 'u1' };
const ACTOR: Actor = { id: 'actor-1' } as Actor;
const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

const sessionOf = (o: Partial<Session> = {}): Session => ({
  id: 'sess-1',
  actorId: 'actor-1',
  context: CTX,
  status: SessionStatus.ACTIVE,
  createdAt: TS,
  lastActivityAt: TS,
  ...o,
});

const messageOf = (text: string): InboundMessage => ({ id: 'm1', context: CTX, text, receivedAt: TS });

const intentOf = (capability: Capability, type: IntentType, requiresWork: boolean): Intent => ({
  type,
  capability,
  confidence: 1,
  requiresWork,
  summary: 'do the thing',
});

const outcomeOf = (status: ExecutionOutcomeStatus): ExecutionOutcome => ({
  status,
  lastStage: ExecutionStage.PLANNING,
  selectedStages: [ExecutionStage.PLANNING],
  refs: { executionPlanRef: { id: 'plan-1', goal: 'g' } },
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

interface Calls {
  run: number;
  resume: number;
  decide: number;
  anchor: number;
  sessionTouch: number;
  sessionWrites: Session[];
}

interface Opts {
  intent?: Intent;
  runOutcome?: ExecutionOutcome;
  resumeOutcome?: ExecutionOutcome;
  pending?: ApprovalRequest | null;
  reconstruct?: { request: ExecutionRequest; prior: ExecutionOutcome } | null;
}

function makeDeps(opts: Opts = {}): { deps: ConversationRuntimeDeps; calls: Calls } {
  const calls: Calls = { run: 0, resume: 0, decide: 0, anchor: 0, sessionTouch: 0, sessionWrites: [] };
  const composer = new ResponseComposer();
  const intentResolver = new IntentResolver(); // real (pure)

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

  const deps: ConversationRuntimeDeps = {
    actors: { async resolveFromContext() { return ACTOR; } },
    sessions: {
      async openForContext() { return sessionOf(); },
      async touch(s) { calls.sessionTouch++; calls.sessionWrites.push(s); return s; },
    },
    memory: {
      async recordShortTerm() { return { id: 'mem-1' }; },
      async recordAssistant() { return undefined; },
      async recordToolMemory() { return undefined; },
    },
    classifier: {
      async classify() { return opts.intent ?? intentOf(Capability.GENERAL_CHAT, IntentType.CHAT, false); },
    },
    projects: { async register() { return { ok: true, message: 'registered' }; } },
    analyzer: { async prepare() { return { ready: true }; } },
    tasks: {
      async createTask() { throw new Error('createTask not expected in these tests'); },
      async transition(t) { return t; },
      async startRun() { throw new Error('startRun not expected'); },
      async completeRun() { return undefined; },
      async failRun() { return undefined; },
    },
    workspace: { async prepare() { return undefined; } },
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
      async run() { calls.run++; return opts.runOutcome ?? outcomeOf(ExecutionOutcomeStatus.COMPLETED); },
      async resume() { calls.resume++; return opts.resumeOutcome ?? outcomeOf(ExecutionOutcomeStatus.COMPLETED); },
    },
    approvals: {
      async decide(id) {
        calls.decide++;
        return { ...pendingApprovalOf(), id, status: ApprovalStatus.REJECTED };
      },
    },
    approvalFlow,
    logger: silentLogger,
  };
  return { deps, calls };
}

const execIntent = intentOf(Capability.CODE_IMPLEMENTATION, IntentType.IMPLEMENT_CODE, true);

describe('ConversationRuntime', () => {
  it('1. chat intent → RESPONDED', async () => {
    const { deps, calls } = makeDeps(); // default classify = GENERAL_CHAT, requiresWork false
    const result = await new ConversationRuntime(deps).handle(messageOf('안녕'));
    expect(result.status).toBe('RESPONDED');
    expect(result.reply.text).toBe('hello');
    expect(calls.run).toBe(0);
  });

  it('2. execution intent, low risk → COMPLETED execution, RESPONDED turn', async () => {
    const { deps, calls } = makeDeps({ intent: execIntent, runOutcome: outcomeOf(ExecutionOutcomeStatus.COMPLETED) });
    const result = await new ConversationRuntime(deps).handle(messageOf('이 버그 고쳐줘'));
    expect(calls.run).toBe(1);
    expect(result.executionOutcome?.status).toBe(ExecutionOutcomeStatus.COMPLETED);
    expect(result.status).toBe('RESPONDED');
    expect(result.reply.text).toContain('완료');
  });

  it('3. execution intent, high risk → AWAITING_APPROVAL + anchored', async () => {
    const { deps, calls } = makeDeps({ intent: execIntent, runOutcome: outcomeOf(ExecutionOutcomeStatus.AWAITING_APPROVAL) });
    const result = await new ConversationRuntime(deps).handle(messageOf('배포해줘'));
    expect(result.status).toBe('AWAITING_APPROVAL');
    expect(calls.anchor).toBe(1);
  });

  it('4. next turn "승인" → ApprovalManager.decide + Orchestrator.resume', async () => {
    const { deps, calls } = makeDeps({ pending: pendingApprovalOf() });
    const result = await new ConversationRuntime(deps).handle(messageOf('승인'));
    expect(calls.decide).toBe(1);
    expect(calls.resume).toBe(1);
    expect(result.status).toBe('RESPONDED'); // resume returned COMPLETED
  });

  it('5. next turn "거절" → DENIED, no resume', async () => {
    const { deps, calls } = makeDeps({ pending: pendingApprovalOf() });
    const result = await new ConversationRuntime(deps).handle(messageOf('거절'));
    expect(result.status).toBe('DENIED');
    expect(calls.decide).toBe(1);
    expect(calls.resume).toBe(0);
    expect(result.reply.text).toContain('거절');
  });

  it('6. next turn "취소" → CANCELLED, no resume', async () => {
    const { deps, calls } = makeDeps({ pending: pendingApprovalOf() });
    const result = await new ConversationRuntime(deps).handle(messageOf('취소'));
    expect(result.status).toBe('CANCELLED');
    expect(calls.resume).toBe(0);
    expect(result.reply.text).toContain('취소');
  });

  it('7. ambiguous message while pending → clarification, no decide, no resume', async () => {
    const { deps, calls } = makeDeps({ pending: pendingApprovalOf() });
    const result = await new ConversationRuntime(deps).handle(messageOf('음 글쎄 잘 모르겠어'));
    expect(result.status).toBe('AWAITING_APPROVAL');
    expect(calls.decide).toBe(0);
    expect(calls.resume).toBe(0);
  });

  it('8. runtime persists no state of its own (no turn repository in deps)', async () => {
    const { deps } = makeDeps();
    // The deps the runtime is built from contain NO repository/persistence collaborator for turns.
    expect(Object.keys(deps)).not.toContain('turnRepository');
    expect(Object.keys(deps)).not.toContain('runtimeStateRepository');
    await new ConversationRuntime(deps).handle(messageOf('안녕'));
  });

  it('9. no runtime snapshot is written to Session (only lastActivity touch)', async () => {
    const { deps, calls } = makeDeps({ intent: execIntent, runOutcome: outcomeOf(ExecutionOutcomeStatus.AWAITING_APPROVAL) });
    await new ConversationRuntime(deps).handle(messageOf('배포해줘'));
    expect(calls.sessionTouch).toBe(1);
    for (const s of calls.sessionWrites) {
      expect(s).not.toHaveProperty('runtimeState');
      expect(s).not.toHaveProperty('pendingApprovalId');
      expect(s).not.toHaveProperty('approvalSnapshot');
    }
  });

  it('approve but reconstructResume() null → does NOT call ApprovalManager.decide, and re-asks', async () => {
    const { deps, calls } = makeDeps({ pending: pendingApprovalOf(), reconstruct: null });
    const result = await new ConversationRuntime(deps).handle(messageOf('승인'));
    expect(calls.decide).toBe(0); // never decide what we cannot resume (CA review §1)
    expect(calls.resume).toBe(0);
    expect(result.status).toBe('AWAITING_APPROVAL');
  });

  it('fresh AWAITING_APPROVAL reply comes from ResponseComposer (no hardcoded runtime text)', async () => {
    const { deps } = makeDeps({ intent: execIntent, runOutcome: outcomeOf(ExecutionOutcomeStatus.AWAITING_APPROVAL) });
    const result = await new ConversationRuntime(deps).handle(messageOf('배포해줘'));
    expect(result.reply.text).toBe(new ResponseComposer().composeApprovalRequired(CTX).text);
  });
});

/**
 * Production-like flow: the REAL StatelessApprovalFlow over an in-memory store proves the full
 * halt→approve→resume loop reaches ExecutionOrchestrator.resume() (CA review §2/§4).
 */
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
    const composer = new ResponseComposer();

    const base = makeDeps({ intent: execIntent, runOutcome: outcomeOf(ExecutionOutcomeStatus.AWAITING_APPROVAL) }).deps;
    const deps: ConversationRuntimeDeps = {
      ...base,
      composer,
      approvalFlow,
      sessions: {
        async openForContext() { return sessions.get('sess-1')!; },
        async touch(s) { sessions.set(s.id, s); return s; },
      },
      orchestrator: {
        async run() {
          // Simulate the real run: a HIGH-risk plan creates a PENDING approval for plan-1.
          approvals.push(pendingApprovalOf());
          return outcomeOf(ExecutionOutcomeStatus.AWAITING_APPROVAL);
        },
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

    // Turn 1: execution intent → halt at approval; anchor persists task + session.activeTaskId.
    const t1 = await runtime.handle(messageOf('배포해줘'));
    expect(t1.status).toBe('AWAITING_APPROVAL');
    expect(sessions.get('sess-1')?.activeTaskId).toBeTruthy();
    expect(approvals.some((a) => a.status === ApprovalStatus.PENDING)).toBe(true);

    // Turn 2: "승인" → findPending derives it, reconstructResume reads the anchor, resume runs.
    const t2 = await runtime.handle(messageOf('승인'));
    expect(resumeCalls).toBe(1);
    expect(t2.status).toBe('RESPONDED');
  });
});
