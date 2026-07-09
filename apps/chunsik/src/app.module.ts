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
  RepositoryIdentityResolver,
  RepositoryHostingManager,
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
import { GitHubRepositoryHostingProvider } from '@chunsik/repository-hosting-github';
import { GitHubAppAuth } from '@quoky/github-app-auth';
import { LocalCommandRunner } from '@chunsik/command-local';
import { ClaudeCliProvider, CodexCliProvider, OllamaCliProvider } from '@chunsik/ai-cli';
import { V1_CONNECTORS } from '@chunsik/connectors';

import { loadConfig } from './config';
import { ConsoleLogger } from './console-logger';
import { GitHubAppGitProvider } from './github-app-git-provider';

const config = loadConfig();
const coreLogger = new ConsoleLogger('chunsik');

// Sprint 4b (ADR-0061): GitHub App authentication for RepositoryHosting (CAP-010) + git push/clone (CAP-002).
// Resolve the reviewed identity (independent of credentials), then select the auth mode and construct the hosting
// adapter + the App-auth git decorator ONLY when auth is fully configured; otherwise the capability is
// "not configured" and fails safe. The App private key / minted token are ADAPTER-LOCAL: passed ONLY into
// @quoky/github-app-auth here; never into @chunsik/core, ConversationRuntime, anchors, ApprovalRequest.reason,
// logs, or Discord. `manager` reaches ConversationRuntime as `RepositoryHostingManager | undefined` — never a token.
const repositoryIdentityResolution = new RepositoryIdentityResolver().resolve(config.repositoryHosting);
const repositoryIdentity =
  repositoryIdentityResolution.status === 'resolved' ? repositoryIdentityResolution.identity : undefined;

const appConfigured = config.githubApp !== undefined;
const devPatToken = (config.githubToken ?? '').trim();
const patConfigured = devPatToken.length > 0;
const isDevRuntime = config.runtimeEnv === 'dev';

// Auth-mode selection (ADR-0061 §10.2). prod: App-only; PAT-only rejected; App+PAT rejected as ambiguous.
// dev: App precedence; PAT fallback allowed. "Rejected" → not configured (fail-safe; a sanitized warning, no secret).
let hostingAuthMode: 'github-app' | 'pat' | 'none';
if (appConfigured && patConfigured) {
  if (isDevRuntime) {
    hostingAuthMode = 'github-app';
  } else {
    hostingAuthMode = 'none';
    coreLogger.warn(
      'repository hosting: both GitHub App and PAT are configured in a non-dev runtime — rejected as ambiguous; capability not configured',
    );
  }
} else if (appConfigured) {
  hostingAuthMode = 'github-app';
} else if (patConfigured) {
  if (isDevRuntime) {
    hostingAuthMode = 'pat';
  } else {
    hostingAuthMode = 'none';
    coreLogger.warn(
      'repository hosting: PAT auth is not allowed in a non-dev runtime (GitHub App required) — capability not configured',
    );
  }
} else {
  hostingAuthMode = 'none';
}

let repositoryHostingManager: RepositoryHostingManager | undefined;
// GIT_PROVIDER default: the plain LocalGitProvider (local ops + dev-PAT/ambient-credential git). Replaced by the
// App-auth decorator only in github-app mode, so git push/clone uses a minted installation token via GIT_ASKPASS.
let gitProvider: GitProvider = new LocalGitProvider();

