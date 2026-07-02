import { describe, expect, it, vi } from 'vitest';
import {
  ApprovalStatus,
  Capability,
  CodeGenerationStatus,
  CommandExecutionStatus,
  IntentType,
  PatchStatus,
  RiskLevel,
  SessionStatus,
  WorkspaceChangeStatus,
} from '../domain';
import type {
  Actor,
  ApplyInput,
  ApprovalRequest,
  CodeGeneration,
  CodeProposal,
  CommandExecution,
  ConversationContext,
  ExecutionPlanRef,
  GenerateCodeInput,
  GitDiff,
  GitStatus,
  InboundMessage,
  Intent,
  PatchGenerationInput,
  PatchSet,
  ProposedChange,
  Project,
  RunCommandInput,
  Session,
  Task,
  WorkspaceChange,
  WorkspaceDiff,
  WorkspaceRef,
} from '../domain';
import type { Logger } from '../ports';
import { ResponseComposer } from './response-composer';
import type { TestResultDetail } from './response-composer';
import { IntentClassifier } from './intent-classifier';
import type { CapabilityRouter } from './capability-router';
import { IntentResolver } from './intent-resolver';
import { ExecutionOutcomeStatus, ExecutionStage } from './execution-orchestrator';
import type { ExecutionOutcome, ExecutionRequest } from './execution-orchestrator';
import { ConversationRuntime, filterInScopeChanges, toCodeChangePreview, toCodeDiffPreview } from './conversation-runtime';
import type {
  ApplyPreviewAnchor,
  ApplyPreviewFlow,
  ApprovalFlow,
  ConversationRuntimeDeps,
  PendingScopeClarification,
  ScopeClarificationFlow,
} from './conversation-runtime';
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

const gitStatusOf = (o: Partial<GitStatus> = {}): GitStatus => ({
  clean: false,
  branch: 'main',
  staged: ['a.ts'],
  unstaged: ['b.ts'],
  untracked: ['c.ts'],
  ...o,
});

