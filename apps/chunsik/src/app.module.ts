import { Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';

import {
  // Injection tokens (ports)
  PLATFORM_ADAPTER,
  STORAGE_PROVIDER,
  QUEUE_PROVIDER,
  VECTOR_PROVIDER,
  WORKSPACE_PROVIDER,
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
  ContextBuilder,
  PromptComposer,
  TaskManager,
  MemoryManager,
  ArtifactManager,
  WorkspaceManager,
  ConnectorManager,
  ResponseComposer,
  RiskPolicy,
} from '@chunsik/core';
import type {
  AiProvider,
  ConnectorProvider,
  PlatformAdapter,
  StorageProvider,
  VectorProvider,
  WorkspaceProvider,
} from '@chunsik/core';

// Concrete providers — the ONLY file allowed to import them.
import { DiscordPlatformAdapter } from '@chunsik/adapter-discord';
import { SqliteStorageProvider } from '@chunsik/storage-sqlite';
import { LocalQueueProvider } from '@chunsik/queue-local';
import { LocalVectorProvider } from '@chunsik/vector-local';
import { LocalCloneWorkspaceProvider } from '@chunsik/workspace-local';
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
    provide: ChunsikCore,
    useFactory: (
      classifier: IntentClassifier,
      planner: Planner,
      router: CapabilityRouter,
      tasks: TaskManager,
      actors: ActorManager,
      sessions: SessionManager,
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