if (hostingAuthMode === 'github-app' && repositoryIdentity && config.githubApp) {
  const identity = repositoryIdentity;
  const appAuth = new GitHubAppAuth({ appId: config.githubApp.appId, privateKeyPem: config.githubApp.privateKeyPem });
  // Lazily resolve + cache the installation id (explicit env id, else the reviewed owner/repo). The token source
  // mints/caches a short-lived installation token DOWN-SCOPED to the single target repo (numeric repository_ids +
  // minimal contents/pull_requests write; ADR-0061 §8.4) — the SINGLE source shared by REST (CAP-010) and git
  // (CAP-002). "Not installed" or "repo not accessible" throws → surfaced pre-mutation upstream (Blocked /
  // not-configured); there is no broad-token fallback.
  let cachedInstallationId: number | undefined = config.githubAppInstallationId;
  const tokenSource = async (): Promise<string> => {
    if (cachedInstallationId === undefined) {
      const resolved = await appAuth.resolveInstallationId(identity.owner, identity.repo);
      if (resolved === null) throw new Error('github app: not installed on the configured repository');
      cachedInstallationId = resolved;
    }
    return appAuth.tokenForRepository(cachedInstallationId, identity.owner, identity.repo, {
      contents: 'write',
      pull_requests: 'write',
    });
  };
  repositoryHostingManager = new RepositoryHostingManager(
    new GitHubRepositoryHostingProvider({ auth: { kind: 'github-app', tokenSource } }),
  );
  gitProvider = new GitHubAppGitProvider({ makeLocalGit: (runner) => new LocalGitProvider(runner), tokenSource });
} else if (hostingAuthMode === 'pat' && repositoryIdentity) {
  repositoryHostingManager = new RepositoryHostingManager(
    new GitHubRepositoryHostingProvider({ auth: { kind: 'pat', token: devPatToken } }),
  );
  // Dev PAT is a REST-only convenience (ADR-0061 §11.3): local git push uses the developer's own git credential,
  // so GIT_PROVIDER stays the plain LocalGitProvider.
}
const repositoryHosting = { identity: repositoryIdentity, manager: repositoryHostingManager };

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
  // CAP-002 Git. Separate port from Workspace — Workspace ≠ Git. In github-app auth mode this is the
  // GitHubAppGitProvider decorator (App-token push/clone via one-shot GIT_ASKPASS; ADR-0061); otherwise the plain
  // LocalGitProvider. LocalGitProvider itself is unchanged.
  { provide: GIT_PROVIDER, useFactory: () => gitProvider },
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
      git: GitManager,
    ) => {
      // ADR-0032: production ApprovalFlow — stateless, derived from existing aggregates
      // (Session.activeTaskId → Task.planId → approvals.findByExecutionPlan → PENDING); anchors the
      // in-flight {request, prior} on the in-focus Task so a later turn can resume. No new store.
      // Track A / ADR-0062 (Sprint 4c-Follow-up-2) — pass the LIVE storage seam to the stateless flows, never an
      // eager { sessions: storage.sessions, tasks: storage.tasks } snapshot. This factory runs during
      // NestFactory.createApplicationContext (main.ts) BEFORE `await storage.init()`, and the sqlite
      // StorageProvider's repositories (`sessions!`/`tasks!`/`approvals!`) are undefined until init() assigns them.
      // Capturing the values here froze `undefined` into the flow, so a later `.save()` threw
      // "Cannot read properties of undefined (reading 'save')". The flows already dereference `store.sessions`/
      // `store.tasks` at CALL time (post-init) — mirroring SessionManager — so holding the live `storage` object
      // resolves the initialized repos. `StorageProvider` structurally satisfies each flow's narrowed store.
      const approvalFlow = new StatelessApprovalFlow(storage);
      // ADR-0037: production ScopeClarificationFlow — one step earlier (before any ExecutionPlan exists). The
      // anchored Task is an inert conversation anchor, distinguished from an approval anchor by planId absence.
      const scopeClarificationFlow = new StatelessScopeClarificationFlow(storage);
      // ADR-0040: production ApplyPreviewFlow — a plan-less inert conversation anchor, never discoverable by
      // StatelessApprovalFlow's plan-scoped lookup.
      const applyPreviewFlow = new StatelessApplyPreviewFlow(storage);
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
        // ADR-0043: reuses the same, already-injected CommandExecutionManager (the sole command runner) as
        // the post-apply validation runner — no new provider/import/inject; runs only pnpm test/typecheck.
        command: commandExecutions,
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
        // ADR-0044: reuses the already-registered GitManager (CAP-002) for the read-only post-apply git
        // preview — status + the new read-only diff extension only; no new provider, no git mutation.
        git,
        // ADR-0054: Repository Hosting (CAP-010) for actual PR creation execution — resolved identity +
        // RepositoryHostingManager (present only when a GitHub token is configured). NO token is passed here.
        // The runtime calls the manager only, never GitHubRepositoryHostingProvider directly.
        repositoryHosting,
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
      GitManager,
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
