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
  ApprovalRef,
  ApprovalRequest,
  CodeGeneration,
  CodeProposal,
  CommandExecution,
  ConversationContext,
  ExecutionPlanRef,
  GenerateCodeInput,
  GitCommitResult,
  GitDiff,
  GitPushResult,
  GitStatus,
  RepositoryInfo,
  InboundMessage,
  Intent,
  PatchGenerationInput,
  PatchSet,
  ProposedChange,
  Project,
  PullRequestMergeResult,
  PullRequestRef,
  PullRequestResult,
  PullRequestStatusPreview,
  RepositoryIdentity,
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
import { RepositoryHostingBlockedError, RepositoryHostingUnverifiedError } from './repository-hosting-manager';

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

/** A valid GitCommitResult (Sprint 2y) — SHA-shaped hash + files/message echoing the commit input, so the
 *  runtime's result-integrity gate passes by default. Override any field to force a mismatch. */
const gitCommitResultOf = (
  input: { files: string[]; message: string },
  o: Partial<GitCommitResult> = {},
): GitCommitResult => ({
  commitHash: '0123456789abcdef0123456789abcdef01234567',
  committedFiles: input.files,
  message: input.message,
  ...o,
});

/** A SHA-shaped commit hash reused across Sprint 2y/2z fixtures (matches the default commit result). */
const HEAD_SHA = '0123456789abcdef0123456789abcdef01234567';

/** Read-only RepositoryInfo (Sprint 2z) — attached branch `main`, HEAD == HEAD_SHA by default so a
 *  GIT_COMMITTED push turn passes the HEAD-matches-committed-hash gate. Override to force detached/moved. */
const repoInfoOf = (o: Partial<RepositoryInfo> = {}): RepositoryInfo => ({
  isRepository: true,
  rootPath: '/repo',
  branch: 'main',
  headSha: HEAD_SHA,
  detached: false,
  ...o,
});

/** A valid GitPushResult (Sprint 3a) — echoes the approved push input, so the runtime's result-integrity
 *  gate passes by default. Override any field to force a mismatch. */
const gitPushResultOf = (
  input: { remote: string; branch: string; commitHash: string },
  o: Partial<GitPushResult> = {},
): GitPushResult => ({
  remote: input.remote,
  branch: input.branch,
  upstreamRef: `${input.remote}/${input.branch}`,
  commitHash: input.commitHash,
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
  gitCommit: number;
  gitInfo: number;
  gitPush: number;
  lastGitStatusRoot?: string;
  lastGitDiffRoot?: string;
  lastGitCommitInput?: { rootPath: string; files: string[]; message: string; approvalRef: ApprovalRef };
  lastGitInfoRoot?: string;
  lastGitPushInput?: { rootPath: string; remote: string; branch: string; commitHash: string; approvalRef: ApprovalRef };
  commandExecGet: number;
  loggerWarn: number;
  hostingCreatePR: number;
  lastHostingCreateInput?: {
    identity: RepositoryIdentity;
    headBranch: string;
    baseBranch: string;
    title: string;
    body: string;
    expectedCommitHash: string;
    approvalRef: ApprovalRef;
  };
  hostingGetStatus: number;
  lastHostingStatusInput?: HostingStatusInput;
  hostingMergePR: number;
  lastHostingMergeInput?: HostingMergeInput;
}

/** Shape of the input the runtime passes to `RepositoryHostingManager.getPullRequestStatus` (Sprint 3e). */
interface HostingStatusInput {
  identity: RepositoryIdentity;
  pullRequestRef: PullRequestRef;
  expectedHeadBranch: string;
  expectedBaseBranch: string;
  expectedCommitHash: string;
}

/** Shape of the input the runtime passes to `RepositoryHostingManager.mergePullRequest` (Sprint 3g). */
interface HostingMergeInput {
  identity: RepositoryIdentity;
  pullRequestRef: PullRequestRef;
  expectedHeadBranch: string;
  expectedBaseBranch: string;
  expectedHeadSha: string;
  approvalRef: ApprovalRef;
}

/** Default fake PullRequestMergeResult echoing the merge input (Sprint 3g) — a valid, merged result. */
function prMergeResultOf(input: HostingMergeInput, over: Partial<PullRequestMergeResult> = {}): PullRequestMergeResult {
  return {
    provider: 'github',
    owner: input.identity.owner,
    repo: input.identity.repo,
    pullRequestNumber: input.pullRequestRef.pullRequestNumber,
    pullRequestUrl: input.pullRequestRef.pullRequestUrl,
    merged: true,
    mergedHeadSha: input.expectedHeadSha,
    mergeCommitHash: 'abcdef1234567890abcdef1234567890abcdef12',
    alreadyMerged: false,
    ...over,
  };
}

/** Default fake PullRequestStatusPreview echoing the status input (Sprint 3e) — an integrity-consistent status. */
function prStatusOf(input: HostingStatusInput, over: Partial<PullRequestStatusPreview> = {}): PullRequestStatusPreview {
  return {
    ref: input.pullRequestRef,
    state: 'open',
    headBranch: input.expectedHeadBranch,
    baseBranch: input.expectedBaseBranch,
    headCommitHash: input.expectedCommitHash,
    isDraft: false,
    checks: { state: 'success', totalCount: 2, successCount: 2, failureCount: 0, pendingCount: 0 },
    reviews: { state: 'approved', approvedCount: 1, changesRequestedCount: 0 },
    observedAt: '2026-07-03T00:00:00.000Z',
    ...over,
  };
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
  /** `git.commitFiles` result (Sprint 2y) — defaults to a valid `gitCommitResultOf` echoing the input; pass
   *  'throw' to simulate a commit failure, or a literal GitCommitResult to force an integrity mismatch. */
  gitCommit?: GitCommitResult | 'throw';
  /** `git.info` result (Sprint 2z) — defaults to `repoInfoOf()` (HEAD == HEAD_SHA); pass 'throw' to simulate
   *  a read error, or a literal RepositoryInfo to force detached / moved-HEAD. */
  gitInfo?: RepositoryInfo | 'throw';
  /** `git.pushApprovedCommit` result (Sprint 3a) — defaults to a valid `gitPushResultOf` echoing the input;
   *  pass 'throw' to simulate a push failure, or a literal GitPushResult to force an integrity mismatch. */
  gitPush?: GitPushResult | 'throw';
  /** When true, `commandExecutions.get` throws (Sprint 2w — validation-lookup failure must not fail preview). */
  commandExecGetThrows?: boolean;
  /** Repository Hosting identity (Sprint 3d-D) — defaults to a valid github identity so PR approval works; pass
   *  `null` to simulate "not configured" (no identity). */
  hostingIdentity?: RepositoryIdentity | null;
  /** Repository Hosting manager (Sprint 3d-D) — defaults to a fake that records the call and returns a valid
   *  echoing PullRequestResult; pass `null` to simulate a missing token (no manager), or a custom fake for
   *  reuse/blocked/unverified paths. */
  hostingManager?: {
    createPullRequest(input: HostingCreateInput): Promise<PullRequestResult>;
    getPullRequestStatus(input: HostingStatusInput): Promise<PullRequestStatusPreview>;
    mergePullRequest?(input: HostingMergeInput): Promise<PullRequestMergeResult>;
  } | null;
  /** Repository Hosting status preview result (Sprint 3e) — defaults to a valid echoing preview; 'throw' to
   *  simulate a read failure, or a literal preview for a specific state/checks/reviews. */
  hostingStatus?: PullRequestStatusPreview | 'throw';
  /** Repository Hosting merge result (Sprint 3g) — defaults to a valid merged result; 'throw-blocked' →
   *  RepositoryHostingBlockedError, 'throw-unverified' → RepositoryHostingUnverifiedError, 'throw-generic' → a
   *  plain Error, or a literal PullRequestMergeResult (e.g. alreadyMerged). */
  hostingMerge?: PullRequestMergeResult | 'throw-blocked' | 'throw-unverified' | 'throw-generic';
}

/** Shape of the input the runtime passes to `RepositoryHostingManager.createPullRequest` (Sprint 3d-D). */
interface HostingCreateInput {
  identity: RepositoryIdentity;
  headBranch: string;
  baseBranch: string;
  title: string;
  body: string;
  expectedCommitHash: string;
  approvalRef: ApprovalRef;
}

/** Default fake PullRequestResult echoing the create input (Sprint 3d-D) — a valid, integrity-consistent PR. */
function prResultOf(input: HostingCreateInput, over: Partial<PullRequestResult> = {}): PullRequestResult {
  return {
    provider: 'github',
    owner: input.identity.owner,
    repo: input.identity.repo,
    pullRequestNumber: 42,
    pullRequestUrl: `https://github.com/${input.identity.owner}/${input.identity.repo}/pull/42`,
    pullRequestHeadBranch: input.headBranch,
    pullRequestBaseBranch: input.baseBranch,
    pullRequestCommitHash: input.expectedCommitHash,
    reused: false,
    ...over,
  };
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
    gitCommit: 0,
    gitInfo: 0,
    gitPush: 0,
    commandExecGet: 0,
    loggerWarn: 0,
    hostingCreatePR: 0,
    hostingGetStatus: 0,
    hostingMergePR: 0,
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
      async commitFiles(input) {
        calls.gitCommit++;
        calls.lastGitCommitInput = input;
        if (opts.gitCommit === 'throw') throw new Error('git commit boom');
        return opts.gitCommit ?? gitCommitResultOf(input);
      },
      async info(rootPath) {
        calls.gitInfo++;
        calls.lastGitInfoRoot = rootPath;
        if (opts.gitInfo === 'throw') throw new Error('git info boom');
        return opts.gitInfo ?? repoInfoOf();
      },
      async pushApprovedCommit(input) {
        calls.gitPush++;
        calls.lastGitPushInput = input;
        if (opts.gitPush === 'throw') throw new Error('git push boom');
        return opts.gitPush ?? gitPushResultOf(input);
      },
    },
    // Sprint 3d-D: Repository Hosting. Default = configured (valid identity + a fake manager echoing a valid
    // PullRequestResult). hostingIdentity:null → not-configured identity; hostingManager:null → missing token.
    repositoryHosting: {
      identity:
        opts.hostingIdentity === null
          ? undefined
          : (opts.hostingIdentity ?? { provider: 'github', owner: 'acme', repo: 'widgets' }),
      manager:
        opts.hostingManager === null
          ? undefined
          : (opts.hostingManager ?? {
              async createPullRequest(input: HostingCreateInput) {
                calls.hostingCreatePR++;
                calls.lastHostingCreateInput = input;
                return prResultOf(input);
              },
              async getPullRequestStatus(input: HostingStatusInput) {
                calls.hostingGetStatus++;
                calls.lastHostingStatusInput = input;
                if (opts.hostingStatus === 'throw') throw new Error('status boom');
                return opts.hostingStatus ?? prStatusOf(input);
              },
              async mergePullRequest(input: HostingMergeInput) {
                calls.hostingMergePR++;
                calls.lastHostingMergeInput = input;
                if (opts.hostingMerge === 'throw-blocked') throw new RepositoryHostingBlockedError('merge blocked');
                if (opts.hostingMerge === 'throw-unverified') throw new RepositoryHostingUnverifiedError('merge unverified');
                if (opts.hostingMerge === 'throw-generic') throw new Error('merge boom');
                return opts.hostingMerge ?? prMergeResultOf(input);
              },
            }),
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
    // the read-only git-preview path never invokes the git mutation added in Sprint 2y
    expect(calls.gitCommit).toBe(0);
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
    // the commit-APPROVAL path (Sprint 2x) never invokes the git mutation added in Sprint 2y
    expect(calls.gitCommit).toBe(0);
  });
});

// ── Sprint 2y — Approved Git Commit Execution (COMMIT_APPROVED → git commit, ADR-0046) ─────────────

