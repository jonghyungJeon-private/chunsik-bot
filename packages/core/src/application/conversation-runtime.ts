import { describeAiFailure } from './ai-failure';
import {
  ApprovalStatus,
  Capability,
  CodeGenerationStatus,
  CommandExecutionStatus,
  IntentType,
  RiskLevel,
  TaskStatus,
  approvalRef,
  codeGenerationRef,
  codeProposalRef,
  patchRef,
} from '../domain';
import type {
  Actor,
  ApprovalDecision,
  ApprovalRequest,
  Artifact,
  CodeGeneration,
  CodeGenerationRef,
  CodeProposal,
  CodeProposalRef,
  CommandExecution,
  ContextBundle,
  ConversationContext,
  ExecutionPlanRef,
  GenerateCodeInput,
  Id,
  InboundMessage,
  Intent,
  IsoTimestamp,
  OutboundMessage,
  PatchGenerationInput,
  PatchRef,
  PatchSet,
  Project,
  PromptSpec,
  ProposedChange,
  Session,
  Task,
  TaskRun,
  WorkspaceDiff,
  WorkspaceRef,
} from '../domain';
import type { AiProvider, AiRequest, Logger, ProjectReadout } from '../ports';
import { now } from '../util/clock';
import type {
  ResponseComposer,
  CodeChangePreview,
  CodeDiffPreview,
  ExecutionReplyStatus,
  PatchSetPreview,
  TestResultDetail,
} from './response-composer';
import type { IntentResolutionContext } from './intent-resolver';
import { extractTargetPathCandidates, normalizeRelativePath } from './target-scope';
import type {
  CancelToken,
  ExecutionOutcome,
  ExecutionOutcomeStatus,
  ExecutionRequest,
} from './execution-orchestrator';

/**
 * Conversation Runtime (Sprint 2k, ADR-0032) — 춘식봇's conversation entry point. It turns one user
 * message into one natural assistant response by **composing** existing Application/Capability
 * services. It is NOT a new execution engine, NOT a Capability, NOT a new Aggregate.
 *
 * Invariants (ADR-0032): the runtime persists NO runtime state; approval-awaiting state is DERIVED
 * from existing Session/Task/ExecutionPlan/ApprovalRequest state (via the injected `approvalFlow`);
 * Session stores NO runtime snapshot. The runtime's essential output is an `OutboundMessage` — the
 * `ChunsikCore` facade performs platform delivery. Reply text is built only by `ResponseComposer`.
 */

/** Transient per-turn status — an Application-layer concept, never persisted. */
export type RuntimeTurnStatus = 'RESPONDED' | 'AWAITING_APPROVAL' | 'DENIED' | 'FAILED' | 'CANCELLED';

/** Transient result of handling one message. NOT an aggregate; never persisted. */
export interface TurnResult {
  status: RuntimeTurnStatus;
  reply: OutboundMessage;
  sessionId: Id;
  executionOutcome?: ExecutionOutcome;
}

/** How the runtime interprets a user message while a pending approval exists (ADR-0032 §6). */
export type ApprovalDecisionKind = 'approve' | 'deny' | 'cancel' | 'ambiguous';

/**
 * Cross-turn approval mechanics, confined behind one collaborator so the runtime stays stateless and
 * the correlation source is wired once (ADR-0032: `Session.activeTaskId → Task.planId →
 * approvals.findByExecutionPlan → PENDING`). `decide`/`resume` themselves stay with `ApprovalManager`
 * / `ExecutionOrchestrator`; this only finds/anchors/reconstructs.
 */
export interface ApprovalFlow {
  /** Derive the session's PENDING approval, if any, from existing aggregates. */
  findPending(session: Session): Promise<ApprovalRequest | null>;
  /**
   * Anchor an awaiting-approval execution to the session's in-focus Task (existing fields only), so
   * a later turn can find + resume it. Persists what {@link reconstructResume} needs.
   */
  anchor(session: Session, request: ExecutionRequest, outcome: ExecutionOutcome): Promise<void>;
  /** Reconstruct the `{request, prior}` needed to resume, from anchored/derived state (null if unavailable). */
  reconstructResume(
    session: Session,
    approval: ApprovalRequest,
  ): Promise<{ request: ExecutionRequest; prior: ExecutionOutcome } | null>;
}

/**
 * Minimal, non-secret facts needed to recover a code-change request on the next turn (Sprint 2p,
 * ADR-0037). Never the generated code, a patch, a diff, or provider output — there is none yet.
 *
 * `kind` here is an ANCHOR DISCRIMINATOR, not the classifier's intent tag — deliberately named and
 * typed differently from `rawKind` below so the two are never confused.
 */
export interface PendingScopeClarification {
  /** Proves this Task's metadata is a scope-clarification anchor, not merely a plan-less Task for
   *  some unrelated reason (`!task.planId` alone is too implicit). */
  kind: 'code-scope-clarification';
  /** The original intent's restated summary — becomes the recovered request's goal/instruction. Must
   *  be the FIRST message's summary, never overwritten by the follow-up reply's text. */
  summary: string;
  /** The classifier's raw.kind tag ('fix' | 'change' | 'refactor'), if present. Named `rawKind` — not
   *  `kind` — specifically to avoid colliding with the discriminator above. */
  rawKind?: string;
  /** The active project at anchor time — re-checked at recovery time. */
  projectId?: Id;
  /** Stored for observability/future policy only — NOT consulted for expiration in Sprint 2p. The
   *  invalidation rule is next-turn-only consumption, not a TTL. */
  createdAt: IsoTimestamp;
}

/**
 * Cross-turn scope-clarification mechanics (ADR-0037), confined behind one collaborator exactly
 * like ApprovalFlow — so the runtime stays stateless and the correlation source is wired once.
 */
export interface ScopeClarificationFlow {
  /** Derive the session's pending clarification, if any and still valid (project unchanged). */
  findPending(session: Session): Promise<PendingScopeClarification | null>;
  /** Anchor a fresh insufficient-scope request so the next turn can recover it. Callers must only
   *  invoke this after confirming an active project exists, the workspace opened successfully, and
   *  no target validated. */
  anchor(session: Session, pending: PendingScopeClarification): Promise<void>;
  /** Consume/clear the anchor — called unconditionally once a pending clarification is checked
   *  (next-turn-only semantics). Safe: a no-op unless `session.activeTaskId` still points at THIS
   *  flow's own anchor Task — it must never clear an approval anchor. */
  clear(session: Session): Promise<void>;
}

/**
 * The states one apply-preview anchor moves through (Sprint 2s, ADR-0040; Sprint 2t, ADR-0041). Never
 * regresses; deny/cancel clears the anchor entirely instead of introducing a "rejected" state.
 *
 * `PATCH_READY` (Sprint 2t) means: a PatchSet **representation** has been generated and stored (a
 * `patchRef` is available). It does NOT mean the patch was applied — no workspace file was modified, no
 * command was executed, no git operation happened.
 */
export type ApplyPreviewAnchorStatus = 'ELIGIBLE' | 'AWAITING_APPROVAL' | 'APPROVED' | 'PATCH_READY';

/**
 * Anchored fact set for "a diff preview was shown; the user may explicitly ask to apply it" (Sprint 2s,
 * ADR-0040). `kind` proves this Task's metadata is an apply-preview anchor, never an approval anchor
 * (`planId` present) or a scope-clarification anchor (different discriminator) — mirrors
 * PendingScopeClarification's pattern exactly.
 */
