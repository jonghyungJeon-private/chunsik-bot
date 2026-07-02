import { Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';

import {
  // Injection tokens (ports)
  PLATFORM_ADAPTER,
  STORAGE_PROVIDER,
  QUEUE_PROVIDER,
  VECTOR_PROVIDER,
  WORKSPACE_PROVIDER,
  GIT_PROVIDER,
  WORKSPACE_WRITER,
  COMMAND_RUNNER,
  EXECUTION_PLANNER,
  PROVIDER_SELECTOR,
  AI_PROVIDERS,
  CONNECTOR_PROVIDERS,
  // Application services (pure core)
  ChunsikCore,
  IntentClassifier,
  Planner,
  CapabilityRouter,
  AiProviderManager,
  ActorManager,
  SessionManager,
  ProjectManager,
  ProjectAnalyzer,
  ContextBuilder,
  PromptComposer,
  PromptRenderer,
  TaskManager,
  MemoryManager,
  ArtifactManager,
  WorkspaceManager,
  GitManager,
  DeterministicPlanner,
  PlanningManager,
  ApprovalPolicy,
  ApprovalManager,
  PatchManager,
  WorkspaceWriteManager,
  CommandExecutionManager,
  CodeGenerationManager,
  ExecutionOrchestrator,
  IntentResolver,
  ConversationRuntime,
  StatelessApprovalFlow,
  StatelessScopeClarificationFlow,
  StatelessApplyPreviewFlow,
  ConnectorManager,
  ResponseComposer,
  RiskPolicy,
} from '@chunsik/core';
import type {
  AiProvider,
  CommandRunner,
  ConnectorProvider,
  ExecutionPlanner,
  GitProvider,
  PlatformAdapter,
  ProviderSelector,
  StorageProvider,
  VectorProvider,
  WorkspaceProvider,
  WorkspaceWriter,
} from '@chunsik/core';

// Concrete providers — the ONLY file allowed to import them.
import { DiscordPlatformAdapter } from '@chunsik/adapter-discord';
import { SqliteStorageProvider } from '@chunsik/storage-sqlite';
import { LocalQueueProvider } from '@chunsik/queue-local';
import { LocalVectorProvider } from '@chunsik/vector-local';
import { LocalCloneWorkspaceProvider, LocalWorkspaceWriter } from '@chunsik/workspace-local';
import { LocalGitProvider } from '@chunsik/git-local';
import { LocalCommandRunner } from '@chunsik/command-local';
import { ClaudeCliProvider, CodexCliProvider, OllamaCliProvider } from '@chunsik/ai-cli';
import { V1_CONNECTORS } from '@chunsik/connectors';

import { loadConfig } from './config';
import { ConsoleLogger } from './console-logger';

const config = loadConfig();
const coreLogger = new ConsoleLogger('chunsik');

/**
 * Port -> concrete bindings. Swapping an implementation (e.g. Postgres storage,
 * git-worktree workspace, Telegram platform) means changing ONLY these lines.
 */
const infrastructure: Provider[] = [
  { provide: STORAGE_PROVIDER, useFactory: () => new SqliteStorageProvider({ dbPath: config.storage.dbPath }) },
  { provide: QUEUE_PROVIDER, useFactory: () => new LocalQueueProvider() },
  { provide: VECTOR_PROVIDER, useFactory: () => new LocalVectorProvider(config.vector.storePath) },
  {
    provide: WORKSPACE_PROVIDER,
    useFactory: () => new LocalCloneWorkspaceProvider({ workspaceRoot: config.workspace.workspaceRoot }),
  },
  // CAP-002 Git (read-only). Separate port from Workspace — Workspace ≠ Git.
  { provide: GIT_PROVIDER, useFactory: () => new LocalGitProvider() },
  // CAP-006 Workspace Write — applies PatchSet operations to the filesystem (node:fs only).
  { provide: WORKSPACE_WRITER, useFactory: () => new LocalWorkspaceWriter() },
  // CAP-007 Command Execution — runs commands via argv-array spawn, no shell (child_process).
  { provide: COMMAND_RUNNER, useFactory: () => new LocalCommandRunner() },
  {
    provide: PLATFORM_ADAPTER,
    useFactory: () => new DiscordPlatformAdapter(config.discord, new ConsoleLogger('discord')),
  },
  {
    provide: AI_PROVIDERS,
    // Real CLI execution: Claude (Sprint 1b-2) + Ollama (CAP-009, ADR-0030, suggest-only).
    // Codex stays stubbed (no deterministic suggest-only mode → unavailable, never selected).
    // Selection is by capability via the router; Ollama is isAvailable()-gated, so an
    // environment without `ollama` has no runtime change.
    useFactory: (): AiProvider[] => [
      new ClaudeCliProvider(config.ai.claudeBin),
      new OllamaCliProvider({ bin: config.ai.ollamaBin, model: config.ai.ollamaModel }),
    ],
  },
  { provide: CONNECTOR_PROVIDERS, useValue: V1_CONNECTORS },
];

/**
 * Application services. These are pure-core classes wired EXPLICITLY (useFactory
 * + inject tokens) so the core needs no NestJS decorators and no type-based DI
 * metadata — keeping it framework-agnostic.
 */
const application: Provider[] = [
  { provide: RiskPolicy, useFactory: () => new RiskPolicy() },
  { provide: ResponseComposer, useFactory: () => new ResponseComposer() },
  {
    provide: AiProviderManager,
    useFactory: (ai: readonly AiProvider[]) => new AiProviderManager(ai),
    inject: [AI_PROVIDERS],
  },
  {
    provide: CapabilityRouter,
    useFactory: (manager: AiProviderManager) => new CapabilityRouter(manager),
    inject: [AiProviderManager],
  },
  // CAP-008: provider selection is consumed via the ProviderSelector port
  // (CapabilityRouter is its implementation), so the AI capability depends on the
  // selection contract, not the concrete router.
  {
    provide: PROVIDER_SELECTOR,
    useFactory: (router: CapabilityRouter): ProviderSelector => router,
    inject: [CapabilityRouter],
  },
  {
    provide: ActorManager,
    useFactory: (storage: StorageProvider) => new ActorManager(storage),
    inject: [STORAGE_PROVIDER],
  },
  {
    provide: SessionManager,
    useFactory: (storage: StorageProvider) => new SessionManager(storage),
    inject: [STORAGE_PROVIDER],
  },
  {
    provide: TaskManager,
    useFactory: (storage: StorageProvider) => new TaskManager(storage),
    inject: [STORAGE_PROVIDER],
  },
  {
    provide: MemoryManager,
    useFactory: (storage: StorageProvider, vector: VectorProvider) => new MemoryManager(storage, vector),
    inject: [STORAGE_PROVIDER, VECTOR_PROVIDER],
  },
  {
    provide: ArtifactManager,
    useFactory: (storage: StorageProvider) => new ArtifactManager(storage),
    inject: [STORAGE_PROVIDER],
  },
  {
    provide: WorkspaceManager,
    useFactory: (workspace: WorkspaceProvider) => new WorkspaceManager(workspace),
    inject: [WORKSPACE_PROVIDER],
  },
  {
    provide: GitManager,
    useFactory: (git: GitProvider) => new GitManager(git),
    inject: [GIT_PROVIDER],
  },
  // CAP-003 Planning. Strategy behind a port (deterministic only in v2);
  // PlanningManager stays thin and imports no other capability manager.
  {
    provide: EXECUTION_PLANNER,
    useFactory: (risk: RiskPolicy) => new DeterministicPlanner(risk),
    inject: [RiskPolicy],
  },
  {
    provide: PlanningManager,
    useFactory: (planner: ExecutionPlanner) => new PlanningManager(planner),
    inject: [EXECUTION_PLANNER],
  },
  // CAP-004 Approval (domain + policy + manager + persistence). Not wired into
  // the orchestrator / Discord flow yet (deferred).
  {
    provide: ApprovalPolicy,
    useFactory: (risk: RiskPolicy) => new ApprovalPolicy(risk),
    inject: [RiskPolicy],
  },
  {
    provide: ApprovalManager,
    useFactory: (storage: StorageProvider, policy: ApprovalPolicy) =>
      new ApprovalManager(storage, policy),
    inject: [STORAGE_PROVIDER, ApprovalPolicy],
  },
  // CAP-005 Patch (generation only). Not orchestrator/Discord wired.
  {
    provide: PatchManager,
    useFactory: (storage: StorageProvider) => new PatchManager(storage),
    inject: [STORAGE_PROVIDER],
  },
  // CAP-006 Workspace Write (apply PatchSet). Not orchestrator/Discord wired.
  {
    provide: WorkspaceWriteManager,
    useFactory: (storage: StorageProvider, writer: WorkspaceWriter) =>
      new WorkspaceWriteManager(storage, writer),
    inject: [STORAGE_PROVIDER, WORKSPACE_WRITER],
  },
  // CAP-007 Command Execution (gate + run + record). Not orchestrator/Discord wired.
  {
    provide: CommandExecutionManager,
    useFactory: (storage: StorageProvider, runner: CommandRunner, risk: RiskPolicy) =>
      new CommandExecutionManager(storage, runner, risk),
    inject: [STORAGE_PROVIDER, COMMAND_RUNNER, RiskPolicy],
  },
  // CAP-008 AI Code Generation (compose → render → select → execute → parse → record).
  // Reuses the AiProvider port via ProviderSelector; not orchestrator/Discord wired.
  {
    provide: PromptRenderer,
    useFactory: () => new PromptRenderer(),
  },
  {
    provide: CodeGenerationManager,
    useFactory: (
      storage: StorageProvider,
      selector: ProviderSelector,
      promptComposer: PromptComposer,
      promptRenderer: PromptRenderer,
    ) => new CodeGenerationManager(storage, selector, promptComposer, promptRenderer),
    inject: [STORAGE_PROVIDER, PROVIDER_SELECTOR, PromptComposer, PromptRenderer],
  },
  {
    provide: ConnectorManager,
    useFactory: (connectors: readonly ConnectorProvider[]) => new ConnectorManager(connectors),
    inject: [CONNECTOR_PROVIDERS],
  },
  {
    provide: IntentClassifier,
    useFactory: (router: CapabilityRouter) => new IntentClassifier(router),
    inject: [CapabilityRouter],
  },
  {
    provide: Planner,
    useFactory: (router: CapabilityRouter, risk: RiskPolicy) => new Planner(router, risk),
    inject: [CapabilityRouter, RiskPolicy],
  },
  {
    provide: ContextBuilder,
    useFactory: (memory: MemoryManager) => new ContextBuilder(memory),
    inject: [MemoryManager],
  },
  { provide: PromptComposer, useFactory: () => new PromptComposer() },
  {
    provide: ProjectManager,
    useFactory: (
      storage: StorageProvider,
      workspace: WorkspaceManager,
      memory: MemoryManager,
      sessions: SessionManager,
    ) => new ProjectManager(storage, workspace, memory, sessions),
    inject: [STORAGE_PROVIDER, WorkspaceManager, MemoryManager, SessionManager],
  },
  {
    provide: ProjectAnalyzer,
    useFactory: (storage: StorageProvider, workspace: WorkspaceManager) =>
      new ProjectAnalyzer(storage, workspace),
    inject: [STORAGE_PROVIDER, WorkspaceManager],
  },
  // Sprint 2j — Intent Resolver + Execution Orchestrator (Application-Layer composition).
  { provide: IntentResolver, useFactory: () => new IntentResolver() },
  {
    provide: ExecutionOrchestrator,
    useFactory: (
      planning: PlanningManager,
      codeGeneration: CodeGenerationManager,
      workspace: WorkspaceManager,
      approval: ApprovalManager,
      patch: PatchManager,
      workspaceWrite: WorkspaceWriteManager,
      command: CommandExecutionManager,
    ) =>
      new ExecutionOrchestrator({
        planning,
        codeGeneration,
        workspace,
        approval,
        patch,
        workspaceWrite,
        command,
        logger: coreLogger,
      }),
    inject: [
      PlanningManager,
      CodeGenerationManager,
      WorkspaceManager,
      ApprovalManager,
      PatchManager,
      WorkspaceWriteManager,
      CommandExecutionManager,
    ],
  },
  // Sprint 2k — Conversation Runtime (the single conversation entry; ADR-0032). ChunsikCore
  // (below) is a thin facade that delegates to it. Approval-awaiting state is DERIVED from existing
  // aggregates (Session.activeTaskId → Task.planId → approvals.findByExecutionPlan → PENDING); the
  // runtime persists no state and writes no snapshot to Session.
  {
    provide: ConversationRuntime,
    useFactory: (
      storage: StorageProvider,
      actors: ActorManager,
      sessions: SessionManager,
      memory: MemoryManager,
      classifier: IntentClassifier,
      projectManager: ProjectManager,
      analyzer: ProjectAnalyzer,
      tasks: TaskManager,
      workspace: WorkspaceManager,
      contextBuilder: ContextBuilder,
      promptComposer: PromptComposer,
      promptRenderer: PromptRenderer,
      router: CapabilityRouter,
      artifacts: ArtifactManager,
      composer: ResponseComposer,
      risk: RiskPolicy,
      intentResolver: IntentResolver,
      orchestrator: ExecutionOrchestrator,
      approvals: ApprovalManager,
      commandExecutions: CommandExecutionManager,
      codeGeneration: CodeGenerationManager,
      patch: PatchManager,
      workspaceWrite: WorkspaceWriteManager,
    ) => {
      // ADR-0032: production ApprovalFlow — stateless, derived from existing aggregates
      // (Session.activeTaskId → Task.planId → approvals.findByExecutionPlan → PENDING); anchors the
      // in-flight {request, prior} on the in-focus Task so a later turn can resume. No new store.
      const approvalFlow = new StatelessApprovalFlow({
        sessions: storage.sessions,
        tasks: storage.tasks,
        approvals: storage.approvals,
      });
      // ADR-0037: production ScopeClarificationFlow — same shape as StatelessApprovalFlow, one step
      // earlier (before any ExecutionPlan exists). The anchored Task is an inert conversation
      // anchor, distinguished from an approval anchor by planId absence + a metadata discriminator.
      const scopeClarificationFlow = new StatelessScopeClarificationFlow({
        sessions: storage.sessions,
        tasks: storage.tasks,
      });
      // ADR-0040: production ApplyPreviewFlow — same shape as StatelessScopeClarificationFlow. The
      // anchored Task is a plan-less inert conversation anchor, so it is never discoverable by
      // StatelessApprovalFlow's plan-scoped lookup, even though the second (apply) ApprovalRequest it
      // eventually creates references the same executionPlanRef as the first.
      const applyPreviewFlow = new StatelessApplyPreviewFlow({
        sessions: storage.sessions,
        tasks: storage.tasks,
      });
      return new ConversationRuntime({
        actors,
        sessions,
        memory,
        classifier,
        // register via ProjectManager; get via the existing projects repository (ADR-0033 read path).
        projects: {
          register: (path, session) => projectManager.register(path, session),
          get: (id) => storage.projects.get(id),
        },
        analyzer,
        tasks,
        workspace,
        commandExecutions,
        contextBuilder,
        promptComposer,
        promptRenderer,
        router,
        artifacts,
        composer,
        risk,
        intentResolver,
        orchestrator,
        approvals,
        approvalFlow,
        scopeClarificationFlow,
        applyPreviewFlow,
        // ADR-0038: reuses the same, already-registered CodeGenerationManager provider
        // ExecutionOrchestrator already depends on — no new provider.
        codeGeneration,
        // ADR-0041: reuses the same, already-registered PatchManager provider (representation-only) and
        // storage.codeProposals — no new provider.
        patch,
        codeProposals: { get: (id) => storage.codeProposals.get(id) },
        // ADR-0042: reuses the same, already-registered WorkspaceWriteManager provider (the sole file
        // mutator) ExecutionOrchestrator already depends on — no new provider.
        workspaceWrite,
        logger: coreLogger,
      });
    },
    inject: [
      STORAGE_PROVIDER,
      ActorManager,
      SessionManager,
      MemoryManager,
      IntentClassifier,
      ProjectManager,
      ProjectAnalyzer,
      TaskManager,
      WorkspaceManager,
      ContextBuilder,
      PromptComposer,
      PromptRenderer,
      CapabilityRouter,
      ArtifactManager,
      ResponseComposer,
      RiskPolicy,
      IntentResolver,
      ExecutionOrchestrator,
      ApprovalManager,
      CommandExecutionManager,
      CodeGenerationManager,
      PatchManager,
      WorkspaceWriteManager,
    ],
  },
  // Thin platform-entry facade (ADR-0032): delegates to ConversationRuntime, then delivers.
  {
    provide: ChunsikCore,
    useFactory: (runtime: ConversationRuntime, platform: PlatformAdapter) =>
      new ChunsikCore({ runtime, platform, logger: coreLogger }),
    inject: [ConversationRuntime, PLATFORM_ADAPTER],
  },
];

@Module({
  providers: [...infrastructure, ...application],
})
export class AppModule {}
