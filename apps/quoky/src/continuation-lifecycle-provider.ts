import type { FactoryProvider } from '@nestjs/common';
import { AgentProfileRegistry, ApprovalManager, CONTINUATION_BINDING_REPOSITORY, STORAGE_PROVIDER, TaskManager,
  WorkHandoffContinuationService } from '@quoky/core';
import type { ContinuationBindingRepository, StorageProvider } from '@quoky/core';

/** Explicit application entry: admit exact provenance, then prepare its Task; no receiver dispatch. */
export const continuationLifecycleProvider: FactoryProvider<WorkHandoffContinuationService> = {
  provide: WorkHandoffContinuationService,
  useFactory: (storage: StorageProvider, profiles: AgentProfileRegistry, tasks: TaskManager, approvals: ApprovalManager, bindings: ContinuationBindingRepository) =>
    new WorkHandoffContinuationService(storage, profiles, bindings, { tasks, approvals }),
  inject: [STORAGE_PROVIDER, AgentProfileRegistry, TaskManager, ApprovalManager, CONTINUATION_BINDING_REPOSITORY],
};
