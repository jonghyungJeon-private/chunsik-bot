import { NotImplementedError } from '../errors';
import { newId } from '../util/id';
import { now } from '../util/clock';
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
import type { PlatformAdapter } from '../ports';
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

/** Everything the orchestrator needs, injected by the composition root. */
export interface ChunsikCoreDeps {
  classifier: IntentClassifier;
  planner: Planner;
  router: CapabilityRouter;
  tasks: TaskManager;
  memory: MemoryManager;
  artifacts: ArtifactManager;
  workspace: WorkspaceManager;
  connectors: ConnectorManager;
  composer: ResponseComposer;
  platform: PlatformAdapter;
  risk: RiskPolicy;
}

/**
 * ChunsikCore is the application orchestrator — the single entry the platform
 * calls. It expresses the v1 task flow as a coordination of the application
 * services. The deterministic plumbing here is real; the leaf cognition it
 * calls (classify, plan, AiProvider.execute) is stubbed until implemented.
 *
 * Boundary note: this file imports NOTHING concrete — no Discord, no SQLite,
 * no CLI. It only knows ports and application services.
 */
export class ChunsikCore {
  constructor(private readonly deps: ChunsikCoreDeps) {}

  /**
   * The end-to-end flow:
   *   1. show typing + record short-term memory
   *   2. classify intent (IntentClassifier)
   *   3. fast path: no work needed -> route capability, execute, reply
   *   4. work path: create Task -> PLANNING -> Planner builds Plan
   *   5. risk gate: HIGH/CRITICAL -> WAITING_APPROVAL + ask the user, return
   *   6. otherwise execute the task now
   */
  async handleInboundMessage(message: InboundMessage): Promise<void> {
    await this.deps.platform.sendTyping(message.context).catch(() => undefined);
    await this.deps.memory.recordShortTerm(message);

    const intent = await this.deps.classifier.classify(message);

    // (3) Fast path — conversational, no Task needed.
    if (!intent.requiresWork) {
      const provider = await this.deps.router.route(intent.capability);
      const result = await provider.execute({
        capability: intent.capability,
        prompt: message.text,
      });
      await this.deps.platform.sendMessage(
        this.deps.composer.compose(message.context, result, result.artifacts ?? []),
      );
      return;
    }

    // (4) Work path — becomes a Task.
    let task = await this.deps.tasks.createTask(intent, message.context);
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
   * Resume after a user approves/denies a gated action. Stubbed: it requires
   * persisting the ApprovalRequest -> Task -> Plan so the run can resume, which
   * depends on Planner output that is not implemented yet.
   */
  async handleApprovalDecision(_decision: ApprovalDecision): Promise<void> {
    throw new NotImplementedError('ChunsikCore.handleApprovalDecision');
  }

  /** Execute a planned task: prepare workspace, inject memory, run, reply. */
  private async executeTask(
    inputTask: Task,
    plan: Plan,
    context: ConversationContext,
  ): Promise<void> {
    const task = await this.deps.tasks.transition(inputTask, TaskStatus.RUNNING);
    const capability: Capability = plan.steps[0]?.capability ?? task.intent.capability;
    const run = await this.deps.tasks.startRun(task, capability);

    try {
      const workspace = await this.deps.workspace.prepare(task);
      const contextFiles = await this.deps.memory.buildContextFiles(task);
      if (workspace) {
        await this.deps.workspace.injectContext(workspace, contextFiles);
      }

      // Provider chosen purely by capability — no concrete CLI named here.
      const provider = await this.deps.router.route(capability);
      const result = await provider.execute({
        capability,
        prompt: plan.summary,
        contextFiles,
        ...(workspace ? { workspace } : {}),
      });

      const artifactIds = await this.deps.artifacts.persistAll(
        task.id,
        run.id,
        result.artifacts ?? [],
      );
      await this.deps.tasks.completeRun(run, { artifactIds, providerId: provider.id });
      await this.deps.tasks.transition(task, TaskStatus.COMPLETED);

      await this.deps.platform.sendMessage(
        this.deps.composer.compose(context, result, result.artifacts ?? []),
      );
    } catch (err) {
      await this.deps.tasks.failRun(run, err instanceof Error ? err.message : String(err));
      await this.deps.tasks.transition(task, TaskStatus.FAILED);
      throw err;
    }
  }
}