const gitDiffOf = (o: Partial<GitDiff> = {}): GitDiff => ({
  files: ['a.ts'],
  unified: 'diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-x\n+y\n',
  truncated: false,
  ...o,
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

/** Deterministic default `workspace.diff` fake output — mirrors what a real provider would derive
 *  from current content vs a `ProposedChange`, without needing real files (Sprint 2r, ADR-0039). */
const workspaceDiffOf = (changes: ProposedChange[]): WorkspaceDiff => ({
  refId: WORKSPACE.id,
  files: changes.map((c) => ({
    path: c.path,
    changeKind: c.delete ? 'delete' : 'modify',
    unified: c.delete
      ? `--- a/${c.path}\n+++ /dev/null\n@@ -1 +0,0 @@\n-old content\n`
      : `--- a/${c.path}\n+++ b/${c.path}\n@@ -1 +1 @@\n-old content\n+${c.newContent ?? ''}\n`,
    binary: false,
  })),
  estimatedChangedLines: changes.length,
  truncated: false,
});

/** Default ELIGIBLE apply-preview anchor (Sprint 2s) matching the fixtures above. */
const applyAnchorOf = (o: Partial<ApplyPreviewAnchor> = {}): ApplyPreviewAnchor => ({
  kind: 'code-preview-apply',
  status: 'ELIGIBLE',
  executionPlanRef: { id: 'plan-1', goal: 'g' },
  workspaceRef: WORKSPACE,
  targetFiles: [TARGET_FILE],
  codeGenerationRef: { id: 'gen-1', status: CodeGenerationStatus.SUCCEEDED },
  codeProposalRef: { id: 'prop-1' },
  instruction: '이 버그 고쳐줘',
  createdAt: TS,
  ...o,
});

/** An APPROVED apply anchor (Sprint 2t entry state) — approvalId present, ready for patch generation. */
const approvedAnchorOf = (o: Partial<ApplyPreviewAnchor> = {}): ApplyPreviewAnchor =>
  applyAnchorOf({ status: 'APPROVED', approvalId: 'apply-appr-1', approvedAt: TS, ...o });

/** Default PatchSet the fake patch.generate returns, derived from the input changes/diff (Sprint 2t). */
const patchSetOf = (input: PatchGenerationInput): PatchSet => ({
  id: 'patch-1',
  executionPlanRef: input.executionPlanRef,
  approvalRef: input.approvalRef,
  operations: input.changes.map((c) => ({
    path: c.path,
    operation: c.delete ? 'delete' : 'update',
    diff: input.diff.files.find((f) => f.path === c.path)?.unified ?? '',
  })),
  status: PatchStatus.GENERATED,
  createdAt: TS,
});

/**
 * A GENERATED, single-`update`-op PatchSet (Sprint 2u) whose id/approvalRef/executionPlanRef/op-path all
 * align with the default PATCH_READY apply anchor (`approvedAnchorOf({ status: 'PATCH_READY', patchRef })`),
 * so `patch.get` returns a PatchSet that passes the runtime's pre-write integrity gate. Override any field
 * to force an invalid shape (wrong id, non-GENERATED, unapproved, extra/other op, add/delete/binary, …).
 */
const patchSetGeneratedOf = (o: Partial<PatchSet> = {}): PatchSet => ({
  id: 'patch-1',
  executionPlanRef: { id: 'plan-1', goal: 'g' },
  approvalRef: { id: 'apply-appr-1', status: ApprovalStatus.APPROVED, executionPlanRef: { id: 'plan-1', goal: 'g' } },
  operations: [{ path: TARGET_FILE, operation: 'update', diff: '--- a\n+++ b\n@@ -1 +1 @@\n-x\n+y\n' }],
  status: PatchStatus.GENERATED,
  createdAt: TS,
  ...o,
});

/** The ApplyInput the default valid path hands to `workspaceWrite.apply` (Sprint 2u). */
const applyInputOf = (): ApplyInput => {
  const patchSet = patchSetGeneratedOf();
  return { patchSet, approvalRef: patchSet.approvalRef, workspaceRef: WORKSPACE };
};

/**
 * An APPLIED WorkspaceChange (Sprint 2u) derived from an ApplyInput — every ref and the single result
 * match the patchSet/workspaceRef so it passes the runtime's post-write result-integrity gate. Override to
 * force a FAILED/PARTIALLY_APPLIED/mismatched change.
 */
const workspaceChangeOf = (input: ApplyInput = applyInputOf(), o: Partial<WorkspaceChange> = {}): WorkspaceChange => {
  const op = input.patchSet.operations[0];
  return {
    id: 'wc-1',
    patchRef: { id: input.patchSet.id, status: input.patchSet.status },
    patchHash: 'hash-1',
    executionPlanRef: input.patchSet.executionPlanRef,
    approvalRef: input.approvalRef,
    workspaceRef: input.workspaceRef,
    status: WorkspaceChangeStatus.APPLIED,
    results: [{ path: op?.path ?? TARGET_FILE, operation: op?.operation ?? 'update', status: 'applied', message: 'ok', durationMs: 1 }],
    createdAt: TS,
    updatedAt: TS,
    ...o,
  };
};

/** An APPROVED ApprovalRequest matching the apply anchor's approvalId (Sprint 2t). */
const approvedApprovalOf = (): ApprovalRequest => ({
  ...pendingApprovalOf(),
  id: 'apply-appr-1',
  status: ApprovalStatus.APPROVED,
  decision: true,
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
  workspaceOpen: number;
  classify: number;
  scopeAnchor: number;
  scopeClear: number;
  scopeFindPending: number;
  lastScopeAnchor?: PendingScopeClarification;
  recordAssistant: number;
  codeGenerationGenerate: number;
  codeGenerationGetProposal: number;
  lastCodeGenerationInput?: GenerateCodeInput;
  workspaceDiff: number;
  lastWorkspaceDiffInput?: ProposedChange[];
  applyFindAnchor: number;
  applyAnchorSet: number;
  applyClear: number;
  lastApplyAnchor?: ApplyPreviewAnchor;
  approvalsGet: number;
  requestForRisk: number;
  lastRequestForRiskInput?: {
    executionPlanRef: ExecutionPlanRef;
    riskLevel: RiskLevel;
    reason: string;
    requestedBy: string;
  };
  patchGenerate: number;
  lastPatchInput?: PatchGenerationInput;
  patchGet: number;
  codeProposalsGet: number;
  workspaceApply: number;
  lastWorkspaceApplyInput?: ApplyInput;
  commandRun: number;
  lastCommandRunInput?: RunCommandInput;
  gitStatus: number;
  gitDiff: number;
  lastGitStatusRoot?: string;
  lastGitDiffRoot?: string;
  commandExecGet: number;
  loggerWarn: number;
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
  /** `workspace.diff` result (Sprint 2r) — defaults to a clean per-change diff derived from whatever
   *  in-scope changes were actually passed in (`workspaceDiffOf`); pass 'throw' to simulate a read
   *  failure, or a literal `WorkspaceDiff` to force a specific (e.g. empty, or `changeKind: 'add'`)
   *  result. */
  workspaceDiff?: WorkspaceDiff | 'throw';
  /** Initial apply-preview anchor (Sprint 2s) — the fake is stateful: `anchor()` sets it, `clear()`
   *  nulls it, so a test can drive multiple sequential `handle()` calls realistically. */
  applyAnchor?: ApplyPreviewAnchor | null;
  /** `approvals.get` result for the apply-approval ambiguous-retry path — defaults to a fresh PENDING
   *  ApprovalRequest matching whatever id was requested. */
  approvalsGetResult?: ApprovalRequest | null;
  /** `patch.generate` result (Sprint 2t) — defaults to a PatchSet derived from the changes/diff passed
   *  in; pass 'throw' to simulate a generation failure (or a `no diff found` mismatch). */
  patchGenerate?: PatchSet | 'throw';
  /** `codeProposals.get` result (Sprint 2t) — defaults to the in-scope proposal for TARGET_FILE; pass
   *  null to simulate a missing CodeProposal. */
  codeProposalGet?: CodeProposal | null;
  /** `patch.get` result (Sprint 2u) — defaults to a single-`update`-op GENERATED PatchSet for the
   *  requested id (`patchSetGeneratedOf`); pass null to simulate a missing PatchSet, or a literal
   *  PatchSet to force a specific (invalid) shape. */
  patchGetResult?: PatchSet | null;
  /** `workspaceWrite.apply` result (Sprint 2u) — defaults to an APPLIED WorkspaceChange derived from the
   *  input (`workspaceChangeOf`); pass 'throw' to simulate a write error, or a literal WorkspaceChange to
   *  force a specific (e.g. FAILED / mismatched) result. */
  workspaceApply?: WorkspaceChange | 'throw';
  /** `command.run` result (Sprint 2v) — defaults to a SUCCEEDED CommandExecution echoing the input args
   *  (via `commandExecOf`); pass 'throw' to simulate a runner throw, or a literal CommandExecution to force
   *  a FAILED / TIMED_OUT result. */
  commandRun?: CommandExecution | 'throw';
  /** `git.status` result (Sprint 2w) — defaults to `gitStatusOf()`; pass 'throw' to simulate a read error. */
  gitStatus?: GitStatus | 'throw';
  /** `git.diff` result (Sprint 2w) — defaults to `gitDiffOf()`; pass 'throw' to simulate a read error. */
  gitDiff?: GitDiff | 'throw';
  /** When true, `commandExecutions.get` throws (Sprint 2w — validation-lookup failure must not fail preview). */
  commandExecGetThrows?: boolean;
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
    workspaceOpen: 0,
    classify: 0,
    scopeAnchor: 0,
    scopeClear: 0,
    scopeFindPending: 0,
    recordAssistant: 0,
    codeGenerationGenerate: 0,
    codeGenerationGetProposal: 0,
    workspaceDiff: 0,
    applyFindAnchor: 0,
    applyAnchorSet: 0,
    applyClear: 0,
    approvalsGet: 0,
    requestForRisk: 0,
    patchGenerate: 0,
    patchGet: 0,
    codeProposalsGet: 0,
    workspaceApply: 0,
    commandRun: 0,
    gitStatus: 0,
    gitDiff: 0,
    commandExecGet: 0,
    loggerWarn: 0,
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

  // Stateful fake (Sprint 2s): anchor()/clear() actually mutate what findAnchor() next reports, so a
  // test can drive several sequential handle() calls through ELIGIBLE -> AWAITING_APPROVAL -> APPROVED.
  let currentApplyAnchor: ApplyPreviewAnchor | null = opts.applyAnchor ?? null;
  const applyPreviewFlow: ApplyPreviewFlow = {
    async findAnchor() {
      calls.applyFindAnchor++;
      return currentApplyAnchor;
    },
    async anchor(_session, anchor) {
      calls.applyAnchorSet++;
      calls.lastApplyAnchor = anchor;
      currentApplyAnchor = anchor;
    },
    async clear() {
      calls.applyClear++;
      currentApplyAnchor = null;
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
        calls.workspaceOpen++;
        if (opts.workspaceOpenThrows) throw new Error('open failed');
        return WORKSPACE;
      },
      async list(_ref, glob) {
        calls.workspaceList++;
        return opts.workspaceList ? opts.workspaceList(glob) : [];
      },
      async diff(_ref, changes) {
        calls.workspaceDiff++;
        calls.lastWorkspaceDiffInput = changes;
        if (opts.workspaceDiff === 'throw') throw new Error('diff failed');
        return opts.workspaceDiff ?? workspaceDiffOf(changes);
      },
    },
    commandExecutions: {
      async get() {
        calls.commandExecGet++;
        if (opts.commandExecGetThrows) throw new Error('command execution lookup boom');
        return opts.commandExec === undefined ? commandExecOf(CommandExecutionStatus.SUCCEEDED) : opts.commandExec;
      },
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
      async get(id) {
        calls.approvalsGet++;
        return opts.approvalsGetResult === undefined ? { ...pendingApprovalOf(), id } : opts.approvalsGetResult;
      },
      async requestForRisk(input) {
        calls.requestForRisk++;
        calls.lastRequestForRiskInput = input;
        return {
          id: 'apply-appr-1',
          executionPlanRef: input.executionPlanRef,
          status: ApprovalStatus.PENDING,
          riskLevel: input.riskLevel,
          reason: input.reason,
          requestedBy: input.requestedBy,
          createdAt: TS,
          updatedAt: TS,
        };
      },
    },
    approvalFlow,
    scopeClarificationFlow,
    applyPreviewFlow,
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
    patch: {
      async generate(input) {
        calls.patchGenerate++;
        calls.lastPatchInput = input;
        if (opts.patchGenerate === 'throw') throw new Error('patch boom');
        return opts.patchGenerate ?? patchSetOf(input);
      },
      async get(id) {
        calls.patchGet++;
        return opts.patchGetResult === undefined ? patchSetGeneratedOf({ id }) : opts.patchGetResult;
      },
    },
    codeProposals: {
      async get() {
        calls.codeProposalsGet++;
        return opts.codeProposalGet === undefined ? codeProposalOf() : opts.codeProposalGet;
      },
    },
    workspaceWrite: {
      async apply(input) {
        calls.workspaceApply++;
        calls.lastWorkspaceApplyInput = input;
        if (opts.workspaceApply === 'throw') throw new Error('workspace write boom');
        return opts.workspaceApply ?? workspaceChangeOf(input);
      },
    },
    command: {
      async run(input) {
        calls.commandRun++;
        calls.lastCommandRunInput = input;
        if (opts.commandRun === 'throw') throw new Error('command boom');
        // default: a SUCCEEDED run echoing the requested args (so kind derives correctly); the id varies by
        // command so a second validation yields a distinct CommandExecutionRef (latest-only test).
        const base = commandExecOf(CommandExecutionStatus.SUCCEEDED, input.args, 0, { stdout: 'ok\n' });
        return opts.commandRun ?? { ...base, id: input.args.includes('typecheck') ? 'cmd-typecheck' : 'cmd-test' };
      },
    },
    git: {
      async status(rootPath) {
        calls.gitStatus++;
        calls.lastGitStatusRoot = rootPath;
        if (opts.gitStatus === 'throw') throw new Error('git status boom');
        return opts.gitStatus ?? gitStatusOf();
      },
      async diff(rootPath) {
        calls.gitDiff++;
        calls.lastGitDiffRoot = rootPath;
        if (opts.gitDiff === 'throw') throw new Error('git diff boom');
        return opts.gitDiff ?? gitDiffOf();
      },
    },
    logger: { ...silentLogger, warn: () => { calls.loggerWarn++; } },
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
  it('successful in-scope proposal → composeCodeDiffPreview, RESPONDED, generate/diff called exactly once', async () => {
    const { result, calls } = await approveWith({}, planningOnlyRequestOf());
    expect(calls.codeGenerationGenerate).toBe(1);
    expect(calls.codeGenerationGetProposal).toBe(1);
    expect(calls.workspaceDiff).toBe(1);
    expect(result.status).toBe('RESPONDED');
    const expectedDiff = workspaceDiffOf([{ path: TARGET_FILE, newContent: 'fixed content' }]);
    expect(result.reply.text).toBe(
      new ResponseComposer().composeCodeDiffPreview(CTX, toCodeDiffPreview(expectedDiff, [])).text,
    );
  });

  it('successful diff preview calls composeCodeDiffPreview and never composeCodeGenerationPreview', async () => {
    const { deps } = makeDeps({
      pending: pendingApprovalOf(),
      reconstruct: { request: planningOnlyRequestOf(), prior: outcomeOf(ExecutionOutcomeStatus.AWAITING_APPROVAL) },
    });
    const spyDiff = vi.spyOn(deps.composer, 'composeCodeDiffPreview');
    const spyText = vi.spyOn(deps.composer, 'composeCodeGenerationPreview');
    const result = await new ConversationRuntime(deps).handle(messageOf('승인'));
    expect(result.status).toBe('RESPONDED');
    expect(spyDiff).toHaveBeenCalledTimes(1);
    expect(spyText).not.toHaveBeenCalled();
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

  it('workspace.diff() throws → failed preview, FAILED, no mutation attempted (ADR-0039)', async () => {
    const { result } = await approveWith({ workspaceDiff: 'throw' }, planningOnlyRequestOf());
    expect(result.status).toBe('FAILED');
    expect(result.reply.text).toBe(new ResponseComposer().composeCodeGenerationPreviewFailed(CTX).text);
  });

  it('workspace.diff() returning zero files → failed preview, FAILED (CA Round 1 Required Change #3)', async () => {
    const { result } = await approveWith(
      { workspaceDiff: { refId: WORKSPACE.id, files: [], estimatedChangedLines: 0, truncated: false } },
      planningOnlyRequestOf(),
    );
    expect(result.status).toBe('FAILED');
    expect(result.reply.text).toBe(new ResponseComposer().composeCodeGenerationPreviewFailed(CTX).text);
  });

  it("workspace.diff() reporting changeKind 'add' → failed preview, never a successful diff (CA Round 1 Required Change #1)", async () => {
    const { result } = await approveWith(
      {
        workspaceDiff: {
          refId: WORKSPACE.id,
          files: [{ path: TARGET_FILE, changeKind: 'add', unified: 'irrelevant', binary: false }],
          estimatedChangedLines: 1,
          truncated: false,
        },
      },
      planningOnlyRequestOf(),
    );
    expect(result.status).toBe('FAILED');
    expect(result.reply.text).toBe(new ResponseComposer().composeCodeGenerationPreviewFailed(CTX).text);
  });

  it('a delete proposal produces a delete-style diff preview (ADR-0039)', async () => {
    const { result, calls } = await approveWith(
      { codeProposal: codeProposalOf({ proposal: [{ path: TARGET_FILE, delete: true }] }) },
      planningOnlyRequestOf(),
    );
    expect(calls.lastWorkspaceDiffInput).toEqual([{ path: TARGET_FILE, delete: true }]);
    expect(result.status).toBe('RESPONDED');
    expect(result.reply.text).toContain(TARGET_FILE);
    expect(result.reply.text).toContain('삭제 제안');
  });

  it('a proposal path outside targetFiles is never rendered as content, only as a warning', async () => {
    const { result, calls } = await approveWith(
      { codeProposal: codeProposalOf({ proposal: [{ path: 'packages/core/other.ts', newContent: 'x' }] }) },
      planningOnlyRequestOf(),
    );
    expect(calls.workspaceDiff).toBe(0); // all-out-of-scope never reaches workspace.diff
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

  it('deny ("거절") never calls codeGeneration.generate or workspace.diff', async () => {
    const { deps, calls } = makeDeps({ pending: pendingApprovalOf() });
    await new ConversationRuntime(deps).handle(messageOf('거절'));
    expect(calls.codeGenerationGenerate).toBe(0);
    expect(calls.workspaceDiff).toBe(0);
  });

  it('cancel ("취소") never calls codeGeneration.generate or workspace.diff', async () => {
    const { deps, calls } = makeDeps({ pending: pendingApprovalOf() });
    await new ConversationRuntime(deps).handle(messageOf('취소'));
    expect(calls.codeGenerationGenerate).toBe(0);
    expect(calls.workspaceDiff).toBe(0);
  });

  it('reconstructResume failure (re-ask) never calls codeGeneration.generate or workspace.diff', async () => {
    const { deps, calls } = makeDeps({ pending: pendingApprovalOf(), reconstruct: null });
    await new ConversationRuntime(deps).handle(messageOf('승인'));
    expect(calls.codeGenerationGenerate).toBe(0);
    expect(calls.workspaceDiff).toBe(0);
  });

  it('a non-planningOnly approval resume never calls codeGeneration.generate or workspace.diff', async () => {
    const { result, calls } = await approveWith({}, {
      goal: 'g',
      instruction: 'g',
      requiredCapabilities: [Capability.CODE_IMPLEMENTATION],
      requestedBy: 'actor-1',
      // planningOnly deliberately absent
    });
    expect(calls.codeGenerationGenerate).toBe(0);
    expect(calls.workspaceDiff).toBe(0);
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

  it('a successful diff preview anchors an ELIGIBLE apply-preview with the same refs (Sprint 2s, ADR-0040)', async () => {
    const { calls } = await approveWith({}, planningOnlyRequestOf());
    expect(calls.applyAnchorSet).toBe(1);
    expect(calls.lastApplyAnchor).toMatchObject({
      kind: 'code-preview-apply',
      status: 'ELIGIBLE',
      executionPlanRef: { id: 'plan-1', goal: 'g' },
      workspaceRef: WORKSPACE,
      targetFiles: [TARGET_FILE],
      instruction: '이 버그 고쳐줘',
    });
    expect(calls.lastApplyAnchor?.approvalId).toBeUndefined();
  });

  it('a failed preview never anchors an apply-preview', async () => {
    const { calls } = await approveWith({ codeGeneration: 'throw' }, planningOnlyRequestOf());
    expect(calls.applyAnchorSet).toBe(0);
  });
});

describe('Explicit Preview Apply Approval — runtime (Sprint 2s, ADR-0040)', () => {
  it.each(['적용해줘', '반영해줘', '이대로 진행해'])(
    '"%s" with an ELIGIBLE anchor creates a second approval and returns AWAITING_APPROVAL',
    async (text) => {
      const { deps, calls } = makeDeps({ applyAnchor: applyAnchorOf() });
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.requestForRisk).toBe(1);
      expect(result.status).toBe('AWAITING_APPROVAL');
      expect(result.reply.text).toBe(
        new ResponseComposer().composeApplyApprovalRequested(CTX, [TARGET_FILE]).text,
      );
    },
  );

  it.each(['좋아', '오케이', '확인', '괜찮네'])(
    '"%s" with an ELIGIBLE anchor does not create an apply approval (Critical Product Rule)',
    async (text) => {
      const { deps, calls } = makeDeps({ applyAnchor: applyAnchorOf() });
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.requestForRisk).toBe(0);
      expect(calls.classify).toBe(1); // falls through to normal handling
      expect(result.status).toBe('RESPONDED');
    },
  );

  it('ordinary non-apply chat with an ELIGIBLE anchor falls through normally (soft hook)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: applyAnchorOf() });
    const result = await new ConversationRuntime(deps).handle(messageOf('오늘 뭐 할까?'));
    expect(calls.requestForRisk).toBe(0);
    expect(calls.classify).toBe(1);
    expect(result.status).toBe('RESPONDED');
  });

  it.each(['적용해줘', '반영해줘', '이대로 진행해'])(
    '"%s" with no anchor returns apply-unavailable — never a new code-change request',
    async (text) => {
      const { deps, calls } = makeDeps(); // applyAnchor defaults to null
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.requestForRisk).toBe(0);
      expect(result.reply.text).toBe(new ResponseComposer().composeApplyPreviewUnavailable(CTX).text);
    },
  );

  it('the no-anchor explicit-apply path calls neither the classifier nor the Orchestrator', async () => {
    const { deps, calls } = makeDeps();
    await new ConversationRuntime(deps).handle(messageOf('적용해줘'));
    expect(calls.classify).toBe(0);
    expect(calls.run).toBe(0);
    expect(calls.resume).toBe(0);
  });

  it('apply intent with a missing codeProposalRef on the anchor does not create an approval', async () => {
    const broken = { ...applyAnchorOf(), codeProposalRef: undefined } as unknown as ApplyPreviewAnchor;
    const { deps, calls } = makeDeps({ applyAnchor: broken });
    const result = await new ConversationRuntime(deps).handle(messageOf('적용해줘'));
    expect(calls.requestForRisk).toBe(0);
    expect(result.status).toBe('FAILED');
    expect(result.reply.text).toBe(new ResponseComposer().composeApplyPreviewUnavailable(CTX).text);
  });

  it('apply intent with a missing workspaceRef on the anchor does not create an approval', async () => {
    const broken = { ...applyAnchorOf(), workspaceRef: undefined } as unknown as ApplyPreviewAnchor;
    const { deps, calls } = makeDeps({ applyAnchor: broken });
    const result = await new ConversationRuntime(deps).handle(messageOf('적용해줘'));
    expect(calls.requestForRisk).toBe(0);
    expect(result.status).toBe('FAILED');
  });

  it('apply intent with empty targetFiles on the anchor does not create an approval', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: applyAnchorOf({ targetFiles: [] }) });
    const result = await new ConversationRuntime(deps).handle(messageOf('적용해줘'));
    expect(calls.requestForRisk).toBe(0);
    expect(result.status).toBe('FAILED');
  });

  it('requestForRisk is called with the anchor executionPlanRef, HIGH risk, and a reason naming both refs and target files', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: applyAnchorOf() });
    await new ConversationRuntime(deps).handle(messageOf('적용해줘'));
    expect(calls.lastRequestForRiskInput?.executionPlanRef).toEqual({ id: 'plan-1', goal: 'g' });
    expect(calls.lastRequestForRiskInput?.riskLevel).toBe(RiskLevel.HIGH);
    expect(calls.lastRequestForRiskInput?.reason).toContain(TARGET_FILE);
    expect(calls.lastRequestForRiskInput?.reason).toContain('prop-1');
    expect(calls.lastRequestForRiskInput?.reason).toContain('gen-1');
  });

  it('after creating the approval, the anchor is re-anchored AWAITING_APPROVAL with the new approvalId and every original ref', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: applyAnchorOf() });
    await new ConversationRuntime(deps).handle(messageOf('적용해줘'));
    expect(calls.lastApplyAnchor?.status).toBe('AWAITING_APPROVAL');
    expect(calls.lastApplyAnchor?.approvalId).toBe('apply-appr-1');
    expect(calls.lastApplyAnchor?.workspaceRef).toEqual(WORKSPACE);
    expect(calls.lastApplyAnchor?.targetFiles).toEqual([TARGET_FILE]);
    expect(calls.lastApplyAnchor?.codeGenerationRef).toEqual({ id: 'gen-1', status: CodeGenerationStatus.SUCCEEDED });
    expect(calls.lastApplyAnchor?.codeProposalRef).toEqual({ id: 'prop-1' });
  });

  it('explicit apply intent while the anchor is already APPROVED does not re-ask or create a duplicate approval', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: applyAnchorOf({ status: 'APPROVED', approvalId: 'apply-appr-1', approvedAt: TS }) });
    const result = await new ConversationRuntime(deps).handle(messageOf('적용해줘'));
    expect(calls.requestForRisk).toBe(0);
    expect(result.status).toBe('RESPONDED');
    expect(result.reply.text).toBe(new ResponseComposer().composeApplyApprovalRecorded(CTX).text);
  });

  it('approve on a pending apply gate calls approvals.decide exactly once', async () => {
    const pendingAnchor = applyAnchorOf({ status: 'AWAITING_APPROVAL', approvalId: 'apply-appr-1' });
    const { deps, calls } = makeDeps({ applyAnchor: pendingAnchor });
    await new ConversationRuntime(deps).handle(messageOf('승인'));
    expect(calls.decide).toBe(1);
  });

  it('approve on a pending apply gate re-anchors APPROVED (does not clear) and preserves every ref', async () => {
    const pendingAnchor = applyAnchorOf({ status: 'AWAITING_APPROVAL', approvalId: 'apply-appr-1' });
    const { deps, calls } = makeDeps({ applyAnchor: pendingAnchor });
    const result = await new ConversationRuntime(deps).handle(messageOf('승인'));
    expect(calls.applyClear).toBe(0);
    expect(calls.lastApplyAnchor?.status).toBe('APPROVED');
    expect(calls.lastApplyAnchor?.approvedAt).toBeTruthy();
    expect(calls.lastApplyAnchor?.workspaceRef).toEqual(WORKSPACE);
    expect(calls.lastApplyAnchor?.targetFiles).toEqual([TARGET_FILE]);
    expect(calls.lastApplyAnchor?.codeGenerationRef).toEqual({ id: 'gen-1', status: CodeGenerationStatus.SUCCEEDED });
    expect(calls.lastApplyAnchor?.codeProposalRef).toEqual({ id: 'prop-1' });
    expect(result.status).toBe('RESPONDED');
    expect(result.reply.text).toBe(new ResponseComposer().composeApplyApprovalRecorded(CTX).text);
    // No Orchestrator/mutation call reachable from this path — no such dependency exists on it.
    expect(calls.run).toBe(0);
    expect(calls.resume).toBe(0);
  });

  it('deny on a pending apply gate clears the anchor and reports DENIED', async () => {
    const pendingAnchor = applyAnchorOf({ status: 'AWAITING_APPROVAL', approvalId: 'apply-appr-1' });
    const { deps, calls } = makeDeps({ applyAnchor: pendingAnchor });
    const result = await new ConversationRuntime(deps).handle(messageOf('거절'));
    expect(calls.applyClear).toBe(1);
    expect(result.status).toBe('DENIED');
  });

  it('cancel on a pending apply gate clears the anchor and reports CANCELLED', async () => {
    const pendingAnchor = applyAnchorOf({ status: 'AWAITING_APPROVAL', approvalId: 'apply-appr-1' });
    const { deps, calls } = makeDeps({ applyAnchor: pendingAnchor });
    const result = await new ConversationRuntime(deps).handle(messageOf('취소'));
    expect(calls.applyClear).toBe(1);
    expect(result.status).toBe('CANCELLED');
  });

  it('an ambiguous reply while the apply approval is pending returns the generic approval notice and never classifies', async () => {
    const pendingAnchor = applyAnchorOf({ status: 'AWAITING_APPROVAL', approvalId: 'apply-appr-1' });
    const { deps, calls } = makeDeps({ applyAnchor: pendingAnchor });
    const result = await new ConversationRuntime(deps).handle(messageOf('뭐였지?'));
    expect(result.status).toBe('AWAITING_APPROVAL');
    expect(calls.classify).toBe(0);
    expect(calls.decide).toBe(0);
    expect(calls.applyClear).toBe(0);
  });

  it('the first (Sprint 2n) approval pending takes priority — apply routing never runs', async () => {
    const pendingAnchor = applyAnchorOf({ status: 'AWAITING_APPROVAL', approvalId: 'apply-appr-1' });
    const { deps, calls } = makeDeps({ pending: pendingApprovalOf(), applyAnchor: pendingAnchor });
    await new ConversationRuntime(deps).handle(messageOf('적용해줘'));
    expect(calls.applyFindAnchor).toBe(0);
    expect(calls.requestForRisk).toBe(0);
  });

  it('a pending scope clarification (Sprint 2p) takes priority over apply routing', async () => {
    const { deps, calls } = makeDeps({
      pendingScope: { kind: 'code-scope-clarification', summary: 'x', createdAt: TS },
      applyAnchor: applyAnchorOf(),
    });
    await new ConversationRuntime(deps).handle(messageOf('적용해줘'));
    expect(calls.applyFindAnchor).toBe(0);
    expect(calls.requestForRisk).toBe(0);
  });

  // A project-mismatched anchor's auto-clear behavior is unit-tested directly against the production
  // StatelessApplyPreviewFlow (stateless-apply-preview-flow.test.ts) — this file's applyPreviewFlow
  // fake is a simple stateful pass-through and does not model that staleness check, matching the same
  // convention already used for scopeClarificationFlow's fake here.
});