describe('Approved Git Commit Execution — runtime (Sprint 2y, ADR-0046)', () => {
  const COMMIT_MSG = 'chore: update ' + TARGET_FILE;
  const HASH = '0123456789abcdef0123456789abcdef01234567';
  /** A COMMIT_APPROVED anchor with complete, valid execution context. */
  const approvedCommitAnchor = (o: Partial<ApplyPreviewAnchor> = {}): ApplyPreviewAnchor =>
    approvedAnchorOf({
      status: 'COMMIT_APPROVED',
      workspaceChangeRef: { id: 'wc-1', status: WorkspaceChangeStatus.APPLIED },
      postApplyValidationRef: { id: 'cmd-test', status: CommandExecutionStatus.SUCCEEDED },
      commitApprovalId: 'apply-appr-1',
      proposedCommitMessage: COMMIT_MSG,
      commitCandidateFiles: [TARGET_FILE],
      ...o,
    });
  /** A GIT_COMMITTED anchor (a commit already executed). */
  const committedAnchor = (o: Partial<ApplyPreviewAnchor> = {}): ApplyPreviewAnchor =>
    approvedCommitAnchor({
      status: 'GIT_COMMITTED',
      commitHash: HASH,
      committedFiles: [TARGET_FILE],
      proposedCommitMessage: undefined,
      commitCandidateFiles: undefined,
      ...o,
    });
  const inScope = { staged: [TARGET_FILE], unstaged: [] as string[], untracked: [] as string[] };
  /** Default happy-path deps for a COMMIT_APPROVED execution. */
  const execDeps = (o: Partial<Opts> = {}): ReturnType<typeof makeDeps> =>
    makeDeps({
      applyAnchor: approvedCommitAnchor(),
      approvalsGetResult: approvedApprovalOf(),
      gitStatus: gitStatusOf(inScope),
      ...o,
    });
  const composer = new ResponseComposer();
  const EXEC_PHRASES = ['승인된 커밋 실행해줘', '커밋 실행해줘', '이제 실제 커밋해줘', 'execute commit'];

  // ── execute + intent (CA 1–9) ───────────────────────────────────────────────────────────────
  it('COMMIT_APPROVED + each execution phrase → git.commitFiles once, GIT_COMMITTED (CA 1–4)', async () => {
    for (const text of EXEC_PHRASES) {
      const { deps, calls } = execDeps();
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.gitCommit, text).toBe(1);
      expect(calls.lastApplyAnchor?.status, text).toBe('GIT_COMMITTED');
      expect(result.status, text).toBe('RESPONDED');
      expect(result.reply.text, text).toBe(composer.composeCommitExecuted(CTX, { commitHash: HASH, files: [TARGET_FILE] }).text);
    }
  });

  it('ambiguous words at COMMIT_APPROVED do not execute (CA 5)', async () => {
    for (const text of ['좋아', '오케이', '확인', '진행해', '다음 단계']) {
      const { deps, calls } = execDeps();
      await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.gitCommit, text).toBe(0);
    }
  });

  it('no COMMIT_APPROVED/GIT_COMMITTED anchor + execution phrase → unavailable, no commit (CA 6)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: null });
    const result = await new ConversationRuntime(deps).handle(messageOf('승인된 커밋 실행해줘'));
    expect(calls.gitCommit).toBe(0);
    expect(calls.gitStatus).toBe(0);
    expect(result.reply.text).toBe(composer.composeCommitExecutionUnavailable(CTX).text);
  });

  it('WORKSPACE_APPLIED + execution phrase → unavailable, no commit (CA 7)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: approvedAnchorOf({ status: 'WORKSPACE_APPLIED', workspaceChangeRef: { id: 'wc-1', status: WorkspaceChangeStatus.APPLIED } }) });
    const result = await new ConversationRuntime(deps).handle(messageOf('승인된 커밋 실행해줘'));
    expect(calls.gitCommit).toBe(0);
    expect(result.reply.text).toBe(composer.composeCommitExecutionUnavailable(CTX).text);
  });

  it('COMMIT_APPROVAL_PENDING + execution phrase → stays the decision flow, no commit (CA 8)', async () => {
    const pending = approvedCommitAnchor({ status: 'COMMIT_APPROVAL_PENDING' });
    const { deps, calls } = makeDeps({ applyAnchor: pending, approvalsGetResult: { ...pendingApprovalOf(), id: 'apply-appr-1' } });
    const result = await new ConversationRuntime(deps).handle(messageOf('커밋 실행해줘'));
    expect(calls.gitCommit).toBe(0);
    // "커밋 실행해줘" is ambiguous as a decision → the pending-approval flow re-prompts, no decide
    expect(calls.decide).toBe(0);
    expect(result.status).toBe('AWAITING_APPROVAL');
  });

  it('COMMIT_APPROVAL_PENDING + "승인" → COMMIT_APPROVED only, never commitFiles (CA 9)', async () => {
    const pending = approvedCommitAnchor({ status: 'COMMIT_APPROVAL_PENDING' });
    const { deps, calls } = makeDeps({ applyAnchor: pending, approvalsGetResult: { ...pendingApprovalOf(), id: 'apply-appr-1' } });
    await new ConversationRuntime(deps).handle(messageOf('승인'));
    expect(calls.lastApplyAnchor?.status).toBe('COMMIT_APPROVED');
    expect(calls.gitCommit).toBe(0);
  });

  // ── push / mutation rejection (CA 10–13) ────────────────────────────────────────────────────
  it('COMMIT_APPROVED + push/"commit and push"/add/reset/stash/checkout → reject, no commit/push (CA 10–12)', async () => {
    for (const text of ['push 해줘', 'commit and push', 'git add 해줘', 'git reset 해줘', 'stash 해줘', 'checkout 해줘']) {
      const { deps, calls } = execDeps();
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.gitCommit, text).toBe(0);
      expect(result.reply.text, text).toBe(composer.composeCommitPushUnsupported(CTX).text);
    }
  });

  it('GIT_COMMITTED + push → no commit execution; push is now Sprint 2z push-approval flow (CA 13, superseded by 2z)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: committedAnchor() });
    const result = await new ConversationRuntime(deps).handle(messageOf('push 해줘'));
    expect(calls.gitCommit).toBe(0); // never a commit mutation
    // Sprint 2z (ADR-0047) owns push at GIT_COMMITTED — no longer the 2y commit-push-unsupported reply.
    expect(result.reply.text).not.toBe(composer.composeCommitPushUnsupported(CTX).text);
  });

  // ── context / approval guards (CA 14–20) ────────────────────────────────────────────────────
  it('incomplete approved context → safe failure, no commit, logger never throws (CA 14–17)', async () => {
    const bad: Array<[string, Partial<ApplyPreviewAnchor>]> = [
      ['missing commitApprovalId', { commitApprovalId: undefined }],
      ['missing proposedCommitMessage', { proposedCommitMessage: undefined }],
      ['missing commitCandidateFiles', { commitCandidateFiles: [] }],
      ['missing workspaceChangeRef', { workspaceChangeRef: undefined }],
      ['missing executionPlanRef', { executionPlanRef: undefined }],
    ];
    for (const [label, patch] of bad) {
      const { deps, calls } = execDeps({ applyAnchor: approvedCommitAnchor(patch) });
      const result = await new ConversationRuntime(deps).handle(messageOf('승인된 커밋 실행해줘')); // must not throw
      expect(calls.gitCommit, label).toBe(0);
      expect(result.status, label).toBe('FAILED');
      expect(result.reply.text, label).toBe(composer.composeCommitExecutionUnavailable(CTX).text);
    }
  });

  it('approval get null / not-APPROVED / plan-mismatch → safe failure, no commit (CA 18–20)', async () => {
    const cases: Array<[string, ApprovalRequest | null]> = [
      ['missing', null],
      ['not APPROVED', { ...pendingApprovalOf(), id: 'apply-appr-1' }],
      ['plan mismatch', { ...approvedApprovalOf(), executionPlanRef: { id: 'other-plan', goal: 'g' } }],
    ];
    for (const [label, approval] of cases) {
      const { deps, calls } = execDeps({ approvalsGetResult: approval });
      const result = await new ConversationRuntime(deps).handle(messageOf('승인된 커밋 실행해줘'));
      expect(calls.gitCommit, label).toBe(0);
      expect(result.reply.text, label).toBe(composer.composeCommitExecutionUnavailable(CTX).text);
    }
  });

  // ── scope re-validation (CA 21–29) ──────────────────────────────────────────────────────────
  it('git.status throws → composeCommitStatusUnavailable, no commit, no fallback (CA 21)', async () => {
    const { deps, calls } = execDeps({ gitStatus: 'throw' });
    const result = await new ConversationRuntime(deps).handle(messageOf('승인된 커밋 실행해줘'));
    expect(calls.gitCommit).toBe(0);
    expect(calls.commandRun).toBe(0);
    expect(result.reply.text).toBe(composer.composeCommitStatusUnavailable(CTX).text);
  });

  it('unsafe candidate / candidate outside targetFiles → unavailable, no commit (CA 22–23)', async () => {
    const unsafe = execDeps({ applyAnchor: approvedCommitAnchor({ commitCandidateFiles: ['../escape.ts'] }) });
    const r1 = await new ConversationRuntime(unsafe.deps).handle(messageOf('승인된 커밋 실행해줘'));
    expect(unsafe.calls.gitCommit).toBe(0);
    expect(r1.reply.text).toBe(composer.composeCommitExecutionUnavailable(CTX).text);

    const outside = execDeps({ applyAnchor: approvedCommitAnchor({ commitCandidateFiles: ['other/x.ts'], targetFiles: [TARGET_FILE] }) });
    const r2 = await new ConversationRuntime(outside.deps).handle(messageOf('승인된 커밋 실행해줘'));
    expect(outside.calls.gitCommit).toBe(0);
    expect(r2.reply.text).toBe(composer.composeCommitExecutionUnavailable(CTX).text);
  });

  it('candidate no longer changed / changed file outside targetFiles / extra in-scope / staged outside candidates → unavailable, no commit (CA 24–27)', async () => {
    const scopeCases: Array<[string, GitStatus]> = [
      ['candidate no longer changed', gitStatusOf({ staged: [], unstaged: [], untracked: [] })],
      ['changed file outside targetFiles', gitStatusOf({ staged: [TARGET_FILE], unstaged: ['other/x.ts'], untracked: [] })],
      ['extra in-scope changed (not a candidate)', gitStatusOf({ staged: [TARGET_FILE, 'packages/core/src/application/bar.ts'], unstaged: [], untracked: [] })],
      ['staged file outside candidate set', gitStatusOf({ staged: [TARGET_FILE, 'unrelated/staged.ts'], unstaged: [], untracked: [] })],
    ];
    for (const [label, status] of scopeCases) {
      // second case: 'other/x.ts' must be in scope only if targetFiles includes it — it does not, so outOfScope.
      const anchor = label === 'extra in-scope changed (not a candidate)'
        ? approvedCommitAnchor({ targetFiles: [TARGET_FILE, 'packages/core/src/application/bar.ts'] })
        : approvedCommitAnchor();
      const { deps, calls } = execDeps({ applyAnchor: anchor, gitStatus: status });
      const result = await new ConversationRuntime(deps).handle(messageOf('승인된 커밋 실행해줘'));
      expect(calls.gitCommit, label).toBe(0);
      expect(result.reply.text, label).toBe(composer.composeCommitExecutionUnavailable(CTX).text);
    }
  });

  it('untracked approved candidate → composeCommitExecutionUntrackedUnsupported, no commit, no git add (CA 28)', async () => {
    const { deps, calls } = execDeps({ gitStatus: gitStatusOf({ staged: [], unstaged: [], untracked: [TARGET_FILE] }) });
    const result = await new ConversationRuntime(deps).handle(messageOf('승인된 커밋 실행해줘'));
    expect(calls.gitCommit).toBe(0);
    expect(result.reply.text).toBe(composer.composeCommitExecutionUntrackedUnsupported(CTX).text);
    expect(result.reply.text).not.toBe(composer.composeCommitExecutionUnavailable(CTX).text);
  });

  it('candidate in BOTH staged and unstaged → still eligible → commits (CA 29)', async () => {
    const { deps, calls } = execDeps({ gitStatus: gitStatusOf({ staged: [TARGET_FILE], unstaged: [TARGET_FILE], untracked: [] }) });
    const result = await new ConversationRuntime(deps).handle(messageOf('승인된 커밋 실행해줘'));
    expect(calls.gitCommit).toBe(1);
    expect(calls.lastGitCommitInput?.files).toEqual([TARGET_FILE]); // de-duped
    expect(result.status).toBe('RESPONDED');
  });

  // ── message (CA 30–32) ──────────────────────────────────────────────────────────────────────
  it('approved message invalid now → unavailable, no commit (CA 30)', async () => {
    const { deps, calls } = execDeps({ applyAnchor: approvedCommitAnchor({ proposedCommitMessage: 'bad\nmultiline' }) });
    const result = await new ConversationRuntime(deps).handle(messageOf('승인된 커밋 실행해줘'));
    expect(calls.gitCommit).toBe(0);
    expect(result.reply.text).toBe(composer.composeCommitExecutionUnavailable(CTX).text);
  });

  it('execution never accepts a new message; commitFiles message === approved message (CA 31–32)', async () => {
    const { deps, calls } = execDeps();
    await new ConversationRuntime(deps).handle(messageOf('승인된 커밋 실행해줘 메시지는 "feat: sneaky override"'));
    expect(calls.gitCommit).toBe(1);
    expect(calls.lastGitCommitInput?.message).toBe(COMMIT_MSG);
    expect(calls.lastGitCommitInput?.message).not.toContain('sneaky');
  });

  // ── commitFiles input (CA 33–38) ────────────────────────────────────────────────────────────
  it('valid context calls git.commitFiles once with exact files/message/ApprovalRef, never git.diff (CA 33–38)', async () => {
    const { deps, calls } = execDeps();
    await new ConversationRuntime(deps).handle(messageOf('승인된 커밋 실행해줘'));
    expect(calls.gitCommit).toBe(1);
    expect(calls.lastGitCommitInput?.files).toEqual([TARGET_FILE]);
    expect(calls.lastGitCommitInput?.message).toBe(COMMIT_MSG);
    expect(calls.lastGitCommitInput?.rootPath).toBe(WORKSPACE.rootPath);
    // the derived plan-scoped ApprovalRef (not the raw ApprovalRequest)
    expect(calls.lastGitCommitInput?.approvalRef).toEqual({ id: 'apply-appr-1', status: ApprovalStatus.APPROVED, executionPlanRef: { id: 'plan-1', goal: 'g' } });
    expect(calls.lastGitCommitInput).not.toHaveProperty('reason'); // no ApprovalRequest fields leaked
    expect(calls.lastGitCommitInput).not.toHaveProperty('requestedBy');
    expect(calls.gitDiff).toBe(0);
  });

  // ── result integrity / success / repeat (CA 51–62) ──────────────────────────────────────────
  it('result-integrity failure (bad hash / wrong files / wrong message) → failed, NO GIT_COMMITTED (CA 51–54)', async () => {
    const badResults: Array<[string, GitCommitResult]> = [
      ['bad hash', gitCommitResultOf({ files: [TARGET_FILE], message: COMMIT_MSG }, { commitHash: 'nothex!!' })],
      ['wrong files', gitCommitResultOf({ files: [TARGET_FILE], message: COMMIT_MSG }, { committedFiles: ['other/x.ts'] })],
      ['extra file', gitCommitResultOf({ files: [TARGET_FILE], message: COMMIT_MSG }, { committedFiles: [TARGET_FILE, 'extra.ts'] })],
      ['wrong message', gitCommitResultOf({ files: [TARGET_FILE], message: COMMIT_MSG }, { message: 'different' })],
    ];
    for (const [label, result] of badResults) {
      const { deps, calls } = execDeps({ gitCommit: result });
      const turn = await new ConversationRuntime(deps).handle(messageOf('승인된 커밋 실행해줘'));
      expect(calls.gitCommit, label).toBe(1);
      expect(calls.lastApplyAnchor?.status, label).not.toBe('GIT_COMMITTED');
      expect(turn.status, label).toBe('FAILED');
      expect(turn.reply.text, label).toBe(composer.composeCommitExecutionFailed(CTX).text);
    }
  });

  it('success re-anchors GIT_COMMITTED, stores hash/files, preserves handoff refs + commitApprovalId, clears message/candidates (CA 55–59)', async () => {
    const { deps, calls } = execDeps();
    await new ConversationRuntime(deps).handle(messageOf('승인된 커밋 실행해줘'));
    const a = calls.lastApplyAnchor;
    expect(a?.status).toBe('GIT_COMMITTED');
    expect(a?.commitHash).toBe(HASH);
    expect(a?.committedFiles).toEqual([TARGET_FILE]);
    expect(a?.workspaceRef).toEqual(WORKSPACE);
    expect(a?.workspaceChangeRef).toEqual({ id: 'wc-1', status: WorkspaceChangeStatus.APPLIED });
    expect(a?.targetFiles).toEqual([TARGET_FILE]);
    expect(a?.executionPlanRef).toEqual({ id: 'plan-1', goal: 'g' });
    expect(a?.commitApprovalId).toBe('apply-appr-1'); // preserved (CA #9)
    expect(a?.postApplyValidationRef).toEqual({ id: 'cmd-test', status: CommandExecutionStatus.SUCCEEDED });
    expect(a?.proposedCommitMessage).toBeUndefined();
    expect(a?.commitCandidateFiles).toBeUndefined();
  });

  it('reply includes the commit hash and states git push not performed (CA 60–61)', async () => {
    const { deps } = execDeps();
    const result = await new ConversationRuntime(deps).handle(messageOf('승인된 커밋 실행해줘'));
    expect(result.reply.text).toContain(HASH.slice(0, 7));
    expect(result.reply.text).toContain('push');
    expect(result.reply.text).toContain('하지 않았어요');
  });

  it('repeat execution after success (GIT_COMMITTED) → already-committed, no new commit (CA 62)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: committedAnchor() });
    const result = await new ConversationRuntime(deps).handle(messageOf('승인된 커밋 실행해줘'));
    expect(calls.gitCommit).toBe(0);
    expect(result.reply.text).toBe(composer.composeCommitAlreadyCommitted(CTX, HASH).text);
    expect(result.reply.text).toContain(HASH.slice(0, 7));
  });

  // ── failure wording (CA 63–67) ──────────────────────────────────────────────────────────────
  it('git.commitFiles throws → composeCommitExecutionFailed (not committed / no push / no rollback / never clean-index) (CA 63–67)', async () => {
    const { deps, calls } = execDeps({ gitCommit: 'throw' });
    const result = await new ConversationRuntime(deps).handle(messageOf('승인된 커밋 실행해줘'));
    expect(calls.gitCommit).toBe(1);
    expect(calls.lastApplyAnchor?.status).not.toBe('GIT_COMMITTED');
    expect(result.status).toBe('FAILED');
    expect(result.reply.text).toBe(composer.composeCommitExecutionFailed(CTX).text);
    expect(result.reply.text).toContain('push는 하지 않았어요');
    expect(result.reply.text).toContain('rollback은 수행하지 않았어요');
    expect(result.reply.text).not.toContain('변경 없음');
    expect(result.reply.text).not.toContain('원상복구');
    expect(result.reply.text).not.toContain('되돌렸');
  });

  // ── no side effects (CA 68–74) ──────────────────────────────────────────────────────────────
  it('the execution path performs no command/WorkspaceWrite/Patch/CodeGen/Orchestrator call (CA 68–74)', async () => {
    const { deps, calls } = execDeps();
    await new ConversationRuntime(deps).handle(messageOf('승인된 커밋 실행해줘'));
    expect(calls.commandRun).toBe(0);
    expect(calls.workspaceApply).toBe(0);
    expect(calls.patchGenerate).toBe(0);
    expect(calls.patchGet).toBe(0);
    expect(calls.codeGenerationGenerate).toBe(0);
    expect(calls.run).toBe(0);
    expect(calls.resume).toBe(0);
    expect(calls.gitDiff).toBe(0); // only status + commitFiles touch git
  });
});

// ── Sprint 2z — Explicit Git Push Approval (GIT_COMMITTED → approval halt, ADR-0047) ───────────────

