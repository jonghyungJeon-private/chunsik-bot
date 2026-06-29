import { NotImplementedError } from '../errors';
import { newId } from '../util/id';
import { now } from '../util/clock';
import { describeAiFailure } from './ai-failure';
import { TaskStatus } from '../domain';
import type {
  ApprovalDecision,
  ApprovalRequest,
  Capability,
  ConversationContext,
  InboundMessage,
  Plan,
  Task,
} from '../domain';
import type { Logger, PlatformAdapter } from '../ports';
import type { IntentClassifier } from './intent-classifier';
import type { Planner } from './planner';
import type { CapabilityRouter } from './capability-router';
import type { TaskManager } from './task-manager';
import type { MemoryManager } from './memory-manager';
import type { ArtifactManager } from './artifact-manager';
import type { WorkspaceManager } from './workspace-manager';
import type { ConnectorManager } from './connector-manager';
import type { ResponseComposer } from './response-composer';
import type { RiskPolicy } from './risk-policy';
import type { ActorManager } from './actor-manager';
import type { SessionManager } from './session-manager';
import type { ContextBuilder } from './context-builder';
import type { PromptComposer } from './prompt-composer';

/** Everything the orchestrator needs, injected by the composition root. */
export interface ChunsikCoreDeps {
  classifier: IntentClassifier;
  planner: Planner;
  router: CapabilityRouter;
  tasks: TaskManager;
  actors: ActorManager;
  sessions: SessionManager;
  memory: MemoryManager;
  contextBuilder: ContextBuilder;
  promptComposer: PromptComposer;
  artifacts: ArtifactManager;
  workspace: WorkspaceManager;
  connectors: ConnectorManager;
  composer: ResponseComposer;
  platform: PlatformAdapter;
  risk: RiskPolicy;
  logger: Logger;
}

/**
 * ChunsikCore is the application orchestrator — the single entry the platform
 * calls. It coordinates the application services into the v1 task flow.
 *
 * Boundary note: this file imports NOTHING concrete — no Discord, no SQLite,
 * no CLI. It depends only on ports (incl. the Logger port) and application
 * services. Provider selection is by capability; it never names a CLI.
 */
export class ChunsikCore {
  constructor(private readonly deps: ChunsikCoreDeps) {}

  /**
   * Flow (Sprint 1b-1):
   *   1. typing + resolve Actor + open/touch Session + record short-term memory
   *   2. classify intent
   *   3. fast path: no work -> route + execute + reply
   *   4. work path: create Task (actor/session) -> PLANNING -> Plan
   *   5. risk gate: HIGH/CRITICAL -> WAITING_APPROVAL + ask, return
   *   6. execute: ContextBuilder -> PromptComposer -> route -> execute ->
   *      Artifact -> COMPLETED -> reply
   */
  async handleInboundMessage(message: InboundMessage): Promise<void> {
    await this.deps.platform.sendTyping(message.context).catch(() => undefined);

    const actor = await this.deps.actors.resolveFromContext(message.context);
    const session = await this.deps.sessions.openForContext(message.context, actor.id);
    await this.deps.sessions.touch(session);
    await this.deps.memory.recordShortTerm(message, session.id);

    const intent = await this.deps.classifier.classify(message);
    this.deps.logger.info('intent classified', {
      capability: intent.capability,
      requiresWork: intent.requiresWork,
    });

    // (3) Fast path — conversational, no Task needed.
    if (!intent.requiresWork) {
      const provider = await this.deps.router.route(intent.capability);
      const result = await provider.execute({ capability: intent.capability, prompt: message.text });
      await this.deps.platform.sendMessage(
        this.deps.composer.compose(message.context, result, result.artifacts ?? []),
      );
      return;
    }

    // (4) Work path — becomes a Task anchored to the actor + session.
    let task = await this.deps.tasks.createTask(intent, message.context, {
      actorId: actor.id,
      sessionId: session.id,
    });
    this.deps.logger.info('task created', {
      taskId: task.id,
      actorId: actor.id,
      sessionId: session.id,
    });
    task = await this.deps.tasks.transition(task, TaskStatus.PLANNING);
    const plan = await this.deps.planner.plan(task, intent);

    // (5) Approval gate.
    if (this.deps.risk.requiresApproval(plan.overallRisk)) {
      task = await this.deps.tasks.transition(task, TaskStatus.WAITING_APPROVAL);
      const request: ApprovalRequest = {
        id: newId(),
        taskId: task.id,
        riskLevel: plan.overallRisk,
        summary: plan.summary,
        requestedAt: now(),
      };
      // TODO(v1): persist `request` so handleApprovalDecision can resume.
      await this.deps.platform.requestApproval(request, message.context);
      return;
    }

    // (6) Run now.
    await this.executeTask(task, plan, message.context);
  }

  /**
   * Resume after a user approves/denies a gated action. Deferred: requires
   * persisting ApprovalRequest -> Task -> Plan to resume. Not reached by the
   * LOW-risk chat path in Sprint 1b-1.
   */
  async handleApprovalDecision(_decision: ApprovalDecision): Promise<void> {
    throw new NotImplementedError('ChunsikCore.handleApprovalDecision');
  }

  /** Execute a planned task: build context, compose prompt, run, persist, reply. */
  private async executeTask(
    inputTask: Task,
    plan: Plan,
    context: ConversationContext,
  ): Promise<void> {
    const task = await this.deps.tasks.transition(inputTask, TaskStatus.RUNNING);
    const capability: Capability = plan.steps[0]?.capability ?? task.intent.capability;
    const run = await this.deps.tasks.startRun(task, capability);
    this.deps.logger.info('run started', { taskId: task.id, runId: run.id, capability });

    let providerId: string | undefined;
    try {
      const workspace = await this.deps.workspace.prepare(task);

      // Context + prompt are assembled in the core; the provider only renders.
      const bundle = await this.deps.contextBuilder.build(task);
      const promptSpec = this.deps.promptComposer.compose(task, bundle);

      // Provider chosen purely by capability — no concrete CLI named here.
      const provider = await this.deps.router.route(capability);
      providerId = provider.id;
      const result = await provider.execute({
        capability,
        promptSpec,
        ...(workspace ? { workspace } : {}),
      });

      const artifactIds = await this.deps.artifacts.persistAll(
        task.id,
        run.id,
        result.artifacts ?? [],
      );
      await this.deps.tasks.completeRun(run, { artifactIds, providerId: provider.id });
      // Persist the assistant turn so the next message in this session has context.
      await this.deps.memory.recordAssistant(result.text, context, task.sessionId);
      await this.deps.tasks.transition(task, TaskStatus.COMPLETED);
      this.deps.logger.info('task completed', {
        taskId: task.id,
        runId: run.id,
        providerId: provider.id,
        artifacts: artifactIds.length,
      });

      await this.deps.platform.sendMessage(
        this.deps.composer.compose(context, result, result.artifacts ?? []),
      );
    } catch (err) {
      // Product-grade failure (ADR-0015): classify, record, and reply kindly.
      const failure = describeAiFailure(err);
      await this.deps.tasks.failRun(run, failure.errorSummary, providerId ? { providerId } : {});
      await this.deps.tasks.transition(task, TaskStatus.FAILED);
      this.deps.logger.error('task failed', {
        taskId: task.id,
        runId: run.id,
        kind: failure.kind,
        error: failure.errorSummary,
      });
      await this.deps.platform
        .sendMessage(this.deps.composer.composeError(context, failure.userMessage))
        .catch(() => undefined);
    }
  }
}