describe('Approved Apply Context → PatchSet Preview — runtime (Sprint 2t, ADR-0041)', () => {
  const approvedDeps = (o: Opts = {}) =>
    makeDeps({ applyAnchor: approvedAnchorOf(), approvalsGetResult: approvedApprovalOf(), ...o });

  it.each(['패치 만들어줘', '패치 생성해줘', '다음 단계 진행해'])(
    '"%s" with an APPROVED anchor generates a PatchSet and returns a preview (RESPONDED)',
    async (text) => {
      const { deps, calls } = approvedDeps();
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.patchGenerate).toBe(1);
      expect(result.status).toBe('RESPONDED');
      expect(result.reply.text).toContain('패치 미리보기');
      expect(result.reply.text).toContain('파일은 수정되지 않았어요');
    },
  );

  it('after generation the anchor is re-anchored PATCH_READY carrying patchRef and every prior ref', async () => {
    const { deps, calls } = approvedDeps();
    await new ConversationRuntime(deps).handle(messageOf('패치 만들어줘'));
    expect(calls.lastApplyAnchor?.status).toBe('PATCH_READY');
    expect(calls.lastApplyAnchor?.patchRef).toEqual({ id: 'patch-1', status: PatchStatus.GENERATED });
    expect(calls.lastApplyAnchor?.workspaceRef).toEqual(WORKSPACE);
    expect(calls.lastApplyAnchor?.targetFiles).toEqual([TARGET_FILE]);
    expect(calls.lastApplyAnchor?.codeProposalRef).toEqual({ id: 'prop-1' });
    expect(calls.lastApplyAnchor?.approvalId).toBe('apply-appr-1');
  });

  it('patch.generate receives an ApprovalRef (id/status/executionPlanRef), not an ApprovalRequest', async () => {
    const { deps, calls } = approvedDeps();
    await new ConversationRuntime(deps).handle(messageOf('패치 만들어줘'));
    expect(calls.lastPatchInput?.approvalRef).toEqual({
      id: 'apply-appr-1',
      status: ApprovalStatus.APPROVED,
      executionPlanRef: { id: 'plan-1', goal: 'g' },
    });
    // an ApprovalRequest would carry reason/requestedBy/createdAt — assert those are absent.
    expect(calls.lastPatchInput?.approvalRef).not.toHaveProperty('reason');
    expect(calls.lastPatchInput?.approvalRef).not.toHaveProperty('requestedBy');
  });

  it('WorkspaceManager.diff is re-run with the in-scope changes before patch.generate', async () => {
    const { deps, calls } = approvedDeps();
    await new ConversationRuntime(deps).handle(messageOf('패치 만들어줘'));
    expect(calls.workspaceDiff).toBe(1);
    expect(calls.lastWorkspaceDiffInput).toEqual([{ path: TARGET_FILE, newContent: 'fixed content' }]);
    expect(calls.lastPatchInput?.changes).toEqual([{ path: TARGET_FILE, newContent: 'fixed content' }]);
  });

  it('an out-of-scope proposal path is never passed to patch.generate', async () => {
    const { deps, calls } = approvedDeps({
      codeProposalGet: codeProposalOf({
        proposal: [
          { path: TARGET_FILE, newContent: 'fixed content' },
          { path: 'packages/core/other.ts', newContent: 'unexpected' },
        ],
      }),
    });
    await new ConversationRuntime(deps).handle(messageOf('패치 만들어줘'));
    expect(calls.lastPatchInput?.changes).toEqual([{ path: TARGET_FILE, newContent: 'fixed content' }]);
    expect(calls.lastWorkspaceDiffInput).toEqual([{ path: TARGET_FILE, newContent: 'fixed content' }]);
  });

  it('patch command with no anchor → composePatchUnavailable, no generation, no classifier/orchestrator', async () => {
    const { deps, calls } = makeDeps(); // applyAnchor defaults to null
    const result = await new ConversationRuntime(deps).handle(messageOf('패치 만들어줘'));
    expect(calls.patchGenerate).toBe(0);
    expect(calls.classify).toBe(0);
    expect(calls.run).toBe(0);
    expect(result.reply.text).toBe(new ResponseComposer().composePatchUnavailable(CTX).text);
  });

  it('patch command with an ELIGIBLE anchor → composePatchUnavailable, no generation', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: applyAnchorOf() }); // ELIGIBLE
    const result = await new ConversationRuntime(deps).handle(messageOf('패치 만들어줘'));
    expect(calls.patchGenerate).toBe(0);
    expect(result.reply.text).toBe(new ResponseComposer().composePatchUnavailable(CTX).text);
  });

  it('APPROVED anchor missing approvalId → no generation, composePatchUnavailable', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: approvedAnchorOf({ approvalId: undefined }) });
    const result = await new ConversationRuntime(deps).handle(messageOf('패치 만들어줘'));
    expect(calls.patchGenerate).toBe(0);
    expect(result.reply.text).toBe(new ResponseComposer().composePatchUnavailable(CTX).text);
  });

  it('approvalId not found (approvals.get → null) → no generation', async () => {
    const { deps, calls } = approvedDeps({ approvalsGetResult: null });
    await new ConversationRuntime(deps).handle(messageOf('패치 만들어줘'));
    expect(calls.patchGenerate).toBe(0);
  });

  it('approval loaded but not APPROVED → no generation', async () => {
    const { deps, calls } = approvedDeps({ approvalsGetResult: pendingApprovalOf() });
    await new ConversationRuntime(deps).handle(messageOf('패치 만들어줘'));
    expect(calls.patchGenerate).toBe(0);
  });

  it('CodeProposal not found → no generation', async () => {
    const { deps, calls } = approvedDeps({ codeProposalGet: null });
    await new ConversationRuntime(deps).handle(messageOf('패치 만들어줘'));
    expect(calls.patchGenerate).toBe(0);
    expect(calls.workspaceDiff).toBe(0);
  });

  it('proposal all out-of-scope → workspace.diff never called, no generation', async () => {
    const { deps, calls } = approvedDeps({
      codeProposalGet: codeProposalOf({ proposal: [{ path: 'packages/core/other.ts', newContent: 'x' }] }),
    });
    await new ConversationRuntime(deps).handle(messageOf('패치 만들어줘'));
    expect(calls.workspaceDiff).toBe(0);
    expect(calls.patchGenerate).toBe(0);
  });

  it('workspace.diff throws → composePatchGenerationFailed, no generation, failure logged', async () => {
    const { deps, calls } = approvedDeps({ workspaceDiff: 'throw' });
    const result = await new ConversationRuntime(deps).handle(messageOf('패치 만들어줘'));
    expect(calls.patchGenerate).toBe(0);
    expect(calls.loggerWarn).toBe(1);
    expect(result.reply.text).toBe(new ResponseComposer().composePatchGenerationFailed(CTX).text);
  });

  it('empty diff.files → no generation, composePatchGenerationFailed', async () => {
    const { deps, calls } = approvedDeps({
      workspaceDiff: { refId: WORKSPACE.id, files: [], estimatedChangedLines: 0, truncated: false },
    });
    await new ConversationRuntime(deps).handle(messageOf('패치 만들어줘'));
    expect(calls.patchGenerate).toBe(0);
  });

  it("changeKind 'add' → no generation", async () => {
    const { deps, calls } = approvedDeps({
      workspaceDiff: {
        refId: WORKSPACE.id,
        files: [{ path: TARGET_FILE, changeKind: 'add', unified: 'x', binary: false }],
        estimatedChangedLines: 1,
        truncated: false,
      },
    });
    await new ConversationRuntime(deps).handle(messageOf('패치 만들어줘'));
    expect(calls.patchGenerate).toBe(0);
  });

  it('binary diff → no generation; empty unified (oversized) → no generation', async () => {
    const binary = approvedDeps({
      workspaceDiff: {
        refId: WORKSPACE.id,
        files: [{ path: TARGET_FILE, changeKind: 'modify', unified: '', binary: true }],
        estimatedChangedLines: 0,
        truncated: false,
      },
    });
    await new ConversationRuntime(binary.deps).handle(messageOf('패치 만들어줘'));
    expect(binary.calls.patchGenerate).toBe(0);

    const oversized = approvedDeps({
      workspaceDiff: {
        refId: WORKSPACE.id,
        files: [{ path: TARGET_FILE, changeKind: 'modify', unified: '', binary: false }],
        estimatedChangedLines: 0,
        truncated: true,
      },
    });
    await new ConversationRuntime(oversized.deps).handle(messageOf('패치 만들어줘'));
    expect(oversized.calls.patchGenerate).toBe(0);
  });

  it('patch.generate throws (e.g. diff/path mismatch) → composePatchGenerationFailed, failure logged (CA Round 1 #5)', async () => {
    const { deps, calls } = approvedDeps({ patchGenerate: 'throw' });
    const result = await new ConversationRuntime(deps).handle(messageOf('패치 만들어줘'));
    expect(calls.patchGenerate).toBe(1); // it was called, then threw
    expect(calls.loggerWarn).toBe(1);
    expect(result.reply.text).toBe(new ResponseComposer().composePatchGenerationFailed(CTX).text);
  });

  it('the PatchSet preview never uses forbidden mutation wording', async () => {
    const { deps } = approvedDeps();
    const result = await new ConversationRuntime(deps).handle(messageOf('패치 만들어줘'));
    for (const word of ['적용했어요', '반영했어요', '수정했어요', '변경 완료', '적용 완료']) {
      expect(result.reply.text).not.toContain(word);
    }
  });

  it('PATCH_READY + repeat patch command → composePatchAlreadyGenerated, no regeneration', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: approvedAnchorOf({ status: 'PATCH_READY', patchRef: { id: 'patch-1', status: PatchStatus.GENERATED } }) });
    const result = await new ConversationRuntime(deps).handle(messageOf('패치 만들어줘'));
    expect(calls.patchGenerate).toBe(0);
    expect(result.reply.text).toBe(new ResponseComposer().composePatchAlreadyGenerated(CTX).text);
  });

  it('apply command while PATCH_READY → already-approved reply, not patch generation', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: approvedAnchorOf({ status: 'PATCH_READY', patchRef: { id: 'patch-1', status: PatchStatus.GENERATED } }) });
    const result = await new ConversationRuntime(deps).handle(messageOf('적용해줘'));
    expect(calls.patchGenerate).toBe(0);
    expect(result.reply.text).toBe(new ResponseComposer().composeApplyApprovalRecorded(CTX).text);
  });

  it('the full sequence performs no WorkspaceWrite/CommandExecution/Orchestrator call', async () => {
    const { deps, calls } = approvedDeps();
    await new ConversationRuntime(deps).handle(messageOf('패치 만들어줘'));
    // Patch generation is representation-only: WorkspaceWrite (Sprint 2u) and CommandExecution (Sprint 2v,
    // via the `command` dep) are deps but must never be called on the patch path, and the Orchestrator is
    // never invoked either.
    expect(calls.run).toBe(0);
    expect(calls.resume).toBe(0);
    expect(calls.workspaceApply).toBe(0);
    expect(calls.commandRun).toBe(0);
  });

  it('"좋아"/"오케이"/"확인" and ordinary chat with an APPROVED anchor do not trigger patch generation', async () => {
    for (const text of ['좋아', '오케이', '확인', '오늘 뭐 할까?']) {
      const { deps, calls } = approvedDeps();
      await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.patchGenerate).toBe(0);
    }
  });
});