describe('Explicit Git Push Approval — runtime (Sprint 2z, ADR-0047)', () => {
  /** A GIT_COMMITTED anchor with complete commit context (HEAD == HEAD_SHA). */
  const committedAnchor = (o: Partial<ApplyPreviewAnchor> = {}): ApplyPreviewAnchor =>
    approvedAnchorOf({
      status: 'GIT_COMMITTED',
      workspaceChangeRef: { id: 'wc-1', status: WorkspaceChangeStatus.APPLIED },
      commitApprovalId: 'apply-appr-1',
      commitHash: HEAD_SHA,
      committedFiles: [TARGET_FILE],
      ...o,
    });
  /** A PUSH_APPROVAL_PENDING anchor with complete resume context. */
  const pushPendingAnchor = (o: Partial<ApplyPreviewAnchor> = {}): ApplyPreviewAnchor =>
    committedAnchor({
      status: 'PUSH_APPROVAL_PENDING',
      pushApprovalId: 'apply-appr-1',
      pushCommitHash: HEAD_SHA,
      pushRemote: 'origin',
      pushBranch: 'main',
      pushUpstreamRef: 'origin/main',
      ...o,
    });
  const pushApprovedAnchor = (o: Partial<ApplyPreviewAnchor> = {}): ApplyPreviewAnchor =>
    pushPendingAnchor({ status: 'PUSH_APPROVED', ...o });
  /** A clean, ahead-1, not-diverged status with an upstream — the push-ready shape. */
  const pushReady = { clean: true, staged: [] as string[], unstaged: [] as string[], untracked: [] as string[], upstream: 'origin/main', ahead: 1, behind: 0 };
  const pushDeps = (o: Partial<Opts> = {}): ReturnType<typeof makeDeps> =>
    makeDeps({ applyAnchor: committedAnchor(), gitInfo: repoInfoOf(), gitStatus: gitStatusOf(pushReady), ...o });
  const composer = new ResponseComposer();
  const PUSH_PHRASES = ['푸시해줘', 'git push 해줘', '원격에 올려줘', 'push this commit'];

  // ── trigger + approval (CA 1–9) ─────────────────────────────────────────────────────────────
  it('GIT_COMMITTED + each push phrase → one CRITICAL push approval, PUSH_APPROVAL_PENDING (CA 1–4)', async () => {
    for (const text of PUSH_PHRASES) {
      const { deps, calls } = pushDeps();
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.requestForRisk, text).toBe(1);
      expect(calls.lastRequestForRiskInput?.riskLevel, text).toBe(RiskLevel.CRITICAL);
      expect(calls.lastApplyAnchor?.status, text).toBe('PUSH_APPROVAL_PENDING');
      expect(result.status, text).toBe('AWAITING_APPROVAL');
      expect(result.reply.text, text).toBe(
        composer.composePushApprovalRequested(CTX, { commitHash: HEAD_SHA, remote: 'origin', branch: 'main', upstream: 'origin/main', ahead: 1 }).text,
      );
    }
  });

  it('ambiguous words at GIT_COMMITTED do not create push approval (CA 5)', async () => {
    for (const text of ['좋아', '오케이', '확인', '진행해', '다음 단계']) {
      const { deps, calls } = pushDeps();
      await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.requestForRisk, text).toBe(0);
      expect(calls.gitInfo, text).toBe(0);
    }
  });

  it('no anchor + push phrase → no push approval and does not enter push flow (CA 1/6)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: null });
    await new ConversationRuntime(deps).handle(messageOf('푸시해줘'));
    expect(calls.requestForRisk).toBe(0);
    expect(calls.gitInfo).toBe(0);
    expect(calls.gitStatus).toBe(0);
  });

  it('WORKSPACE_APPLIED + push phrase → existing 2w mutating reject, no push approval (CA 7)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: approvedAnchorOf({ status: 'WORKSPACE_APPLIED', workspaceChangeRef: { id: 'wc-1', status: WorkspaceChangeStatus.APPLIED } }) });
    const result = await new ConversationRuntime(deps).handle(messageOf('푸시해줘'));
    expect(calls.requestForRisk).toBe(0);
    expect(calls.gitInfo).toBe(0);
    expect(result.reply.text).toBe(composer.composeGitMutationNotSupported(CTX).text);
  });

  it('COMMIT_APPROVED + push phrase → existing 2y push-unsupported, no push approval (CA 8)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: committedAnchor({ status: 'COMMIT_APPROVED', proposedCommitMessage: 'chore: x', commitCandidateFiles: [TARGET_FILE] }) });
    const result = await new ConversationRuntime(deps).handle(messageOf('푸시해줘'));
    expect(calls.requestForRisk).toBe(0);
    expect(calls.gitInfo).toBe(0);
    expect(result.reply.text).toBe(composer.composeCommitPushUnsupported(CTX).text);
  });

  it('PUSH_APPROVED + push phrase → already approved, not pushed, no new approval (CA 9)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: pushApprovedAnchor() });
    const result = await new ConversationRuntime(deps).handle(messageOf('푸시해줘'));
    expect(calls.requestForRisk).toBe(0);
    expect(result.reply.text).toBe(composer.composePushAlreadyApproved(CTX).text);
  });

  // ── companion / force (CA 10–17) ────────────────────────────────────────────────────────────
  it('deploy-only / branch-only at GIT_COMMITTED (no push word) → no push flow (CA 2/10/11)', async () => {
    for (const text of ['배포해줘', '브랜치 만들어줘']) {
      const { deps, calls } = pushDeps();
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.requestForRisk, text).toBe(0);
      expect(calls.gitInfo, text).toBe(0);
      expect(result.reply.text, text).not.toBe(composer.composePushUnsupportedCompanion(CTX).text);
    }
  });

  it('push bundled with force/--force/deploy/PR/tag/branch/reset → unsupported companion, no approval (CA 12–17)', async () => {
    for (const text of ['force push 해줘', 'push --force', '푸시하고 배포해줘', 'push and PR', 'push tag 해줘', 'push branch 해줘', 'push하고 reset']) {
      const { deps, calls } = pushDeps();
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.requestForRisk, text).toBe(0);
      expect(calls.gitInfo, text).toBe(0);
      expect(result.reply.text, text).toBe(composer.composePushUnsupportedCompanion(CTX).text);
    }
  });

  // ── context / verification guards (CA 18–32) ────────────────────────────────────────────────
  it('incomplete committed context → safe failure, no approval, logger never throws (CA 18–22)', async () => {
    const bad: Array<[string, Partial<ApplyPreviewAnchor>]> = [
      ['missing commitHash', { commitHash: undefined }],
      ['invalid commitHash', { commitHash: 'nothex!!' }],
      ['missing committedFiles', { committedFiles: [] }],
      ['missing workspaceRef', { workspaceRef: undefined }],
      ['missing executionPlanRef', { executionPlanRef: undefined }],
    ];
    for (const [label, patch] of bad) {
      const { deps, calls } = pushDeps({ applyAnchor: committedAnchor(patch) });
      const result = await new ConversationRuntime(deps).handle(messageOf('푸시해줘')); // must not throw
      expect(calls.requestForRisk, label).toBe(0);
      expect(result.reply.text, label).toBe(composer.composePushApprovalUnavailable(CTX).text);
    }
  });

  it('git info / status read failure → composePushStatusUnavailable, no approval (CA 23–24)', async () => {
    const infoThrow = pushDeps({ gitInfo: 'throw' });
    const r1 = await new ConversationRuntime(infoThrow.deps).handle(messageOf('푸시해줘'));
    expect(infoThrow.calls.requestForRisk).toBe(0);
    expect(r1.reply.text).toBe(composer.composePushStatusUnavailable(CTX).text);

    const statusThrow = pushDeps({ gitStatus: 'throw' });
    const r2 = await new ConversationRuntime(statusThrow.deps).handle(messageOf('푸시해줘'));
    expect(statusThrow.calls.requestForRisk).toBe(0);
    expect(r2.reply.text).toBe(composer.composePushStatusUnavailable(CTX).text);
  });

  it('HEAD moved / detached → composePushHeadMovedUnavailable, no approval (CA 25–26)', async () => {
    const moved = pushDeps({ gitInfo: repoInfoOf({ headSha: 'f'.repeat(40) }) });
    const r1 = await new ConversationRuntime(moved.deps).handle(messageOf('푸시해줘'));
    expect(moved.calls.requestForRisk).toBe(0);
    expect(r1.reply.text).toBe(composer.composePushHeadMovedUnavailable(CTX).text);

    const detached = pushDeps({ gitInfo: repoInfoOf({ detached: true, branch: '', headSha: undefined }) });
    const r2 = await new ConversationRuntime(detached.deps).handle(messageOf('푸시해줘'));
    expect(detached.calls.requestForRisk).toBe(0);
    expect(r2.reply.text).toBe(composer.composePushHeadMovedUnavailable(CTX).text);
  });

  it('no / unparseable upstream → composePushNoUpstream, no approval (CA 27–30)', async () => {
    const cases: Array<[string, Partial<GitStatus>]> = [
      ['no upstream', { upstream: undefined, ahead: undefined, behind: undefined }],
      ['no slash', { upstream: 'originmain' }],
      ['empty remote', { upstream: '/main' }],
      ['empty branch', { upstream: 'origin/' }],
      ['control char', { upstream: 'origin/main' }],
    ];
    for (const [label, over] of cases) {
      const { deps, calls } = pushDeps({ gitStatus: gitStatusOf({ ...pushReady, ...over }) });
      const result = await new ConversationRuntime(deps).handle(messageOf('푸시해줘'));
      expect(calls.requestForRisk, label).toBe(0);
      expect(result.reply.text, label).toBe(composer.composePushNoUpstream(CTX).text);
    }
  });

  it('branch not ahead → nothing to push; behind > 0 → diverged; no approval (CA 31–32)', async () => {
    const notAhead = pushDeps({ gitStatus: gitStatusOf({ ...pushReady, ahead: 0 }) });
    const r1 = await new ConversationRuntime(notAhead.deps).handle(messageOf('푸시해줘'));
    expect(notAhead.calls.requestForRisk).toBe(0);
    expect(r1.reply.text).toBe(composer.composePushNothingToPush(CTX).text);

    const diverged = pushDeps({ gitStatus: gitStatusOf({ ...pushReady, ahead: 1, behind: 2 }) });
    const r2 = await new ConversationRuntime(diverged.deps).handle(messageOf('푸시해줘'));
    expect(diverged.calls.requestForRisk).toBe(0);
    expect(r2.reply.text).toBe(composer.composePushDiverged(CTX).text);
  });

  // ── dirty working tree (CA 33–35) ───────────────────────────────────────────────────────────
  it('dirty working tree (staged/unstaged/untracked) → composePushDirtyWorkingTree, no approval (CA 33–35)', async () => {
    const dirties: Array<[string, Partial<GitStatus>]> = [
      ['staged', { clean: false, staged: ['x.ts'] }],
      ['unstaged', { clean: false, unstaged: ['y.ts'] }],
      ['untracked', { clean: false, untracked: ['z.ts'] }],
    ];
    for (const [label, over] of dirties) {
      const { deps, calls } = pushDeps({ gitStatus: gitStatusOf({ ...pushReady, ...over }) });
      const result = await new ConversationRuntime(deps).handle(messageOf('푸시해줘'));
      expect(calls.requestForRisk, label).toBe(0);
      expect(result.reply.text, label).toBe(composer.composePushDirtyWorkingTree(CTX).text);
    }
  });

  // ── valid + upstream parsing (CA 36–37) ─────────────────────────────────────────────────────
  it('origin/feature/x parses remote=origin branch=feature/x and approves (CA 36–37)', async () => {
    const { deps, calls } = pushDeps({ gitStatus: gitStatusOf({ ...pushReady, upstream: 'origin/feature/x' }) });
    await new ConversationRuntime(deps).handle(messageOf('푸시해줘'));
    expect(calls.requestForRisk).toBe(1);
    expect(calls.lastApplyAnchor?.pushRemote).toBe('origin');
    expect(calls.lastApplyAnchor?.pushBranch).toBe('feature/x');
    expect(calls.lastApplyAnchor?.pushUpstreamRef).toBe('origin/feature/x');
  });

  // ── approval reason (CA 41–49) ──────────────────────────────────────────────────────────────
  it('approval reason includes commit/remote/upstream/branch/ahead + no-push + permission + not-in-2z + future-step + CRITICAL, no diff (CA 41–49)', async () => {
    const { deps, calls } = pushDeps();
    await new ConversationRuntime(deps).handle(messageOf('푸시해줘'));
    const reason = calls.lastRequestForRiskInput?.reason ?? '';
    expect(reason).toContain(HEAD_SHA);
    expect(reason).toContain('origin');
    expect(reason).toContain('origin/main');
    expect(reason).toContain('no git push has been performed');
    expect(reason).toContain('records permission only');
    expect(reason).toContain('NOT executed in Sprint 2z');
    expect(reason).toContain('future execution requires a separate step');
    expect(reason).toContain('point-in-time');
    expect(reason).not.toContain('diff --git');
    expect(calls.lastRequestForRiskInput?.riskLevel).toBe(RiskLevel.CRITICAL);
  });

  // ── decision flow (CA 50–58) ────────────────────────────────────────────────────────────────
  it('PUSH_APPROVAL_PENDING + ambiguous / push / force / deploy phrase → re-prompt, no decide (CA 50–53)', async () => {
    for (const text of ['음 글쎄', '푸시해줘', 'push --force', '푸시하고 배포']) {
      const { deps, calls } = makeDeps({ applyAnchor: pushPendingAnchor() });
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.decide, text).toBe(0);
      expect(calls.requestForRisk, text).toBe(0);
      expect(calls.applyAnchorSet, text).toBe(0); // no re-anchor
      expect(result.status, text).toBe('AWAITING_APPROVAL');
    }
  });

  it('PUSH_APPROVAL_PENDING approve verifies the ApprovalRequest (missing / not-PENDING / plan-mismatch → no decide) (CA 54)', async () => {
    const gone = makeDeps({ applyAnchor: pushPendingAnchor(), approvalsGetResult: null });
    await new ConversationRuntime(gone.deps).handle(messageOf('승인'));
    expect(gone.calls.decide).toBe(0);

    const mismatch = makeDeps({ applyAnchor: pushPendingAnchor(), approvalsGetResult: { ...pendingApprovalOf(), id: 'apply-appr-1', executionPlanRef: { id: 'other-plan', goal: 'g' } } });
    await new ConversationRuntime(mismatch.deps).handle(messageOf('승인'));
    expect(mismatch.calls.decide).toBe(0);
  });

  it('PUSH_APPROVAL_PENDING + "승인" → PUSH_APPROVED only, no push (CA 55)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: pushPendingAnchor() });
    const result = await new ConversationRuntime(deps).handle(messageOf('승인'));
    expect(calls.decide).toBe(1);
    expect(calls.lastApplyAnchor?.status).toBe('PUSH_APPROVED');
    expect(result.reply.text).toBe(composer.composePushApprovalRecorded(CTX).text);
  });

  it('PUSH_APPROVAL_PENDING + "거절"/"취소" → GIT_COMMITTED, clear only push fields, commit context preserved, no push (CA 56–57)', async () => {
    for (const [text, expected] of [['거절', 'DENIED'], ['취소', 'CANCELLED']] as const) {
      const { deps, calls } = makeDeps({ applyAnchor: pushPendingAnchor() });
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.decide, text).toBe(1);
      expect(result.status, text).toBe(expected);
      expect(calls.lastApplyAnchor?.status, text).toBe('GIT_COMMITTED');
      expect(calls.lastApplyAnchor?.pushApprovalId, text).toBeUndefined();
      expect(calls.lastApplyAnchor?.pushRemote, text).toBeUndefined();
      expect(calls.lastApplyAnchor?.pushUpstreamRef, text).toBeUndefined();
      expect(calls.lastApplyAnchor?.commitHash, text).toBe(HEAD_SHA); // commit context preserved
      expect(calls.lastApplyAnchor?.committedFiles, text).toEqual([TARGET_FILE]);
      const wanted = text === '거절' ? composer.composePushApprovalDenied(CTX).text : composer.composePushApprovalCancelled(CTX).text;
      expect(result.reply.text, text).toBe(wanted);
    }
  });

  it('PUSH_APPROVAL_PENDING with incomplete context → safe failure, no decide (CA 58)', async () => {
    const bad: Array<[string, Partial<ApplyPreviewAnchor>]> = [
      ['missing pushApprovalId', { pushApprovalId: undefined }],
      ['missing pushUpstreamRef', { pushUpstreamRef: undefined }],
      ['missing pushCommitHash', { pushCommitHash: undefined }],
      ['missing commitHash', { commitHash: undefined }],
    ];
    for (const [label, patch] of bad) {
      const { deps, calls } = makeDeps({ applyAnchor: pushPendingAnchor(patch) });
      const result = await new ConversationRuntime(deps).handle(messageOf('승인')); // must not throw
      expect(calls.decide, label).toBe(0);
      expect(result.reply.text, label).toBe(composer.composePushApprovalUnavailable(CTX).text);
    }
  });

  // ── PUSH_APPROVED context + repeats (CA 59–62) ──────────────────────────────────────────────
  it('approve preserves ALL push + commit context on PUSH_APPROVED (CA 59–60)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: pushPendingAnchor() });
    await new ConversationRuntime(deps).handle(messageOf('승인'));
    const a = calls.lastApplyAnchor;
    expect(a?.status).toBe('PUSH_APPROVED');
    expect(a?.pushApprovalId).toBe('apply-appr-1');
    expect(a?.pushCommitHash).toBe(HEAD_SHA);
    expect(a?.pushRemote).toBe('origin');
    expect(a?.pushBranch).toBe('main');
    expect(a?.pushUpstreamRef).toBe('origin/main');
    expect(a?.commitHash).toBe(HEAD_SHA);
    expect(a?.committedFiles).toEqual([TARGET_FILE]);
    expect(a?.commitApprovalId).toBe('apply-appr-1');
    expect(a?.workspaceRef).toEqual(WORKSPACE);
    expect(a?.executionPlanRef).toEqual({ id: 'plan-1', goal: 'g' });
  });

  it('PUSH_APPROVED + push → already approved; + ambiguous → no push (CA 61–62)', async () => {
    const approved = makeDeps({ applyAnchor: pushApprovedAnchor() });
    const r1 = await new ConversationRuntime(approved.deps).handle(messageOf('푸시해줘'));
    expect(r1.reply.text).toBe(composer.composePushAlreadyApproved(CTX).text);

    const ambiguous = makeDeps({ applyAnchor: pushApprovedAnchor() });
    await new ConversationRuntime(ambiguous.deps).handle(messageOf('좋아'));
    expect(ambiguous.calls.requestForRisk).toBe(0);
  });

  // ── no side effects (CA 63–82) ──────────────────────────────────────────────────────────────
  it('the push-approval path performs no git push/commit/command/WorkspaceWrite/Patch/CodeGen/Orchestrator call (CA 63–82)', async () => {
    const { deps, calls } = pushDeps();
    await new ConversationRuntime(deps).handle(messageOf('푸시해줘'));
    expect(calls.gitInfo).toBe(1); // read-only info
    expect(calls.gitStatus).toBe(1); // read-only status
    expect(calls.gitCommit).toBe(0); // no commit/push mutation
    expect(calls.gitDiff).toBe(0);
    expect(calls.commandRun).toBe(0);
    expect(calls.workspaceApply).toBe(0);
    expect(calls.patchGenerate).toBe(0);
    expect(calls.patchGet).toBe(0);
    expect(calls.codeGenerationGenerate).toBe(0);
    expect(calls.run).toBe(0);
    expect(calls.resume).toBe(0);
    // the git dep exposes no push method (structural)
    expect(Object.keys(deps.git)).not.toContain('push');
  });
});

// ── Sprint 3a — Approved Git Push Execution (PUSH_APPROVED → git push, ADR-0048) ───────────────────

