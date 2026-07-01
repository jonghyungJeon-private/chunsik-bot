import { describeAiFailure } from './ai-failure';
import { Capability, CommandExecutionStatus, IntentType, TaskStatus } from '../domain';
import type {
  Actor,
  ApprovalDecision,
  ApprovalRequest,
  Artifact,
  CommandExecution,
  ContextBundle,
  ConversationContext,
  Id,
  InboundMessage,
  Intent,
  OutboundMessage,
  Project,
  PromptSpec,
  RiskLevel,
  Session,
  Task,
  TaskRun,
  WorkspaceRef,
} from '../domain';
import type { AiProvider, AiRequest, Logger, ProjectReadout } from '../ports';
import { now } from '../util/clock';
import type { ResponseComposer, ExecutionReplyStatus, TestResultDetail } from './response-composer';
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
  readonly approvals: { decide(approvalId: Id, decision: ApprovalDecision): Promise<ApprovalRequest> };
  readonly approvalFlow: ApprovalFlow;
  readonly logger: Logger;
}

const APPROVE_WORDS = ['승인', '진행', '좋아', 'yes', 'y', 'ok'];
const DENY_WORDS = ['거절', '아니', 'no', 'n'];
const CANCEL_WORDS = ['취소', '중단', '그만'];

/** Bound on how many extracted target-path candidates trigger a workspace.list call per turn
 *  (Sprint 2o, ADR-0036) — a chat message must never drive an unbounded number of workspace scans. */
const MAX_TARGET_CANDIDATES = 5;

/** Map an Execution Orchestrator outcome status to the ResponseComposer reply status. */
function toReplyStatus(status: ExecutionOutcomeStatus): ExecutionReplyStatus {
  return status as unknown as ExecutionReplyStatus; // identical string values (ADR-0032)
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
      // ADR-0035: a planningOnly request never mutates, so "완료했어요" would be misleading —
      // nothing was generated/patched/written. Say so explicitly instead of the generic COMPLETED text.
      if (ctx.request.planningOnly) {
        const reply = this.deps.composer.composePlanningOnlyApproved(message.context);
        await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
        return { status: 'RESPONDED', reply, sessionId: session.id, executionOutcome: outcome };
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

  /** (C) Resolve the workspace (if the capability needs it), run the execution, and frame the reply. */
  private async handleExecutionIntent(
    message: InboundMessage,
    session: Session,
    actor: Actor,
    intent: Intent,
  ): Promise<TurnResult> {
    // Filesystem/command capabilities run in the active project's workspace (ADR-0033).
    let workspaceRef: WorkspaceRef | undefined;
    if (ConversationRuntime.needsWorkspace(intent.capability)) {
      if (!session.activeProjectId) {
        return this.respondComposed(message, session, this.deps.composer.composeNeedsProject(message.context));
      }
      const project = await this.deps.projects.get(session.activeProjectId);
      if (!project) {
        return this.respondComposed(message, session, this.deps.composer.composeNeedsProject(message.context));
      }
      try {
        workspaceRef = await this.deps.workspace.open({ id: project.id, rootPath: project.rootPath });
      } catch {
        return this.failComposed(message, session, this.deps.composer.composeWorkspaceUnavailable(message.context));
      }
    }

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
        return this.respondComposed(
          message,
          session,
          this.deps.composer.composeTargetScopeClarification(message.context),
        );
      }
    }

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
  ): Promise<TurnResult> {
    await this.deps.memory.recordAssistant(reply.text, message.context, session.id);
    return { status: 'RESPONDED', reply, sessionId: session.id };
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