export interface ApplyPreviewAnchor {
  kind: 'code-preview-apply';
  status: ApplyPreviewAnchorStatus;
  executionPlanRef: ExecutionPlanRef;
  workspaceRef: WorkspaceRef;
  targetFiles: string[];
  codeGenerationRef: CodeGenerationRef;
  codeProposalRef: CodeProposalRef;
  /** The original request's instruction — restated in the apply-approval's `reason`, never re-derived
   *  from chat history. */
  instruction: string;
  /** The active project at anchor time — re-checked at recovery time (mirrors Sprint 2p's Q5 pattern). */
  projectId?: Id;
  createdAt: IsoTimestamp;
  /** Set once `status` moves to `AWAITING_APPROVAL` or beyond; absent while `ELIGIBLE`. */
  approvalId?: Id;
  /** Set once `status` becomes `APPROVED`. */
  approvedAt?: IsoTimestamp;
  /** Set once `status` becomes `PATCH_READY` (Sprint 2t, ADR-0041) — the generated PatchSet's ref,
   *  preserved for Sprint 2u. Its presence makes a repeated patch command idempotent. A PatchSet
   *  representation existing does NOT mean it was applied — no file/command/git mutation occurred. */
  patchRef?: PatchRef;
}

/**
 * Cross-turn apply-preview mechanics (Sprint 2s, ADR-0040), confined behind one collaborator exactly
 * like ApprovalFlow/ScopeClarificationFlow — so the runtime stays stateless and the correlation source
 * is wired once.
 */
export interface ApplyPreviewFlow {
  /** Derive the session's apply-preview anchor, if any and still valid (project unchanged). A returned
   *  anchor is not always "pending" anything — it may be `ELIGIBLE` or already `APPROVED`; callers
   *  branch on `.status`. */
  findAnchor(session: Session): Promise<ApplyPreviewAnchor | null>;
  /** Anchor (or re-anchor, on every status transition) the apply-preview fact set. Always creates a
   *  fresh Task and re-points `session.activeTaskId` — same shape as the other two flows. */
  anchor(session: Session, anchor: ApplyPreviewAnchor): Promise<void>;
  /** Consume/clear the anchor — called only on deny/cancel (approving re-anchors as `APPROVED` instead).
   *  A no-op unless `session.activeTaskId` still points at THIS flow's own anchor Task. */
  clear(session: Session): Promise<void>;
}

export interface ConversationRuntimeDeps {
  readonly actors: { resolveFromContext(context: ConversationContext): Promise<Actor> };
  readonly sessions: {
    openForContext(context: ConversationContext, actorId: Id): Promise<Session>;
    touch(session: Session): Promise<Session>;
  };
  readonly memory: {
    recordShortTerm(message: InboundMessage, sessionId?: Id): Promise<{ id: Id }>;
    recordAssistant(text: string, context: ConversationContext, sessionId?: Id): Promise<unknown>;
    recordToolMemory(text: string, opts: { projectId?: Id; sessionId?: Id }): Promise<unknown>;
  };
  readonly classifier: { classify(message: InboundMessage): Promise<Intent> };
  readonly projects: {
    register(path: string, session: Session): Promise<{ ok: boolean; message: string; project?: { id: Id } }>;
    get(id: Id): Promise<Project | null>;
  };
  readonly analyzer: {
    prepare(session: Session): Promise<{ ready: boolean; message?: string; readout?: ProjectReadout }>;
  };
  readonly tasks: {
    createTask(
      intent: Intent,
      context: ConversationContext,
      anchor: { actorId: Id; sessionId: Id; projectId?: Id },
    ): Promise<Task>;
    transition(task: Task, to: TaskStatus): Promise<Task>;
    startRun(task: Task, capability: Capability): Promise<TaskRun>;
    completeRun(run: TaskRun, opts: { artifactIds: Id[]; providerId?: string }): Promise<unknown>;
    failRun(run: TaskRun, summary: string, opts: { providerId?: string }): Promise<unknown>;
  };
  readonly workspace: {
    prepare(task: Task): Promise<WorkspaceRef | undefined>;
    open(project: { id: Id; rootPath: string }): Promise<WorkspaceRef>;
    /** Reused for target-scope validation (Sprint 2o, ADR-0036) — not a new port/capability. */
    list(ref: WorkspaceRef, glob?: string): Promise<string[]>;
    /** Reused for post-approval diff preview (Sprint 2r, ADR-0039) — not a new port/capability; the
     *  same read-only WorkspaceManager.diff() ExecutionOrchestrator's WORKSPACE_DIFF stage uses. */
    diff(ref: WorkspaceRef, changes: ProposedChange[]): Promise<WorkspaceDiff>;
  };
  readonly commandExecutions: { get(id: Id): Promise<CommandExecution | null> };
  readonly contextBuilder: { build(task: Task, excludeMemoryIds: Id[]): Promise<ContextBundle> };
  readonly promptComposer: { compose(task: Task, bundle: ContextBundle, readout?: ProjectReadout): PromptSpec };
  readonly promptRenderer: {
    render(spec: PromptSpec, opts: { capability: Capability; workspace?: WorkspaceRef }): AiRequest;
  };
  readonly router: { select(capability: Capability): Promise<AiProvider> };
  readonly artifacts: { persistAll(taskId: Id, runId: Id, artifacts: Artifact[]): Promise<Id[]> };
  readonly composer: ResponseComposer;
  readonly risk: { requiresApproval(level: RiskLevel): boolean };
  readonly intentResolver: {
    resolve(intent: Intent, context: IntentResolutionContext): ExecutionRequest | null;
    isExecution(intent: Intent): boolean;
  };
  readonly orchestrator: {
    run(request: ExecutionRequest, cancelToken?: CancelToken): Promise<ExecutionOutcome>;
    resume(request: ExecutionRequest, prior: ExecutionOutcome, cancelToken?: CancelToken): Promise<ExecutionOutcome>;
  };
  readonly approvals: {
    decide(approvalId: Id, decision: ApprovalDecision): Promise<ApprovalRequest>;
    /** Reused for the ambiguous-retry prompt on the apply gate (Sprint 2s) — a type-only widening, not
     *  a new method (`ApprovalManager.get` already exists). */
    get(approvalId: Id): Promise<ApprovalRequest | null>;
    /** Reused for the second (apply) approval (Sprint 2s, ADR-0040) — not a new capability/port; the
     *  same already-registered ApprovalManager instance already implements this. */
    requestForRisk(input: {
      executionPlanRef: ExecutionPlanRef;
      riskLevel: RiskLevel;
      reason: string;
      requestedBy: string;
    }): Promise<ApprovalRequest>;
  };
  readonly approvalFlow: ApprovalFlow;
  readonly scopeClarificationFlow: ScopeClarificationFlow;
  readonly applyPreviewFlow: ApplyPreviewFlow;
  /** Reused for post-approval preview generation (Sprint 2q, ADR-0038) — not a new capability/port. */
  readonly codeGeneration: {
    generate(input: GenerateCodeInput): Promise<CodeGeneration>;
    getProposal(generation: CodeGeneration): Promise<CodeProposal | null>;
  };
  /** Reused for PatchSet generation (Sprint 2t, ADR-0041) — the same already-registered PatchManager
   *  ExecutionOrchestrator already depends on. Representation-only (CAP-005); never applies. */
  readonly patch: { generate(input: PatchGenerationInput): Promise<PatchSet> };
  /** Read-only load of the approved CodeProposal by ref (Sprint 2t) — backed by storage.codeProposals,
   *  already in the runtime factory's scope. Not a new port. */
  readonly codeProposals: { get(id: Id): Promise<CodeProposal | null> };
  readonly logger: Logger;
}