describe('Approved Git Push Execution — runtime (Sprint 3a, ADR-0048)', () => {
  const REMOTE = 'origin';
  const BRANCH = 'main';
  const UPSTREAM = 'origin/main';
  /** A PUSH_APPROVED anchor with complete, valid execution context. */
  const pushApprovedAnchor = (o: Partial<ApplyPreviewAnchor> = {}): ApplyPreviewAnchor =>
    approvedAnchorOf({
      status: 'PUSH_APPROVED',
      workspaceChangeRef: { id: 'wc-1', status: WorkspaceChangeStatus.APPLIED },
      postApplyValidationRef: { id: 'cmd-test', status: CommandExecutionStatus.SUCCEEDED },
      commitApprovalId: 'apply-appr-1',
      commitHash: HEAD_SHA,
      committedFiles: [TARGET_FILE],
      pushApprovalId: 'apply-appr-1',
      pushCommitHash: HEAD_SHA,
      pushRemote: REMOTE,
      pushBranch: BRANCH,
      pushUpstreamRef: UPSTREAM,
      ...o,
    });
  /** A GIT_PUSHED anchor (a push already executed). */
  const pushedAnchor = (o: Partial<ApplyPreviewAnchor> = {}): ApplyPreviewAnchor =>
    pushApprovedAnchor({
      status: 'GIT_PUSHED',
      pushedCommitHash: HEAD_SHA,
      pushedRemote: REMOTE,
      pushedBranch: BRANCH,
      pushedUpstreamRef: UPSTREAM,
      ...o,
    });
  /** A clean, ahead-1, not-diverged status whose upstream matches the approved target. */
  const execReady = { clean: true, staged: [] as string[], unstaged: [] as string[], untracked: [] as string[], upstream: UPSTREAM, ahead: 1, behind: 0 };
  const execDeps = (o: Partial<Opts> = {}): ReturnType<typeof makeDeps> =>
    makeDeps({
      applyAnchor: pushApprovedAnchor(),
      approvalsGetResult: approvedApprovalOf(),
      gitInfo: repoInfoOf(),
      gitStatus: gitStatusOf(execReady),
      ...o,
    });
  const composer = new ResponseComposer();
  const EXEC_PHRASES = ['승인된 push 실행해줘', 'push 실행해줘', '이제 실제 push 해줘', 'execute approved push', 'push approved commit'];

  // ── execute + gating (CA 1–12) ──────────────────────────────────────────────────────────────
  it('PUSH_APPROVED + each execution phrase → git.pushApprovedCommit once, GIT_PUSHED (CA 1–5)', async () => {
    for (const text of EXEC_PHRASES) {
      const { deps, calls } = execDeps();
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.gitPush, text).toBe(1);
      expect(calls.lastApplyAnchor?.status, text).toBe('GIT_PUSHED');
      expect(result.status, text).toBe('RESPONDED');
      expect(result.reply.text, text).toBe(composer.composePushExecuted(CTX, { commitHash: HEAD_SHA, remote: REMOTE, branch: BRANCH }).text);
    }
  });

  it('ambiguous words at PUSH_APPROVED do not execute (CA 6)', async () => {
    for (const text of ['좋아', '오케이', '확인', '진행해', '다음 단계']) {
      const { deps, calls } = execDeps();
      await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.gitPush, text).toBe(0);
    }
  });

  it('no anchor + execution phrase → no push (CA 7)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: null });
    await new ConversationRuntime(deps).handle(messageOf('승인된 push 실행해줘'));
    expect(calls.gitPush).toBe(0);
  });

  it('GIT_COMMITTED + push-execution phrase → 2z push APPROVAL, no pushApprovedCommit (CA 8–9)', async () => {
    for (const text of ['이제 실제 push 해줘', 'execute approved push']) {
      const anchor = approvedAnchorOf({ status: 'GIT_COMMITTED', workspaceChangeRef: { id: 'wc-1', status: WorkspaceChangeStatus.APPLIED }, commitApprovalId: 'apply-appr-1', commitHash: HEAD_SHA, committedFiles: [TARGET_FILE] });
      const { deps, calls } = makeDeps({ applyAnchor: anchor, gitInfo: repoInfoOf(), gitStatus: gitStatusOf(execReady) });
      await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.gitPush, text).toBe(0);
      expect(calls.requestForRisk, text).toBe(1); // 2z CRITICAL push approval
      expect(calls.lastRequestForRiskInput?.riskLevel, text).toBe(RiskLevel.CRITICAL);
      expect(calls.lastApplyAnchor?.status, text).toBe('PUSH_APPROVAL_PENDING');
    }
  });

  it('PUSH_APPROVAL_PENDING + execution phrase → 2z decision flow (ambiguous re-prompt), no push (CA 10–11)', async () => {
    for (const text of ['execute approved push', '승인된 push 실행해줘']) {
      const pending = approvedAnchorOf({ status: 'PUSH_APPROVAL_PENDING', workspaceChangeRef: { id: 'wc-1', status: WorkspaceChangeStatus.APPLIED }, commitApprovalId: 'apply-appr-1', commitHash: HEAD_SHA, committedFiles: [TARGET_FILE], pushApprovalId: 'apply-appr-1', pushCommitHash: HEAD_SHA, pushRemote: REMOTE, pushBranch: BRANCH, pushUpstreamRef: UPSTREAM });
      const { deps, calls } = makeDeps({ applyAnchor: pending, approvalsGetResult: { ...pendingApprovalOf(), id: 'apply-appr-1' } });
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.gitPush, text).toBe(0);
      expect(calls.decide, text).toBe(0);
      expect(result.status, text).toBe('AWAITING_APPROVAL');
    }
  });

  it('COMMIT_APPROVED / WORKSPACE_APPLIED do not execute push (CA 12)', async () => {
    for (const status of ['COMMIT_APPROVED', 'WORKSPACE_APPLIED'] as const) {
      const anchor = approvedAnchorOf({ status, workspaceChangeRef: { id: 'wc-1', status: WorkspaceChangeStatus.APPLIED }, commitApprovalId: 'apply-appr-1', proposedCommitMessage: 'chore: x', commitCandidateFiles: [TARGET_FILE] });
      const { deps, calls } = makeDeps({ applyAnchor: anchor });
      await new ConversationRuntime(deps).handle(messageOf('승인된 push 실행해줘'));
      expect(calls.gitPush, status).toBe(0);
    }
  });

  // ── companion / force (CA 13–19) ────────────────────────────────────────────────────────────
  it('push + force/--force/-f/PR/deploy/tag/branch/reset → reject, no push (CA 13–19)', async () => {
    for (const text of ['force push 실행해줘', 'push --force', 'push -f', 'push and PR', '푸시하고 배포', 'push tag 실행', 'push하고 reset']) {
      const { deps, calls } = execDeps();
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.gitPush, text).toBe(0);
      expect(result.reply.text, text).toBe(composer.composePushUnsupportedCompanion(CTX).text);
    }
  });

  // ── context / verification guards (CA 20–48) ────────────────────────────────────────────────
  it('incomplete approved push context → composePushExecutionUnavailable, no push, log never throws (CA 20–26)', async () => {
    const bad: Array<[string, Partial<ApplyPreviewAnchor>]> = [
      ['missing pushApprovalId', { pushApprovalId: undefined }],
      ['missing pushCommitHash', { pushCommitHash: undefined }],
      ['missing pushRemote', { pushRemote: undefined }],
      ['missing pushBranch', { pushBranch: undefined }],
      ['missing pushUpstreamRef', { pushUpstreamRef: undefined }],
      ['missing commitHash', { commitHash: undefined }],
      ['missing executionPlanRef', { executionPlanRef: undefined }],
    ];
    for (const [label, patch] of bad) {
      const { deps, calls } = execDeps({ applyAnchor: pushApprovedAnchor(patch) });
      const result = await new ConversationRuntime(deps).handle(messageOf('승인된 push 실행해줘')); // must not throw
      expect(calls.gitPush, label).toBe(0);
      expect(result.reply.text, label).toBe(composer.composePushExecutionUnavailable(CTX).text);
    }
  });

  it('unsafe/malformed persisted target in anchor → no pushApprovedCommit (CA 27–31)', async () => {
    const bad: Array<[string, Partial<ApplyPreviewAnchor>]> = [
      ['unsafe pushRemote', { pushRemote: 'ori gin' }],
      ['unsafe pushBranch', { pushBranch: 'bad:branch' }],
      ['malformed pushUpstreamRef', { pushUpstreamRef: 'originmain' }],
      ['upstream/remote-branch mismatch', { pushUpstreamRef: 'origin/other' }],
      ['invalid pushCommitHash', { pushCommitHash: 'nothex' }],
      ['invalid commitHash', { commitHash: 'nothex' }],
    ];
    for (const [label, patch] of bad) {
      const { deps, calls } = execDeps({ applyAnchor: pushApprovedAnchor(patch) });
      const result = await new ConversationRuntime(deps).handle(messageOf('승인된 push 실행해줘'));
      expect(calls.gitPush, label).toBe(0);
      expect(result.reply.text, label).toBe(composer.composePushExecutionUnavailable(CTX).text);
    }
  });

  it('approval null / not-APPROVED / plan-mismatch → no push (CA 32–34)', async () => {
    const cases: Array<[string, ApprovalRequest | null]> = [
      ['missing', null],
      ['not APPROVED', { ...pendingApprovalOf(), id: 'apply-appr-1' }],
      ['plan mismatch', { ...approvedApprovalOf(), executionPlanRef: { id: 'other-plan', goal: 'g' } }],
    ];
    for (const [label, approval] of cases) {
      const { deps, calls } = execDeps({ approvalsGetResult: approval });
      const result = await new ConversationRuntime(deps).handle(messageOf('승인된 push 실행해줘'));
      expect(calls.gitPush, label).toBe(0);
      expect(result.reply.text, label).toBe(composer.composePushExecutionUnavailable(CTX).text);
    }
  });

  it('git.info / git.status read failure → composePushStatusUnavailable, no push (CA 35–36)', async () => {
    const infoThrow = execDeps({ gitInfo: 'throw' });
    const r1 = await new ConversationRuntime(infoThrow.deps).handle(messageOf('승인된 push 실행해줘'));
    expect(infoThrow.calls.gitPush).toBe(0);
    expect(r1.reply.text).toBe(composer.composePushStatusUnavailable(CTX).text);

    const statusThrow = execDeps({ gitStatus: 'throw' });
    const r2 = await new ConversationRuntime(statusThrow.deps).handle(messageOf('승인된 push 실행해줘'));
    expect(statusThrow.calls.gitPush).toBe(0);
    expect(r2.reply.text).toBe(composer.composePushStatusUnavailable(CTX).text);
  });

  it('detached / HEAD ≠ pushCommitHash / commitHash ≠ pushCommitHash → no push (CA 37–39)', async () => {
    const detached = execDeps({ gitInfo: repoInfoOf({ detached: true, branch: '', headSha: undefined }) });
    expect((await new ConversationRuntime(detached.deps).handle(messageOf('승인된 push 실행해줘'))).reply.text).toBe(composer.composePushExecutionUnavailable(CTX).text);
    expect(detached.calls.gitPush).toBe(0);

    const moved = execDeps({ gitInfo: repoInfoOf({ headSha: 'f'.repeat(40) }) });
    await new ConversationRuntime(moved.deps).handle(messageOf('승인된 push 실행해줘'));
    expect(moved.calls.gitPush).toBe(0);

    const commitDrift = execDeps({ applyAnchor: pushApprovedAnchor({ commitHash: 'a'.repeat(40) }) }); // commitHash ≠ pushCommitHash
    await new ConversationRuntime(commitDrift.deps).handle(messageOf('승인된 push 실행해줘'));
    expect(commitDrift.calls.gitPush).toBe(0);
  });

  it('dirty tree / upstream drift / not-ahead / diverged → no push (CA 40–48)', async () => {
    const blocked: Array<[string, Partial<GitStatus>, (c: ReturnType<typeof makeDeps>['deps']['composer']) => string]> = [
      ['no upstream', { upstream: undefined, ahead: undefined, behind: undefined }, (c) => c.composePushExecutionUnavailable(CTX).text],
      ['upstream differs', { upstream: 'origin/other' }, (c) => c.composePushExecutionUnavailable(CTX).text],
      ['ahead 0', { ahead: 0 }, (c) => c.composePushNothingToPush(CTX).text],
      ['behind > 0', { ahead: 1, behind: 2 }, (c) => c.composePushDiverged(CTX).text],
      ['staged dirty', { clean: false, staged: ['x.ts'] }, (c) => c.composePushDirtyWorkingTree(CTX).text],
      ['unstaged dirty', { clean: false, unstaged: ['y.ts'] }, (c) => c.composePushDirtyWorkingTree(CTX).text],
      ['untracked dirty', { clean: false, untracked: ['z.ts'] }, (c) => c.composePushDirtyWorkingTree(CTX).text],
    ];
    for (const [label, over, expected] of blocked) {
      const { deps, calls } = execDeps({ gitStatus: gitStatusOf({ ...execReady, ...over }) });
      const result = await new ConversationRuntime(deps).handle(messageOf('승인된 push 실행해줘'));
      expect(calls.gitPush, label).toBe(0);
      expect(result.reply.text, label).toBe(expected(composer));
    }
  });

  // ── pushApprovedCommit input (CA 49–53) ─────────────────────────────────────────────────────
  it('valid context calls git.pushApprovedCommit once with exact approved remote/branch/hash + ApprovalRef (CA 49–53)', async () => {
    const { deps, calls } = execDeps();
    await new ConversationRuntime(deps).handle(messageOf('승인된 push 실행해줘'));
    expect(calls.gitPush).toBe(1);
    expect(calls.lastGitPushInput?.remote).toBe(REMOTE);
    expect(calls.lastGitPushInput?.branch).toBe(BRANCH);
    expect(calls.lastGitPushInput?.commitHash).toBe(HEAD_SHA);
    expect(calls.lastGitPushInput?.rootPath).toBe(WORKSPACE.rootPath);
    expect(calls.lastGitPushInput?.approvalRef).toEqual({ id: 'apply-appr-1', status: ApprovalStatus.APPROVED, executionPlanRef: { id: 'plan-1', goal: 'g' } });
  });

  // ── result integrity / success / repeat (CA 79–105) ─────────────────────────────────────────
  it('result-integrity mismatch → composePushResultUnverified, keep PUSH_APPROVED, no GIT_PUSHED (CA 79–86)', async () => {
    const badResults: Array<[string, GitPushResult]> = [
      ['wrong commitHash', gitPushResultOf({ remote: REMOTE, branch: BRANCH, commitHash: HEAD_SHA }, { commitHash: 'b'.repeat(40) })],
      ['wrong remote', gitPushResultOf({ remote: REMOTE, branch: BRANCH, commitHash: HEAD_SHA }, { remote: 'upstream' })],
      ['wrong branch', gitPushResultOf({ remote: REMOTE, branch: BRANCH, commitHash: HEAD_SHA }, { branch: 'dev' })],
      ['wrong upstreamRef', gitPushResultOf({ remote: REMOTE, branch: BRANCH, commitHash: HEAD_SHA }, { upstreamRef: 'origin/dev' })],
    ];
    for (const [label, result] of badResults) {
      const { deps, calls } = execDeps({ gitPush: result });
      const turn = await new ConversationRuntime(deps).handle(messageOf('승인된 push 실행해줘'));
      expect(calls.gitPush, label).toBe(1);
      expect(calls.lastApplyAnchor?.status, label).not.toBe('GIT_PUSHED');
      expect(turn.reply.text, label).toBe(composer.composePushResultUnverified(CTX).text);
    }
  });

  it('success re-anchors GIT_PUSHED, stores pushed target, preserves full audit context (CA 87–92)', async () => {
    const { deps, calls } = execDeps();
    await new ConversationRuntime(deps).handle(messageOf('승인된 push 실행해줘'));
    const a = calls.lastApplyAnchor;
    expect(a?.status).toBe('GIT_PUSHED');
    expect(a?.pushedCommitHash).toBe(HEAD_SHA);
    expect(a?.pushedRemote).toBe(REMOTE);
    expect(a?.pushedBranch).toBe(BRANCH);
    expect(a?.pushedUpstreamRef).toBe(UPSTREAM);
    expect(a?.pushApprovalId).toBe('apply-appr-1');
    expect(a?.pushCommitHash).toBe(HEAD_SHA);
    expect(a?.pushRemote).toBe(REMOTE);
    expect(a?.pushBranch).toBe(BRANCH);
    expect(a?.pushUpstreamRef).toBe(UPSTREAM);
    expect(a?.commitApprovalId).toBe('apply-appr-1');
    expect(a?.commitHash).toBe(HEAD_SHA);
    expect(a?.committedFiles).toEqual([TARGET_FILE]);
    expect(a?.workspaceRef).toEqual(WORKSPACE);
    expect(a?.executionPlanRef).toEqual({ id: 'plan-1', goal: 'g' });
    expect(a?.postApplyValidationRef).toEqual({ id: 'cmd-test', status: CommandExecutionStatus.SUCCEEDED });
  });

  it('success reply says pushed to remote target + no PR/deployment, no readiness claims (CA 93–95)', async () => {
    const { deps } = execDeps();
    const result = await new ConversationRuntime(deps).handle(messageOf('승인된 push 실행해줘'));
    expect(result.reply.text).toContain(HEAD_SHA.slice(0, 7));
    expect(result.reply.text).toContain(`${REMOTE}/${BRANCH}`);
    expect(result.reply.text).toContain('PR 생성과 배포는 하지 않았어요');
    for (const bad of ['배포 준비', 'ready to deploy', 'push-safe', 'deployed']) expect(result.reply.text).not.toContain(bad);
  });

  it('provider push throw → composePushExecutionFailed, keep PUSH_APPROVED, no GIT_PUSHED (CA 96–100)', async () => {
    const { deps, calls } = execDeps({ gitPush: 'throw' });
    const result = await new ConversationRuntime(deps).handle(messageOf('승인된 push 실행해줘'));
    expect(calls.gitPush).toBe(1);
    expect(calls.lastApplyAnchor?.status).not.toBe('GIT_PUSHED');
    expect(result.status).toBe('FAILED');
    expect(result.reply.text).toBe(composer.composePushExecutionFailed(CTX).text);
    expect(result.reply.text).not.toContain('원격 변경 없음');
    expect(result.reply.text).toContain('rollback은 하지 않았어요');
  });

  it('GIT_PUSHED + execution/push phrase again → already pushed, no new push (CA 101–103)', async () => {
    for (const text of ['승인된 push 실행해줘', 'execute approved push', 'push approved commit', '푸시해줘']) {
      const { deps, calls } = makeDeps({ applyAnchor: pushedAnchor() });
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.gitPush, text).toBe(0);
      expect(result.reply.text, text).toBe(composer.composePushAlreadyPushed(CTX, { commitHash: HEAD_SHA, remote: REMOTE, branch: BRANCH }).text);
    }
  });

  // (Sprint 3b, ADR-0049 supersedes 3a's GIT_PUSHED PR-phrase behavior) A PR-creation phrase now routes to
  // the PR-approval flow — here `pushedAnchor()` pushed to `main`, so head == base → no approval. A bare
  // deploy phrase still gets the (now deploy-only) future-sprint reply.
  it('GIT_PUSHED + PR phrase (head==base main) → head/base limitation, no push, no approval (Sprint 3b)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: pushedAnchor() });
    const result = await new ConversationRuntime(deps).handle(messageOf('PR 만들어줘'));
    expect(calls.gitPush).toBe(0);
    expect(calls.requestForRisk).toBe(0);
    expect(result.reply.text).toBe(composer.composePrHeadEqualsBaseUnavailable(CTX).text);
  });

  it('GIT_PUSHED + deploy-only phrase → deploy-only future-sprint reply, no push (Sprint 3b)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: pushedAnchor() });
    const result = await new ConversationRuntime(deps).handle(messageOf('배포해줘'));
    expect(calls.gitPush).toBe(0);
    expect(result.reply.text).toBe(composer.composePushPrDeployUnsupported(CTX).text);
  });

  // ── no side effects (CA 106–113) ────────────────────────────────────────────────────────────
  it('the push-execution path performs no command/WorkspaceWrite/Patch/CodeGen/Orchestrator/commit call (CA 106–113)', async () => {
    const { deps, calls } = execDeps();
    await new ConversationRuntime(deps).handle(messageOf('승인된 push 실행해줘'));
    expect(calls.gitPush).toBe(1);
    expect(calls.gitInfo).toBe(1);
    expect(calls.gitStatus).toBe(1);
    expect(calls.gitCommit).toBe(0);
    expect(calls.gitDiff).toBe(0);
    expect(calls.commandRun).toBe(0);
    expect(calls.workspaceApply).toBe(0);
    expect(calls.patchGenerate).toBe(0);
    expect(calls.patchGet).toBe(0);
    expect(calls.codeGenerationGenerate).toBe(0);
    expect(calls.run).toBe(0);
    expect(calls.resume).toBe(0);
  });
});

// ── Sprint 3b — Explicit Pull Request Creation Approval (GIT_PUSHED → CRITICAL PR approval, ADR-0049) ──

