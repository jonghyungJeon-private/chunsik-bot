/**
 * Stable, provider-independent identity of an external input (ADR-0074).
 *
 * A ResourceRef is a value object, not an aggregate, cached connector payload,
 * persistent resource record, or generated Artifact.
 */
export class ResourceRef {
  readonly source: string;
  readonly externalId: string;

  constructor(input: { source: string; externalId: string }) {
    this.source = requireIdentityPart(input.source, 'source');
    this.externalId = requireIdentityPart(input.externalId, 'externalId');
    Object.freeze(this);
  }

  equals(other: ResourceRef): boolean {
    return this.source === other.source && this.externalId === other.externalId;
  }

  get identity(): string {
    return `${this.source}:${this.externalId}`;
  }
}

function requireIdentityPart(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`ResourceRef ${name} must be non-empty`);
  }
  return value.trim();
}
