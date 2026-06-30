import { NotImplementedError } from '../errors';
import { describeAiFailure } from './ai-failure';
import { Capability, IntentType, TaskStatus } from '../domain';
import type {
  ApprovalDecision,
  ConversationContext,
  Id,
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
import type { ProjectReadout } from '../ports';
import type { ActorManager } from './actor-manager';
import type { SessionManager } from './session-manager';
import type { ProjectManager } from './project-manager';
import type { ProjectAnalyzer } from './project-analyzer';
import type { ContextBuilder } from './context-builder';
import type { PromptComposer } from './prompt-composer';
import type { PromptRenderer } from './prompt-renderer';

/** Everything the orchestrator needs, injected by the composition root. */
export interface ChunsikCoreDeps {
  classifier: IntentClassifier;
  planner: Planner;
  router: CapabilityRouter;
  tasks: TaskManager;
  actors: ActorManager;
  sessions: SessionManager;
  projects: ProjectManager;
  analyzer: ProjectAnalyzer;
  memory: MemoryManager;
  contextBuilder: ContextBuilder;
  promptComposer: PromptComposer;
  promptRenderer: PromptRenderer;
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

  /** Capabilities that operate on files need a resolved workspace; chat does not. */
  private static needsWorkspace(capability: Capability): boolean {
    return capability === Capability.CODE_IMPLEMENTATION || capability === Capability.TEST_EXECUTION;
  }

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
    const userMemory = await this.deps.memory.recordShortTerm(message, session.id);

    const intent = await this.deps.classifier.classify(message);
    this.deps.logger.info('intent classified', {
      capability: intent.capability,
      requiresWork: intent.requiresWork,
    });

    // Project registration is a deterministic command, not an AI task (ADR-0018).
    if (intent.type === IntentType.REGISTER_PROJECT) {
      const path = typeof intent.raw?.path === 'string' ? intent.raw.path : '';
      const result = await this.deps.projects.register(path, session);
      this.deps.logger.info('project registration', {
        ok: result.ok,
        projectId: result.project?.id,
      });
      await this.deps.platform.sendMessage({ context: message.context, text: result.message });
      await this.deps.memory.recordAssistant(result.message, message.context, session.id);
      return;
    }

    // Gated project analysis (ADR-0019): guard there is an active project, then
    // gather a read-only readout to feed the prompt.
    let analysisReadout: ProjectReadout | undefined;
    if (intent.capability === Capability.PROJECT_ANALYSIS) {
      const prep = await this.deps.analyzer.prepare(session);
      if (!prep.ready) {
        const text = prep.message ?? '프로젝트 분석을 진행할 수 없어요.';
        await this.deps.platform.sendMessage({ context: message.context, text });
        await this.deps.memory.recordAssistant(text, message.context, session.id);
        return;
      }
      analysisReadout = prep.readout;
    }

    // (3) Fast path — conversational, no Task needed.
    if (!intent.requiresWork) {
      const provider = await this.deps.router.select(intent.capability);
      const result = await provider.execute({ capability: intent.capability, prompt: message.text });
      await this.deps.platform.sendMessage(
        this.deps.composer.compose(message.context, result, result.artifacts ?? []),
      );
      return;
    }

    // (4) Work path — becomes a Task anchored to the actor + session (+ active project).
    let task = await this.deps.tasks.createTask(intent, message.context, {
      actorId: actor.id,
      sessionId: session.id,
      ...(session.activeProjectId ? { projectId: session.activeProjectId } : {}),
    });
    this.deps.logger.info('task created', {
      taskId: task.id,
      actorId: actor.id,
      sessionId: session.id,
    });
    task = await this.deps.tasks.transition(task, TaskStatus.PLANNING);
    const plan = await this.deps.planner.plan(task, intent);

    // (5) Approval gate. Live approval wiring is deferred: CAP-004 (ADR-0025) delivers
    // the Approval capability (ApprovalManager + persistence); wiring it into this flow
    // (and the Discord approval UI) is a future integration slice. Unreachable today —
    // no v1 capability is HIGH/CRITICAL risk — so this throws rather than half-running.
    if (this.deps.risk.requiresApproval(plan.overallRisk)) {
      throw new NotImplementedError('approval flow wiring (deferred — see CAP-004 / ADR-0025)');
    }

    // (6) Run now. Exclude the just-recorded current message from recent context
    // (it already appears in the task layer) — ADR-0017 decision.
    await this.executeTask(task, plan, message.context, userMemory.id, analysisReadout);
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
    excludeMemoryId?: Id,
    readout?: ProjectReadout,
  ): Promise<void> {
    const task = await this.deps.tasks.transition(inputTask, TaskStatus.RUNNING);
    const capability: Capability = plan.steps[0]?.capability ?? task.intent.capability;
    const run = await this.deps.tasks.startRun(task, capability);
    this.deps.logger.info('run started', { taskId: task.id, runId: run.id, capability });

    let providerId: string | undefined;
    try {
      // Only filesystem-touching capabilities need a working directory. A chat
      // about a project gets its context from PROJECT memory, not a resolved
      // workspace — so we don't prepare one here (avoids resolving a stub).
      const workspace = ChunsikCore.needsWorkspace(capability)
        ? await this.deps.workspace.prepare(task)
        : undefined;

      // Context + prompt are assembled in the core; the provider only renders.
      const bundle = await this.deps.contextBuilder.build(
        task,
        excludeMemoryId ? [excludeMemoryId] : [],
      );
      const promptSpec = this.deps.promptComposer.compose(task, bundle, readout);
      // Render the PromptSpec to a provider-agnostic AiRequest BEFORE the provider sees
      // it — the provider never knows PromptSpec (ADR-0029):
      //   PromptComposer → PromptSpec → PromptRenderer → AiRequest → AiProvider.
      const aiRequest = this.deps.promptRenderer.render(promptSpec, {
        capability,
        ...(workspace ? { workspace } : {}),
      });

      // Provider chosen purely by capability — no concrete CLI named here.
      const provider = await this.deps.router.select(capability);
      providerId = provider.id;
      const result = await provider.execute(aiRequest);

      const artifactIds = await this.deps.artifacts.persistAll(
        task.id,
        run.id,
        result.artifacts ?? [],
      );
      await this.deps.tasks.completeRun(run, { artifactIds, providerId: provider.id });
      // Persist the assistant turn so the next message in this session has context.
      await this.deps.memory.recordAssistant(result.text, context, task.sessionId);
      // Keep a project analysis as TOOL memory for later reuse (ADR-0019).
      if (capability === Capability.PROJECT_ANALYSIS && task.projectId) {
        await this.deps.memory.recordToolMemory(result.text, {
          projectId: task.projectId,
          sessionId: task.sessionId,
        });
      }
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