// ── Sprint 2u — PatchRef → WorkspaceWrite Apply (first real file mutation, ADR-0042) ─────────────

describe('PatchRef → WorkspaceWrite Apply — runtime (Sprint 2u, ADR-0042)', () => {
  const FINAL_APPLY_PHRASES = ['패치 적용해줘', '파일에 적용해줘', '최종 적용해줘'];

  /** A PATCH_READY apply anchor carrying the patchRef the default `patch.get` resolves (Sprint 2u). */
  const patchReadyAnchor = (o: Partial<ApplyPreviewAnchor> = {}): ApplyPreviewAnchor =>
    approvedAnchorOf({ status: 'PATCH_READY', patchRef: { id: 'patch-1', status: PatchStatus.GENERATED }, ...o });
  const appliedAnchor = (o: Partial<ApplyPreviewAnchor> = {}): ApplyPreviewAnchor =>
    patchReadyAnchor({ status: 'WORKSPACE_APPLIED', workspaceChangeRef: { id: 'wc-1', status: WorkspaceChangeStatus.APPLIED }, ...o });

  const composer = new ResponseComposer();
  const appliedText = composer.composeWorkspaceApplied(CTX, [TARGET_FILE]).text;
  const failedText = composer.composeWorkspaceApplyFailed(CTX).text;
  const unavailableText = composer.composeWorkspaceApplyUnavailable(CTX).text;
  const alreadyAppliedText = composer.composeWorkspaceAlreadyApplied(CTX).text;

  // ── Success path & anchor preservation (CA 1–4) ────────────────────────────────────────────
  it('each explicit final-apply phrase + PATCH_READY + a valid single-`update` PatchSet calls workspaceWrite.apply exactly once (CA 1)', async () => {
    for (const phrase of FINAL_APPLY_PHRASES) {
      const { deps, calls } = makeDeps({ applyAnchor: patchReadyAnchor() });
      const result = await new ConversationRuntime(deps).handle(messageOf(phrase));
      expect(calls.workspaceApply, phrase).toBe(1);
      expect(result.reply.text, phrase).toBe(appliedText);
    }
  });

  it('success re-anchors WORKSPACE_APPLIED (CA 2), preserving the workspaceChangeRef (CA 3) and every prior ref (CA 4)', async () => {
    const anchor = patchReadyAnchor();
    const { deps, calls } = makeDeps({ applyAnchor: anchor });
    await new ConversationRuntime(deps).handle(messageOf('패치 적용해줘'));
    expect(calls.applyAnchorSet).toBe(1);
    expect(calls.lastApplyAnchor?.status).toBe('WORKSPACE_APPLIED');
    expect(calls.lastApplyAnchor?.workspaceChangeRef).toEqual({ id: 'wc-1', status: WorkspaceChangeStatus.APPLIED });
    // every prior ref carried forward unchanged
    expect(calls.lastApplyAnchor?.patchRef).toEqual(anchor.patchRef);
    expect(calls.lastApplyAnchor?.executionPlanRef).toEqual(anchor.executionPlanRef);
    expect(calls.lastApplyAnchor?.workspaceRef).toEqual(anchor.workspaceRef);
    expect(calls.lastApplyAnchor?.approvalId).toBe(anchor.approvalId);
    expect(calls.lastApplyAnchor?.codeProposalRef).toEqual(anchor.codeProposalRef);
    expect(calls.lastApplyAnchor?.codeGenerationRef).toEqual(anchor.codeGenerationRef);
    expect(calls.lastApplyAnchor?.targetFiles).toEqual(anchor.targetFiles);
  });

  // ── No-write on bad anchor state (CA 10–14) ─────────────────────────────────────────────────
  it('final-apply with no anchor → composeWorkspaceApplyUnavailable, no write, no PatchSet load (CA 10)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: null });
    const result = await new ConversationRuntime(deps).handle(messageOf('패치 적용해줘'));
    expect(calls.workspaceApply).toBe(0);
    expect(calls.patchGet).toBe(0);
    expect(result.reply.text).toBe(unavailableText);
  });

  it('final-apply with an ELIGIBLE or APPROVED anchor → unavailable, no write (CA 11, 13)', async () => {
    for (const anchor of [applyAnchorOf(), approvedAnchorOf()]) {
      const { deps, calls } = makeDeps({ applyAnchor: anchor });
      const result = await new ConversationRuntime(deps).handle(messageOf('패치 적용해줘'));
      expect(calls.workspaceApply, anchor.status).toBe(0);
      expect(calls.patchGet, anchor.status).toBe(0);
      expect(result.reply.text, anchor.status).toBe(unavailableText);
    }
  });

  it('final-apply while AWAITING_APPROVAL is intercepted by the Sprint 2s approval turn — no write (CA 12)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: approvedAnchorOf({ status: 'AWAITING_APPROVAL' }) });
    await new ConversationRuntime(deps).handle(messageOf('패치 적용해줘'));
    expect(calls.workspaceApply).toBe(0);
    expect(calls.patchGet).toBe(0);
  });

  it('final-apply while PATCH_READY without a patchRef → unavailable, no write, no PatchSet load (CA 14)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: approvedAnchorOf({ status: 'PATCH_READY' }) }); // no patchRef
    const result = await new ConversationRuntime(deps).handle(messageOf('패치 적용해줘'));
    expect(calls.workspaceApply).toBe(0);
    expect(calls.patchGet).toBe(0);
    expect(result.reply.text).toBe(unavailableText);
  });

  // ── No-write on invalid / unsupported PatchSet (CA 15–26) ──────────────────────────────────
  it('a missing PatchSet (patch.get → null) → composeWorkspaceApplyFailed, no write, failure logged (CA 15)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: patchReadyAnchor(), patchGetResult: null });
    const result = await new ConversationRuntime(deps).handle(messageOf('패치 적용해줘'));
    expect(calls.patchGet).toBe(1);
    expect(calls.workspaceApply).toBe(0);
    expect(calls.loggerWarn).toBe(1);
    expect(result.reply.text).toBe(failedText);
  });

  it('an invalid / unsupported PatchSet never reaches WorkspaceWrite → composeWorkspaceApplyFailed, logged (CA 16–26)', async () => {
    const cases: Array<[string, PatchSet]> = [
      ['id !== anchor.patchRef.id (CA 16)', patchSetGeneratedOf({ id: 'other-patch' })],
      ['status !== GENERATED (CA 17)', patchSetGeneratedOf({ status: 'STALE' as unknown as PatchStatus })],
      ['approvalRef not APPROVED (CA 18)', patchSetGeneratedOf({ approvalRef: { id: 'apply-appr-1', status: ApprovalStatus.PENDING, executionPlanRef: { id: 'plan-1', goal: 'g' } } })],
      ['approvalRef.id !== anchor.approvalId (CA 19)', patchSetGeneratedOf({ approvalRef: { id: 'other-appr', status: ApprovalStatus.APPROVED, executionPlanRef: { id: 'plan-1', goal: 'g' } } })],
      ['executionPlanRef mismatch (CA 20)', patchSetGeneratedOf({ executionPlanRef: { id: 'other-plan', goal: 'g' } })],
      ['empty operations (CA 21)', patchSetGeneratedOf({ operations: [] })],
      ['more than one operation (CA 22)', patchSetGeneratedOf({ operations: [
        { path: TARGET_FILE, operation: 'update', diff: 'd1' },
        { path: TARGET_FILE, operation: 'update', diff: 'd2' },
      ] })],
      ['op path outside targetFiles (CA 23)', patchSetGeneratedOf({ operations: [{ path: 'packages/core/src/other.ts', operation: 'update', diff: 'd' }] })],
      ['op is add (CA 24)', patchSetGeneratedOf({ operations: [{ path: TARGET_FILE, operation: 'add', diff: 'd' }] })],
      ['op is delete (CA 25)', patchSetGeneratedOf({ operations: [{ path: TARGET_FILE, operation: 'delete', diff: 'd' }] })],
      ['op is binary (CA 26)', patchSetGeneratedOf({ operations: [{ path: TARGET_FILE, operation: 'update', diff: 'd', metadata: { binary: true } }] })],
    ];
    for (const [label, patchSet] of cases) {
      const { deps, calls } = makeDeps({ applyAnchor: patchReadyAnchor(), patchGetResult: patchSet });
      const result = await new ConversationRuntime(deps).handle(messageOf('패치 적용해줘'));
      expect(calls.workspaceApply, label).toBe(0);
      expect(calls.loggerWarn, label).toBe(1);
      expect(result.reply.text, label).toBe(failedText);
    }
  });

  // ── Result-integrity / stale write (CA 27–31) ──────────────────────────────────────────────
  it('a non-clean WorkspaceChange never advances to WORKSPACE_APPLIED → composeWorkspaceApplyFailed (CA 27–30)', async () => {
    const cases: Array<[string, WorkspaceChange]> = [
      ['status FAILED — stale update, file unchanged (CA 27)', workspaceChangeOf(applyInputOf(), {
        status: WorkspaceChangeStatus.FAILED,
        results: [{ path: TARGET_FILE, operation: 'update', status: 'failed', message: 'unified diff did not apply cleanly', durationMs: 1 }],
      })],
      ['status PARTIALLY_APPLIED (CA 28)', workspaceChangeOf(applyInputOf(), { status: WorkspaceChangeStatus.PARTIALLY_APPLIED })],
      ['APPLIED but results[0].path mismatch (CA 29)', workspaceChangeOf(applyInputOf(), {
        results: [{ path: 'packages/core/src/other.ts', operation: 'update', status: 'applied', message: 'ok', durationMs: 1 }],
      })],
      ['APPLIED but patchRef.id mismatch (CA 30)', workspaceChangeOf(applyInputOf(), { patchRef: { id: 'other-patch', status: PatchStatus.GENERATED } })],
      ['APPLIED but a failed result', workspaceChangeOf(applyInputOf(), {
        results: [{ path: TARGET_FILE, operation: 'update', status: 'failed', message: 'x', durationMs: 1 }],
      })],
      ['APPLIED but empty results', workspaceChangeOf(applyInputOf(), { results: [] })],
    ];
    for (const [label, change] of cases) {
      const { deps, calls } = makeDeps({ applyAnchor: patchReadyAnchor(), workspaceApply: change });
      const result = await new ConversationRuntime(deps).handle(messageOf('패치 적용해줘'));
      expect(calls.workspaceApply, label).toBe(1); // the write WAS attempted
      expect(calls.applyAnchorSet, label).toBe(0); // but it never advanced to WORKSPACE_APPLIED
      expect(calls.loggerWarn, label).toBe(1);
      expect(result.reply.text, label).toBe(failedText);
    }
  });

  it('workspaceWrite.apply throwing → composeWorkspaceApplyFailed, failure logged, no advance (CA 31)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: patchReadyAnchor(), workspaceApply: 'throw' });
    const result = await new ConversationRuntime(deps).handle(messageOf('패치 적용해줘'));
    expect(calls.workspaceApply).toBe(1);
    expect(calls.applyAnchorSet).toBe(0);
    expect(calls.loggerWarn).toBe(1);
    expect(result.reply.text).toBe(failedText);
  });

  // ── Trigger discipline (CA 32–37) ───────────────────────────────────────────────────────────
  it('a bare "적용"/"좋아"/"오케이"/"확인"/"다음 단계 진행" with PATCH_READY never triggers a file write (CA 32–34)', async () => {
    for (const text of ['적용', '적용해줘', '좋아', '오케이', '확인', '다음 단계 진행']) {
      const { deps, calls } = makeDeps({ applyAnchor: patchReadyAnchor() });
      await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.workspaceApply, text).toBe(0);
    }
  });

  it('"패치 적용해줘" routes to the WorkspaceWrite path, not Sprint 2s handleApplyAlreadyApprovedTurn (CA 35)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: patchReadyAnchor() });
    const result = await new ConversationRuntime(deps).handle(messageOf('패치 적용해줘'));
    expect(calls.workspaceApply).toBe(1);
    expect(result.reply.text).toBe(appliedText);
    expect(result.reply.text).not.toBe(composer.composeApplyApprovalRecorded(CTX).text);
  });

  it('a final-apply phrase with no valid apply context calls neither the classifier nor the Orchestrator (CA 36–37)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: null });
    await new ConversationRuntime(deps).handle(messageOf('패치 적용해줘'));
    expect(calls.classify).toBe(0);
    expect(calls.run).toBe(0);
    expect(calls.resume).toBe(0);
  });

  // ── Input shape & no hidden side effects across the full apply sequence (CA 38–45) ──────────
  it('workspaceWrite.apply receives exactly {patchSet, approvalRef, workspaceRef} — never a CodeProposal (CA 38–39)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: patchReadyAnchor() });
    await new ConversationRuntime(deps).handle(messageOf('패치 적용해줘'));
    const input = calls.lastWorkspaceApplyInput!;
    expect(Object.keys(input).sort()).toEqual(['approvalRef', 'patchSet', 'workspaceRef']);
    expect(input.patchSet.id).toBe('patch-1');
    // the ApprovalRef handed to WorkspaceWrite is the PatchSet's own embedded approval (§5.3)
    expect(input.approvalRef).toEqual(input.patchSet.approvalRef);
    expect(input.approvalRef.id).toBe('apply-appr-1');
    expect(input.workspaceRef.id).toBe(WORKSPACE.id);
  });

  it('the apply sequence performs no patch.generate / codeGeneration.generate / Orchestrator / command / git call (CA 40, 42–45)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: patchReadyAnchor() });
    await new ConversationRuntime(deps).handle(messageOf('패치 적용해줘'));
    expect(calls.workspaceApply).toBe(1); // the ONE mutation on this path
    expect(calls.patchGenerate).toBe(0); // representation-only; not regenerated (CA 40)
    expect(calls.codeGenerationGenerate).toBe(0); // no AI regeneration (CA 45)
    expect(calls.run).toBe(0); // no ExecutionOrchestrator (CA 44)
    expect(calls.resume).toBe(0);
    // `command` (Sprint 2v) and `git` (Sprint 2w) are deps, but the apply path must never call them.
    expect(calls.commandRun).toBe(0); // no CommandExecution on the apply path (CA 42)
    expect(calls.gitStatus).toBe(0); // no git read on the apply path (CA 43)
    expect(calls.gitDiff).toBe(0);
  });

  it('the patch dependency exposes only generate/get — PatchManager gains no apply method (CA 41)', () => {
    const { deps } = makeDeps({ applyAnchor: patchReadyAnchor() });
    expect(Object.keys(deps.patch).sort()).toEqual(['generate', 'get']);
  });

  // ── Idempotency & applied-state routing (CA 46–47) ─────────────────────────────────────────
  it('WORKSPACE_APPLIED + a final-apply command → composeWorkspaceAlreadyApplied, no second write (CA 46)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: appliedAnchor() });
    const result = await new ConversationRuntime(deps).handle(messageOf('패치 적용해줘'));
    expect(calls.workspaceApply).toBe(0);
    expect(calls.applyAnchorSet).toBe(0);
    expect(result.reply.text).toBe(alreadyAppliedText);
  });

  it('WORKSPACE_APPLIED + a patch or apply command → composeWorkspaceAlreadyApplied, never hiding the applied state (CA 47)', async () => {
    for (const text of ['패치 만들어줘', '적용해줘']) {
      const { deps, calls } = makeDeps({ applyAnchor: appliedAnchor() });
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.workspaceApply, text).toBe(0);
      expect(calls.patchGenerate, text).toBe(0);
      expect(result.reply.text, text).toBe(alreadyAppliedText);
    }
  });
});