const APPROVE_WORDS = ['승인', '진행', '좋아', 'yes', 'y', 'ok'];
const DENY_WORDS = ['거절', '아니', 'no', 'n'];
const CANCEL_WORDS = ['취소', '중단', '그만'];

/** Explicit apply-only phrases (Sprint 2s, ADR-0040) — "좋아"/"오케이"/"확인"/"괜찮네" must NEVER match;
 *  those stay in APPROVE_WORDS for the ordinary approval flow but are insufficient to authorize file
 *  modification. "이대로 진행" (multi-word) is deliberately distinct from APPROVE_WORDS' bare "진행" —
 *  the two word-sets are non-overlapping by construction, not by coincidence. */
const APPLY_WORDS = ['적용', '반영', '이대로 진행'];

/** Explicit patch phrases (Sprint 2t, ADR-0041) — distinct from APPROVE_WORDS and APPLY_WORDS. CA Round 1
 *  Required Change #2: the ambiguous standalone "계속 진행" is deliberately excluded — a bare "continue"
 *  intent must never be auto-read as PatchSet generation. Every entry is an explicit patch-generation
 *  phrase; "다음 단계 진행" is the full multi-word form (never bare "다음 단계"); "좋아"/"오케이"/"확인"
 *  never match. Combined with routing (generation only on an APPROVED anchor), this enforces:
 *  explicit patch phrase + APPROVED anchor ⇒ generation; a bare "계속 진행" ⇒ never generation. */
const PATCH_WORDS = [
  '패치 만들어',
  '패치 생성',
  '패치로 만들어',
  'patch 만들어',
  'generate patch',
  'patchset 만들어',
  '다음 단계 진행',
];

/** Bound on how many extracted target-path candidates trigger a workspace.list call per turn
 *  (Sprint 2o, ADR-0036) — a chat message must never drive an unbounded number of workspace scans. */
const MAX_TARGET_CANDIDATES = 5;

/** Map an Execution Orchestrator outcome status to the ResponseComposer reply status. */
function toReplyStatus(status: ExecutionOutcomeStatus): ExecutionReplyStatus {
  return status as unknown as ExecutionReplyStatus; // identical string values (ADR-0032)
}

/**
 * Split a proposal into in-scope changes (path normalizes to a validated targetFiles entry) and
 * everything else, reported as a warning and never read/rendered as content (AI Code Generation
 * Preview, ADR-0038; Unified Diff Preview, ADR-0039). AI-proposed paths are untrusted; targetFiles is
 * the authoritative scope. Exported (not a private class method) so it is directly unit-testable,
 * matching `target-scope.ts`'s pattern.
 *
 * Preserves each in-scope `ProposedChange`'s `delete`/`newContent` shape exactly as given — spreads
 * `change` and overrides only `path`, never reconstructing a new object that could default a field the
 * AI's proposal didn't carry (Sprint 2r, ADR-0039, CA Round 1 Required Change #6).
 */
export function filterInScopeChanges(
  proposal: ProposedChange[],
  targetFiles: string[],
): { inScope: ProposedChange[]; outOfScopeWarnings: string[] } {
  const normalizedTargets = new Map(targetFiles.map((p) => [normalizeRelativePath(p), p]));
  const inScope: ProposedChange[] = [];
  const outOfScopeWarnings: string[] = [];
  for (const change of proposal) {
    const validatedPath = normalizedTargets.get(normalizeRelativePath(change.path));
    if (!validatedPath) {
      outOfScopeWarnings.push(change.path);
      continue;
    }
    inScope.push({ ...change, path: validatedPath }); // validated value, never the AI's raw path
  }
  return { inScope, outOfScopeWarnings };
}

/** Sprint 2q's original filtering + text-excerpt shaping (ADR-0038) — now a thin wrapper over
 *  {@link filterInScopeChanges}. Signature/behavior unchanged; retained for compatibility (ADR-0039). */
export function toCodeChangePreview(proposal: ProposedChange[], targetFiles: string[]): CodeChangePreview {
  const { inScope, outOfScopeWarnings } = filterInScopeChanges(proposal, targetFiles);
  const changes: CodeChangePreview['changes'] = inScope.map((c) => ({
    path: c.path,
    kind: c.delete ? 'delete' : 'update',
    ...(c.delete ? {} : { excerpt: c.newContent }),
  }));
  return { changes, outOfScopeWarnings };
}

/**
 * Shape an already-guarded `WorkspaceManager.diff()` result into the composer-facing DTO (Sprint 2r,
 * ADR-0039). Pure data reshaping — no bounding/truncation-notice text here; `ResponseComposer` owns
 * that (ADR-0032). Callers must have already rejected an empty `diff.files` and any `changeKind: 'add'`
 * entry before calling this (see `runCodeGenerationPreview`).
 */
export function toCodeDiffPreview(diff: WorkspaceDiff, outOfScopeWarnings: string[]): CodeDiffPreview {
  const changes: CodeDiffPreview['changes'] = diff.files.map((f) => ({
    path: f.path, // already the validated targetFiles value passed into workspace.diff
    kind: f.changeKind === 'delete' ? 'delete' : 'update', // 'modify' -> 'update' ('add' rejected earlier)
    unified: f.unified, // '' when binary or size-skipped by the provider
    binary: f.binary,
  }));
  return { changes, outOfScopeWarnings };
}

export class ConversationRuntime {
  constructor(private readonly deps: ConversationRuntimeDeps) {}

  /** Capabilities that operate on files need a resolved workspace; chat does not. */
  private static needsWorkspace(capability: Capability): boolean {
    return capability === Capability.CODE_IMPLEMENTATION || capability === Capability.TEST_EXECUTION;
  }

  /** Interpret a user message as an approval decision (only meaningful while a pending approval exists). */
  static interpretDecision(text: string): ApprovalDecisionKind {
    const t = text.trim().toLowerCase();
    const has = (words: string[]): boolean => words.some((w) => t === w || t.includes(w));
    // cancel takes precedence over deny ("중단" etc. are unambiguous abandons)
    if (has(CANCEL_WORDS)) return 'cancel';
    if (has(APPROVE_WORDS) && !has(DENY_WORDS)) return 'approve';
    if (has(DENY_WORDS) && !has(APPROVE_WORDS)) return 'deny';
    return 'ambiguous';
  }

  /** Explicit apply intent only (Sprint 2s, ADR-0040) — deliberately NOT interpretDecision/APPROVE_WORDS;
   *  "좋아"/"오케이"/"확인"/"괜찮네" must never authorize file modification (Critical Product Rule). */
  static interpretApplyIntent(text: string): boolean {
    const t = text.trim().toLowerCase();
    return APPLY_WORDS.some((w) => t.includes(w));
  }

  /** Explicit patch-generation intent only (Sprint 2t, ADR-0041) — the ambiguous standalone "계속 진행"
   *  is excluded; combined with routing, generation only fires on an APPROVED anchor. */
  static interpretPatchIntent(text: string): boolean {
    const t = text.trim().toLowerCase();
    return PATCH_WORDS.some((w) => t.includes(w));
  }

