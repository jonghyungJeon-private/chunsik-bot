/**
 * Structured logging seam. The core/app/adapters depend ONLY on this interface,
 * never on `console` directly. v1 ships a single console-backed implementation
 * in the app layer; a future `LoggerProvider` (file/JSON/OTel) can replace it
 * without changing any call site.
 *
 * Keep fields primitive and non-sensitive — never log tokens, secrets, or raw
 * message content.
 */
export type LogFields = Record<string, string | number | boolean | undefined>;

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}