// ── Sprint 2v — Post-Apply Validation Command (WORKSPACE_APPLIED → CommandExecution, ADR-0043) ────

describe('Post-Apply Validation Command — runtime (Sprint 2v, ADR-0043)', () => {
  /** A WORKSPACE_APPLIED apply anchor carrying the refs the post-apply validation path needs. */
  const validatedAnchor = (o: Partial<ApplyPreviewAnchor> = {}): ApplyPreviewAnchor =>
    approvedAnchorOf({
      status: 'WORKSPACE_APPLIED',
      patchRef: { id: 'patch-1', status: PatchStatus.GENERATED },
      workspaceChangeRef: { id: 'wc-1', status: WorkspaceChangeStatus.APPLIED },
      ...o,
    });

  const composer = new ResponseComposer();
  const clarifyText = composer.composePostApplyValidationClarify(CTX).text;
  const unsupportedText = composer.composePostApplyValidationUnsupported(CTX).text;
  const unavailableText = composer.composePostApplyValidationUnavailable(CTX).text;

  // ── Run + selection (CA 1–4) ────────────────────────────────────────────────────────────────
  it('WORKSPACE_APPLIED + "테스트 돌려줘"/"pnpm test 실행해줘" runs pnpm test once (CA 1–2)', async () => {
    for (const text of ['테스트 돌려줘', 'pnpm test 실행해줘']) {
      const { deps, calls } = makeDeps({ applyAnchor: validatedAnchor() });
      await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.commandRun, text).toBe(1);
      expect(calls.lastCommandRunInput?.command, text).toBe('pnpm');
      expect(calls.lastCommandRunInput?.args, text).toEqual(['test']);
    }
  });

  it('WORKSPACE_APPLIED + "typecheck 해줘"/"타입체크 해줘" runs pnpm typecheck once (CA 3–4)', async () => {
    for (const text of ['typecheck 해줘', '타입체크 해줘']) {
      const { deps, calls } = makeDeps({ applyAnchor: validatedAnchor() });
      await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.commandRun, text).toBe(1);
      expect(calls.lastCommandRunInput?.args, text).toEqual(['typecheck']);
    }
  });

  // ── Clarify / negative / not-automatic (CA 5–10) ─────────────────────────────────────────────
  it('"검증해줘" clarifies, no command.run, RESPONDED, no re-anchor (CA 5)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: validatedAnchor() });
    const result = await new ConversationRuntime(deps).handle(messageOf('검증해줘'));
    expect(calls.commandRun).toBe(0);
    expect(calls.applyAnchorSet).toBe(0);
    expect(result.status).toBe('RESPONDED');
    expect(result.reply.text).toBe(clarifyText);
  });

  it('both test AND typecheck requested → clarify, no command.run (CA 6–7)', async () => {
    for (const text of ['테스트랑 타입체크 해줘', 'pnpm test랑 pnpm typecheck 실행해줘']) {
      const { deps, calls } = makeDeps({ applyAnchor: validatedAnchor() });
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.commandRun, text).toBe(0);
      expect(result.reply.text, text).toBe(clarifyText);
    }
  });

  it('"좋아"/"오케이"/"확인"/"다음 단계 진행" do not run CommandExecution (CA 8–9)', async () => {
    for (const text of ['좋아', '오케이', '확인', '다음 단계 진행']) {
      const { deps, calls } = makeDeps({ applyAnchor: validatedAnchor() });
      await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.commandRun, text).toBe(0);
    }
  });

  it('creating a WORKSPACE_APPLIED anchor is NOT automatic validation — apply success runs no command (CA 10)', async () => {
    // A Sprint 2u apply-success turn (PATCH_READY + "패치 적용해줘") performs zero command.run.
    const { deps, calls } = makeDeps({
      applyAnchor: approvedAnchorOf({ status: 'PATCH_READY', patchRef: { id: 'patch-1', status: PatchStatus.GENERATED } }),
    });
    await new ConversationRuntime(deps).handle(messageOf('패치 적용해줘'));
    expect(calls.workspaceApply).toBe(1); // the apply happened
    expect(calls.commandRun).toBe(0); // but NO validation ran automatically
  });

  // ── Workspace source / Sprint 2l regression (CA 11–15) ──────────────────────────────────────
  it('command runs against anchor.workspaceRef + workspaceChangeRef + executionPlanRef (CA 11–12)', async () => {
    const anchor = validatedAnchor();
    const { deps, calls } = makeDeps({ applyAnchor: anchor });
    await new ConversationRuntime(deps).handle(messageOf('테스트 돌려줘'));
    expect(calls.lastCommandRunInput?.workspaceRef).toEqual(anchor.workspaceRef);
    expect(calls.lastCommandRunInput?.workspaceChangeRef).toEqual(anchor.workspaceChangeRef);
    expect(calls.lastCommandRunInput?.executionPlanRef).toEqual(anchor.executionPlanRef);
    expect(calls.lastCommandRunInput?.approvalRef).toBeUndefined(); // MEDIUM risk → no approval
  });

  it('with a WORKSPACE_APPLIED anchor the workspace is NOT re-resolved (workspace.open not called) (CA 13)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: validatedAnchor() });
    await new ConversationRuntime(deps).handle(messageOf('테스트 돌려줘'));
    expect(calls.workspaceOpen).toBe(0);
  });

  it('NO WORKSPACE_APPLIED anchor → existing Sprint 2l general test/typecheck flow, not the direct path (CA 14–15)', async () => {
    const cases: Array<[string, Intent]> = [
      ['테스트 돌려줘', intentOf(Capability.TEST_EXECUTION, IntentType.RUN_TESTS, true, { kind: 'test' })],
      ['typecheck 해줘', intentOf(Capability.TEST_EXECUTION, IntentType.RUN_TESTS, true, { kind: 'typecheck' })],
    ];
    for (const [text, intent] of cases) {
      const { deps, calls } = makeDeps({ applyAnchor: null, intent, runOutcome: outcomeOf(ExecutionOutcomeStatus.COMPLETED, 'cmd-1') });
      await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.commandRun, text).toBe(0); // runtime does not call command.run directly (new path skipped)
      expect(calls.classify, text).toBe(1); // it goes through the classifier (Sprint 2l path)
      expect(calls.run, text).toBe(1); // and the existing ExecutionOrchestrator TEST_EXECUTION stage
    }
  });

  // ── Command surface / denylist (CA 16–20) ───────────────────────────────────────────────────
  it('only pnpm test / pnpm typecheck ever reach command.run (CA 16)', async () => {
    for (const [text, args] of [['테스트 돌려줘', ['test']], ['타입체크 해줘', ['typecheck']]] as const) {
      const { deps, calls } = makeDeps({ applyAnchor: validatedAnchor() });
      await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.lastCommandRunInput?.command).toBe('pnpm');
      expect(calls.lastCommandRunInput?.args).toEqual(args);
    }
  });

  it('a validation phrase carrying a dangerous/arbitrary command fragment → unsupported, no command.run (CA 17–19)', async () => {
    for (const text of [
      '테스트 돌려줘 rm -rf /',
      '테스트 돌려줘 && git status',
      'pnpm test; git commit',
      'typecheck 해줘 node -e "process.exit(1)"',
    ]) {
      const { deps, calls } = makeDeps({ applyAnchor: validatedAnchor() });
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.commandRun, text).toBe(0);
      expect(calls.applyAnchorSet, text).toBe(0);
      expect(result.status, text).toBe('RESPONDED');
      expect(result.reply.text, text).toBe(unsupportedText);
    }
  });

  it('a pure git request (no validation token) is NOT routed through the validation flow (CA 20)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: validatedAnchor() });
    await new ConversationRuntime(deps).handle(messageOf('git commit 해줘'));
    expect(calls.commandRun).toBe(0); // interpret… → null → falls through, not 'unsupported'
  });

  // ── Rendering (CA 21–27) ────────────────────────────────────────────────────────────────────
  it('SUCCEEDED → composePostApplyValidationPassed with command + bounded output (CA 21, 24)', async () => {
    const { deps } = makeDeps({
      applyAnchor: validatedAnchor(),
      commandRun: commandExecOf(CommandExecutionStatus.SUCCEEDED, ['test'], 0, { stdout: 'all good\n' }),
    });
    const result = await new ConversationRuntime(deps).handle(messageOf('테스트 돌려줘'));
    expect(result.status).toBe('RESPONDED');
    expect(result.reply.text).toContain('pnpm test');
    expect(result.reply.text).toContain('이번 실행 기준으로');
    expect(result.reply.text).toContain('all good');
    expect(result.reply.text).toContain('git 명령은 실행하지 않았어요');
    expect(result.reply.text).toContain('커밋/푸시는 하지 않았어요');
  });

  it('FAILED → composePostApplyValidationFailed, framed as the project result (CA 22, 25)', async () => {
    const { deps } = makeDeps({
      applyAnchor: validatedAnchor(),
      commandRun: commandExecOf(CommandExecutionStatus.FAILED, ['test'], 1, { stdout: 'FAIL x.test.ts\n' }),
    });
    const result = await new ConversationRuntime(deps).handle(messageOf('테스트 돌려줘'));
    expect(result.reply.text).toContain('pnpm test');
    expect(result.reply.text).toContain('FAIL x.test.ts');
    expect(result.reply.text).toContain('git 명령은 실행하지 않았어요');
    expect(result.reply.text).toContain('커밋/푸시는 하지 않았어요');
  });

  it('TIMED_OUT reply is distinct from FAILED and includes commit/push wording (CA 23, 26)', async () => {
    const { deps } = makeDeps({
      applyAnchor: validatedAnchor(),
      commandRun: commandExecOf(CommandExecutionStatus.TIMED_OUT, ['test']),
    });
    const result = await new ConversationRuntime(deps).handle(messageOf('테스트 돌려줘'));
    const failedText = composer.composePostApplyValidationFailed(CTX, { kind: 'test', command: 'pnpm', args: ['test'], durationMs: 1, stdout: '', stderr: '' }).text;
    expect(result.reply.text).not.toBe(failedText);
    expect(result.reply.text).toContain('제한 시간');
    expect(result.reply.text).toContain('git 명령은 실행하지 않았어요');
    expect(result.reply.text).toContain('커밋/푸시는 하지 않았어요');
  });

  it('no terminal validation reply overstates (deployed / verified / clean tree / 완전히 검증) (CA 27)', async () => {
    const details: TestResultDetail = { kind: 'test', command: 'pnpm', args: ['test'], exitCode: 0, durationMs: 1, stdout: '', stderr: '' };
    const replies = [
      composer.composePostApplyValidationPassed(CTX, details).text,
      composer.composePostApplyValidationFailed(CTX, details).text,
      composer.composePostApplyValidationTimedOut(CTX, details).text,
    ];
    for (const text of replies) {
      for (const forbidden of ['완전히 검증', '배포', 'clean tree', 'git 변경 없음', 'committed', 'pushed', 'deployed']) {
        expect(text, forbidden).not.toContain(forbidden);
      }
    }
  });

  // ── No rollback / anchor kept (CA 28–30) ────────────────────────────────────────────────────
  it('FAILED → no rollback (no WorkspaceWrite/git), keeps WORKSPACE_APPLIED (CA 28–29)', async () => {
    const anchor = validatedAnchor();
    const { deps, calls } = makeDeps({
      applyAnchor: anchor,
      commandRun: commandExecOf(CommandExecutionStatus.FAILED, ['test'], 1),
    });
    await new ConversationRuntime(deps).handle(messageOf('테스트 돌려줘'));
    expect(calls.workspaceApply).toBe(0);
    expect(calls.lastApplyAnchor?.status).toBe('WORKSPACE_APPLIED'); // re-anchored, still applied
  });

  it('TIMED_OUT keeps WORKSPACE_APPLIED (CA 30)', async () => {
    const { deps, calls } = makeDeps({
      applyAnchor: validatedAnchor(),
      commandRun: commandExecOf(CommandExecutionStatus.TIMED_OUT, ['test']),
    });
    await new ConversationRuntime(deps).handle(messageOf('테스트 돌려줘'));
    expect(calls.lastApplyAnchor?.status).toBe('WORKSPACE_APPLIED');
  });

  // ── Throw → no ref / no re-anchor (CA 31–32) ────────────────────────────────────────────────
  it('command.run throws → no postApplyValidationRef, no re-anchor, failure logged (CA 31–32)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: validatedAnchor(), commandRun: 'throw' });
    const result = await new ConversationRuntime(deps).handle(messageOf('테스트 돌려줘'));
    expect(calls.commandRun).toBe(1); // it was attempted, then threw
    expect(calls.applyAnchorSet).toBe(0); // NOT re-anchored (CA #4)
    expect(calls.loggerWarn).toBe(1);
    expect(result.reply.text).toBe(unavailableText);
  });

  // ── Ref preservation / latest-only (CA 33–36) ───────────────────────────────────────────────
  it('SUCCEEDED/FAILED/TIMED_OUT each preserve postApplyValidationRef on the anchor (CA 33–35)', async () => {
    const cases: Array<[string, CommandExecutionStatus]> = [
      ['SUCCEEDED', CommandExecutionStatus.SUCCEEDED],
      ['FAILED', CommandExecutionStatus.FAILED],
      ['TIMED_OUT', CommandExecutionStatus.TIMED_OUT],
    ];
    for (const [label, status] of cases) {
      const { deps, calls } = makeDeps({
        applyAnchor: validatedAnchor(),
        commandRun: commandExecOf(status, ['test'], status === CommandExecutionStatus.FAILED ? 1 : 0),
      });
      await new ConversationRuntime(deps).handle(messageOf('테스트 돌려줘'));
      expect(calls.applyAnchorSet, label).toBe(1);
      expect(calls.lastApplyAnchor?.postApplyValidationRef, label).toEqual({ id: 'cmd-1', status });
      expect(calls.lastApplyAnchor?.status, label).toBe('WORKSPACE_APPLIED');
    }
  });

  it('a second validation replaces postApplyValidationRef with the latest ref (CA 36)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: validatedAnchor() }); // stateful anchor fake
    const runtime = new ConversationRuntime(deps);
    await runtime.handle(messageOf('테스트 돌려줘'));
    expect(calls.lastApplyAnchor?.postApplyValidationRef?.id).toBe('cmd-test');
    await runtime.handle(messageOf('타입체크 해줘'));
    expect(calls.lastApplyAnchor?.postApplyValidationRef?.id).toBe('cmd-typecheck'); // replaced, not appended
    expect(calls.commandRun).toBe(2);
  });

  // ── No new state / no side effects (CA 37–45) ───────────────────────────────────────────────
  it('the validation path performs no WorkspaceWrite/Patch/CodeGen/git/Orchestrator call (CA 37–45)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: validatedAnchor() });
    await new ConversationRuntime(deps).handle(messageOf('테스트 돌려줘'));
    expect(calls.commandRun).toBe(1); // the ONE allow-listed command
    expect(calls.workspaceApply).toBe(0); // no WorkspaceWrite (CA 39)
    expect(calls.patchGenerate).toBe(0); // no PatchManager.generate (CA 40)
    expect(calls.patchGet).toBe(0); // no PatchManager.get (CA 41)
    expect(calls.codeGenerationGenerate).toBe(0); // no CodeGeneration (CA 42)
    expect(calls.run).toBe(0); // no ExecutionOrchestrator (CA 44)
    expect(calls.resume).toBe(0);
    // `git` is a dep since Sprint 2w, but the validation path must never call it.
    expect(calls.gitStatus).toBe(0); // no git read on the validation path (CA 43)
    expect(calls.gitDiff).toBe(0);
    // no new anchor status (CA 38): the re-anchor keeps WORKSPACE_APPLIED, never WORKSPACE_VALIDATED
    expect(calls.lastApplyAnchor?.status).toBe('WORKSPACE_APPLIED');
  });

  it('clarify and unsupported are RESPONDED, record memory, never re-anchor or set a ref (CA #3)', async () => {
    for (const text of ['검증해줘', '테스트 돌려줘 && git status']) {
      const { deps, calls } = makeDeps({ applyAnchor: validatedAnchor() });
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(result.status, text).toBe('RESPONDED');
      expect(calls.recordAssistant, text).toBe(1);
      expect(calls.applyAnchorSet, text).toBe(0);
      expect(calls.commandRun, text).toBe(0);
    }
  });
});