  /**
   * Handle one inbound message → one transient `TurnResult` (with an `OutboundMessage`). Never sends
   * to the platform (delivery is the facade's job) and never persists runtime state.
   */
  async handle(message: InboundMessage): Promise<TurnResult> {
    const actor = await this.deps.actors.resolveFromContext(message.context);
    const session = await this.deps.sessions.openForContext(message.context, actor.id);
    await this.deps.sessions.touch(session);
    const userMemory = await this.deps.memory.recordShortTerm(message, session.id);

    // (A) Approval-decision routing — ONLY when a pending approval is derived for this session.
    const pending = await this.deps.approvalFlow.findPending(session);
    if (pending) {
      return this.handleApprovalTurn(message, session, actor, pending);
    }

    // (A2) Scope-clarification routing (ADR-0037) — checked BEFORE classification so a bare
    // file-path reply doesn't need to re-trigger the classifier's fix/change/refactor keywords.
    // Ordering is load-bearing: approvalFlow is checked first, so an approval-anchored session
    // (planId present) is never routed here.
    const pendingScope = await this.deps.scopeClarificationFlow.findPending(session);
    if (pendingScope) {
      return this.handleScopeClarificationTurn(message, session, actor, pendingScope);
    }

    // (A3) Apply-preview routing (Sprint 2s, ADR-0040) — checked after approvalFlow/scopeClarificationFlow
    // so neither is ever pre-empted.
    const applyAnchor = await this.deps.applyPreviewFlow.findAnchor(session);
    // A real second ApprovalRequest is pending decision — intercepts EVERY turn, exactly like the first
    // approval does, regardless of whether the message is an apply phrase.
    if (applyAnchor?.status === 'AWAITING_APPROVAL') {
      return this.handleApplyApprovalTurn(message, session, actor, applyAnchor);
    }
    // (Sprint 2t, ADR-0041) Explicit patch command → PatchSet representation. Checked before apply-intent;
    // PATCH_WORDS and APPLY_WORDS are non-overlapping, and patch is the later product step. Generation
    // only ever fires on an APPROVED anchor.
    if (ConversationRuntime.interpretPatchIntent(message.text)) {
      if (applyAnchor?.status === 'APPROVED') {
        return this.handlePatchGenerationTurn(message, session, applyAnchor);
      }
      if (applyAnchor?.status === 'PATCH_READY') {
        return this.handlePatchAlreadyGeneratedTurn(message, session); // don't regenerate
      }
      // patch command with no APPROVED/PATCH_READY anchor (none / ELIGIBLE) — never falls through to a
      // new code-change request, mirroring the apply-unavailable handling.
      return this.handlePatchUnavailableTurn(message, session);
    }
    if (ConversationRuntime.interpretApplyIntent(message.text)) {
      if (applyAnchor?.status === 'ELIGIBLE') {
        return this.handleApplyIntentTurn(message, session, actor, applyAnchor); // creates approval #2
      }
      if (applyAnchor?.status === 'APPROVED' || applyAnchor?.status === 'PATCH_READY') {
        return this.handleApplyAlreadyApprovedTurn(message, session); // don't re-ask, don't re-approve
      }
      // No anchor at all (or a stale one, already auto-cleared by findAnchor). An explicit apply phrase
      // must NEVER be reinterpreted as a new, unscoped code-change request (CA review).
      return this.handleApplyPreviewUnavailableTurn(message, session);
    }
    // Anything else: fall through untouched — an ELIGIBLE/APPROVED/PATCH_READY anchor is an optional
    // follow-up opportunity, never a hard gate ordinary conversation must route around.

    const intent = await this.deps.classifier.classify(message);
    this.deps.logger.info('intent classified', {
      capability: intent.capability,
      requiresWork: intent.requiresWork,
    });

    // (B) Project registration — deterministic command (ADR-0018).
    if (intent.type === IntentType.REGISTER_PROJECT) {
      const path = typeof intent.raw?.path === 'string' ? intent.raw.path : '';
      const result = await this.deps.projects.register(path, session);
      await this.deps.memory.recordAssistant(result.message, message.context, session.id);
      return this.responded(session, { context: message.context, text: result.message });
    }

    // (C) Execution intent → resolve workspace (if needed) → Intent Resolver → Execution Orchestrator.
    if (this.deps.intentResolver.isExecution(intent)) {
      return this.handleExecutionIntent(message, session, actor, intent);
    }

    // (D) Gated project analysis (ADR-0019) — gather a read-only readout to feed the prompt.
    let readout: ProjectReadout | undefined;
    if (intent.capability === Capability.PROJECT_ANALYSIS) {
      const prep = await this.deps.analyzer.prepare(session);
      if (!prep.ready) {
        const text = prep.message ?? '프로젝트 분석을 진행할 수 없어요.';
        await this.deps.memory.recordAssistant(text, message.context, session.id);
        return this.responded(session, { context: message.context, text });
      }
      readout = prep.readout;
    }

    // (E) Fast path — conversational, no Task needed.
    if (!intent.requiresWork) {
      const provider = await this.deps.router.select(intent.capability);
      const result = await provider.execute({ capability: intent.capability, prompt: message.text });
      const reply = this.deps.composer.compose(message.context, result, result.artifacts ?? []);
      await this.deps.memory.recordAssistant(result.text, message.context, session.id);
      return this.responded(session, reply);
    }

    // (F) Work path — a chat/analysis Task (existing single-capability flow, relocated).
    return this.handleWorkTurn(message, session, actor, intent, userMemory.id, readout);
  }

  /** (A) A turn that lands while an approval is pending: interpret + route (ADR-0032 §6). */
  private async handleApprovalTurn(
    message: InboundMessage,
    session: Session,
    actor: Actor,
    pending: ApprovalRequest,
  ): Promise<TurnResult> {
    const decision = ConversationRuntime.interpretDecision(message.text);
    this.deps.logger.info('approval decision interpreted', { approvalId: pending.id, decision });

    if (decision === 'ambiguous') {
      const reply = this.deps.composer.composeApprovalNotice(message.context, pending);
      await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
      return { status: 'AWAITING_APPROVAL', reply, sessionId: session.id }; // no resume
    }

    if (decision === 'approve') {
      // Reconstruct FIRST — never record a decision we cannot act on (CA review). Only once the
      // halted execution is recoverable do we decide + resume.
      const ctx = await this.deps.approvalFlow.reconstructResume(session, pending);
      if (!ctx) {
        // Can't reconstruct — fail safe: re-ask, and do NOT call ApprovalManager.decide.
        const reply = this.deps.composer.composeApprovalNotice(message.context, pending);
        await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
        return { status: 'AWAITING_APPROVAL', reply, sessionId: session.id };
      }
      await this.deps.approvals.decide(pending.id, this.decisionOf(pending.id, actor.id, true));
      const outcome = await this.deps.orchestrator.resume(ctx.request, ctx.prior);
      // ADR-0038: a cleanly-resumed planningOnly request now runs an AI CodeGeneration preview
      // (never Patch/WorkspaceWrite/CommandExecution). A resume outcome that did NOT complete cleanly
      // (rare — e.g. the approval re-fetch failed) falls back to the existing generic handling.
      if (ctx.request.planningOnly) {
        if (outcome.status !== ('COMPLETED' as ExecutionOutcomeStatus)) {
          return this.replyForOutcome(message.context, session, outcome);
        }
        return this.runCodeGenerationPreview(message, session, ctx.request, outcome);
      }
      return this.replyForOutcome(message.context, session, outcome);
    }

    // deny / cancel — record the (rejecting) decision; never resume.
    await this.deps.approvals.decide(pending.id, this.decisionOf(pending.id, actor.id, false));
    const status: RuntimeTurnStatus = decision === 'deny' ? 'DENIED' : 'CANCELLED';
    const replyStatus: ExecutionReplyStatus = decision === 'deny' ? 'DENIED' : 'CANCELLED';
    const reply = this.deps.composer.composeExecutionResult(message.context, replyStatus);
    await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
    return { status, reply, sessionId: session.id };
  }

