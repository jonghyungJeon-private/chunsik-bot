# Stage 2B Slice 5C-EG-F0-R Offline Runner

This directory owns the non-production, fixture-only executable representation of the accepted F0 allowlist in
`allowlist.ts`. The Markdown allowlist remains the Architecture and Safety specification; this versioned TypeScript
object is its single machine-readable command contract. Drift tests pin the 16 command ids and exclude templates.

The runner exposes pure canonicalization, symbol resolution, dependency, identity, stream-policy, normalization, and
evidence functions. `AllowedCommandExecutor` and `ExecutableIdentityVerifier` are boundaries only. There is no real
host adapter, shell lookup, process spawn, network access, daemon contact, or production-runtime import.

The static allowlist binds command shape, `approvalStatus=CANDIDATE_ONLY_NOT_APPROVED`, normalization, policies, and
validated dependency declarations. Repository divergence is not static: `ExecutionBaselineBinding` owns the
approval-supplied expected behind/ahead counts and has a separate digest. Dependency state is module-issued only from
the exact closed symbol resolution and context-matching successful prior evidence; arbitrary strings are rejected.

Fixture output is a sequence of stdout/stderr chunks. Caps and strict UTF-8/newline normalization are applied
incrementally across chunk boundaries. A value equal to its byte/line cap is allowed; one greater is rejected. Raw
accumulators are discarded after normalization or failure. The canonical digest remains unfrozen and F0/F1 execution
remains unapproved.

Validation:

```text
pnpm exec vitest run tools/provider-routing/egress-allowlist-runner/runner.test.ts
pnpm exec tsc -p tools/provider-routing/egress-allowlist-runner/tsconfig.json
```
