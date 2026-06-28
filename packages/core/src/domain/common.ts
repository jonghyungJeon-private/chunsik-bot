/** Opaque identifier. Storage providers decide the concrete format. */
export type Id = string;

/** ISO-8601 timestamp string, e.g. "2026-06-28T10:00:00.000Z". */
export type IsoTimestamp = string;

/** A generic, provider-agnostic key/value bag for extension metadata. */
export type Metadata = Record<string, unknown>;