// ── Sprint 2w — Post-Validation Git Status Preview (WORKSPACE_APPLIED → read-only Git, ADR-0044) ──

describe('Post-Validation Git Status Preview — runtime (Sprint 2w, ADR-0044)', () => {
  /** A WORKSPACE_APPLIED anchor for the read-only git-preview path. */
  const gitAnchor = (o: Partial<ApplyPreviewAnchor> = {}): ApplyPreviewAnchor =>
    approvedAnchorOf({
      status: 'WORKSPACE_APPLIED',
      workspaceChangeRef: { id: 'wc-1', status: WorkspaceChangeStatus.APPLIED },
      ...o,
    });
  const gitAnchorWithValidation = (o: Partial<ApplyPreviewAnchor> = {}): ApplyPreviewAnchor =>
    gitAnchor({ postApplyValidationRef: { id: 'cmd-1', status: CommandExecutionStatus.SUCCEEDED }, ...o });

  const composer = new ResponseComposer();
  const mutationText = composer.composeGitMutationNotSupported(CTX).text;
  const unavailableText = composer.composeGitPreviewUnavailable(CTX).text;

  // ── status/diff calls (CA 1–6) ──────────────────────────────────────────────────────────────
  it('status phrases call git.status only (CA 1–4)', async () => {
    for (const text of ['git 상태 보여줘', '깃 상태 보여줘', '변경 파일 보여줘', '커밋 전에 변경사항 요약해줘']) {
      const { deps, calls } = makeDeps({ applyAnchor: gitAnchor() });
      await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.gitStatus, text).toBe(1);
      expect(calls.gitDiff, text).toBe(0);
    }
  });

  it('diff phrases call BOTH git.status and git.diff (CA 5–6)', async () => {
    for (const text of ['diff 보여줘', 'git diff 보여줘']) {
      const { deps, calls } = makeDeps({ applyAnchor: gitAnchor() });
      await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.gitStatus, text).toBe(1);
      expect(calls.gitDiff, text).toBe(1);
    }
  });

  // ── negative / not-automatic (CA 7–10) ──────────────────────────────────────────────────────
  it('"좋아"/"오케이"/"확인"/"다음 단계 진행" do not call git (CA 7–8)', async () => {
    for (const text of ['좋아', '오케이', '확인', '다음 단계 진행']) {
      const { deps, calls } = makeDeps({ applyAnchor: gitAnchor() });
      await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.gitStatus, text).toBe(0);
      expect(calls.gitDiff, text).toBe(0);
    }
  });

  it('apply success (Sprint 2u) runs no git preview automatically (CA 9)', async () => {
    const { deps, calls } = makeDeps({
      applyAnchor: approvedAnchorOf({ status: 'PATCH_READY', patchRef: { id: 'patch-1', status: PatchStatus.GENERATED } }),
    });
    await new ConversationRuntime(deps).handle(messageOf('패치 적용해줘'));
    expect(calls.workspaceApply).toBe(1);
    expect(calls.gitStatus).toBe(0);
    expect(calls.gitDiff).toBe(0);
  });

  it('post-apply validation success (Sprint 2v) runs no git preview automatically (CA 10)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: gitAnchor() });
    await new ConversationRuntime(deps).handle(messageOf('테스트 돌려줘'));
    expect(calls.commandRun).toBe(1);
    expect(calls.gitStatus).toBe(0);
    expect(calls.gitDiff).toBe(0);
  });

  // ── mutating rejection (CA 11–16) ───────────────────────────────────────────────────────────
  it('non-commit mutating git phrases reject with no git read (CA 11–16)', async () => {
    // NOTE: commit phrases (커밋해줘 / commit this / …) are handled by Sprint 2x's commit-approval flow, not
    // by this 2w git-mutation reject — so this list is the non-commit mutations only.
    for (const text of ['git add 해줘', 'push 해줘', 'git reset 해줘', 'stash 해줘']) {
      const { deps, calls } = makeDeps({ applyAnchor: gitAnchor() });
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.gitStatus, text).toBe(0);
      expect(calls.gitDiff, text).toBe(0);
      expect(result.reply.text, text).toBe(mutationText);
    }
  });

  // ── workspace / gating (CA 17–19) ───────────────────────────────────────────────────────────
  it('no WORKSPACE_APPLIED anchor → no post-apply git preview (CA 17)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: null });
    await new ConversationRuntime(deps).handle(messageOf('git 상태 보여줘'));
    expect(calls.gitStatus).toBe(0);
    expect(calls.gitDiff).toBe(0);
  });

  it('git read uses anchor.workspaceRef.rootPath and does not re-resolve the workspace (CA 18–19)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: gitAnchor() });
    await new ConversationRuntime(deps).handle(messageOf('diff 보여줘'));
    expect(calls.lastGitStatusRoot).toBe(WORKSPACE.rootPath);
    expect(calls.lastGitDiffRoot).toBe(WORKSPACE.rootPath);
    expect(calls.workspaceOpen).toBe(0);
  });

  // ── bounds (CA 20–23) ───────────────────────────────────────────────────────────────────────
  it('changed files over 30 are truncated and labeled; diff truncation labeled; within budget (CA 20–23)', async () => {
    const many = Array.from({ length: 40 }, (_, i) => `f${i}.ts`);
    const s = await new ConversationRuntime(makeDeps({ applyAnchor: gitAnchor(), gitStatus: gitStatusOf({ staged: many, unstaged: [], untracked: [] }) }).deps).handle(messageOf('git 상태 보여줘'));
    expect(s.reply.text).toContain('생략했어요');
    expect(s.reply.text.length).toBeLessThanOrEqual(1900);

    const d = await new ConversationRuntime(makeDeps({ applyAnchor: gitAnchor(), gitDiff: gitDiffOf({ truncated: true }) }).deps).handle(messageOf('diff 보여줘'));
    expect(d.reply.text).toContain('일부만 보여드렸어요');
    expect(d.reply.text.length).toBeLessThanOrEqual(1900);
  });

  // ── validation context (CA 24–27) ───────────────────────────────────────────────────────────
  it('validation context: resolved shows command+status (CA 24)', async () => {
    const { deps } = makeDeps({ applyAnchor: gitAnchorWithValidation(), commandExec: commandExecOf(CommandExecutionStatus.SUCCEEDED, ['test'], 0) });
    const result = await new ConversationRuntime(deps).handle(messageOf('git 상태 보여줘'));
    expect(result.reply.text).toContain('pnpm test SUCCEEDED');
  });

  it('validation context: absent → "검증 기록 없음" (CA 25)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: gitAnchor() });
    const result = await new ConversationRuntime(deps).handle(messageOf('git 상태 보여줘'));
    expect(result.reply.text).toContain('검증 기록 없음');
    expect(calls.commandExecGet).toBe(0); // no ref → not looked up
  });

  it('validation lookup null/throw → preview still succeeds, validation shown unavailable (CA 26–27)', async () => {
    const nullCase = makeDeps({ applyAnchor: gitAnchorWithValidation(), commandExec: null });
    const r1 = await new ConversationRuntime(nullCase.deps).handle(messageOf('git 상태 보여줘'));
    expect(nullCase.calls.gitStatus).toBe(1); // preview proceeded
    expect(r1.status).toBe('RESPONDED');
    expect(r1.reply.text).toContain('불러올 수 없어요');

    const throwCase = makeDeps({ applyAnchor: gitAnchorWithValidation(), commandExecGetThrows: true });
    const r2 = await new ConversationRuntime(throwCase.deps).handle(messageOf('git 상태 보여줘'));
    expect(throwCase.calls.gitStatus).toBe(1); // preview proceeded despite lookup throw
    expect(r2.status).toBe('RESPONDED');
    expect(r2.reply.text).toContain('불러올 수 없어요');
  });

  // ── disclaimers (CA 28–32) ──────────────────────────────────────────────────────────────────
  it('every successful preview carries the read-only disclaimers and no overclaim (CA 28–32)', async () => {
    for (const text of ['git 상태 보여줘', 'diff 보여줘']) {
      const { deps } = makeDeps({ applyAnchor: gitAnchor() });
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      for (const d of ['읽기 전용 Git 미리보기', 'git add/commit/push는 하지 않았어요', '파일 수정은 하지 않았어요', '명령 실행도 하지 않았어요']) {
        expect(result.reply.text, `${text}:${d}`).toContain(d);
      }
      for (const f of ['배포 가능', 'committed', 'pushed', 'deployed', '검증 완료', 'safe to commit']) {
        expect(result.reply.text, `${text}:${f}`).not.toContain(f);
      }
    }
  });

  // ── read failure (CA 33–37) ─────────────────────────────────────────────────────────────────
  it('git.status throws on a status preview → safe failure, no fallback (CA 33, 36–37)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: gitAnchor(), gitStatus: 'throw' });
    const result = await new ConversationRuntime(deps).handle(messageOf('git 상태 보여줘'));
    expect(result.status).toBe('FAILED');
    expect(result.reply.text).toBe(unavailableText);
    // CA impl review: a read-only git subcommand WAS attempted, so the failure copy must NOT claim none ran.
    expect(result.reply.text).not.toContain('git 명령은 실행하지 않았어요');
    expect(result.reply.text).toContain('git add/commit/push는 하지 않았어요');
    expect(calls.loggerWarn).toBe(1);
    expect(calls.commandRun).toBe(0);
    expect(calls.workspaceApply).toBe(0);
  });

  it('diff preview: git.status throws first → git.diff NOT called (CA 34)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: gitAnchor(), gitStatus: 'throw' });
    const result = await new ConversationRuntime(deps).handle(messageOf('diff 보여줘'));
    expect(calls.gitStatus).toBe(1);
    expect(calls.gitDiff).toBe(0); // status failed before diff
    expect(result.reply.text).toBe(unavailableText);
  });

  it('diff preview: git.diff throws after status ok → safe failure (CA 35)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: gitAnchor(), gitDiff: 'throw' });
    const result = await new ConversationRuntime(deps).handle(messageOf('diff 보여줘'));
    expect(calls.gitStatus).toBe(1);
    expect(calls.gitDiff).toBe(1);
    expect(result.status).toBe('FAILED');
    expect(result.reply.text).toBe(unavailableText);
  });

  // ── no side effects / no re-anchor (CA 38–47) ───────────────────────────────────────────────
  it('the git-preview path performs no CommandExecution/WorkspaceWrite/Patch/CodeGen/Orchestrator call and no re-anchor (CA 38–47)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: gitAnchor() });
    await new ConversationRuntime(deps).handle(messageOf('diff 보여줘'));
    expect(calls.commandRun).toBe(0);
    expect(calls.workspaceApply).toBe(0);
    expect(calls.patchGenerate).toBe(0);
    expect(calls.patchGet).toBe(0);
    expect(calls.codeGenerationGenerate).toBe(0);
    expect(calls.run).toBe(0);
    expect(calls.resume).toBe(0);
    expect(calls.applyAnchorSet).toBe(0); // no re-anchor on preview (CA #9)
    // the git dep exposes only read-only status/diff — no mutating method (structural)
    expect(Object.keys(deps.git).sort()).toEqual(['diff', 'status']);
  });
});

