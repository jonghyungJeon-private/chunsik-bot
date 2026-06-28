import type { Id } from '../domain';

export interface QueueJob<T = unknown> {
  id: Id;
  name: string;
  payload: T;
  attempts: number;
  maxAttempts: number;
}

export interface EnqueueOptions {
  maxAttempts?: number;
  /** Delay before the job becomes visible, in ms. */
  delayMs?: number;
}

export type JobHandler<T> = (job: QueueJob<T>) => Promise<void>;

/**
 * PORT: asynchronous work. v1 implementation: LocalQueueProvider (in-process).
 *
 * Abstracted now so v2 can swap to Redis/BullMQ without touching the core.
 * The core enqueues task work; it does not know whether the queue is in-memory
 * or distributed.
 */
export interface QueueProvider {
  enqueue<T>(name: string, payload: T, options?: EnqueueOptions): Promise<Id>;
  /** Register a worker for a named job type. */
  process<T>(name: string, handler: JobHandler<T>): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}