  /**
   * After a planningOnly CODE_IMPLEMENTATION approval resumes cleanly, run AI Code Generation once,
   * in preview mode, and render the result as a unified diff against the current workspace content
   * (ADR-0038, ADR-0039). Never calls ExecutionOrchestrator, Patch, WorkspaceWrite, or
   * CommandExecution — this method's only side effects are at most one CodeGenerationManager.generate()
   * call (CAP-008) and at most one WorkspaceManager.diff() call (CAP-001) — both read-only, neither
   * ever touches the filesystem.
   *
   * executionPlanRef, workspaceRef, and a non-empty targetFiles must ALL be present before
   * generate() is ever called — targetFiles is the only allowed scope source; there is no AI
   * target-file guessing. An empty diff result or a changeKind of 'add' for a validated target (its
   * current content could not be found/read at diff time) is a failed preview, never a partial or
   * degraded success (ADR-0039, CA Round 1).
   */
  private async runCodeGenerationPreview(
    message: InboundMessage,
    session: Session,
    request: ExecutionRequest,
    outcome: ExecutionOutcome,
  ): Promise<TurnResult> {
    const planRef = outcome.refs.executionPlanRef;
    const targetFiles = request.targetFiles;
    if (!planRef || !request.workspaceRef || !targetFiles?.length) {
      return this.failComposed(
        message, session, this.deps.composer.composeCodeGenerationPreviewFailed(message.context), outcome,
      );
    }

    let generation: CodeGeneration;
    try {
      generation = await this.deps.codeGeneration.generate({
        executionPlanRef: planRef,
        capability: Capability.CODE_IMPLEMENTATION,
        instruction: request.instruction,
        workspaceRef: request.workspaceRef,
        targetFiles,
      });
    } catch {
      return this.failComposed(
        message, session, this.deps.composer.composeCodeGenerationPreviewFailed(message.context), outcome,
      );
    }
    if (generation.status !== CodeGenerationStatus.SUCCEEDED) {
      return this.failComposed(
        message, session, this.deps.composer.composeCodeGenerationPreviewFailed(message.context), outcome,
      );
    }

    const proposal = await this.deps.codeGeneration.getProposal(generation);
    if (!proposal) {
      return this.failComposed(
        message, session, this.deps.composer.composeCodeGenerationPreviewFailed(message.context), outcome,
      );
    }

    const { inScope, outOfScopeWarnings } = filterInScopeChanges(proposal.proposal, targetFiles);
    if (inScope.length === 0) {
      // Every proposed path was outside the validated targetFiles — never present this as a
      // successful code-change proposal.
      return this.failComposed(
        message,
        session,
        this.deps.composer.composeCodeGenerationPreviewNoValidChange(message.context, outOfScopeWarnings),
        outcome,
      );
    }

    let diff: WorkspaceDiff;
    try {
      diff = await this.deps.workspace.diff(request.workspaceRef, inScope);
    } catch {
      // Read-only failure (e.g. current file unreadable) — same guaranteed non-mutation as every
      // other preview failure (ADR-0039, CA Round 1 Required Change #8).
      return this.failComposed(
        message, session, this.deps.composer.composeCodeGenerationPreviewFailed(message.context), outcome,
      );
    }

    // An empty diff result cannot be a successful preview (ADR-0039, CA Round 1 Required Change #3).
    if (diff.files.length === 0) {
      return this.failComposed(
        message, session, this.deps.composer.composeCodeGenerationPreviewFailed(message.context), outcome,
      );
    }

    // targetFiles are Workspace-validated existing files (ADR-0036) — changeKind 'add' means the
    // current content could not be found/read at diff time. Failed preview, not a "new file" success
    // (ADR-0039, CA Round 1 Required Change #1).
    if (diff.files.some((f) => f.changeKind === 'add')) {
      return this.failComposed(
        message, session, this.deps.composer.composeCodeGenerationPreviewFailed(message.context), outcome,
      );
    }

    const diffPreview = toCodeDiffPreview(diff, outOfScopeWarnings);
    const reply = this.deps.composer.composeCodeDiffPreview(message.context, diffPreview);
    // Sprint 2s (ADR-0040): remember what was just previewed, in case the user explicitly asks to apply
    // it on a later turn. A plan-less Task anchor — never discoverable by approvalFlow.
    await this.deps.applyPreviewFlow.anchor(session, {
      kind: 'code-preview-apply',
      status: 'ELIGIBLE',
      executionPlanRef: planRef,
      workspaceRef: request.workspaceRef,
      targetFiles,
      codeGenerationRef: codeGenerationRef(generation),
      codeProposalRef: codeProposalRef(proposal),
      instruction: request.instruction,
      ...(session.activeProjectId ? { projectId: session.activeProjectId } : {}),
      createdAt: now(),
    });
    return this.respondComposed(message, session, reply, outcome);
  }

  /** No eligible apply-preview anchor exists at all (Sprint 2s, ADR-0040) — an explicit apply phrase is
   *  never reinterpreted as a new, unscoped code-change request. Never reaches the classifier or the
   *  Orchestrator. */
  private async handleApplyPreviewUnavailableTurn(message: InboundMessage, session: Session): Promise<TurnResult> {
    const reply = this.deps.composer.composeApplyPreviewUnavailable(message.context);
    await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
    return this.responded(session, reply);
  }

  /** The apply approval was already decided APPROVED and the user asked to apply again (Sprint 2s,
   *  ADR-0040) — never re-asks, never creates a duplicate approval. */
  private async handleApplyAlreadyApprovedTurn(message: InboundMessage, session: Session): Promise<TurnResult> {
    const reply = this.deps.composer.composeApplyApprovalRecorded(message.context);
    await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
    return this.responded(session, reply);
  }

  /**
   * An explicit apply phrase arrived while the anchor is ELIGIBLE (Sprint 2s, ADR-0040) — create the
   * second, HIGH-risk ApprovalRequest and halt. Never calls ExecutionOrchestrator, Patch, WorkspaceWrite,
   * or CommandExecution.
   */
  private async handleApplyIntentTurn(
    message: InboundMessage,
    session: Session,
    actor: Actor,
    anchor: ApplyPreviewAnchor,
  ): Promise<TurnResult> {
    if (!anchor.workspaceRef || !anchor.targetFiles.length || !anchor.codeProposalRef) {
      // Defensive — the anchor is always written complete (runCodeGenerationPreview), but never trust
      // it blindly.
      const reply = this.deps.composer.composeApplyPreviewUnavailable(message.context);
      return this.failComposed(message, session, reply);
    }
    const approval = await this.deps.approvals.requestForRisk({
      executionPlanRef: anchor.executionPlanRef,
      riskLevel: RiskLevel.HIGH, // apply approval is unconditionally HIGH, never auto-approved
      reason:
        `Apply AI code proposal ${anchor.codeProposalRef.id} from generation ${anchor.codeGenerationRef.id} ` +
        `to ${anchor.targetFiles.join(', ')}`,
      requestedBy: actor.id,
    });
    await this.deps.applyPreviewFlow.anchor(session, { ...anchor, status: 'AWAITING_APPROVAL', approvalId: approval.id });
    const reply = this.deps.composer.composeApplyApprovalRequested(message.context, anchor.targetFiles);
    await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
    return { status: 'AWAITING_APPROVAL', reply, sessionId: session.id };
  }

