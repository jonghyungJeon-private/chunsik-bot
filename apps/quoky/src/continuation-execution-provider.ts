import type { FactoryProvider } from '@nestjs/common';
import { AgentProfileRegistry, CONTINUATION_BINDING_REPOSITORY, ContinuationExecutionEntryService,
  ContinuationExecutionService, STORAGE_PROVIDER, TaskManager, WorkHandoffContinuationService } from '@quoky/core';
import type { ContinuationBindingRepository, StorageProvider } from '@quoky/core';

/** DI availability only: no transport, runtime trigger or receiver activation. */
export const continuationExecutionEntryProvider: FactoryProvider<ContinuationExecutionEntryService> = {
  provide: ContinuationExecutionEntryService,
  useFactory: (storage: StorageProvider, profiles: AgentProfileRegistry, bindings: ContinuationBindingRepository, tasks: TaskManager) =>
    new ContinuationExecutionEntryService(storage, profiles, bindings, tasks),
  inject: [STORAGE_PROVIDER, AgentProfileRegistry, CONTINUATION_BINDING_REPOSITORY, TaskManager],
};

export const continuationExecutionProvider: FactoryProvider<ContinuationExecutionService> = {
  provide: ContinuationExecutionService,
  useFactory: (storage: StorageProvider, profiles: AgentProfileRegistry, bindings: ContinuationBindingRepository,
    preparation: WorkHandoffContinuationService, entry: ContinuationExecutionEntryService) =>
    new ContinuationExecutionService(storage, profiles, bindings, preparation, entry),
  inject: [STORAGE_PROVIDER, AgentProfileRegistry, CONTINUATION_BINDING_REPOSITORY,
    WorkHandoffContinuationService, ContinuationExecutionEntryService],
};
