# Stage 2B Slice 5C-EG-F0-R Offline Runner

This directory owns the non-production, fixture-only executable representation of the accepted F0 allowlist in
`allowlist.ts`. The Markdown allowlist remains the Architecture and Safety specification; this versioned TypeScript
object is its single machine-readable command contract. Drift tests pin the 16 command ids and exclude templates.

The runner exposes pure canonicalization, symbol resolution, dependency, identity, stream-policy, normalization, and
evidence functions. `AllowedCommandExecutor` and `ExecutableIdentityVerifier` are boundaries only. There is no real
host adapter, shell lookup, process spawn, network access, daemon contact, or production-runtime import.

Validation:

```text
pnpm exec vitest run tools/provider-routing/egress-allowlist-runner/runner.test.ts
pnpm exec tsc -p tools/provider-routing/egress-allowlist-runner/tsconfig.json
```