  /**
   * Decide the already-created second (apply) approval (Sprint 2s, ADR-0040). Reuses the same
   * interpretDecision/APPROVE_WORDS/DENY_WORDS/CANCEL_WORDS the first approval uses — only the
   * *creation* trigger needed a distinct word-set, not the decision itself. Approving re-anchors as
   * APPROVED (never clears) so a future Apply sprint can recover every ref; denying/cancelling clears.
   */
  private async handleApplyApprovalTurn(
    message: InboundMessage,
    session: Session,
    actor: Actor,
    anchor: ApplyPreviewAnchor,
  ): Promise<TurnResult> {
    const decision = ConversationRuntime.interpretDecision(message.text);
    if (decision === 'ambiguous') {
      const fresh = await this.deps.approvals.get(anchor.approvalId!);
      const reply = fresh
        ? this.deps.composer.composeApprovalNotice(message.context, fresh)
        : this.deps.composer.composeApplyPreviewUnavailable(message.context); // pathological
      await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
      return { status: 'AWAITING_APPROVAL', reply, sessionId: session.id };
    }

    const approved = decision === 'approve';
    await this.deps.approvals.decide(anchor.approvalId!, this.decisionOf(anchor.approvalId!, actor.id, approved));

    if (!approved) {
      // deny / cancel — nothing left to preserve.
      await this.deps.applyPreviewFlow.clear(session);
      const replyStatus: ExecutionReplyStatus = decision === 'deny' ? 'DENIED' : 'CANCELLED';
      const reply = this.deps.composer.composeExecutionResult(message.context, replyStatus);
      await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
      return { status: decision === 'deny' ? 'DENIED' : 'CANCELLED', reply, sessionId: session.id };
    }

    // approve — Sprint 2s stops here (no Patch/WorkspaceWrite/CommandExecution/git call), but the
    // approved context MUST survive for a future Apply sprint. Re-anchor (never clear): every ref this
    // anchor carries is exactly what that future sprint will need.
    await this.deps.applyPreviewFlow.anchor(session, { ...anchor, status: 'APPROVED', approvedAt: now() });
    const reply = this.deps.composer.composeApplyApprovalRecorded(message.context);
    await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
    return { status: 'RESPONDED', reply, sessionId: session.id };
  }

  /**
   * An explicit patch command arrived while the apply anchor is APPROVED (Sprint 2t, ADR-0041) — recover
   * the approved context, re-validate against the latest workspace content, and generate a PatchSet
   * REPRESENTATION via the existing Patch capability (CAP-005). Never applies: no WorkspaceWrite, no
   * CommandExecution, no git/file mutation. The Application layer derives the ApprovalRef and injects it;
   * PatchManager never queries ApprovalManager. On success the anchor becomes PATCH_READY (patchRef
   * preserved for Sprint 2u); a PatchSet existing does NOT mean it was applied.
   */
  private async handlePatchGenerationTurn(
    message: InboundMessage,
    session: Session,
    anchor: ApplyPreviewAnchor,
  ): Promise<TurnResult> {
    // 1. Approved-context guards.
    if (!anchor.approvalId || !anchor.workspaceRef || !anchor.targetFiles.length || !anchor.codeProposalRef) {
      return this.failComposed(message, session, this.deps.composer.composePatchUnavailable(message.context));
    }
    const approval = await this.deps.approvals.get(anchor.approvalId);
    if (!approval || approval.status !== ApprovalStatus.APPROVED) {
      return this.failComposed(message, session, this.deps.composer.composePatchUnavailable(message.context));
    }

    // 2. Source of truth = the CodeProposal aggregate, never rendered diff text / chat memory.
    const proposal = await this.deps.codeProposals.get(anchor.codeProposalRef.id);
    if (!proposal) {
      return this.failComposed(message, session, this.deps.composer.composePatchUnavailable(message.context));
    }

    // 3. Re-filter against validated targetFiles — targetFiles stays authoritative.
    const { inScope } = filterInScopeChanges(proposal.proposal, anchor.targetFiles);
    if (inScope.length === 0) {
      return this.failComposed(message, session, this.deps.composer.composePatchUnavailable(message.context));
    }

    // 4. Re-run WorkspaceManager.diff against CURRENT content — staleness/add/binary/empty check.
    let diff: WorkspaceDiff;
    try {
      diff = await this.deps.workspace.diff(anchor.workspaceRef, inScope);
    } catch {
      this.logPatchGenerationFailed(session, anchor, 'workspace diff failed');
      return this.failComposed(message, session, this.deps.composer.composePatchGenerationFailed(message.context));
    }
    // No PatchSet for empty / changeKind:add / binary / oversized(empty unified) results.
    const unrenderable =
      diff.files.length === 0 ||
      diff.files.some((f) => f.changeKind === 'add' || f.binary || !f.unified.trim());
    if (unrenderable) {
      this.logPatchGenerationFailed(session, anchor, 'unrenderable diff (empty/add/binary/oversized)');
      return this.failComposed(message, session, this.deps.composer.composePatchGenerationFailed(message.context));
    }

    // 5. Application derives the ApprovalRef; PatchManager receives it and re-validates.
    let patchSet: PatchSet;
    try {
      patchSet = await this.deps.patch.generate({
        executionPlanRef: anchor.executionPlanRef,
        approvalRef: approvalRef(approval),
        changes: inScope,
        diff,
      });
    } catch {
      this.logPatchGenerationFailed(session, anchor, 'patch generation failed');
      return this.failComposed(message, session, this.deps.composer.composePatchGenerationFailed(message.context));
    }

    // 6. Preserve PatchRef on the anchor for Sprint 2u — re-anchor PATCH_READY, never clear.
    await this.deps.applyPreviewFlow.anchor(session, { ...anchor, status: 'PATCH_READY', patchRef: patchRef(patchSet) });

    // 7. ResponseComposer renders the preview from PatchSet facts.
    const reply = this.deps.composer.composePatchSetPreview(message.context, {
      operations: patchSet.operations.map((op) => ({ path: op.path, kind: op.operation, unified: op.diff })),
    });
    await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
    return this.responded(session, reply);
  }

  /** A patch command arrived while the anchor is already PATCH_READY (Sprint 2t) — never regenerates. */
  private async handlePatchAlreadyGeneratedTurn(message: InboundMessage, session: Session): Promise<TurnResult> {
    const reply = this.deps.composer.composePatchAlreadyGenerated(message.context);
    await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
    return this.responded(session, reply);
  }

  /** A patch command arrived with no APPROVED/PATCH_READY apply context (Sprint 2t) — never a new
   *  code-change request, never reaches the classifier or the Orchestrator. */
  private async handlePatchUnavailableTurn(message: InboundMessage, session: Session): Promise<TurnResult> {
    const reply = this.deps.composer.composePatchUnavailable(message.context);
    await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
    return this.responded(session, reply);
  }