// ── Sprint 2x — Explicit Git Commit Approval (WORKSPACE_APPLIED → approval halt, ADR-0045) ────────

describe('Explicit Git Commit Approval — runtime (Sprint 2x, ADR-0045)', () => {
  /** WORKSPACE_APPLIED anchor whose git status is fully in-scope (changes ⊆ targetFiles). */
  const commitAnchor = (o: Partial<ApplyPreviewAnchor> = {}): ApplyPreviewAnchor =>
    approvedAnchorOf({
      status: 'WORKSPACE_APPLIED',
      workspaceChangeRef: { id: 'wc-1', status: WorkspaceChangeStatus.APPLIED },
      ...o,
    });
  /** A COMMIT_APPROVAL_PENDING anchor with complete resume context. */
  const pendingCommitAnchor = (o: Partial<ApplyPreviewAnchor> = {}): ApplyPreviewAnchor =>
    commitAnchor({
      status: 'COMMIT_APPROVAL_PENDING',
      commitApprovalId: 'apply-appr-1',
      proposedCommitMessage: 'chore: update ' + TARGET_FILE,
      commitCandidateFiles: [TARGET_FILE],
      ...o,
    });
  const inScopeStatus = { staged: [TARGET_FILE], unstaged: [] as string[], untracked: [] as string[] };
  const composer = new ResponseComposer();

  // ── intent + status read (CA 1–6) ───────────────────────────────────────────────────────────
  it('commit requests read git.status (never git.diff) and create a HIGH approval (CA 1–5)', async () => {
    for (const text of ['커밋해줘', '이 변경사항 커밋해줘', 'git commit 준비해줘', 'commit this', '커밋 메시지 만들어줘']) {
      const { deps, calls } = makeDeps({ applyAnchor: commitAnchor(), gitStatus: gitStatusOf(inScopeStatus) });
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.gitStatus, text).toBe(1);
      expect(calls.gitDiff, text).toBe(0);
      expect(calls.requestForRisk, text).toBe(1);
      expect(calls.lastRequestForRiskInput?.riskLevel, text).toBe(RiskLevel.HIGH);
      expect(calls.lastApplyAnchor?.status, text).toBe('COMMIT_APPROVAL_PENDING');
      expect(result.status, text).toBe('AWAITING_APPROVAL');
    }
  });

  it('"커밋 전에 변경사항 요약" is NOT a commit request — stays a 2w status preview (CA 6)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: commitAnchor() });
    await new ConversationRuntime(deps).handle(messageOf('커밋 전에 변경사항 요약 보여줘'));
    expect(calls.requestForRisk).toBe(0);
    expect(calls.gitStatus).toBe(1); // 2w status preview ran, not a commit approval
  });

  // ── negative / gating (CA 7–9) ──────────────────────────────────────────────────────────────
  it('"좋아"/"오케이"/"확인"/"다음 단계"/"진행해" do not trigger commit approval (CA 7–8)', async () => {
    for (const text of ['좋아', '오케이', '확인', '다음 단계', '진행해']) {
      const { deps, calls } = makeDeps({ applyAnchor: commitAnchor() });
      await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.requestForRisk, text).toBe(0);
    }
  });

  it('no WORKSPACE_APPLIED anchor + "커밋해줘" → composeCommitUnavailable, no approval, no git (CA 9)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: null });
    const result = await new ConversationRuntime(deps).handle(messageOf('커밋해줘'));
    expect(calls.requestForRisk).toBe(0);
    expect(calls.gitStatus).toBe(0);
    expect(result.reply.text).toBe(composer.composeCommitUnavailable(CTX).text);
  });

  // ── mutation rejection (CA 10–13) ───────────────────────────────────────────────────────────
  it('push/add/reset-only phrases → no approval (CA 10, 12, 13)', async () => {
    for (const text of ['push 해줘', 'git add 해줘', 'git reset 해줘', 'stash 해줘']) {
      const { deps, calls } = makeDeps({ applyAnchor: commitAnchor() });
      await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.requestForRisk, text).toBe(0);
      expect(calls.gitStatus, text).toBe(0);
    }
  });

  it('"commit and push" / "커밋하고 push" → unsupported companion, no approval, no git (CA 11)', async () => {
    for (const text of ['commit and push', '커밋하고 push 해줘']) {
      const { deps, calls } = makeDeps({ applyAnchor: commitAnchor() });
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.requestForRisk, text).toBe(0);
      expect(calls.gitStatus, text).toBe(0);
      expect(result.reply.text, text).toBe(composer.composeCommitUnsupportedCompanion(CTX).text);
    }
  });

  // ── status preconditions (CA 14–17) ─────────────────────────────────────────────────────────
  it('clean tree → nothing to commit, no approval (CA 14)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: commitAnchor(), gitStatus: gitStatusOf({ clean: true, staged: [], unstaged: [], untracked: [] }) });
    const result = await new ConversationRuntime(deps).handle(messageOf('커밋해줘'));
    expect(calls.requestForRisk).toBe(0);
    expect(result.reply.text).toBe(composer.composeCommitNothingToCommit(CTX).text);
  });

  it('git.status throws → composeCommitStatusUnavailable, no approval, no fallback, precise wording (CA 15–17)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: commitAnchor(), gitStatus: 'throw' });
    const result = await new ConversationRuntime(deps).handle(messageOf('커밋해줘'));
    expect(calls.requestForRisk).toBe(0);
    expect(calls.commandRun).toBe(0);
    expect(result.reply.text).toBe(composer.composeCommitStatusUnavailable(CTX).text);
    expect(result.reply.text).not.toContain('git 명령은 실행하지 않았어요');
  });

  // ── candidate files + path safety (CA 18–25) ────────────────────────────────────────────────
  it('in-scope changes create an approval; out-of-scope / unsafe / empty-intersection do not (CA 18–24)', async () => {
    // in-scope
    const ok = makeDeps({ applyAnchor: commitAnchor(), gitStatus: gitStatusOf(inScopeStatus) });
    await new ConversationRuntime(ok.deps).handle(messageOf('커밋해줘'));
    expect(ok.calls.requestForRisk).toBe(1);

    const blocked: Array<[string, ReturnType<typeof gitStatusOf>]> = [
      ['outside targetFiles', gitStatusOf({ staged: ['other/x.ts'], unstaged: [], untracked: [] })],
      ['untracked outside', gitStatusOf({ staged: [], unstaged: [], untracked: ['other/y.ts'] })],
      ['only-outside (empty intersection)', gitStatusOf({ staged: ['a.ts'], unstaged: ['b.ts'], untracked: [] })],
      ['absolute path', gitStatusOf({ staged: ['/etc/passwd'], unstaged: [], untracked: [] })],
      ['traversal path', gitStatusOf({ staged: ['../../secret'], unstaged: [], untracked: [] })],
      ['empty path', gitStatusOf({ staged: [''], unstaged: [], untracked: [] })],
    ];
    for (const [label, status] of blocked) {
      const { deps, calls } = makeDeps({ applyAnchor: commitAnchor(), gitStatus: status });
      const result = await new ConversationRuntime(deps).handle(messageOf('커밋해줘'));
      expect(calls.requestForRisk, label).toBe(0);
      expect(result.reply.text, label).toContain('적용 대상 밖의'); // composeCommitOutOfScopeChanges wording
    }
  });

  // ── commit message (CA 26–33) ───────────────────────────────────────────────────────────────
  it('deterministic message ≤120, valid user message accepted, invalid rejected (CA 26–33)', async () => {
    // deterministic default
    const def = makeDeps({ applyAnchor: commitAnchor(), gitStatus: gitStatusOf(inScopeStatus) });
    await new ConversationRuntime(def.deps).handle(messageOf('커밋해줘'));
    expect(def.calls.lastApplyAnchor?.proposedCommitMessage?.length).toBeLessThanOrEqual(120);

    // valid user message
    const good = makeDeps({ applyAnchor: commitAnchor(), gitStatus: gitStatusOf(inScopeStatus) });
    await new ConversationRuntime(good.deps).handle(messageOf('커밋해줘 메시지는 "fix: handle git failure"'));
    expect(good.calls.lastApplyAnchor?.proposedCommitMessage).toBe('fix: handle git failure');
    expect(good.calls.requestForRisk).toBe(1);

    // invalid: multiline / overlong / multiple quoted
    const invalids = [
      '커밋해줘 메시지는 "line1\nline2"',
      '커밋해줘 메시지는 "' + 'x'.repeat(130) + '"',
      '커밋해줘 메시지는 "one" 그리고 "two"',
    ];
    for (const text of invalids) {
      const { deps, calls } = makeDeps({ applyAnchor: commitAnchor(), gitStatus: gitStatusOf(inScopeStatus) });
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.requestForRisk, text).toBe(0);
      expect(result.reply.text, text).toBe(composer.composeCommitMessageInvalid(CTX).text);
    }
  });

  it('approval reason includes files/message/validation/HIGH + deferral note, and no raw diff (CA 34–39)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: commitAnchor(), gitStatus: gitStatusOf(inScopeStatus) });
    await new ConversationRuntime(deps).handle(messageOf('커밋해줘'));
    const reason = calls.lastRequestForRiskInput?.reason ?? '';
    expect(reason).toContain(TARGET_FILE);
    expect(reason).toContain('chore: update');
    expect(reason).toContain('no git add/commit/push has been performed');
    expect(reason).toContain('records permission only');
    expect(reason).toContain('git commit approval planning');
    expect(reason).not.toContain('diff --git');
  });

  // ── decision integrity (CA 40–53) ───────────────────────────────────────────────────────────
  it('COMMIT_APPROVAL_PENDING with incomplete context → safe failure, no decide, logger never throws (CA 41–44)', async () => {
    const bad: Array<[string, Partial<ApplyPreviewAnchor>]> = [
      ['missing commitApprovalId', { commitApprovalId: undefined }],
      ['missing proposedCommitMessage', { proposedCommitMessage: undefined }],
      ['missing commitCandidateFiles', { commitCandidateFiles: [] }],
      ['missing workspaceChangeRef', { workspaceChangeRef: undefined }],
      // CA impl review: a missing executionPlanRef must be a safe failure — the failure log must NOT throw.
      ['missing executionPlanRef', { executionPlanRef: undefined }],
    ];
    for (const [label, patch] of bad) {
      const { deps, calls } = makeDeps({ applyAnchor: pendingCommitAnchor(patch) });
      const result = await new ConversationRuntime(deps).handle(messageOf('승인')); // must not throw
      expect(calls.decide, label).toBe(0);
      expect(result.status, label).toBe('FAILED');
      expect(result.reply.text, label).toBe(composer.composeCommitUnavailable(CTX).text);
    }
  });

  it('approval request missing/not-PENDING/plan-mismatch → safe failure, no decide (CA 44)', async () => {
    const gone = makeDeps({ applyAnchor: pendingCommitAnchor(), approvalsGetResult: null });
    await new ConversationRuntime(gone.deps).handle(messageOf('승인'));
    expect(gone.calls.decide).toBe(0);

    const mismatch = makeDeps({ applyAnchor: pendingCommitAnchor(), approvalsGetResult: { ...pendingApprovalOf(), id: 'apply-appr-1', executionPlanRef: { id: 'other-plan', goal: 'g' } } });
    await new ConversationRuntime(mismatch.deps).handle(messageOf('승인'));
    expect(mismatch.calls.decide).toBe(0);
  });

  it('ambiguous decision preserves pending context, no decide, no new approval (CA 45)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: pendingCommitAnchor() });
    const result = await new ConversationRuntime(deps).handle(messageOf('음 글쎄'));
    expect(calls.decide).toBe(0);
    expect(calls.requestForRisk).toBe(0);
    expect(calls.applyAnchorSet).toBe(0); // no re-anchor
    expect(result.status).toBe('AWAITING_APPROVAL');
  });

  it('deny/cancel → decide, revert to WORKSPACE_APPLIED clearing only commit fields, commit-specific reply (CA 46–49)', async () => {
    for (const [text, expectedStatus] of [['거절', 'DENIED'], ['취소', 'CANCELLED']] as const) {
      const { deps, calls } = makeDeps({ applyAnchor: pendingCommitAnchor() });
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.decide, text).toBe(1);
      expect(result.status, text).toBe(expectedStatus);
      expect(calls.lastApplyAnchor?.status, text).toBe('WORKSPACE_APPLIED');
      expect(calls.lastApplyAnchor?.commitApprovalId, text).toBeUndefined();
      expect(calls.lastApplyAnchor?.proposedCommitMessage, text).toBeUndefined();
      expect(calls.lastApplyAnchor?.workspaceChangeRef, text).toEqual({ id: 'wc-1', status: WorkspaceChangeStatus.APPLIED });
      expect(calls.lastApplyAnchor?.targetFiles, text).toEqual([TARGET_FILE]);
      const expected = text === '거절' ? composer.composeCommitApprovalDenied(CTX).text : composer.composeCommitApprovalCancelled(CTX).text;
      expect(result.reply.text, text).toBe(expected);
      // not the generic execution-result wording
      expect(result.reply.text, text).not.toBe(composer.composeExecutionResult(CTX, expectedStatus).text);
    }
  });

  it('approve → decide, re-anchor COMMIT_APPROVED, recorded reply, no git commit (CA 50–52)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: pendingCommitAnchor() });
    const result = await new ConversationRuntime(deps).handle(messageOf('승인'));
    expect(calls.decide).toBe(1);
    expect(calls.lastApplyAnchor?.status).toBe('COMMIT_APPROVED');
    expect(result.reply.text).toBe(composer.composeCommitApprovalRecorded(CTX).text);
    expect(result.reply.text).not.toContain('커밋 완료');
    expect(calls.gitStatus).toBe(0); // no git on the decision turn
  });

  it('COMMIT_APPROVED + "커밋해줘" → already-approved/not-committed, no new approval (CA 53)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: commitAnchor({ status: 'COMMIT_APPROVED' }) });
    const result = await new ConversationRuntime(deps).handle(messageOf('커밋해줘'));
    expect(calls.requestForRisk).toBe(0);
    expect(result.reply.text).toBe(composer.composeCommitAlreadyApproved(CTX).text);
  });

  // ── no side effects (CA 54–65) ──────────────────────────────────────────────────────────────
  it('the commit-approval path performs no git.diff/WorkspaceWrite/Patch/CodeGen/Orchestrator/command call (CA 54–65)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: commitAnchor(), gitStatus: gitStatusOf(inScopeStatus) });
    await new ConversationRuntime(deps).handle(messageOf('커밋해줘'));
    expect(calls.gitDiff).toBe(0);
    expect(calls.workspaceApply).toBe(0);
    expect(calls.patchGenerate).toBe(0);
    expect(calls.patchGet).toBe(0);
    expect(calls.codeGenerationGenerate).toBe(0);
    expect(calls.commandRun).toBe(0);
    expect(calls.run).toBe(0);
    expect(calls.resume).toBe(0);
    // git dep exposes only read-only status/diff (no mutation method); no GitProvider add/commit/push
    expect(Object.keys(deps.git).sort()).toEqual(['diff', 'status']);
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

describe('filterInScopeChanges (Sprint 2r, ADR-0039)', () => {
  it('an in-scope delete change preserves delete: true exactly — no defaulted newContent field', () => {
    const { inScope, outOfScopeWarnings } = filterInScopeChanges([{ path: TARGET_FILE, delete: true }], [TARGET_FILE]);
    expect(inScope).toEqual([{ path: TARGET_FILE, delete: true }]);
    expect(inScope[0]).not.toHaveProperty('newContent');
    expect(outOfScopeWarnings).toEqual([]);
  });

  it('an in-scope update change preserves newContent exactly', () => {
    const { inScope } = filterInScopeChanges([{ path: TARGET_FILE, newContent: 'x' }], [TARGET_FILE]);
    expect(inScope).toEqual([{ path: TARGET_FILE, newContent: 'x' }]);
  });

  it('the rendered path is the validated targetFiles value, never the AI raw path', () => {
    const { inScope } = filterInScopeChanges([{ path: `./${TARGET_FILE}`, newContent: 'x' }], [TARGET_FILE]);
    expect(inScope).toEqual([{ path: TARGET_FILE, newContent: 'x' }]);
  });

  it('an out-of-scope path is excluded from inScope and reported using the AI raw string', () => {
    const { inScope, outOfScopeWarnings } = filterInScopeChanges([{ path: 'other.ts', newContent: 'x' }], [TARGET_FILE]);
    expect(inScope).toEqual([]);
    expect(outOfScopeWarnings).toEqual(['other.ts']);
  });
});

describe('toCodeDiffPreview (Sprint 2r, ADR-0039)', () => {
  const diffOf = (changeKind: 'add' | 'modify' | 'delete', unified = 'diff text', binary = false): WorkspaceDiff => ({
    refId: 'ws-1',
    files: [{ path: TARGET_FILE, changeKind, unified, binary }],
    estimatedChangedLines: 1,
    truncated: false,
  });

  it("maps a 'modify' FileDiff to kind: 'update'", () => {
    const preview = toCodeDiffPreview(diffOf('modify'), []);
    expect(preview.changes).toEqual([{ path: TARGET_FILE, kind: 'update', unified: 'diff text', binary: false }]);
  });

  it("maps a 'delete' FileDiff to kind: 'delete'", () => {
    const preview = toCodeDiffPreview(diffOf('delete'), []);
    expect(preview.changes[0]?.kind).toBe('delete');
  });

  it('passes unified/binary through unchanged', () => {
    const preview = toCodeDiffPreview(diffOf('modify', '', true), []);
    expect(preview.changes[0]).toEqual({ path: TARGET_FILE, kind: 'update', unified: '', binary: true });
  });

  it('passes outOfScopeWarnings through unchanged', () => {
    const preview = toCodeDiffPreview(diffOf('modify'), ['other.ts']);
    expect(preview.outOfScopeWarnings).toEqual(['other.ts']);
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
