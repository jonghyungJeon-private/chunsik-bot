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
    // Sprint 1b-2: real Claude CLI execution. Codex/Ollama remain stubbed and are
    // wired in a future sprint. Selection is by capability via the router.
    useFactory: (): AiProvider[] => [new ClaudeCliProvider(config.ai.claudeBin)],
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
  {
    provide: ChunsikCore,
    useFactory: (
      classifier: IntentClassifier,
      planner: Planner,
      router: CapabilityRouter,
      tasks: TaskManager,
      actors: ActorManager,
      sessions: SessionManager,
      projects: ProjectManager,
      analyzer: ProjectAnalyzer,
      memory: MemoryManager,
      contextBuilder: ContextBuilder,
      promptComposer: PromptComposer,
      artifacts: ArtifactManager,
      workspace: WorkspaceManager,
      connectors: ConnectorManager,
      composer: ResponseComposer,
      platform: PlatformAdapter,
      risk: RiskPolicy,
    ) =>
      new ChunsikCore({
        classifier,
        planner,
        router,
        tasks,
        actors,
        sessions,
        projects,
        analyzer,
        memory,
        contextBuilder,
        promptComposer,
        artifacts,
        workspace,
        connectors,
        composer,
        platform,
        risk,
        logger: coreLogger,
      }),
    inject: [
      IntentClassifier,
      Planner,
      CapabilityRouter,
      TaskManager,
      ActorManager,
      SessionManager,
      ProjectManager,
      ProjectAnalyzer,
      MemoryManager,
      ContextBuilder,
      PromptComposer,
      ArtifactManager,
      WorkspaceManager,
      ConnectorManager,
      ResponseComposer,
      PLATFORM_ADAPTER,
      RiskPolicy,
    ],
  },
];

@Module({
  providers: [...infrastructure, ...application],
})
export class AppModule {}