  /** Structured, no-content failure log for PatchSet generation (Sprint 2t, ADR-0041 — CA Round 1) — so
   *  operators can trace failures without the user seeing internals and without leaking diff/file text. */
  private logPatchGenerationFailed(session: Session, anchor: ApplyPreviewAnchor, reason: string): void {
    this.deps.logger.warn('PatchSet generation failed', {
      reason,
      sessionId: session.id,
      executionPlanId: anchor.executionPlanRef.id,
      approvalId: anchor.approvalId,
      codeProposalId: anchor.codeProposalRef.id,
      targetFiles: anchor.targetFiles.join(', '),
    }); // deliberately NO diff text / file content
  }

  /** (C) Resolve the workspace (if the capability needs it), run the execution, and frame the reply. */
  private async handleExecutionIntent(
    message: InboundMessage,
    session: Session,
    actor: Actor,
    intent: Intent,
  ): Promise<TurnResult> {
    const ws = await this.resolveExecutionWorkspace(message, session, intent.capability);
    if ('status' in ws) return ws;
    const workspaceRef = ws.workspaceRef;

    // ADR-0036: a code-change request needs a validated target before it may reach Planning/Approval.
    let targetFiles: string[] | undefined;
    if (intent.capability === Capability.CODE_IMPLEMENTATION) {
      const candidates = extractTargetPathCandidates(message.text).slice(0, MAX_TARGET_CANDIDATES);
      for (const candidate of candidates) {
        const hits = await this.deps.workspace.list(workspaceRef!, candidate);
        // Never assume list()'s glob is exact-match — verify the returned hit normalizes to the
        // same path as the candidate, and use THAT hit as targetFiles, never the raw candidate.
        const matched = hits.find((hit) => normalizeRelativePath(hit) === normalizeRelativePath(candidate));
        if (matched) {
          targetFiles = [matched];
          break;
        }
      }
      if (!targetFiles) {
        // ADR-0037: anchor so the user's very next reply (even a bare path) can recover this
        // request. Reached only for a fresh CODE_IMPLEMENTATION request with an active project and
        // an opened workspace (both already required to reach this line) and no validated target.
        await this.deps.scopeClarificationFlow.anchor(session, {
          kind: 'code-scope-clarification',
          summary: intent.summary,
          ...(typeof intent.raw?.kind === 'string' ? { rawKind: intent.raw.kind } : {}),
          ...(session.activeProjectId ? { projectId: session.activeProjectId } : {}),
          createdAt: now(),
        });
        return this.respondComposed(
          message,
          session,
          this.deps.composer.composeTargetScopeClarification(message.context),
        );
      }
    }

    return this.runResolvedExecution(message, session, actor, intent, workspaceRef, targetFiles);
  }

  /** Resolve the active project's workspace for a needsWorkspace capability, or an early-return reply. */
  private async resolveExecutionWorkspace(
    message: InboundMessage,
    session: Session,
    capability: Capability,
  ): Promise<{ workspaceRef?: WorkspaceRef } | TurnResult> {
    if (!ConversationRuntime.needsWorkspace(capability)) return {};
    if (!session.activeProjectId) {
      return this.respondComposed(message, session, this.deps.composer.composeNeedsProject(message.context));
    }
    const project = await this.deps.projects.get(session.activeProjectId);
    if (!project) {
      return this.respondComposed(message, session, this.deps.composer.composeNeedsProject(message.context));
    }
    try {
      const workspaceRef = await this.deps.workspace.open({ id: project.id, rootPath: project.rootPath });
      return { workspaceRef };
    } catch {
      return this.failComposed(message, session, this.deps.composer.composeWorkspaceUnavailable(message.context));
    }
  }

  /** Resolve → run → frame the halt/complete/fail reply. Shared tail for a ready ExecutionRequest. */
  private async runResolvedExecution(
    message: InboundMessage,
    session: Session,
    actor: Actor,
    intent: Intent,
    workspaceRef: WorkspaceRef | undefined,
    targetFiles: string[] | undefined,
  ): Promise<TurnResult> {
    const request = this.deps.intentResolver.resolve(intent, {
      requestedBy: actor.id,
      ...(session.activeProjectId ? { projectId: session.activeProjectId } : {}),
      ...(workspaceRef ? { workspaceRef } : {}),
      ...(targetFiles ? { targetFiles } : {}),
    });
    if (!request) {
      // Defensive: isExecution() gated this path, so resolve should not return null.
      return this.failComposed(message, session, this.deps.composer.composeCommandUnavailable(message.context));
    }

    const outcome = await this.deps.orchestrator.run(request);
    if (outcome.status === ('AWAITING_APPROVAL' as ExecutionOutcomeStatus)) {
      await this.deps.approvalFlow.anchor(session, request, outcome); // enable next-turn resume
      // ADR-0035: a code-change halt gets a more specific prompt than the generic approval text —
      // it names this as a code-change request and states that no file is modified yet.
      if (intent.capability === Capability.CODE_IMPLEMENTATION) {
        const reply = this.deps.composer.composeCodeChangeApprovalRequired(message.context);
        await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
        return { status: 'AWAITING_APPROVAL', reply, sessionId: session.id, executionOutcome: outcome };
      }
      return this.replyForOutcome(message.context, session, outcome);
    }
    if (intent.capability === Capability.TEST_EXECUTION) {
      return this.frameTestResult(message, session, outcome);
    }
    return this.replyForOutcome(message.context, session, outcome);
  }

  /**
   * (A2) Recover a code-change request from a pending scope clarification (ADR-0037). Consumes the
   * anchor unconditionally (next-turn-only) before evaluating the reply. The recovered request's
   * goal/instruction always comes from `pending.summary` — the ORIGINAL first message — never from
   * this follow-up message's text.
   */
  private async handleScopeClarificationTurn(
    message: InboundMessage,
    session: Session,
    actor: Actor,
    pending: PendingScopeClarification,
  ): Promise<TurnResult> {
    await this.deps.scopeClarificationFlow.clear(session); // next-turn-only: consumed either way

    if (CANCEL_WORDS.some((w) => message.text.trim() === w || message.text.includes(w))) {
      const reply = this.deps.composer.composeScopeClarificationCancelled(message.context);
      await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
      return { status: 'CANCELLED', reply, sessionId: session.id };
    }

    const ws = await this.resolveExecutionWorkspace(message, session, Capability.CODE_IMPLEMENTATION);
    if ('status' in ws) return ws; // no active project / workspace unavailable — same replies as fresh

    const recovered: Intent = {
      type: IntentType.IMPLEMENT_CODE,
      capability: Capability.CODE_IMPLEMENTATION,
      confidence: 1,
      requiresWork: true,
      summary: pending.summary,
      ...(pending.rawKind ? { raw: { kind: pending.rawKind } } : {}),
    };

    const candidates = extractTargetPathCandidates(message.text).slice(0, MAX_TARGET_CANDIDATES);
    for (const candidate of candidates) {
      const hits = await this.deps.workspace.list(ws.workspaceRef!, candidate);
      const matched = hits.find((hit) => normalizeRelativePath(hit) === normalizeRelativePath(candidate));
      if (matched) {
        return this.runResolvedExecution(message, session, actor, recovered, ws.workspaceRef, [matched]);
      }
    }

    const reply = this.deps.composer.composeTargetScopeClarification(message.context);
    return this.respondComposed(message, session, reply); // no re-anchor (next-turn-only)
  }

