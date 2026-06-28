import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

import {
  ChunsikCore,
  PLATFORM_ADAPTER,
  STORAGE_PROVIDER,
  VECTOR_PROVIDER,
  QUEUE_PROVIDER,
} from '@chunsik/core';
import type {
  PlatformAdapter,
  QueueProvider,
  StorageProvider,
  VectorProvider,
} from '@chunsik/core';

import { AppModule } from './app.module';

/**
 * Boots Chunsik as a standalone Nest application context (no HTTP server —
 * Discord is the interface). Resolves the orchestrator + platform from the DI
 * container, wires the inbound handlers, and starts infrastructure.
 *
 * NOTE: v1 providers are skeletons that throw NotImplementedError, so the
 * init/start calls below will surface as a clear startup error until they are
 * implemented. The wiring and types, however, are real.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const storage = app.get<StorageProvider>(STORAGE_PROVIDER);
  const vector = app.get<VectorProvider>(VECTOR_PROVIDER);
  const queue = app.get<QueueProvider>(QUEUE_PROVIDER);
  const platform = app.get<PlatformAdapter>(PLATFORM_ADAPTER);
  const core = app.get(ChunsikCore);

  // The platform delivers normalized messages; the core owns all logic.
  platform.onMessage((message) => core.handleInboundMessage(message));
  platform.onApprovalDecision((decision) => core.handleApprovalDecision(decision));

  await storage.init();
  await vector.init();
  await queue.start();
  await platform.start();

  const shutdown = async (): Promise<void> => {
    await platform.stop().catch(() => undefined);
    await queue.stop().catch(() => undefined);
    await storage.close().catch(() => undefined);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // eslint-disable-next-line no-console
  console.log('[chunsik] started');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[chunsik] failed to start:', err);
  process.exit(1);
});
