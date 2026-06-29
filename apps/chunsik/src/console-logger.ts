/* eslint-disable no-console */
import type { Logger, LogFields } from '@chunsik/core';

/**
 * The ONE place `console` is used. A namespaced, console-backed `Logger`.
 * Output: `[namespace] message key=value …` (undefined fields omitted).
 *
 * This is the v1 implementation of the Logger seam; a future LoggerProvider can
 * replace it in the composition root without touching call sites.
 */
export class ConsoleLogger implements Logger {
  constructor(private readonly namespace: string) {}

  info(message: string, fields?: LogFields): void {
    console.log(this.format(message, fields));
  }

  warn(message: string, fields?: LogFields): void {
    console.warn(this.format(message, fields));
  }

  error(message: string, fields?: LogFields): void {
    console.error(this.format(message, fields));
  }

  private format(message: string, fields?: LogFields): string {
    const pairs = fields
      ? Object.entries(fields)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}=${v}`)
      : [];
    return `[${this.namespace}] ${message}${pairs.length ? ` ${pairs.join(' ')}` : ''}`;
  }
}