  /** Assemble the display-relevant facts for a ran/timed-out `CommandExecution` (ADR-0034). Raw only — no truncation, no text. */
  private static toTestResultDetail(exec: CommandExecution): TestResultDetail {
    const kind: 'test' | 'typecheck' = exec.args.includes('typecheck') ? 'typecheck' : 'test';
    return {
      kind,
      command: exec.command,
      args: exec.args,
      durationMs: exec.durationMs,
      stdout: exec.stdout,
      stderr: exec.stderr,
      ...(exec.exitCode !== undefined ? { exitCode: exec.exitCode } : {}),
    };
  }

  /**
   * Frame a TEST_EXECUTION outcome (ADR-0033; detail three-way branch added in ADR-0034). A command
   * that RAN → a **product test result** (pass/fail + detail), read via the existing
   * `CommandExecution` read path; `TIMED_OUT` → a distinct timeout reply (not a test verdict); a
   * command that never ran at all (allow-list refusal / system error, no `CommandExecution`) → an
   * execution-failure reply. The orchestrator's status contract is not reinterpreted — the runtime
   * only chooses which case applies and assembles raw facts; all text lives in `ResponseComposer`.
   */
  private async frameTestResult(
    message: InboundMessage,
    session: Session,
    outcome: ExecutionOutcome,
  ): Promise<TurnResult> {
    const id = outcome.refs.commandExecutionId;
    const exec: CommandExecution | null = id ? await this.deps.commandExecutions.get(id) : null;
    if (
      exec &&
      (exec.status === CommandExecutionStatus.SUCCEEDED || exec.status === CommandExecutionStatus.FAILED)
    ) {
      const passed = exec.status === CommandExecutionStatus.SUCCEEDED;
      const detail = ConversationRuntime.toTestResultDetail(exec);
      const reply = this.deps.composer.composeTestResult(message.context, { ...detail, passed });
      await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
      return { status: 'RESPONDED', reply, sessionId: session.id, executionOutcome: outcome };
    }
    if (exec && exec.status === CommandExecutionStatus.TIMED_OUT) {
      const detail = ConversationRuntime.toTestResultDetail(exec);
      const reply = this.deps.composer.composeTestTimedOut(message.context, detail);
      return this.failComposed(message, session, reply, outcome);
    }
    // Command never ran at all (allow-list refusal → no CommandExecution, spawn/system error).
    return this.failComposed(message, session, this.deps.composer.composeCommandUnavailable(message.context), outcome);
  }

  private async respondComposed(
    message: InboundMessage,
    session: Session,
    reply: OutboundMessage,
    outcome?: ExecutionOutcome,
  ): Promise<TurnResult> {
    await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
    return { status: 'RESPONDED', reply, sessionId: session.id, ...(outcome ? { executionOutcome: outcome } : {}) };
  }

  private async failComposed(
    message: InboundMessage,
    session: Session,
    reply: OutboundMessage,
    outcome?: ExecutionOutcome,
  ): Promise<TurnResult> {
    await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
    return { status: 'FAILED', reply, sessionId: session.id, ...(outcome ? { executionOutcome: outcome } : {}) };
  }

  /** Map an ExecutionOutcome to a TurnResult + recorded reply. */
  private async replyForOutcome(
    context: ConversationContext,
    session: Session,
    outcome: ExecutionOutcome,
  ): Promise<TurnResult> {
    if (outcome.status === ('AWAITING_APPROVAL' as ExecutionOutcomeStatus)) {
      // Only a plan-scoped ref is available here (not the full ApprovalRequest) — use the generic
      // ResponseComposer prompt. The runtime never builds reply text itself (ADR-0032 §10).
      const reply = this.deps.composer.composeApprovalRequired(context);
      await this.deps.memory.recordAssistant(reply.text, context, session.id);
      return { status: 'AWAITING_APPROVAL', reply, sessionId: session.id, executionOutcome: outcome };
    }
    const replyStatus = toReplyStatus(outcome.status);
    const reply = this.deps.composer.composeExecutionResult(context, replyStatus);
    await this.deps.memory.recordAssistant(reply.text, context, session.id);
    const status: RuntimeTurnStatus =
      replyStatus === 'COMPLETED'
        ? 'RESPONDED'
        : replyStatus === 'DENIED'
          ? 'DENIED'
          : replyStatus === 'CANCELLED'
            ? 'CANCELLED'
            : 'FAILED';
    return { status, reply, sessionId: session.id, executionOutcome: outcome };
  }

  /** (F) Existing single-capability work path (relocated from ChunsikCore), returning a reply. */
  private async handleWorkTurn(
    message: InboundMessage,
    session: Session,
    actor: Actor,
    intent: Intent,
    excludeMemoryId: Id,
    readout: ProjectReadout | undefined,
  ): Promise<TurnResult> {
    let task = await this.deps.tasks.createTask(intent, message.context, {
      actorId: actor.id,
      sessionId: session.id,
      ...(session.activeProjectId ? { projectId: session.activeProjectId } : {}),
    });
    task = await this.deps.tasks.transition(task, TaskStatus.RUNNING);
    const capability: Capability = task.intent.capability;
    const run = await this.deps.tasks.startRun(task, capability);

    let providerId: string | undefined;
    try {
      const workspace = ConversationRuntime.needsWorkspace(capability)
        ? await this.deps.workspace.prepare(task)
        : undefined;
      const bundle = await this.deps.contextBuilder.build(task, excludeMemoryId ? [excludeMemoryId] : []);
      const promptSpec = this.deps.promptComposer.compose(task, bundle, readout);
      const aiRequest = this.deps.promptRenderer.render(promptSpec, {
        capability,
        ...(workspace ? { workspace } : {}),
      });
      const provider = await this.deps.router.select(capability);
      providerId = provider.id;
      const result = await provider.execute(aiRequest);

      const artifactIds = await this.deps.artifacts.persistAll(task.id, run.id, result.artifacts ?? []);
      await this.deps.tasks.completeRun(run, { artifactIds, ...(providerId ? { providerId } : {}) });
      await this.deps.memory.recordAssistant(result.text, message.context, task.sessionId ?? session.id);
      if (capability === Capability.PROJECT_ANALYSIS && task.projectId) {
        await this.deps.memory.recordToolMemory(result.text, {
          projectId: task.projectId,
          sessionId: task.sessionId ?? session.id,
        });
      }
      await this.deps.tasks.transition(task, TaskStatus.COMPLETED);
      const reply = this.deps.composer.compose(message.context, result, result.artifacts ?? []);
      return this.responded(session, reply);
    } catch (err) {
      const failure = describeAiFailure(err);
      await this.deps.tasks.failRun(run, failure.errorSummary, providerId ? { providerId } : {});
      await this.deps.tasks.transition(task, TaskStatus.FAILED);
      this.deps.logger.error('work turn failed', { taskId: task.id, runId: run.id, kind: failure.kind });
      const reply = this.deps.composer.composeError(message.context, failure.userMessage);
      return { status: 'FAILED', reply, sessionId: session.id };
    }
  }

  private decisionOf(approvalId: Id, decidedBy: string, approved: boolean): ApprovalDecision {
    return { approvalId, approved, decidedBy, decidedAt: now() };
  }

  private responded(session: Session, reply: OutboundMessage): TurnResult {
    return { status: 'RESPONDED', reply, sessionId: session.id };
  }
}