describe('Explicit PR Creation Approval — runtime (Sprint 3b, ADR-0049)', () => {
  const REMOTE = 'origin';
  const HEAD = 'feature/login'; // pushed head branch (≠ base "main")
  const UPSTREAM = 'origin/feature/login';
  const BASE = 'main';
  const composer = new ResponseComposer();

  /** A GIT_PUSHED anchor pushed to a FEATURE branch (head ≠ base) — ready for a PR-creation approval. */
  const prReadyAnchor = (o: Partial<ApplyPreviewAnchor> = {}): ApplyPreviewAnchor =>
    approvedAnchorOf({
      status: 'GIT_PUSHED',
      workspaceChangeRef: { id: 'wc-1', status: WorkspaceChangeStatus.APPLIED },
      commitApprovalId: 'apply-appr-1',
      commitHash: HEAD_SHA,
      committedFiles: [TARGET_FILE],
      pushApprovalId: 'apply-appr-1',
      pushCommitHash: HEAD_SHA,
      pushRemote: REMOTE,
      pushBranch: HEAD,
      pushUpstreamRef: UPSTREAM,
      pushedCommitHash: HEAD_SHA,
      pushedRemote: REMOTE,
      pushedBranch: HEAD,
      pushedUpstreamRef: UPSTREAM,
      ...o,
    });
  /** A GIT_PUSHED anchor pushed to "main" (head == base). */
  const pushedToMainAnchor = (): ApplyPreviewAnchor =>
    prReadyAnchor({ pushBranch: BASE, pushUpstreamRef: 'origin/main', pushedBranch: BASE, pushedUpstreamRef: 'origin/main' });
  /** The approved target repository identity carried on the PR approval anchor (Sprint 3d-D). Matches makeDeps'
   *  default resolved identity so execution can proceed. */
  const PR_IDENTITY: RepositoryIdentity = { provider: 'github', owner: 'acme', repo: 'widgets' };
  /** A live APPROVED PR ApprovalRequest for `apply-appr-1` / plan-1 (Sprint 3d-D) — what `approvals.get` must
   *  return for PR-creation execution to proceed. */
  const approvedPrRequest = (): ApprovalRequest => ({ ...pendingApprovalOf(), id: 'apply-appr-1', status: ApprovalStatus.APPROVED });
  /** A PR_APPROVAL_PENDING anchor with complete PR context + approved repository identity (Sprint 3d-D). */
  const prPendingAnchor = (o: Partial<ApplyPreviewAnchor> = {}): ApplyPreviewAnchor =>
    prReadyAnchor({
      status: 'PR_APPROVAL_PENDING',
      prApprovalId: 'apply-appr-1',
      prPushedCommitHash: HEAD_SHA,
      prHeadBranch: HEAD,
      prBaseBranch: BASE,
      prTitle: 'Apply approved changes',
      prBodyPreview: 'body preview',
      repositoryIdentity: PR_IDENTITY,
      ...o,
    });
  /** A PR_APPROVED anchor. */
  const prApprovedAnchor = (o: Partial<ApplyPreviewAnchor> = {}): ApplyPreviewAnchor =>
    prPendingAnchor({ status: 'PR_APPROVED', ...o });

  const CREATE_PHRASES = [
    'PR 만들어줘', 'pull request 만들어줘', 'GitHub PR 열어줘', 'open a PR', '깃허브 PR 만들어줘',
    'PR 열어줘', 'pull request 생성해줘', 'merge request 만들어줘', 'create merge request',
  ];
  const BARE_NOUNS = ['PR', 'GitHub PR', 'pull request', 'merge request'];
  const COMPANIONS = ['PR 만들고 배포', 'PR 만들고 merge', 'PR 만들고 release', 'PR 만들고 auto merge', 'PR 만들고 force', 'PR 만들고 reset'];

  // ── creation + gating (CA 1–19) ──────────────────────────────────────────────────────────────
  it('GIT_PUSHED + each explicit PR-creation phrase → one CRITICAL PR ApprovalRequest, PR_APPROVAL_PENDING (CA 1–9)', async () => {
    for (const text of CREATE_PHRASES) {
      const { deps, calls } = makeDeps({ applyAnchor: prReadyAnchor() });
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.requestForRisk, text).toBe(1);
      expect(calls.lastRequestForRiskInput?.riskLevel, text).toBe(RiskLevel.CRITICAL);
      expect(calls.lastApplyAnchor?.status, text).toBe('PR_APPROVAL_PENDING');
      expect(result.status, text).toBe('AWAITING_APPROVAL');
    }
  });

  it('GIT_PUSHED + a bare PR noun (no create/open verb) → no PR approval (CA 10–13)', async () => {
    for (const text of BARE_NOUNS) {
      const { deps, calls } = makeDeps({ applyAnchor: prReadyAnchor() });
      await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.requestForRisk, text).toBe(0);
    }
  });

  it('GIT_PUSHED + ambiguous phrase → no PR approval (CA 14)', async () => {
    for (const text of ['좋아', '오케이', '확인', '진행해', '다음 단계']) {
      const { deps, calls } = makeDeps({ applyAnchor: prReadyAnchor() });
      await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.requestForRisk, text).toBe(0);
    }
  });

  it('non-GIT_PUSHED states + PR phrase → no PR approval; PR_APPROVED + PR phrase → EXECUTES creation (Sprint 3d-D supersedes CA 15–19)', async () => {
    for (const anchor of [null, approvedAnchorOf({ status: 'WORKSPACE_APPLIED' }), approvedAnchorOf({ status: 'GIT_COMMITTED', commitHash: HEAD_SHA, committedFiles: [TARGET_FILE] }), approvedAnchorOf({ status: 'PUSH_APPROVED', pushBranch: HEAD, pushUpstreamRef: UPSTREAM, pushCommitHash: HEAD_SHA, commitHash: HEAD_SHA })]) {
      const { deps, calls } = makeDeps({ applyAnchor: anchor });
      await new ConversationRuntime(deps).handle(messageOf('PR 만들어줘'));
      expect(calls.requestForRisk, String(anchor?.status)).toBe(0);
    }
    // (Sprint 3d-D, ADR-0054) PR_APPROVED + a PR create phrase now EXECUTES creation (no NEW approval).
    const { deps, calls } = makeDeps({ applyAnchor: prApprovedAnchor(), approvalsGetResult: approvedPrRequest() });
    const result = await new ConversationRuntime(deps).handle(messageOf('PR 만들어줘'));
    expect(calls.requestForRisk).toBe(0);
    expect(calls.hostingCreatePR).toBe(1);
    expect(calls.lastApplyAnchor?.status).toBe('PR_CREATED');
    expect(result.status).toBe('RESPONDED');
  });

  // ── unsupported companions (CA 20–27) ────────────────────────────────────────────────────────
  it('GIT_PUSHED + PR bundled with deploy/merge/release/auto-merge/force/reset → unsupported companion, no approval (CA 20–25)', async () => {
    for (const text of COMPANIONS) {
      const { deps, calls } = makeDeps({ applyAnchor: prReadyAnchor() });
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.requestForRisk, text).toBe(0);
      expect(result.reply.text, text).toBe(composer.composePrUnsupportedCompanion(CTX).text);
    }
  });

  it('PR_APPROVED + PR bundled with deploy/merge → unsupported companion, no PR (CA 26–27)', async () => {
    for (const text of ['PR 만들고 배포', 'PR 만들고 merge']) {
      const { deps, calls } = makeDeps({ applyAnchor: prApprovedAnchor() });
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.requestForRisk, text).toBe(0);
      expect(result.reply.text, text).toBe(composer.composePrUnsupportedCompanion(CTX).text);
    }
  });

  // ── context / verification guards (CA 28–40) ─────────────────────────────────────────────────
  it('incomplete / unsafe pushed context → composePrApprovalUnavailable, no approval, log never throws (CA 28–40)', async () => {
    const bad: Array<[string, Partial<ApplyPreviewAnchor>]> = [
      ['missing pushedCommitHash', { pushedCommitHash: undefined }],
      ['invalid pushedCommitHash', { pushedCommitHash: 'not-a-sha' }],
      ['pushedCommitHash != pushCommitHash', { pushCommitHash: 'c'.repeat(40) }],
      ['pushedCommitHash != commitHash', { commitHash: 'd'.repeat(40) }],
      ['missing pushedBranch', { pushedBranch: undefined }],
      ['unsafe pushedBranch', { pushedBranch: 'bad:branch' }],
      ['missing pushedRemote', { pushedRemote: undefined }],
      ['unsafe pushedRemote', { pushedRemote: '-bad' }],
      ['missing pushedUpstreamRef', { pushedUpstreamRef: undefined }],
      ['malformed pushedUpstreamRef', { pushedUpstreamRef: 'noslash' }],
      ['parsed branch != pushedBranch', { pushedUpstreamRef: 'origin/other' }],
      ['parsed remote != pushedRemote', { pushedUpstreamRef: 'upstream/feature/login' }],
      ['missing workspaceRef', { workspaceRef: undefined }],
      ['missing executionPlanRef', { executionPlanRef: undefined }],
    ];
    for (const [label, patch] of bad) {
      const { deps, calls } = makeDeps({ applyAnchor: prReadyAnchor(patch) });
      const result = await new ConversationRuntime(deps).handle(messageOf('PR 만들어줘'));
      expect(calls.requestForRisk, label).toBe(0);
      expect(result.reply.text, label).toBe(composer.composePrApprovalUnavailable(CTX).text);
    }
  });

  // ── target / title / body / reason / risk (CA 41–65) ─────────────────────────────────────────
  it('deterministic target: base == "main" policy, head == pushedBranch, head==base blocks (CA 41–46)', async () => {
    const ok = makeDeps({ applyAnchor: prReadyAnchor() });
    await new ConversationRuntime(ok.deps).handle(messageOf('PR 만들어줘'));
    expect(ok.calls.lastApplyAnchor?.prBaseBranch).toBe('main');
    expect(ok.calls.lastApplyAnchor?.prHeadBranch).toBe(HEAD);
    expect(ok.calls.lastRequestForRiskInput?.reason).toContain('base: main');

    const hb = makeDeps({ applyAnchor: pushedToMainAnchor() });
    const result = await new ConversationRuntime(hb.deps).handle(messageOf('PR 만들어줘'));
    expect(hb.calls.requestForRisk).toBe(0);
    expect(result.reply.text).toBe(composer.composePrHeadEqualsBaseUnavailable(CTX).text);
  });

  it('deterministic bounded title: sanitizes control/newline/markdown/backticks, bounds length, falls back (CA 47–51)', async () => {
    const titleOf = async (instruction: string): Promise<string> => {
      const { deps, calls } = makeDeps({ applyAnchor: prReadyAnchor({ instruction }) });
      await new ConversationRuntime(deps).handle(messageOf('PR 만들어줘'));
      return calls.lastApplyAnchor?.prTitle ?? '';
    };
    expect(await titleOf('add logout button')).toBe('add logout button'); // deterministic
    expect(await titleOf('ab')).toBe('ab'); // control chars stripped
    expect(await titleOf('line1\nline2')).toBe('line1 line2'); // newlines collapse to one line
    expect(await titleOf('# Title `code`')).toBe('Title code'); // markdown heading + backticks removed
    expect((await titleOf('x'.repeat(300))).length).toBe(100); // bounded to MAX_PR_TITLE
    expect(await titleOf('   ')).toBe('Apply approved changes'); // blank → fallback
  });

  it('deterministic bounded body: committed-file COUNT only (no paths), no raw diff/content, says no deploy (CA 52–57)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: prReadyAnchor({ committedFiles: [TARGET_FILE] }) });
    await new ConversationRuntime(deps).handle(messageOf('PR 만들어줘'));
    const body = calls.lastApplyAnchor?.prBodyPreview ?? '';
    expect(body).toContain('1개'); // committed-file count
    expect(body).not.toContain(TARGET_FILE); // NO file paths (CA #5)
    expect(body).not.toContain('foo.ts');
    expect(body).not.toContain('+++'); // no raw diff
    expect(body).not.toContain('---');
    expect(body).toContain('배포'); // says no deployment
    expect(body.length).toBeLessThanOrEqual(1000); // bounded
  });

  it('CRITICAL reason: pushed commit + head/base + permission-only + not-in-3b + future hosting + no deploy/merge; no overclaim (CA 58–65, CA #12)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: prReadyAnchor() });
    await new ConversationRuntime(deps).handle(messageOf('PR 만들어줘'));
    const reason = calls.lastRequestForRiskInput?.reason ?? '';
    expect(calls.lastRequestForRiskInput?.riskLevel).toBe(RiskLevel.CRITICAL);
    expect(reason).toContain(`pushed commit: ${HEAD_SHA}`);
    expect(reason).toContain('head: feature/login');
    expect(reason).toContain('base: main');
    expect(reason).toContain('records permission only');
    expect(reason).toContain('NOT performed in Sprint 3b');
    expect(reason).toContain('future execution requires a separate repository-hosting step');
    expect(reason).toContain('no deployment has been performed');
    expect(reason).toContain('no merge has been performed');
    expect(reason).toContain('does not guarantee a PR can be created'); // CA #12 discipline
  });

  // ── decision flow (CA 66–80) ─────────────────────────────────────────────────────────────────
  it('PR_APPROVAL_PENDING + ambiguous / PR-creation / PR+deploy / PR+merge / deploy-only → re-prompt, no decide (CA 66–70)', async () => {
    for (const text of ['음 글쎄', 'PR 만들어줘', 'PR 만들고 배포', 'PR 만들고 merge', '배포해줘']) {
      const { deps, calls } = makeDeps({ applyAnchor: prPendingAnchor() });
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.decide, text).toBe(0);
      expect(calls.requestForRisk, text).toBe(0);
      expect(calls.applyAnchorSet, text).toBe(0); // no re-anchor
      expect(result.status, text).toBe('AWAITING_APPROVAL');
    }
  });

  it('PR_APPROVAL_PENDING + "승인" verifies the ApprovalRequest (missing / plan-mismatch → no decide) (CA 71)', async () => {
    const gone = makeDeps({ applyAnchor: prPendingAnchor(), approvalsGetResult: null });
    await new ConversationRuntime(gone.deps).handle(messageOf('승인'));
    expect(gone.calls.decide).toBe(0);
    const mismatch = makeDeps({ applyAnchor: prPendingAnchor(), approvalsGetResult: { ...pendingApprovalOf(), id: 'apply-appr-1', executionPlanRef: { id: 'other-plan', goal: 'g' } } });
    await new ConversationRuntime(mismatch.deps).handle(messageOf('승인'));
    expect(mismatch.calls.decide).toBe(0);
  });

  it('PR_APPROVAL_PENDING + "승인" → PR_APPROVED only, no PR creation (CA 72)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: prPendingAnchor(), approvalsGetResult: { ...pendingApprovalOf(), id: 'apply-appr-1' } });
    const result = await new ConversationRuntime(deps).handle(messageOf('승인'));
    expect(calls.decide).toBe(1);
    expect(calls.lastApplyAnchor?.status).toBe('PR_APPROVED');
    expect(result.reply.text).toBe(composer.composePrApprovalRecorded(CTX).text);
  });

  it('PR_APPROVAL_PENDING + "거절"/"취소" → GIT_PUSHED, clear ONLY PR fields, pushed/commit context preserved (CA 73–74, 81–84)', async () => {
    for (const [text, expected] of [['거절', 'DENIED'], ['취소', 'CANCELLED']] as const) {
      const { deps, calls } = makeDeps({ applyAnchor: prPendingAnchor(), approvalsGetResult: { ...pendingApprovalOf(), id: 'apply-appr-1' } });
      const result = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.decide, text).toBe(1);
      expect(result.status, text).toBe(expected);
      expect(calls.lastApplyAnchor?.status, text).toBe('GIT_PUSHED');
      expect(calls.lastApplyAnchor?.prApprovalId, text).toBeUndefined();
      expect(calls.lastApplyAnchor?.prHeadBranch, text).toBeUndefined();
      expect(calls.lastApplyAnchor?.prBaseBranch, text).toBeUndefined();
      expect(calls.lastApplyAnchor?.prTitle, text).toBeUndefined();
      expect(calls.lastApplyAnchor?.prBodyPreview, text).toBeUndefined();
      expect(calls.lastApplyAnchor?.pushedCommitHash, text).toBe(HEAD_SHA); // pushed context preserved
      expect(calls.lastApplyAnchor?.pushedBranch, text).toBe(HEAD);
      expect(calls.lastApplyAnchor?.commitHash, text).toBe(HEAD_SHA); // commit context preserved
      expect(calls.lastApplyAnchor?.committedFiles, text).toEqual([TARGET_FILE]);
      const wanted = text === '거절' ? composer.composePrApprovalDenied(CTX).text : composer.composePrApprovalCancelled(CTX).text;
      expect(result.reply.text, text).toBe(wanted);
    }
  });

  it('PR_APPROVAL_PENDING with incomplete context → safe failure, no decide (CA 75)', async () => {
    for (const patch of [{ prApprovalId: undefined }, { prHeadBranch: undefined }, { prPushedCommitHash: undefined }, { prTitle: undefined }] as Partial<ApplyPreviewAnchor>[]) {
      const { deps, calls } = makeDeps({ applyAnchor: prPendingAnchor(patch) });
      const result = await new ConversationRuntime(deps).handle(messageOf('승인'));
      expect(calls.decide).toBe(0);
      expect(result.reply.text).toBe(composer.composePrApprovalUnavailable(CTX).text);
    }
  });

  it('PR_APPROVED preserves PR + pushed/commit/workspace context; PR phrase → already approved; ambiguous → no PR (CA 76–79)', async () => {
    const approved = prApprovedAnchor();
    expect(approved.prApprovalId).toBe('apply-appr-1');
    expect(approved.prPushedCommitHash).toBe(HEAD_SHA);
    expect(approved.prHeadBranch).toBe(HEAD);
    expect(approved.prBaseBranch).toBe(BASE);
    expect(approved.prTitle).toBe('Apply approved changes');
    expect(approved.prBodyPreview).toBe('body preview');
    expect(approved.pushedCommitHash).toBe(HEAD_SHA); // pushed context preserved
    expect(approved.committedFiles).toEqual([TARGET_FILE]); // commit/workspace context preserved
    // (Sprint 3d-D) PR_APPROVED + PR create phrase now EXECUTES (no new approval); ambiguous "좋아" does nothing.
    const exec = makeDeps({ applyAnchor: prApprovedAnchor(), approvalsGetResult: approvedPrRequest() });
    const r1 = await new ConversationRuntime(exec.deps).handle(messageOf('PR 만들어줘'));
    expect(exec.calls.requestForRisk).toBe(0);
    expect(exec.calls.hostingCreatePR).toBe(1);
    expect(exec.calls.lastApplyAnchor?.status).toBe('PR_CREATED');
    expect(r1.status).toBe('RESPONDED');
    const amb = makeDeps({ applyAnchor: prApprovedAnchor() });
    await new ConversationRuntime(amb.deps).handle(messageOf('좋아'));
    expect(amb.calls.requestForRisk).toBe(0);
    expect(amb.calls.hostingCreatePR).toBe(0);
  });

  it('PR_APPROVED + deploy-only phrase → state-specific: approval recorded, PR not created, deploy not done (CA 80, 108)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: prApprovedAnchor() });
    const result = await new ConversationRuntime(deps).handle(messageOf('배포해줘'));
    expect(calls.requestForRisk).toBe(0);
    expect(result.reply.text).toBe(composer.composePrApprovedDeployUnsupported(CTX).text);
  });

  // ── no side effects (CA 85–100) ──────────────────────────────────────────────────────────────
  it('the PR-approval path performs NO git/PR/hosting/command/write/patch/codegen/orchestrator side effect; no fresh Git read (CA 85–100)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: prReadyAnchor() });
    await new ConversationRuntime(deps).handle(messageOf('PR 만들어줘'));
    expect(calls.requestForRisk).toBe(1); // the ONLY effect
    expect(calls.gitPush).toBe(0);
    expect(calls.gitCommit).toBe(0);
    expect(calls.gitInfo).toBe(0); // CA #12: no fresh Git read
    expect(calls.gitStatus).toBe(0);
    expect(calls.gitDiff).toBe(0);
    expect(calls.commandRun).toBe(0);
    expect(calls.workspaceApply).toBe(0);
    expect(calls.patchGenerate).toBe(0);
    expect(calls.codeGenerationGenerate).toBe(0);
    expect(calls.run).toBe(0);
    expect(calls.resume).toBe(0);
    // (Sprint 3d-D) the PR-APPROVAL path still performs NO hosting mutation — createPullRequest is NOT called
    // during approval (that is a separate PR_APPROVED execution phase). Git capability still has no PR method.
    expect(calls.hostingCreatePR).toBe(0);
    expect(Object.keys(deps.git)).not.toContain('createPullRequest');
    expect(Object.keys(deps.git)).not.toContain('pullRequest');
  });

  // ── composer wording (CA 101–109) ────────────────────────────────────────────────────────────
  it('composer wording: approval-only, never claims PR created/deployed/merged/released/verified (CA 101–109)', () => {
    const requested = composer.composePrApprovalRequested(CTX, { pushedCommitHash: HEAD_SHA, headBranch: HEAD, baseBranch: BASE, title: 'Apply approved changes' }).text;
    expect(requested).toContain('승인');
    expect(requested).toContain('PR을 만들지 않아요');
    const recorded = composer.composePrApprovalRecorded(CTX).text;
    expect(recorded).toContain('PR은 만들지 않았어요');
    const denied = composer.composePrApprovalDenied(CTX).text;
    expect(denied).toContain('push된 그대로');
    expect(denied).toContain('PR은 만들지 않았어요');
    expect(composer.composePrApprovalUnavailable(CTX).text).toContain('PR은 만들지 않았어요');
    expect(composer.composePrAlreadyApproved(CTX).text).toContain('만들지 않았어요');
    expect(composer.composePrUnsupportedCompanion(CTX).text).toMatch(/배포|merge|release/);
    expect(composer.composePushPrDeployUnsupported(CTX).text).toContain('배포는 아직 지원하지 않아요');
    expect(composer.composePushPrDeployUnsupported(CTX).text).not.toContain('PR 생성'); // deploy-only now
    expect(composer.composePrApprovedDeployUnsupported(CTX).text).toContain('PR은 아직 만들지 않았');
    // no composer claims a PR was created / deployed / merged / released / hosting-verified (CA 109 / #12)
    for (const t of [requested, recorded, denied, composer.composePrApprovalCancelled(CTX).text, composer.composePrHeadEqualsBaseUnavailable(CTX).text, composer.composePrAlreadyApproved(CTX).text]) {
      expect(t).not.toMatch(/배포했|병합했|merged|deployed|released|production/i);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Sprint 3d-D (ADR-0054): actual PR creation execution (PR_APPROVED → manager → PR_CREATED).
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  const prResult = (over: Partial<PullRequestResult> = {}): PullRequestResult => ({
    provider: 'github',
    owner: 'acme',
    repo: 'widgets',
    pullRequestNumber: 42,
    pullRequestUrl: 'https://github.com/acme/widgets/pull/42',
    pullRequestHeadBranch: HEAD,
    pullRequestBaseBranch: BASE,
    pullRequestCommitHash: HEAD_SHA,
    reused: false,
    ...over,
  });
  const APPROVED_REQ = () => approvedPrRequest();
  const PR_CREATED_ANCHOR = (o: Partial<ApplyPreviewAnchor> = {}): ApplyPreviewAnchor =>
    prApprovedAnchor({
      status: 'PR_CREATED',
      pullRequestRef: { provider: 'github', owner: 'acme', repo: 'widgets', pullRequestNumber: 42, pullRequestUrl: 'https://github.com/acme/widgets/pull/42' },
      pullRequestNumber: 42,
      pullRequestUrl: 'https://github.com/acme/widgets/pull/42',
      pullRequestHeadBranch: HEAD,
      pullRequestBaseBranch: BASE,
      pullRequestCommitHash: HEAD_SHA,
      pullRequestReused: false,
      ...o,
    });

  it('PR_APPROVED + explicit create/open phrase → executes; bare noun/승인/진행해/deploy/merge → no execution (CA 1–7)', async () => {
    for (const text of CREATE_PHRASES) {
      const { deps, calls } = makeDeps({ applyAnchor: prApprovedAnchor(), approvalsGetResult: APPROVED_REQ() });
      await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.hostingCreatePR, text).toBe(1);
      expect(calls.lastApplyAnchor?.status, text).toBe('PR_CREATED');
    }
    for (const text of [...BARE_NOUNS, '승인', '진행해', '좋아', '배포해줘', 'PR 만들고 merge']) {
      const { deps, calls } = makeDeps({ applyAnchor: prApprovedAnchor(), approvalsGetResult: APPROVED_REQ() });
      await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.hostingCreatePR, text).toBe(0);
    }
  });

  it('PR_APPROVAL_PENDING + create phrase does not execute (CA 7); GIT_PUSHED w/o PR_APPROVED does not execute (CA 8)', async () => {
    const pending = makeDeps({ applyAnchor: prPendingAnchor(), approvalsGetResult: APPROVED_REQ() });
    await new ConversationRuntime(pending.deps).handle(messageOf('PR 만들어줘'));
    expect(pending.calls.hostingCreatePR).toBe(0);
    const pushed = makeDeps({ applyAnchor: prReadyAnchor(), approvalsGetResult: APPROVED_REQ() });
    await new ConversationRuntime(pushed.deps).handle(messageOf('PR 만들어줘'));
    expect(pushed.calls.hostingCreatePR).toBe(0); // creates a NEW approval (3b), not execution
  });

  it('PR_CREATED only after manager success; no PR_CREATED on blocked/unverified failure (CA 9/10/38/39)', async () => {
    const ok = makeDeps({ applyAnchor: prApprovedAnchor(), approvalsGetResult: APPROVED_REQ() });
    await new ConversationRuntime(ok.deps).handle(messageOf('PR 만들어줘'));
    expect(ok.calls.lastApplyAnchor?.status).toBe('PR_CREATED');
    for (const err of [new RepositoryHostingBlockedError('b'), new RepositoryHostingUnverifiedError('u')]) {
      const { deps, calls } = makeDeps({
        applyAnchor: prApprovedAnchor(),
        approvalsGetResult: APPROVED_REQ(),
        hostingManager: { async createPullRequest() { throw err; } },
      });
      const r = await new ConversationRuntime(deps).handle(messageOf('PR 만들어줘'));
      expect(calls.lastApplyAnchor?.status, err.name).not.toBe('PR_CREATED');
      expect(r.status, err.name).toBe('FAILED');
    }
  });

  it('verifies approval via ApprovalManager.get; missing/non-APPROVED/plan-mismatch → no manager call (CA 11–16/19/20)', async () => {
    for (const req of [null, { ...approvedPrRequest(), status: ApprovalStatus.PENDING }, { ...approvedPrRequest(), executionPlanRef: { id: 'other', goal: 'g' } }]) {
      const { deps, calls } = makeDeps({ applyAnchor: prApprovedAnchor(), approvalsGetResult: req as ApprovalRequest | null });
      const r = await new ConversationRuntime(deps).handle(messageOf('PR 만들어줘'));
      expect(calls.approvalsGet).toBeGreaterThan(0);
      expect(calls.hostingCreatePR).toBe(0);
      expect(r.reply.text).toBe(composer.composePrCreationUnavailable(CTX).text);
    }
  });

  it('pushed/head/base context mismatch → no manager call, fail safe (CA 16/17)', async () => {
    for (const bad of [{ pushedCommitHash: 'f'.repeat(40) }, { pushedBranch: 'other' }, { prBaseBranch: 'develop' }]) {
      const { deps, calls } = makeDeps({ applyAnchor: prApprovedAnchor(bad), approvalsGetResult: APPROVED_REQ() });
      await new ConversationRuntime(deps).handle(messageOf('PR 만들어줘'));
      expect(calls.hostingCreatePR, JSON.stringify(bad)).toBe(0);
    }
  });

  it('resolved identity is passed to manager; missing identity or missing token (manager) → not configured (CA 21/22/27)', async () => {
    const ok = makeDeps({ applyAnchor: prApprovedAnchor(), approvalsGetResult: APPROVED_REQ() });
    await new ConversationRuntime(ok.deps).handle(messageOf('PR 만들어줘'));
    expect(ok.calls.lastHostingCreateInput?.identity).toEqual({ provider: 'github', owner: 'acme', repo: 'widgets' });
    for (const opt of [{ hostingIdentity: null as null }, { hostingManager: null as null }]) {
      const { deps, calls } = makeDeps({ applyAnchor: prApprovedAnchor(), approvalsGetResult: APPROVED_REQ(), ...opt });
      const r = await new ConversationRuntime(deps).handle(messageOf('PR 만들어줘'));
      expect(calls.hostingCreatePR).toBe(0);
      expect(r.reply.text).toBe(composer.composePrCreationNotConfigured(CTX).text);
    }
  });

  it('resolved identity differing from the approved anchor identity → fail safe, no manager call (CA change 1 / tests 78/80)', async () => {
    const { deps, calls } = makeDeps({
      applyAnchor: prApprovedAnchor({ repositoryIdentity: { provider: 'github', owner: 'evil', repo: 'widgets' } }),
      approvalsGetResult: APPROVED_REQ(),
    });
    const r = await new ConversationRuntime(deps).handle(messageOf('PR 만들어줘'));
    expect(calls.hostingCreatePR).toBe(0);
    expect(r.reply.text).toBe(composer.composePrCreationUnavailable(CTX).text);
  });

  it('PR_APPROVED anchor missing repositoryIdentity → fail safe (CA change 1 / test 77)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: prApprovedAnchor({ repositoryIdentity: undefined }), approvalsGetResult: APPROVED_REQ() });
    await new ConversationRuntime(deps).handle(messageOf('PR 만들어줘'));
    expect(calls.hostingCreatePR).toBe(0);
  });

  it('manager receives ApprovalRef + expected pushed commit hash + bounded body; no token anywhere (CA 34/35/29/30)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: prApprovedAnchor(), approvalsGetResult: APPROVED_REQ() });
    const r = await new ConversationRuntime(deps).handle(messageOf('PR 만들어줘'));
    const input = calls.lastHostingCreateInput!;
    expect(input.approvalRef).toEqual({ id: 'apply-appr-1', status: ApprovalStatus.APPROVED, executionPlanRef: { id: 'plan-1', goal: 'g' } });
    expect(input.expectedCommitHash).toBe(HEAD_SHA);
    expect(input.body).toContain('변경 파일 수'); // count only, no file paths
    expect(input.body).not.toContain(TARGET_FILE);
    // no token in the create input, the created anchor, or the reply
    expect(JSON.stringify(input)).not.toMatch(/token|ghp_/i);
    expect(JSON.stringify(calls.lastApplyAnchor)).not.toMatch(/token|ghp_/i);
    expect(r.reply.text).not.toMatch(/token|ghp_/i);
  });

  it('new PR success → PR_CREATED reused:false; response has URL + no merge/deploy/release (CA 32/34/35/37/41/42)', async () => {
    const { deps, calls } = makeDeps({
      applyAnchor: prApprovedAnchor(),
      approvalsGetResult: APPROVED_REQ(),
      hostingManager: { async createPullRequest(i) { return prResult({ pullRequestHeadBranch: i.headBranch, pullRequestBaseBranch: i.baseBranch, pullRequestCommitHash: i.expectedCommitHash }); } },
    });
    const r = await new ConversationRuntime(deps).handle(messageOf('PR 만들어줘'));
    expect(calls.lastApplyAnchor?.status).toBe('PR_CREATED');
    expect(calls.lastApplyAnchor?.pullRequestReused).toBe(false);
    expect(r.reply.text).toContain('https://github.com/acme/widgets/pull/42');
    expect(r.reply.text).toContain('머지/배포/릴리즈는 하지 않았어요');
    expect(r.reply.text).not.toMatch(/merged|deployed|released/i);
  });

  it('existing-PR reuse → PR_CREATED reused:true; response says existing connected, not newly created (CA 36/43/44/58/61)', async () => {
    const { deps, calls } = makeDeps({
      applyAnchor: prApprovedAnchor(),
      approvalsGetResult: APPROVED_REQ(),
      hostingManager: { async createPullRequest(i) { return prResult({ reused: true, pullRequestHeadBranch: i.headBranch, pullRequestBaseBranch: i.baseBranch, pullRequestCommitHash: i.expectedCommitHash }); } },
    });
    const r = await new ConversationRuntime(deps).handle(messageOf('PR 만들어줘'));
    expect(calls.lastApplyAnchor?.status).toBe('PR_CREATED');
    expect(calls.lastApplyAnchor?.pullRequestReused).toBe(true);
    expect(r.reply.text).toContain('기존에 열려 있던 PR을 연결했어요');
    expect(r.reply.text).not.toContain('PR을 만들었어요');
  });

  it('ONLY a known BlockedError says "PR not created"; Unverified + generic + non-Error → safe unverified (3d-D impl review)', async () => {
    // 1. Known pre-mutation BlockedError → "PR은 만들지 않았어요" allowed; no PR_CREATED.
    const blocked = makeDeps({ applyAnchor: prApprovedAnchor(), approvalsGetResult: APPROVED_REQ(), hostingManager: { async createPullRequest() { throw new RepositoryHostingBlockedError('x'); } } });
    const rb = await new ConversationRuntime(blocked.deps).handle(messageOf('PR 만들어줘'));
    expect(rb.reply.text).toBe(composer.composePrCreationBlocked(CTX).text);
    expect(rb.reply.text).toContain('PR은 만들지 않았어요');
    expect(blocked.calls.lastApplyAnchor?.status).not.toBe('PR_CREATED');

    // 2–4. UnverifiedError, a generic Error, and a non-Error throw ALL map to unverified — never "not created".
    const unverifiedThrowers = [
      { async createPullRequest() { throw new RepositoryHostingUnverifiedError('u'); } },
      { async createPullRequest() { throw new Error('unexpected generic'); } },
      { async createPullRequest(): Promise<PullRequestResult> { throw 'string failure'; } }, // non-Error throw
    ];
    for (const [i, hostingManager] of unverifiedThrowers.entries()) {
      const { deps, calls } = makeDeps({ applyAnchor: prApprovedAnchor(), approvalsGetResult: APPROVED_REQ(), hostingManager });
      const r = await new ConversationRuntime(deps).handle(messageOf('PR 만들어줘'));
      expect(r.reply.text, `case ${i}`).toBe(composer.composePrCreationUnverified(CTX).text);
      expect(r.reply.text, `case ${i}`).not.toContain('PR은 만들지 않았어요');
      expect(r.reply.text, `case ${i}`).toContain('확인하지 못했어요');
      expect(calls.lastApplyAnchor?.status, `case ${i}`).not.toBe('PR_CREATED');
    }
  });

  it('PR_CREATED anchor preserves the full causal chain + PR result; no token/remoteUrl (CA 61–72)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: prApprovedAnchor(), approvalsGetResult: APPROVED_REQ() });
    await new ConversationRuntime(deps).handle(messageOf('PR 만들어줘'));
    const a = calls.lastApplyAnchor!;
    expect(a.repositoryIdentity).toEqual({ provider: 'github', owner: 'acme', repo: 'widgets' });
    expect(a.pullRequestRef).toEqual({ provider: 'github', owner: 'acme', repo: 'widgets', pullRequestNumber: 42, pullRequestUrl: 'https://github.com/acme/widgets/pull/42' });
    expect(a.pullRequestCommitHash).toBe(HEAD_SHA);
    expect(a.pullRequestCommitHash).toBe(a.prPushedCommitHash);
    expect(a.pullRequestHeadBranch).toBe(a.prHeadBranch);
    expect(a.pullRequestBaseBranch).toBe(a.prBaseBranch);
    expect(a.prApprovalId).toBe('apply-appr-1'); // causal chain preserved
    expect(a.commitHash).toBe(HEAD_SHA);
    expect(JSON.stringify(a)).not.toMatch(/remoteUrl|token/i);
  });

  it('execution performs NO extra git/command/workspace side effects — only the manager call (CA 49–60)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: prApprovedAnchor(), approvalsGetResult: APPROVED_REQ() });
    await new ConversationRuntime(deps).handle(messageOf('PR 만들어줘'));
    expect(calls.hostingCreatePR).toBe(1);
    expect(calls.gitPush).toBe(0);
    expect(calls.gitCommit).toBe(0);
    expect(calls.gitStatus).toBe(0);
    expect(calls.gitInfo).toBe(0);
    expect(calls.commandRun).toBe(0);
    expect(calls.workspaceApply).toBe(0);
    expect(calls.run).toBe(0);
  });

  it('PR_CREATED + create phrase → already created (URL, no new manager call); deploy/merge → future step (CA 8/40/111–114)', async () => {
    const again = makeDeps({ applyAnchor: PR_CREATED_ANCHOR(), approvalsGetResult: APPROVED_REQ() });
    const r = await new ConversationRuntime(again.deps).handle(messageOf('PR 만들어줘'));
    expect(again.calls.hostingCreatePR).toBe(0);
    expect(r.reply.text).toBe(composer.composePrAlreadyCreated(CTX, { prNumber: 42, prUrl: 'https://github.com/acme/widgets/pull/42' }).text);
    // (Sprint 3f supersedes) a bare deploy/release phrase at PR_CREATED still → companion-unsupported; a merge
    // phrase now routes to merge approval (covered by the 3f tests), so it is no longer a companion here.
    for (const text of ['배포해줘', 'release 해줘']) {
      const { deps, calls } = makeDeps({ applyAnchor: PR_CREATED_ANCHOR(), approvalsGetResult: APPROVED_REQ() });
      const rr = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.hostingCreatePR, text).toBe(0);
      expect(rr.reply.text, text).toBe(composer.composePrCreatedCompanionUnsupported(CTX).text);
    }
  });

  it('GIT_PUSHED + PR approval request fails safe when repository identity is not configured (CA change 9 / tests 106–108)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: prReadyAnchor(), hostingIdentity: null });
    const r = await new ConversationRuntime(deps).handle(messageOf('PR 만들어줘'));
    expect(calls.requestForRisk).toBe(0); // no ApprovalRequest
    expect(calls.lastApplyAnchor?.status).not.toBe('PR_APPROVAL_PENDING');
    expect(r.reply.text).toBe(composer.composePrCreationNotConfigured(CTX).text);
  });

  it('PR approval request stores repositoryIdentity in PR_APPROVAL_PENDING; reason has owner/repo, no token (CA 75/109)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: prReadyAnchor(), hostingIdentity: { provider: 'github', owner: 'acme', repo: 'widgets' } });
    await new ConversationRuntime(deps).handle(messageOf('PR 만들어줘'));
    expect(calls.lastApplyAnchor?.status).toBe('PR_APPROVAL_PENDING');
    expect(calls.lastApplyAnchor?.repositoryIdentity).toEqual({ provider: 'github', owner: 'acme', repo: 'widgets' });
    expect(calls.lastRequestForRiskInput?.reason).toContain('acme/widgets');
    expect(calls.lastRequestForRiskInput?.reason).not.toMatch(/token|ghp_/i);
  });

  it('runtime does not parse ApprovalRequest.reason for context (CA change 2 / test 81)', async () => {
    // Even with a garbage/empty reason, execution proceeds off STRUCTURED anchor + ApprovalRef fields.
    const { deps, calls } = makeDeps({
      applyAnchor: prApprovedAnchor(),
      approvalsGetResult: { ...approvedPrRequest(), reason: 'totally unrelated free text' },
    });
    await new ConversationRuntime(deps).handle(messageOf('PR 만들어줘'));
    expect(calls.hostingCreatePR).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Sprint 3e (ADR-0055): read-only PR status preview (PR_CREATED + status phrase → keep PR_CREATED).
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  const STATUS_PHRASES = ['PR 상태 확인해줘', 'PR 상태 어때?', 'CI 상태 확인해줘', '체크 상태 봐줘', 'GitHub checks 봐줘', 'review 상태 알려줘'];

  it('PR_CREATED + status phrase → read-only preview via manager; keeps PR_CREATED; no mutation (CA 1/7/50)', async () => {
    for (const text of STATUS_PHRASES) {
      const { deps, calls } = makeDeps({ applyAnchor: PR_CREATED_ANCHOR() });
      const r = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.hostingGetStatus, text).toBe(1);
      expect(calls.hostingCreatePR, text).toBe(0);
      expect(calls.applyAnchorSet, text).toBe(0); // no re-anchor → still PR_CREATED (Q2)
      expect(r.reply.text, text).toContain('현재 조회 기준으로 PR 상태를 확인했어요');
    }
  });

  it('non-PR_CREATED states + status phrase → no status preview (CA 2)', async () => {
    for (const anchor of [prApprovedAnchor(), prReadyAnchor(), null]) {
      const { deps, calls } = makeDeps({ applyAnchor: anchor });
      await new ConversationRuntime(deps).handle(messageOf('PR 상태 확인해줘'));
      expect(calls.hostingGetStatus, String(anchor?.status)).toBe(0);
    }
  });

  it('PR_CREATED + merge/deploy/reviewer phrases are NOT status previews (CA 3/4/5); bare "상태" does not trigger (CA 6)', async () => {
    for (const text of ['merge 해줘', '배포해줘', '리뷰어 추가해줘', '상태 확인해줘']) {
      const { deps, calls } = makeDeps({ applyAnchor: PR_CREATED_ANCHOR() });
      await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.hostingGetStatus, text).toBe(0);
    }
  });

  it('status preview passes anchor.pullRequestRef (never a user-supplied PR number/URL) to the manager (CA 64–67)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: PR_CREATED_ANCHOR() });
    await new ConversationRuntime(deps).handle(messageOf('PR #999 상태 확인해줘 https://github.com/other/repo/pull/999'));
    expect(calls.hostingGetStatus).toBe(1);
    const input = calls.lastHostingStatusInput!;
    expect(input.pullRequestRef).toEqual({ provider: 'github', owner: 'acme', repo: 'widgets', pullRequestNumber: 42, pullRequestUrl: 'https://github.com/acme/widgets/pull/42' });
    expect(JSON.stringify(input)).not.toContain('999');
    expect(JSON.stringify(input)).not.toContain('other/repo');
    expect(input.expectedCommitHash).toBe(HEAD_SHA);
  });

  it('missing identity or manager (token) → not configured; no call, no state change (CA 10/11)', async () => {
    for (const opt of [{ hostingIdentity: null as null }, { hostingManager: null as null }]) {
      const { deps, calls } = makeDeps({ applyAnchor: PR_CREATED_ANCHOR(), ...opt });
      const r = await new ConversationRuntime(deps).handle(messageOf('PR 상태 확인해줘'));
      expect(calls.hostingGetStatus).toBe(0);
      expect(calls.applyAnchorSet).toBe(0);
      expect(r.reply.text).toBe(composer.composePrStatusNotConfigured(CTX).text);
    }
  });

  it('anchor missing pullRequestRef / repositoryIdentity, or identity mismatch → unavailable, no call (CA 12/13/14/15)', async () => {
    const cases = [
      PR_CREATED_ANCHOR({ pullRequestRef: undefined }),
      PR_CREATED_ANCHOR({ repositoryIdentity: undefined }),
      PR_CREATED_ANCHOR({ repositoryIdentity: { provider: 'github', owner: 'evil', repo: 'widgets' } }),
    ];
    for (const anchor of cases) {
      const { deps, calls } = makeDeps({ applyAnchor: anchor });
      const r = await new ConversationRuntime(deps).handle(messageOf('PR 상태 확인해줘'));
      expect(calls.hostingGetStatus).toBe(0);
      expect(r.reply.text).toBe(composer.composePrStatusUnavailable(CTX).text);
    }
  });

  it('read failure / stale result → "could not check current status" (never checks-failed/PR-not-created); keeps PR_CREATED (CA 8/54/81–84)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: PR_CREATED_ANCHOR(), hostingStatus: 'throw' });
    const r = await new ConversationRuntime(deps).handle(messageOf('PR 상태 확인해줘'));
    expect(calls.applyAnchorSet).toBe(0);
    expect(r.reply.text).toBe(composer.composePrStatusCheckFailed(CTX).text);
    expect(r.reply.text).toContain('확인하지 못했어요');
    expect(r.reply.text).not.toContain('만들지 않았'); // not "PR was not created"
    expect(r.reply.text).not.toMatch(/체크가\s*실패했어|checks failed/i); // no positive checks-failed claim
  });

  it('response is point-in-time + bounded; no safe-to-merge / CI-verified / raw data (CA 22–26/33–37)', async () => {
    const { deps } = makeDeps({ applyAnchor: PR_CREATED_ANCHOR() });
    const r = await new ConversationRuntime(deps).handle(messageOf('PR 상태 확인해줘'));
    const t = r.reply.text;
    expect(t).toContain('#42');
    expect(t).toContain('https://github.com/acme/widgets/pull/42');
    expect(t).toContain('지금 이 시점');
    expect(t).toContain('머지/배포/릴리즈는 하지 않았어요');
    expect(t).toContain('안전하게 머지해도 된다는 뜻은 아니에요');
    expect(t).not.toMatch(/영구|배포 준비|검증 완료|safe to merge|deploy ready/i);
  });

  it('empty check-runs renders "no checks", not success (CA 88/89); merged/closed reported but keeps PR_CREATED (CA 78/79)', async () => {
    const noChecks = makeDeps({
      applyAnchor: PR_CREATED_ANCHOR(),
      hostingStatus: prStatusOf({ identity: PR_IDENTITY, pullRequestRef: PR_CREATED_ANCHOR().pullRequestRef!, expectedHeadBranch: HEAD, expectedBaseBranch: BASE, expectedCommitHash: HEAD_SHA }, { checks: { state: 'unknown', totalCount: 0, successCount: 0, failureCount: 0, pendingCount: 0 } }),
    });
    const rc = await new ConversationRuntime(noChecks.deps).handle(messageOf('PR 상태 확인해줘'));
    expect(rc.reply.text).toContain('표시할 체크 결과가 없거나');
    expect(rc.reply.text).not.toMatch(/체크 통과|CI 성공/);
    for (const state of ['merged', 'closed'] as const) {
      const { deps, calls } = makeDeps({
        applyAnchor: PR_CREATED_ANCHOR(),
        hostingStatus: prStatusOf({ identity: PR_IDENTITY, pullRequestRef: PR_CREATED_ANCHOR().pullRequestRef!, expectedHeadBranch: HEAD, expectedBaseBranch: BASE, expectedCommitHash: HEAD_SHA }, { state }),
      });
      const r = await new ConversationRuntime(deps).handle(messageOf('PR 상태 확인해줘'));
      expect(calls.applyAnchorSet, state).toBe(0); // no PR_MERGED/PR_CLOSED, keep PR_CREATED
      // reported provider-state must not imply a deployment/release happened or is ready.
      expect(r.reply.text, state).not.toMatch(/배포했|배포\s*준비|deployed|deploy\s*ready|released|release\s*ready/i);
    }
  });

  it('status preview performs NO git/command/create side effects — only the read-only manager call (CA 38–49)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: PR_CREATED_ANCHOR() });
    await new ConversationRuntime(deps).handle(messageOf('PR 상태 확인해줘'));
    expect(calls.hostingGetStatus).toBe(1);
    expect(calls.hostingCreatePR).toBe(0);
    expect(calls.gitPush + calls.gitCommit + calls.gitStatus + calls.commandRun + calls.workspaceApply + calls.run).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Sprint 3f (ADR-0056): explicit PR merge APPROVAL gate (permission only; NO merge/GitHub write).
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  const MERGE_PENDING_ANCHOR = (o: Partial<ApplyPreviewAnchor> = {}): ApplyPreviewAnchor =>
    PR_CREATED_ANCHOR({ status: 'MERGE_APPROVAL_PENDING', mergeApprovalId: 'apply-appr-1', mergeApprovalRequestedAt: TS, ...o });
  const MERGE_APPROVED_ANCHOR = (o: Partial<ApplyPreviewAnchor> = {}): ApplyPreviewAnchor =>
    PR_CREATED_ANCHOR({ status: 'MERGE_APPROVED', mergeApprovalId: 'apply-appr-1', mergeApprovalRequestedAt: TS, mergeApprovedAt: TS, mergeApprovalDecisionBy: 'actor-1', ...o });

  it('PR_CREATED + explicit merge approval / merge phrase → MERGE_APPROVAL_PENDING, CRITICAL, no merge (CA 1/2)', async () => {
    for (const text of ['머지 승인해줘', 'PR 머지 승인 요청해줘', '이 PR 머지해도 되게 승인 요청해줘', 'approve merge', 'merge this PR', '머지해줘']) {
      const { deps, calls } = makeDeps({ applyAnchor: PR_CREATED_ANCHOR() });
      const r = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.requestForRisk, text).toBe(1);
      expect(calls.lastRequestForRiskInput?.riskLevel, text).toBe(RiskLevel.CRITICAL);
      expect(calls.lastApplyAnchor?.status, text).toBe('MERGE_APPROVAL_PENDING');
      expect(r.status, text).toBe('AWAITING_APPROVAL');
      expect(r.reply.text, text).toContain('아직 머지는 하지 않았어요');
    }
  });

  it('PR_CREATED + merge question / deploy / status / "진행해" / bare noun → no merge approval (CA 3/4/5/71)', async () => {
    for (const text of ['머지 가능해?', '머지해도 안전해?', '배포해줘', '릴리즈해줘', '진행해', '좋아', '승인']) {
      const { deps, calls } = makeDeps({ applyAnchor: PR_CREATED_ANCHOR() });
      await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.requestForRisk, text).toBe(0);
    }
    // "PR 상태 봐줘" → status preview, not merge approval (CA 4)
    const s = makeDeps({ applyAnchor: PR_CREATED_ANCHOR() });
    await new ConversationRuntime(s.deps).handle(messageOf('PR 상태 봐줘'));
    expect(s.calls.requestForRisk).toBe(0);
    expect(s.calls.hostingGetStatus).toBe(1);
  });

  // Merge STATUS/CHECK/INSPECTION phrases must NOT create MERGE_APPROVAL_PENDING even though "해줘" is a
  // request verb — the "해줘" must not turn an inquiry into an approval (CA 3f impl review, tests 82–85).
  it('PR_CREATED + merge status/check phrase → no merge approval, no MERGE_APPROVAL_PENDING (CA 82–85)', async () => {
    for (const text of ['머지 상태 확인해줘', 'merge status 확인해줘', '머지 확인해줘', '머지 체크해줘']) {
      const { deps, calls } = makeDeps({ applyAnchor: PR_CREATED_ANCHOR() });
      const r = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.requestForRisk, text).toBe(0);
      expect(calls.lastApplyAnchor?.status, text).not.toBe('MERGE_APPROVAL_PENDING');
      expect(r.reply.text, text).not.toContain('아직 머지는 하지 않았어요');
    }
  });

  it('non-PR_CREATED states + merge phrase → no merge approval (CA 6)', async () => {
    for (const anchor of [prApprovedAnchor(), prReadyAnchor(), null]) {
      const { deps, calls } = makeDeps({ applyAnchor: anchor });
      await new ConversationRuntime(deps).handle(messageOf('머지 승인해줘'));
      expect(calls.requestForRisk, String(anchor?.status)).toBe(0);
    }
  });

  it('reason: CRITICAL, deterministic, owner/repo/PR/head/base/commit + "no merge/deploy/release", "pr source", no secrets/safety (CA 13–25/65/76–80)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: PR_CREATED_ANCHOR() });
    await new ConversationRuntime(deps).handle(messageOf('머지 승인해줘'));
    const reason = calls.lastRequestForRiskInput!.reason;
    expect(calls.lastRequestForRiskInput!.executionPlanRef).toEqual({ id: 'plan-1', goal: 'g' });
    expect(reason).toContain('acme/widgets');
    expect(reason).toContain('#42');
    expect(reason).toContain('feature/login');
    expect(reason).toContain('main');
    expect(reason).toContain('no merge has been performed');
    expect(reason).toContain('pr source: created');
    expect(reason).not.toContain('merge creation');
    expect(reason).not.toMatch(/token|ghp_|raw diff|file content|check log|review body/i);
    // must not POSITIVELY claim checks/reviews/mergeability/safety; the required NEGATION line is present.
    expect(reason).not.toContain('checks passed');
    expect(reason).not.toContain('reviews approved');
    expect(reason).not.toMatch(/is mergeable|safe to merge\b/i);
    expect(reason).toContain('not guaranteed safe or mergeable by this approval');
  });

  it('MERGE_APPROVAL_PENDING intercepts approve/deny/cancel; merge/deploy/status phrases re-prompt (CA 7–12/72)', async () => {
    // approve (incl. "진행해")
    for (const text of ['승인', '진행해']) {
      const { deps, calls } = makeDeps({ applyAnchor: MERGE_PENDING_ANCHOR() });
      const r = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.decide, text).toBe(1);
      expect(calls.lastApplyAnchor?.status, text).toBe('MERGE_APPROVED');
      expect(r.status, text).toBe('RESPONDED');
    }
    for (const [text, expected] of [['거절', 'DENIED'], ['취소', 'CANCELLED']] as const) {
      const { deps, calls } = makeDeps({ applyAnchor: MERGE_PENDING_ANCHOR() });
      const r = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.decide, text).toBe(1);
      expect(calls.lastApplyAnchor?.status, text).toBe('PR_CREATED');
      expect(r.status, text).toBe(expected);
    }
    for (const text of ['머지해줘', '배포해줘', 'PR 상태 봐줘']) {
      const { deps, calls } = makeDeps({ applyAnchor: MERGE_PENDING_ANCHOR() });
      const r = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.decide, text).toBe(0); // ambiguous → re-prompt, no decide
      expect(calls.hostingGetStatus, text).toBe(0);
      expect(r.status, text).toBe('AWAITING_APPROVAL');
    }
  });

  it('MERGE_APPROVAL_PENDING preserves the chain + merge fields; approve → MERGE_APPROVED with decisionBy/approvedAt (CA 26–28/40–42/67)', async () => {
    const pend = MERGE_PENDING_ANCHOR();
    expect(pend.pullRequestRef).toBeTruthy();
    expect(pend.repositoryIdentity).toBeTruthy();
    expect(pend.mergeApprovalId).toBe('apply-appr-1');
    expect(pend.mergeApprovalRequestedAt).toBeTruthy();
    const { deps, calls } = makeDeps({ applyAnchor: MERGE_PENDING_ANCHOR() });
    await new ConversationRuntime(deps).handle(messageOf('승인'));
    const a = calls.lastApplyAnchor!;
    expect(a.status).toBe('MERGE_APPROVED');
    expect(a.mergeApprovedAt).toBeTruthy();
    expect(a.mergeApprovalDecisionBy).toBe('actor-1');
    expect(a.pullRequestRef).toBeTruthy();
    expect(a.repositoryIdentity).toBeTruthy();
    expect(a.pullRequestCommitHash).toBe(HEAD_SHA);
  });

  it('approval decision uses structured fields only (CA 35–39/69/70)', async () => {
    // unrelated reason text but matching structured fields → approves
    const ok = makeDeps({ applyAnchor: MERGE_PENDING_ANCHOR(), approvalsGetResult: { ...pendingApprovalOf(), id: 'apply-appr-1', reason: 'totally unrelated text' } });
    await new ConversationRuntime(ok.deps).handle(messageOf('승인'));
    expect(ok.calls.lastApplyAnchor?.status).toBe('MERGE_APPROVED');
    // plan mismatch (even if reason looks right) → no approve
    const bad = makeDeps({ applyAnchor: MERGE_PENDING_ANCHOR(), approvalsGetResult: { ...pendingApprovalOf(), id: 'apply-appr-1', executionPlanRef: { id: 'other', goal: 'g' } } });
    const r = await new ConversationRuntime(bad.deps).handle(messageOf('승인'));
    expect(bad.calls.lastApplyAnchor?.status).not.toBe('MERGE_APPROVED');
    expect(r.reply.text).toBe(composer.composeMergeApprovalUnavailable(CTX).text);
    // missing request → unavailable
    const missing = makeDeps({ applyAnchor: MERGE_PENDING_ANCHOR(), approvalsGetResult: null });
    await new ConversationRuntime(missing.deps).handle(messageOf('승인'));
    expect(missing.calls.lastApplyAnchor).toBeUndefined();
  });

  it('deny/cancel → PR_CREATED, clear ONLY merge fields, preserve PR/push/commit/workspace chain (CA 29–34/68)', async () => {
    for (const text of ['거절', '취소']) {
      const { deps, calls } = makeDeps({ applyAnchor: MERGE_PENDING_ANCHOR() });
      await new ConversationRuntime(deps).handle(messageOf(text));
      const a = calls.lastApplyAnchor!;
      expect(a.status, text).toBe('PR_CREATED');
      expect(a.mergeApprovalId, text).toBeUndefined();
      expect(a.mergeApprovalRequestedAt, text).toBeUndefined();
      expect(a.mergeApprovedAt, text).toBeUndefined();
      expect(a.mergeApprovalDecisionBy, text).toBeUndefined();
      expect(a.pullRequestRef, text).toBeTruthy(); // preserved
      expect(a.repositoryIdentity, text).toBeTruthy();
      expect(a.pushedCommitHash, text).toBe(HEAD_SHA);
      expect(a.committedFiles, text).toEqual([TARGET_FILE]);
    }
  });

  it('MERGE_APPROVED follow-ups: bare "머지" mention → already approved; deploy → future step; status → read-only preview keeps MERGE_APPROVED (CA 43–45/73–75/81; Sprint 3g supersedes: "머지해줘" now EXECUTES — tests 27–29)', async () => {
    // (Sprint 3g) a bare "머지" noun (no execution verb) stays a non-mutating already-approved reply; a direct
    // "머지해줘" command now executes merge (covered by the 3g execution tests). No re-anchor here.
    const merge = makeDeps({ applyAnchor: MERGE_APPROVED_ANCHOR() });
    const rm = await new ConversationRuntime(merge.deps).handle(messageOf('머지'));
    expect(merge.calls.requestForRisk).toBe(0);
    expect(merge.calls.applyAnchorSet).toBe(0); // no re-anchor
    expect(rm.reply.text).toBe(composer.composeMergeAlreadyApproved(CTX).text);
    expect(rm.reply.text).not.toMatch(/merged|deployed|released/i);

    const dep = makeDeps({ applyAnchor: MERGE_APPROVED_ANCHOR() });
    const rd = await new ConversationRuntime(dep.deps).handle(messageOf('배포해줘'));
    expect(rd.reply.text).toBe(composer.composeMergeApprovedCompanionUnsupported(CTX).text);

    const st = makeDeps({ applyAnchor: MERGE_APPROVED_ANCHOR() });
    const rs = await new ConversationRuntime(st.deps).handle(messageOf('PR 상태 확인해줘'));
    expect(st.calls.hostingGetStatus).toBe(1);
    expect(st.calls.applyAnchorSet).toBe(0); // keeps MERGE_APPROVED (no re-anchor)
    expect(rs.reply.text).toContain('머지 승인은 기록되어 있지만, 아직 머지는 하지 않았어요');
    expect(rs.reply.text).not.toMatch(/merged|병합했/i);
  });

  it('no mutation anywhere in the merge-approval flow (CA 46–62/66)', async () => {
    for (const [anchor, text] of [
      [PR_CREATED_ANCHOR(), '머지 승인해줘'],
      [MERGE_PENDING_ANCHOR(), '승인'],
      [MERGE_APPROVED_ANCHOR(), '머지'], // (Sprint 3g) bare mention stays non-mutating; "머지해줘" now executes (3g tests)
    ] as const) {
      const { deps, calls } = makeDeps({ applyAnchor: anchor });
      const r = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.hostingCreatePR, text).toBe(0);
      expect(calls.gitPush + calls.gitCommit + calls.gitStatus + calls.commandRun + calls.workspaceApply + calls.run, text).toBe(0);
      expect(r.reply.text, text).not.toMatch(/merged\b|병합했|deployed|배포했|released|릴리즈했|safe to merge|안전하게 머지|CI verified/i);
      expect(r.reply.text, text).not.toContain('merge creation');
    }
  });

  // ── Sprint 3g (ADR-0057): PR MERGE EXECUTION — actual merge from MERGE_APPROVED, live-preflight-guarded. ──
  const MERGE_MERGED_ANCHOR = (o: Partial<ApplyPreviewAnchor> = {}): ApplyPreviewAnchor =>
    MERGE_APPROVED_ANCHOR({ status: 'PR_MERGED', mergedAt: TS, mergeExecutedBy: 'actor-1', mergedHeadSha: HEAD_SHA, ...o });
  const APPROVED_MERGE = () => approvedPrRequest(); // id apply-appr-1, APPROVED, matching plan

  it('MERGE_APPROVED + direct merge command → merge execution preflight runs, anchors PR_MERGED (CA 27–29/1/18)', async () => {
    for (const text of ['머지해줘', '이 PR 머지해줘', 'merge this PR', '실제 머지해줘', '이제 머지 실행해줘', '승인된 PR 머지해줘', 'merge now', 'execute merge']) {
      const { deps, calls } = makeDeps({ applyAnchor: MERGE_APPROVED_ANCHOR(), approvalsGetResult: APPROVED_MERGE() });
      const r = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.hostingMergePR, text).toBe(1);
      expect(calls.lastHostingMergeInput?.expectedHeadSha, text).toBe(HEAD_SHA);
      expect(calls.lastApplyAnchor?.status, text).toBe('PR_MERGED');
      expect(r.reply.text, text).toContain('머지했어요');
    }
  });

  it('MERGE_APPROVED + bare "머지" → no execution, composeMergeAlreadyApproved (CA 30/4)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: MERGE_APPROVED_ANCHOR(), approvalsGetResult: APPROVED_MERGE() });
    const r = await new ConversationRuntime(deps).handle(messageOf('머지'));
    expect(calls.hostingMergePR).toBe(0);
    expect(calls.applyAnchorSet).toBe(0); // no re-anchor
    expect(r.reply.text).toBe(composer.composeMergeAlreadyApproved(CTX).text);
    expect(r.reply.text).not.toMatch(/merged\b|머지했|deployed|released/i);
  });

  it('MERGE_APPROVED + merge STATUS/CHECK phrase → read-only status path, no execution (CA 31/32)', async () => {
    for (const text of ['머지 상태 확인해줘', 'merge status 확인해줘', '머지 확인해줘', '머지 체크해줘', '머지 가능해?']) {
      const { deps, calls } = makeDeps({ applyAnchor: MERGE_APPROVED_ANCHOR(), approvalsGetResult: APPROVED_MERGE() });
      const r = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.hostingMergePR, text).toBe(0);
      expect(calls.hostingGetStatus, text).toBe(1);
      expect(calls.applyAnchorSet, text).toBe(0); // keeps MERGE_APPROVED (read-only)
      expect(r.reply.text, text).toContain('머지 승인은 기록되어 있지만, 아직 머지는 하지 않았어요');
    }
  });

  it('forbidden merge-execution triggers: PR_CREATED/PENDING/deploy never merge (CA 2/3/4)', async () => {
    // PR_CREATED + "머지해줘" → merge APPROVAL (3f), not execution
    const cr = makeDeps({ applyAnchor: PR_CREATED_ANCHOR() });
    await new ConversationRuntime(cr.deps).handle(messageOf('머지해줘'));
    expect(cr.calls.hostingMergePR).toBe(0);
    expect(cr.calls.requestForRisk).toBe(1); // records approval, does not merge
    // MERGE_APPROVAL_PENDING + "머지해줘" → re-prompt, no merge/decide
    const pend = makeDeps({ applyAnchor: MERGE_PENDING_ANCHOR() });
    const rp = await new ConversationRuntime(pend.deps).handle(messageOf('머지해줘'));
    expect(pend.calls.hostingMergePR).toBe(0);
    expect(pend.calls.decide).toBe(0);
    expect(rp.status).toBe('AWAITING_APPROVAL');
    // MERGE_APPROVED + "배포해줘"/"릴리즈해줘" → unsupported companion, no merge
    for (const text of ['배포해줘', '릴리즈해줘']) {
      const { deps, calls } = makeDeps({ applyAnchor: MERGE_APPROVED_ANCHOR(), approvalsGetResult: APPROVED_MERGE() });
      const r = await new ConversationRuntime(deps).handle(messageOf(text));
      expect(calls.hostingMergePR, text).toBe(0);
      expect(r.reply.text, text).not.toMatch(/머지했|merged\b/i);
    }
  });

  it('successful merge anchors PR_MERGED with mergedAt/mergeExecutedBy/mergedHeadSha, preserves chain + approval evidence (CA 18–20/39/40)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: MERGE_APPROVED_ANCHOR(), approvalsGetResult: APPROVED_MERGE() });
    const r = await new ConversationRuntime(deps).handle(messageOf('머지해줘'));
    const a = calls.lastApplyAnchor!;
    expect(a.status).toBe('PR_MERGED');
    expect(typeof a.mergedAt).toBe('string'); // runtime record timestamp (CA change 3)
    expect((a.mergedAt ?? '').length).toBeGreaterThan(0);
    expect(a.mergeExecutedBy).toBe('actor-1');
    expect(a.mergedHeadSha).toBe(HEAD_SHA);
    // full causal chain + 3f approval evidence preserved
    expect(a.pullRequestRef).toBeTruthy();
    expect(a.repositoryIdentity).toBeTruthy();
    expect(a.pullRequestCommitHash).toBe(HEAD_SHA);
    expect(a.mergeApprovalId).toBe('apply-appr-1');
    expect(a.mergeApprovedAt).toBeTruthy();
    expect(a.mergeApprovalDecisionBy).toBe('actor-1');
    // response says merged, explicitly NOT deploy/release
    expect(r.reply.text).toContain('머지했어요');
    expect(r.reply.text).toMatch(/배포\/릴리즈는 하지 않았어요|배포\/릴리즈/);
    expect(r.reply.text).not.toMatch(/deployed|released|배포했|릴리즈했|production/i);
  });

  it('live already merged (manager alreadyMerged=true) → PR_MERGED, already-merged response (CA 33)', async () => {
    const ref = PR_CREATED_ANCHOR().pullRequestRef!;
    const already: PullRequestMergeResult = {
      provider: 'github', owner: 'acme', repo: 'widgets',
      pullRequestNumber: ref.pullRequestNumber, pullRequestUrl: ref.pullRequestUrl,
      merged: true, mergedHeadSha: HEAD_SHA, alreadyMerged: true,
    };
    const { deps, calls } = makeDeps({ applyAnchor: MERGE_APPROVED_ANCHOR(), approvalsGetResult: APPROVED_MERGE(), hostingMerge: already });
    const r = await new ConversationRuntime(deps).handle(messageOf('머지해줘'));
    expect(calls.hostingMergePR).toBe(1);
    expect(calls.lastApplyAnchor?.status).toBe('PR_MERGED');
    expect(r.reply.text).toContain('이미 머지되어 있어요');
    expect(r.reply.text).not.toMatch(/deployed|released/i);
  });

  it('known pre-mutation Blocked → "not merged", stays MERGE_APPROVED (CA 22)', async () => {
    const { deps, calls } = makeDeps({ applyAnchor: MERGE_APPROVED_ANCHOR(), approvalsGetResult: APPROVED_MERGE(), hostingMerge: 'throw-blocked' });
    const r = await new ConversationRuntime(deps).handle(messageOf('머지해줘'));
    expect(calls.hostingMergePR).toBe(1);
    expect(calls.applyAnchorSet).toBe(0); // NOT anchored PR_MERGED
    expect(r.reply.text).toContain('머지하지 않았어요');
    expect(r.reply.text).not.toMatch(/머지했|merged\b/i);
  });

  it('unknown/generic failure after mutating call → UNVERIFIED, never "not merged", stays MERGE_APPROVED (CA 21)', async () => {
    for (const mode of ['throw-unverified', 'throw-generic'] as const) {
      const { deps, calls } = makeDeps({ applyAnchor: MERGE_APPROVED_ANCHOR(), approvalsGetResult: APPROVED_MERGE(), hostingMerge: mode });
      const r = await new ConversationRuntime(deps).handle(messageOf('머지해줘'));
      expect(calls.hostingMergePR, mode).toBe(1);
      expect(calls.applyAnchorSet, mode).toBe(0); // NOT PR_MERGED (unverified)
      expect(r.reply.text, mode).toContain('확인하지 못했어요');
      expect(r.reply.text, mode).not.toMatch(/머지하지 않았|not merged/i); // must NOT claim not merged
    }
  });

  it('missing/invalid approval evidence → Blocked before mutation, stays MERGE_APPROVED (CA 5/6/7/8)', async () => {
    for (const req of [null, { ...approvedPrRequest(), status: ApprovalStatus.PENDING }, { ...approvedPrRequest(), executionPlanRef: { id: 'other', goal: 'g' } }]) {
      const { deps, calls } = makeDeps({ applyAnchor: MERGE_APPROVED_ANCHOR(), approvalsGetResult: req });
      const r = await new ConversationRuntime(deps).handle(messageOf('머지해줘'));
      expect(calls.hostingMergePR).toBe(0);
      expect(calls.applyAnchorSet).toBe(0);
      expect(r.reply.text).toContain('머지하지 않았어요');
    }
    // missing mergeApprovalId on the anchor → Blocked
    const noId = makeDeps({ applyAnchor: MERGE_APPROVED_ANCHOR({ mergeApprovalId: undefined }), approvalsGetResult: APPROVED_MERGE() });
    await new ConversationRuntime(noId.deps).handle(messageOf('머지해줘'));
    expect(noId.calls.hostingMergePR).toBe(0);
  });

  it('not configured (no identity / no manager) → unavailable, no merge (CA 26 boundary)', async () => {
    for (const opt of [{ hostingIdentity: null as null }, { hostingManager: null as null }]) {
      const { deps, calls } = makeDeps({ applyAnchor: MERGE_APPROVED_ANCHOR(), approvalsGetResult: APPROVED_MERGE(), ...opt });
      const r = await new ConversationRuntime(deps).handle(messageOf('머지해줘'));
      expect(calls.hostingMergePR).toBe(0);
      expect(r.reply.text).toContain('설정되지 않았어요');
    }
    // resolved identity ≠ approved anchor identity → Blocked (never merges a different repo)
    const mism = makeDeps({ applyAnchor: MERGE_APPROVED_ANCHOR(), approvalsGetResult: APPROVED_MERGE(), hostingIdentity: { provider: 'github', owner: 'evil', repo: 'widgets' } });
    await new ConversationRuntime(mism.deps).handle(messageOf('머지해줘'));
    expect(mism.calls.hostingMergePR).toBe(0);
  });

  it('PR_MERGED terminal: merge phrase → already merged; status → read-only preview keeps PR_MERGED; deploy → companion (CA 36/37/38)', async () => {
    const m1 = makeDeps({ applyAnchor: MERGE_MERGED_ANCHOR() });
    const r1 = await new ConversationRuntime(m1.deps).handle(messageOf('머지해줘'));
    expect(m1.calls.hostingMergePR).toBe(0);
    expect(m1.calls.applyAnchorSet).toBe(0);
    expect(r1.reply.text).toContain('이미 머지되어 있어요');

    const m2 = makeDeps({ applyAnchor: MERGE_MERGED_ANCHOR() });
    const r2 = await new ConversationRuntime(m2.deps).handle(messageOf('PR 상태 확인해줘'));
    expect(m2.calls.hostingGetStatus).toBe(1);
    expect(m2.calls.applyAnchorSet).toBe(0); // keeps PR_MERGED
    expect(r2.reply.text).not.toMatch(/deployed|released/i);

    const m3 = makeDeps({ applyAnchor: MERGE_MERGED_ANCHOR() });
    const r3 = await new ConversationRuntime(m3.deps).handle(messageOf('배포해줘'));
    expect(m3.calls.hostingMergePR).toBe(0);
    expect(r3.reply.text).not.toMatch(/머지했|deployed|배포했|released/i);
  });

  it('merge execution touches NO Git/CommandExecution/workspace and never leaks a token (CA 23/24/25/26)', async () => {
    for (const mode of [undefined, 'throw-blocked', 'throw-unverified'] as const) {
      const { deps, calls } = makeDeps({ applyAnchor: MERGE_APPROVED_ANCHOR(), approvalsGetResult: APPROVED_MERGE(), hostingMerge: mode });
      const r = await new ConversationRuntime(deps).handle(messageOf('머지해줘'));
      expect(calls.gitPush + calls.gitCommit + calls.gitStatus + calls.commandRun + calls.workspaceApply + calls.run + calls.hostingCreatePR, String(mode)).toBe(0);
      // token never appears in the anchor or the response text
      expect(JSON.stringify(calls.lastApplyAnchor ?? {}), String(mode)).not.toMatch(/ghp_|github_pat_|token/i);
      expect(r.reply.text, String(mode)).not.toMatch(/ghp_|github_pat_/i);
    }
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
