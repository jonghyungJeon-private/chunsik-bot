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
import { ConsoleLogger } from './console-logger';
import { serializeError } from './error-diagnostics';

const log = new ConsoleLogger('chunsik');

/**
 * Boots Chunsik as a standalone Nest application context (no HTTP server —
 * Discord is the interface). Resolves providers/services from DI, wires the
 * inbound handler, and starts infrastructure.
 *
 * Sprint 1b-1 — the inbound handler is `ChunsikCore.handleInboundMessage`,
 * which runs the real pipeline: resolve Actor → open Session → classify →
 * create Task → plan → ContextBuilder → PromptComposer → route → provider →
 * Artifact → reply. The AI provider is a deterministic placeholder in 1b-1;
 * Sprint 1b-2 swaps in the real Claude CLI execution.
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

  // Track B (Sprint 4c-Follow-up-2): secret-free structured diagnostics — name/message/redacted stack/cause plus
  // non-secret correlation context (stage + message/channel/user ids). The raw message text is deliberately NOT
  // logged (a user could paste a secret into chat); only non-secret identifiers are.
  platform.onMessage((message) =>
    core.handleInboundMessage(message).catch((err) =>
      log.error(
        'inbound handling failed',
        serializeError(err, {
          stage: 'inbound',
          messageId: message.id,
          platform: message.context.platform,
          channelId: message.context.channelId,
          userId: message.context.userId,
        }),
      ),
    ),
  );
  platform.onApprovalDecision((decision) =>
    core.handleApprovalDecision(decision).catch((err) =>
      log.error(
        'approval handling failed',
        serializeError(err, {
          stage: 'approval-decision',
          approvalId: decision.approvalId,
          approved: decision.approved,
        }),
      ),
    ),
  );

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

  log.info('started (Sprint 1g — gated project analysis, ADR-0019)');
}

bootstrap().catch((err) => {
  log.error('failed to start', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
