import { NotImplementedError } from '@chunsik/core';
import type { EnqueueOptions, Id, JobHandler, QueueProvider } from '@chunsik/core';

/**
 * SKELETON. Implements QueueProvider as a single-process queue.
 *
 * TODO(impl): back this with an in-memory array + a tick loop (or a small lib),
 * supporting maxAttempts retries and delayMs. Abstracted now so v2 can swap to
 * Redis/BullMQ behind the same port with no core change.
 */
export class LocalQueueProvider implements QueueProvider {
  private readonly handlers = new Map<string, JobHandler<unknown>>();

  async enqueue<T>(_name: string, _payload: T, _options?: EnqueueOptions): Promise<Id> {
    throw new NotImplementedError('LocalQueueProvider.enqueue');
  }

  process<T>(name: string, handler: JobHandler<T>): void {
    this.handlers.set(name, handler as JobHandler<unknown>);
  }

  async start(): Promise<void> {
    // No-op lifecycle in v1: there is no worker loop yet. `enqueue` remains
    // unimplemented, so nothing is dispatched until the queue is built.
    void this.handlers;
  }

  async stop(): Promise<void> {
    // No-op lifecycle in v1.
  }
}
