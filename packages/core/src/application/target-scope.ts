/**
 * Deterministic candidate project-relative file-path extraction from raw user text (Sprint 2o,
 * ADR-0036). Pure, synchronous, no I/O, no Workspace access — finds tokens that LOOK like a
 * project-relative file path (require a `/`, per CA Round 1 — rejects bare filenames, "Node.js",
 * "e.g.", "v1.2.3"), in order of appearance, filtering out anything absolute or containing a `..`
 * segment. A candidate here is NEVER trusted as sufficient scope on its own — the caller
 * (ConversationRuntime) must validate it exists in the real workspace via the existing read-only
 * Workspace capability (`WorkspaceManager.list`) before treating it as a target file.
 *
 * This module is a pure Application-layer parser helper — not a capability, not a domain service,
 * not a port/adapter/repository.
 */
export function extractTargetPathCandidates(text: string): string[] {
  const matches = text.match(/\b[\w][\w./-]*\.[a-zA-Z0-9]+\b/g) ?? [];
  const out: string[] = [];
  for (const m of matches) {
    if (!m.includes('/')) continue; // require a path separator — rejects bare filenames/tokens
    if (m.startsWith('/') || m.startsWith('.')) continue; // absolute or hidden/dot-relative
    if (m.split('/').includes('..')) continue; // traversal
    if (!out.includes(m)) out.push(m);
  }
  return out;
}

/**
 * Normalize a project-relative path for exact-match comparison against a Workspace-returned hit.
 * Strips a leading `./`, collapses duplicate slashes, drops a trailing slash. Never resolves `..` —
 * a path containing `..` is not made safe by this function; {@link extractTargetPathCandidates}
 * already rejects those before they reach here.
 */
export function normalizeRelativePath(path: string): string {
  return path.replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/$/, '');
}
