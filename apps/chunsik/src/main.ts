import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

import {
  ActorManager,
  SessionManager,
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
import { ConsoleLogger } from './console-logger';

const log = new ConsoleLogger('chunsik');

/**
 * Boots Chunsik as a standalone Nest application context (no HTTP server —
 * Discord is the interface). Resolves providers/services from DI, wires the
 * inbound handler, and starts infrastructure.
 *
 * Sprint 1a — WALKING SKELETON: the inbound handler resolves the Actor, opens a
 * Session, persists it, and echoes the message. There is intentionally NO
 * cognition (no Intent/Planner/PromptComposer/AI execution). Sprint 1b replaces
 * this handler with `ChunsikCore.handleInboundMessage`.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const storage = app.get<StorageProvider>(STORAGE_PROVIDER);
  const vector = app.get<VectorProvider>(VECTOR_PROVIDER);
  const queue = app.get<QueueProvider>(QUEUE_PROVIDER);
  const platform = app.get<PlatformAdapter>(PLATFORM_ADAPTER);
  const actors = app.get(ActorManager);
  const sessions = app.get(SessionManager);

  platform.onMessage(async (message) => {
    const actor = await actors.resolveFromContext(message.context);
    const session = await sessions.openForContext(message.context, actor.id);
    await sessions.touch(session);
    await platform.sendMessage({
      context: message.context,
      text: `🐹 echo: ${message.text}`,
    });
    log.info('echo handled', { actorId: actor.id, sessionId: session.id });
  });

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

  log.info('started (Sprint 1a walking skeleton — echo mode)');
}

bootstrap().catch((err) => {
  log.error('failed to start', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
