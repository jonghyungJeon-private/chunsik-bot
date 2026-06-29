# Chunsik — Version 1 Architecture Conformance Audit (Freeze Gate)

- **Type:** Architecture Conformance Audit (review sprint — no feature work).
- **Date:** 2026-06-29
- **Scope:** Verify the implementation conforms to the architectural constitution
  (`ARCHITECTURE.md`) and recorded decisions (`DECISIONS.md`, ADR-0001…0019) before
  Version 1 is frozen, and determine readiness for **v1.0.0-rc1**.
- **Audited against:** `ARCHITECTURE.md`, `DECISIONS.md`, `CURRENT_STATE.md`, ADRs,
  and the actual source under `packages/*` and `apps/chunsik`.
- **Method:** static boundary/dependency analysis, per-service responsibility review,
  domain/ports inventory, SQLite schema review, security review, plus `pnpm typecheck`
  and `pnpm test`.

---

## 1. Executive Summary

Chunsik v1 is **structurally sound and conforms to every hard ("never") rule** in the
constitution. The Core is pure (no platform/driver/CLI/framework types), dependencies
point strictly inward (`apps → adapters → core`), provider selection is data-driven
(no branching on provider `id`), Chunsik Memory is the source of truth, and unbuilt
capabilities are **honestly stubbed** with `NotImplementedError` rather than faked.
Security practice is strong: prompts travel by stdin only, secrets are masked before
logging/persistence, SQL is fully parameterized, and file analysis is allow-listed and
secret-filtered.

All findings are **WARNING-level** — no defect requires code correction to freeze.
They cluster into three areas: (1) **documentation drift** — the constitution's `[NOW]/
[RESERVE]` status tags and two "reserve a field" mandates (`workflowId`, structured
`Usage`) no longer match the code (they were dropped under ADR-0013's YAGNI but never
reconciled); (2) **scale readiness** — the SQLite schema defines no secondary indexes
and has no migration-versioning system; (3) **minor hygiene** — one dead file, one
unused method, and one missing ADR (the Logger port).

**Verdict: PASS WITH WARNINGS. Overall score: 90 / 100. Recommended: FREEZE as
v1.0.0-rc1**, with the Immediate-tier items below tracked as fast-follow doc/hygiene
fixes before the final `v1.0.0` tag.

| Gate | Result |
|---|---|
| `pnpm typecheck` | ✅ PASS (exit 0) |
| `pnpm test` | ✅ 12 files / 62 tests PASS |
| `git status` | clean before audit; only this report added (no source changes) |
| Hard-rule violations | **0** |
| Warnings | 9 (see §13) |

---

## 2. Overall Score

**90 / 100 — PASS WITH WARNINGS.**

| Dimension | Weight | Score | Notes |
|---|---|---|---|
| Boundary purity | 20 | 20 | Core imports only `node:crypto` (sanctioned id util, §11.6). |
| Dependency direction | 20 | 20 | Inward-only; no reverse/circular/cross-adapter deps. |
| Provider-agnosticism | 15 | 15 | Data-driven routing; no `id` branching; stdin-only prompts. |
| Domain / responsibility | 15 | 13 | Clean SoC; one unused method straddles the memory/workspace line. |
| Security | 15 | 14 | Masking + allow-list + parameterized SQL; residual user-typed-secret risk. |
| Documentation conformance | 10 | 6 | Stale `[NOW]/[RESERVE]` tags; `workflowId`/`Usage` reserve mandates unmet. |
| Persistence / scale | 5 | 2 | No secondary indexes; no migration versioning (V2 concern). |

---

## 3. Boundary Audit — ✅ PASS

Rule (§2.2, §11.2, §12): no Discord, SQLite, Node-framework, `child_process`, `fs`,
Claude/Codex/Ollama, or adapter type may appear in `@chunsik/core`.

- Grep of `packages/core/src/**/*.ts` (excluding tests) for `node:*`, `discord`,
  `better-sqlite3`, `@nestjs`, `child_process`, `fs`, `spawn/exec`, `require(`, and
  any `@chunsik/<adapter>` import → **one match only**: `node:crypto.randomUUID` in
  `util/id.ts`.
- This is **sanctioned by ARCHITECTURE.md §11.6** ("ids come from the shared `id`
  utility, swappable for tests"). `randomUUID` is a platform-neutral builtin, not a
  driver/framework/provider type. **Not a violation.** (Watch-item W-7: for maximal
  purity it could become an `IdProvider` port; the constitution explicitly allows the
  current util, so no action required to freeze.)
- No `fs`, `child_process`, `process.*`, `spawn`, or `exec` anywhere in core. All such
  Node APIs live in adapters (`ai-cli` uses `spawn`; `workspace-local` uses `fs`/
  `spawnSync`), which is correct.

**Result: PASS.**

---

## 4. Dependency Audit — ✅ PASS

Rule (§2.4): `apps → adapters → core`; no reverse, circular, or hidden dependency.

Actual graph (verified from every `package.json` + tsconfig `references`):

```
@chunsik/core            → (no workspace deps; no @chunsik/* imports)
@chunsik/adapter-discord → @chunsik/core, discord.js
@chunsik/storage-sqlite  → @chunsik/core, better-sqlite3
@chunsik/ai-cli          → @chunsik/core
@chunsik/workspace-local → @chunsik/core
@chunsik/queue-local     → @chunsik/core
@chunsik/vector-local    → @chunsik/core
@chunsik/connectors      → @chunsik/core
@chunsik/app (apps/…)    → @chunsik/core + ALL adapters + @nestjs/* + reflect-metadata + rxjs
```

- **Core has zero outbound workspace imports** (`packages/core/src/**` imports no
  `@chunsik/*` package). ✅
- **Every adapter depends only on `@chunsik/core`.** No sibling-adapter import found
  (e.g. storage→discord, ai-cli→workspace) — searched, **none**. ✅
- **`apps/chunsik/src/app.module.ts` is the sole composition root** — the only place
  that imports concrete adapter classes and binds them to port tokens
  (`STORAGE_PROVIDER`, `QUEUE_PROVIDER`, `VECTOR_PROVIDER`, `WORKSPACE_PROVIDER`,
  `PLATFORM_ADAPTER`, `AI_PROVIDERS`, `CONNECTOR_PROVIDERS`). ✅
- tsconfig `references` mirror the runtime graph; the build enforces the boundary
  (Core cannot resolve an adapter package).

**Result: PASS — textbook ports-and-adapters dependency inversion.**

---

## 5. Architecture Drift Audit — ⚠️ PASS WITH WARNINGS

Comparing constitution + ADRs vs. implementation.

### 5.1 Implemented but under-documented (status tag stale → should be `[NOW]`)
ARCHITECTURE.md §4 still tags these `[RESERVE]`, but they are fully implemented:
- `Session` (aggregate) + `SessionManager` — built (Sprint 1a+).
- `Actor`/`Principal` + `ActorManager` — built (ADR-0009).
- `ContextBuilder` (§6.4 seam, ADR-0002) — built.
- `PromptComposer` + `PromptSpec` + `ContextBundle` (ADR-0003) — built.

→ **W-1 (drift):** the `[RESERVE]` tags for the above are stale; they are `[NOW]`.

### 5.2 Documented/reserved but NOT implemented (mandate unmet)
- **`workflowId` on `Task` — MISSING.** ARCHITECTURE.md §4 ("Workflow `[LATER]` —
  reserve `workflowId` on Task") and **ADR-0004** mandate a reserved nullable field.
  `domain/task.ts` has no `workflowId`. → **W-2 (drift, notable).**
  - *Reconciliation:* ADR-0013 ("YAGNI on seams") dropped premature reserves, and the
    JSON-blob storage model makes adding a nullable field later **free** (no migration).
    So the omission is defensible — but ADR-0004 / §4 were never updated to say so. The
    decision record and the constitution now contradict the code.
- **Structured `Usage`/cost on `TaskRun` — PARTIAL.** ARCHITECTURE.md ("TaskRun (+
  Usage/cost), Usage `[RESERVE]`") and **ADR-0010**. Implementation has only
  `durationMs` (commented "minimal usage tracking, ADR-0015"); no `usage`/`cost`
  object. Consistent with `[RESERVE]`, but ADR-0010's reserved field is unrealized. →
  **W-3 (drift, minor).**
- **`ResourceRef` (ADR-0005), `AgentProfile` (ADR-0008), Domain `Event`s + `EventBus`
  (ADR-0006)** — not implemented. These are `[RESERVE]/[LATER]` and were explicitly
  YAGNI'd by ADR-0013 (map onto existing ports / no action now). **Consistent** — and
  the absence of an event bus actively satisfies §12 ("no implicit event
  choreography"). No action; noted for completeness.

### 5.3 Implemented but undocumented
- **Logger port** (`ports/logger.port.ts`) + `ConsoleLogger` — a real port with no
  ADR (§11.7 expects a decision record for an architectural seam). → **W-4 (missing ADR).**

### 5.4 Duplicate / overlapping responsibilities
- None harmful. ADR-0002 (ContextBuilder seam) and ADR-0003 (PromptComposer) are
  **refined**, not duplicated, by ADR-0014 (prompt/context contracts). Relationship is
  additive; recommend a cross-reference note, not a merge.

**Result: PASS WITH WARNINGS — drift is documentation lag, not structural divergence.**

---

## 6. Responsibility Audit — ✅ PASS (1 watch-item)

| Service | Responsibility | Verdict |
|---|---|---|
| `ChunsikCore` | Single orchestration flow (classify → analysis gate → task → plan → risk gate → execute → reply). Delegates all work to services; holds no I/O. | ✅ cohesive |
| `Planner` | Intra-task decomposition (single-step plan + risk). Conforms ADR (Plan ≠ Workflow). | ✅ |
| `PromptComposer` | Pure layering → `PromptSpec` (system/developer/context/task). No I/O. | ✅ (ADR-0003) |
| `ContextBuilder` | Retrieve recent SHORT_TERM + project memory → `ContextBundle`. Rank/compress/budget deferred (`[RESERVE]`, ADR-0002). | ✅ (minimal) |
| `CapabilityRouter` | Select `AiProvider` by capability + priority among available. No `id` branching. | ✅ (§5) |
| `MemoryManager` | System of record for memory (CRUD/scope). Also has `buildContextFiles()`. | ⚠️ W-5 |
| `WorkspaceManager` | Thin guard over `WorkspaceProvider`; `ensureSafe` enforces clean-tree rule (§9.2). | ✅ |
| `TaskManager` | Task/TaskRun lifecycle + status-transition guard (`canTransition`). | ✅ |

- **W-5 (watch-item):** `MemoryManager.buildContextFiles()` builds `.chunsik/context.md`
  /`task.md` content. §6.4 says context-file **materialization** belongs to the
  workspace layer. The method only *produces* `ContextFile[]` (does not write to disk),
  and — verified — **is never called** in the live path (the Claude CLI receives the
  `PromptSpec` via stdin, not files). It is unused scaffolding sitting on the
  memory/workspace boundary. Recommend either wiring it through `WorkspaceProvider.
  writeContextFiles` (the sanctioned materialization seam) or removing it; clarify the
  boundary either way.

**Result: PASS.**

---

## 7. Domain Audit — ✅ PASS

- **Entities:** `Actor`, `Session`, `Task`, `TaskRun`, `Intent`, `Plan`/`PlanStep`,
  `MemoryRecord`, `Artifact`, `Project`, `ApprovalRequest`/`ApprovalDecision`,
  `WorkspaceRef`. **Value objects:** `ConversationContext`, `ExternalIdentity`,
  `GitStatus`, `CommandResult`, `ContextBundle`, `PromptSpec`, `ContextFile`,
  `MemoryScope`. **Enums:** `TaskStatus`, `SessionStatus`, `TaskRunStatus`,
  `RiskLevel`, `Capability`, `IntentType`, `MemoryType` (6 types, matches §6.3),
  `AiFailureKind`, `ArtifactKind` (8 kinds).
- **Aggregate discipline:** `Session` is a thin root (identity + lifecycle + pointers
  `activeProjectId`/`activeTaskId`); it stores **no context/memory snapshot** — satisfies
  ADR-0001 and the §12 "no snapshots on Session" rule. ✅
- **Resource vs Artifact (§12 hard rule):** `Artifact` (output) exists; `Resource`
  (input) is deferred; they are not merged. ✅
- **Repositories (8):** `actors`, `sessions`, `tasks`, `taskRuns`, `memories`,
  `artifacts`, `projects` implemented; `approvals` is an honest `StubRepository`
  (throws `NotImplementedError`) — matches the deferred approval flow.

**Result: PASS — the domain matches the concept map; relationships intact.**

---

## 8. Security Audit — ✅ PASS (1 residual risk)

| Surface | Finding |
|---|---|
| Prompt construction | Rendered to text and passed **via stdin only**; CLI args hardcoded `['-p']`. No prompt/user data on argv → no argument injection. ✅ |
| Workspace access | `readProjectFiles` reads an **allow-list** (`package.json`, `pnpm-workspace.yaml`, `README/ARCHITECTURE/DECISIONS.md`, `tsconfig*.json`) only; 8 KB/file cap; excludes `node_modules/dist/build/.git/coverage`. ✅ |
| Secret handling | `isSecretName` skips `.env*` and `secret|token|key|credential|password` names **unconditionally**, independent of the allow-list. ✅ |
| Shell/git | Only `git -C <path> rev-parse --abbrev-ref HEAD` via `spawnSync` with **array args** (no shell string interpolation), 5 s timeout. ✅ |
| Masking | `maskSecrets` (Discord-token shape, `sk/pk/ghp/gho/ghs/xox*`, `Bearer …`) applied to stderr **before** it is logged, stored on `TaskRun`, or surfaced; output sliced (300/500/1000 chars). ✅ |
| SQL | All statements `prepare()`d; values bound with `?`. `memories.findByScope` builds its WHERE from **fixed column-name fragments** with `?` placeholders (values via params). Table names are internal constants. **No injection.** ✅ |
| Persistence | `memories` store user/assistant text + `role` (no provider id, no secrets by design); `artifacts` store AI output. No tokens/full-prompt logging. ✅ |
| Logging | Structured metadata only (ids, capability, kind, masked `errorSummary`). No raw prompts/tokens. ✅ |
| Misc | No `eval`/`Function`, no string-concatenated SQL, no shell string interpolation found. ✅ |

- **W-6 (residual risk, accepted for v1):** if a **user types a secret** into a Discord
  message, it is persisted verbatim as SHORT_TERM memory (the allow-list governs file
  reads, not user input). Acceptable for a local, single-actor Personal Edition;
  revisit (input scrubbing / retention) for Team Edition.
- Note: the "context files on disk" surface raised during review is **not live** —
  `buildContextFiles` is unused (see W-5); the runtime path is stdin-only.

**Result: PASS.**

---

## 9. Performance Audit — ⚠️ PASS WITH WARNINGS

- **ContextBuilder / memory retrieval:** per inbound message, reads recent SHORT_TERM
  (limit ~10) + latest PROJECT memory. Small result sets, but every lookup is a **full
  table scan** (no index — see §10). At Personal-Edition scale (one actor, modest rows)
  this is fine; it will degrade as `memories`/`tasks` grow. → **W-8.**
- **Prompt construction:** O(n) string join of 4 layers — trivial.
- **Workspace scanning/readout:** top-level + 2-level tree, ≤60 entries/dir, 8 KB/file
  cap → bounded and cheap.
- **SQLite:** WAL mode enabled (readers don't block writers); writes are upserts; one
  multi-statement transaction (actor + identities). Good concurrency posture for v1.

**Result: PASS WITH WARNINGS — no hot-path problem at v1 scale; indexing is the scale lever.**

---

## 10. SQLite Audit — ⚠️ PASS WITH WARNINGS

- **Schema (8 tables):** `actors`, `actor_identities` (composite PK `platform,
  external_id`), `sessions`, `tasks`, `task_runs`, `artifacts`, `projects`, `memories`.
  Uniform pattern: `id TEXT PRIMARY KEY` + a JSON `data TEXT NOT NULL` blob, with a few
  **typed filter columns** (`channel_id`, `thread_id`, `task_id`, `session_id`,
  `project_id`, `type`, `status`) extracted for WHERE clauses.
- **Indexes:** **none defined.** Lookups on `channel_id`, `thread_id`, `task_id`,
  `session_id`, `project_id`, `type` all full-scan (only PKs are implicitly indexed). →
  **W-8 (scale).**
- **Constraints:** PKs present; `*_NOT NULL` on `data`/`type`/`status`. **No foreign
  keys** (FK columns are plain `TEXT`); referential integrity is enforced in
  application code, not the DB. Acceptable for v1; note for V2.
- **Migrations:** `CREATE TABLE IF NOT EXISTS` at `init()` + defensive
  `ALTER TABLE … ADD COLUMN` in try/catch. **No version table / migration runner.**
  This is brittle for evolving schemas (silent catch hides real errors). → **W-9.**
- **Queries:** all `prepare()`d; upserts via `ON CONFLICT … DO UPDATE`; sorting via
  `ORDER BY json_extract(data,'$.field')`. Serialization is full-object JSON in `data`.
- **Locking/scalability:** WAL; single-process in-process DB — correct for Personal
  Edition; Team Edition swaps `StorageProvider` to Postgres (§13).

**Result: PASS WITH WARNINGS — correct and safe; not yet index-tuned or
version-migratable (both are explicit V2 items).**

---

## 11. ADR Review (obsolete / duplicate / missing)

- **Inventory:** ADR-0001 … ADR-0019, contiguous, no numbering gaps. ADR-0019 is
  `✅ Accepted` with explicit non-goals (no indexing/vector/semantic search).
- **Obsolete:** none. ADR-0004 (Workflow deferred) and ADR-0007 (Plugin rejected)
  remain valid deferral/rejection records.
- **Duplicate:** none. ADR-0014 refines ADR-0002/0003 (additive, not duplicate) —
  recommend a cross-reference.
- **Missing:**
  - **Logger / observability port** — no ADR (W-4).
  - **ADR-0004 / ADR-0010 reconciliation** — the `workflowId` / structured `Usage`
    reservations are unmet under ADR-0013's YAGNI; record an addendum so decisions match
    code (W-2/W-3).
- **Internal consistency:** `CURRENT_STATE.md` accurately reflects implemented vs.
  deferred (Discord/Claude CLI/Session/Short-term Memory/Project Registration/Project
  Analysis vs. Codex/Ollama/Workflow/Agent Runtime/Vector/Jira/Slack/Confluence).

---

## 12. Version 2 Readiness Audit

| V2 capability | Seam status | Readiness | Gap to close |
|---|---|---|---|
| Workspace editing | `WorkspaceProvider.writeFile/listFiles/runCommand` (stubbed) + `RiskPolicy.assessCommand` (built) | 🟡 Partial | Implement provider write/exec behind approval + clean-tree guard (§9). |
| Git worktree | Same `WorkspaceProvider` port; new adapter only | 🟢 Ready | Add `GitWorktreeWorkspaceProvider`; wire one line. |
| Patch generation | `ArtifactKind.PATCH`/`CODE_DIFF` + `ArtifactManager` | 🟡 Partial | Needs workspace write + a code provider path. |
| Approval system | `ApprovalRequest/Decision` domain + `RiskPolicy.requiresApproval` (built) | 🔴 Seam-only | Persist `ApprovalRequest` (orchestrator TODO), implement `DiscordPlatformAdapter.requestApproval`, `ChunsikCore.handleApprovalDecision`, and the `approvals` repo (currently stub). **Biggest gap.** |
| Codex CLI | `CodexCliProvider` class + capability descriptors | 🟡 Partial | Implement `isAvailable/execute` (base throws); add to `AI_PROVIDERS`. |
| Ollama | `OllamaCliProvider` class | 🟡 Partial | Same as Codex; also embedding capability for vector. |
| Multi-provider routing | `CapabilityRouter` priority selection over available providers | 🟢 Ready | Works once >1 provider is available; no Core change. |
| Jira / Slack / Confluence | `ConnectorProvider` port + `ConnectorManager` + reserved `ArtifactKind`s; `V1_CONNECTORS = []` | 🟡 Partial | Add read-first connector adapters (gated writes per §10/§13). |

**Routing, worktree, and connectors are architecturally ready** (adapters/wiring only).
**Approval and provider execution** are the substantive V2 build-outs.

---

## 13. Findings

### Violations (must-fix to conform) — **NONE**
No hard-rule (§12) violation. Core purity, inward dependencies, provider-agnosticism,
memory-as-source-of-truth, honest stubs, and security controls all hold.

### Warnings (track; non-blocking for RC)
| # | Severity | Finding |
|---|---|---|
| W-1 | Low | ARCHITECTURE.md §4 `[RESERVE]` tags stale for built items (Session, Actor, ContextBuilder, PromptComposer, ContextBundle, PromptSpec → `[NOW]`). |
| W-2 | Medium | `workflowId` reserve (ADR-0004 + §4) not implemented; decision record contradicts code (JSON storage makes late-add free — reconcile the docs). |
| W-3 | Low | Structured `Usage`/cost on `TaskRun` (ADR-0010) unrealized; only `durationMs`. |
| W-4 | Low | Logger port has no ADR (§11.7). |
| W-5 | Low | `MemoryManager.buildContextFiles` is unused and straddles the §6.4 materialization boundary — wire via `WorkspaceProvider` or remove. |
| W-6 | Low | User-typed secrets persist verbatim in SHORT_TERM memory (accepted for Personal Edition). |
| W-7 | Info | `node:crypto` in `util/id.ts` is the sanctioned id seam; could become an `IdProvider` port for strict purity. |
| W-8 | Medium | No SQLite secondary indexes — full scans on all non-PK lookups (scale lever for Team Edition). |
| W-9 | Low | No SQLite migration-versioning; defensive `ALTER … ADD COLUMN` in try/catch can mask real errors. |

### Hygiene
- **Dead code:** `apps/chunsik/src/placeholder-ai-provider.ts` is defined but never
  imported (the live placeholder concern is gone; Claude is wired). Safe to delete.

---

## 14. Technical Debt

**Immediate (before final `v1.0.0` tag — docs/hygiene, no behavior change):**
- Reconcile ARCHITECTURE.md §4 status tags (W-1) and add an ADR addendum for the
  dropped `workflowId`/`Usage` reserves under ADR-0013 (W-2, W-3).
- Add an ADR for the Logger port (W-4).
- Remove dead `placeholder-ai-provider.ts`; decide `buildContextFiles` (wire or drop) (W-5).

**Version 2:**
- SQLite secondary indexes on FK/filter columns; add FK constraints (W-8).
- SQLite migration/versioning system replacing defensive ALTERs (W-9).
- End-to-end approval flow (persist request → request UI → resume decision → `approvals` repo).
- Implement + wire Codex and Ollama providers; embedding capability for vector search.
- PROJECT/TOOL memory retention/pruning (only SHORT_TERM is capped at 30/session).

**Future:**
- Connectors (Jira/Slack/Confluence, read-first, gated writes).
- Workflow engine, agent runtime, `ResourceRef`, `AgentProfile`, `EventBus` —
  all behind existing `[LATER]` seams; each requires its own ADR.

---

## 15. Recommended Version 2 Preparation Tasks
1. **Approval slice** (highest-value seam→feature): persist `ApprovalRequest`,
   implement `requestApproval` + `handleApprovalDecision` + `approvals` repo.
2. **Provider expansion:** implement Codex/Ollama `isAvailable/execute`, wire into
   `AI_PROVIDERS`, validate `CapabilityRouter` fallback with >1 provider.
3. **Storage hardening:** add indexes + FKs + a migration runner before multi-actor data.
4. **Workspace write path:** implement `WorkspaceProvider` write/exec behind the
   clean-tree + approval guards; enable patch/diff artifacts.
5. **Doc reconciliation** (carry the Immediate-tier items) so the constitution and ADRs
   match the frozen code.

---

## 16. Freeze Recommendation

**FREEZE Version 1 as `v1.0.0-rc1`.**

The architecture is conformant on every load-bearing rule, the build and tests are
green, and there are **zero structural violations**. The open items are documentation
drift, scale-oriented persistence tuning, and minor hygiene — none of which blocks a
release candidate. Recommended path:

1. Tag **`v1.0.0-rc1`** now.
2. Land the **Immediate-tier** doc/hygiene fixes (W-1–W-5, dead-code removal) as a small
   conformance PR.
3. Promote to **`v1.0.0`** once the constitution/ADRs are reconciled with the code.

---

## Appendix — Validation Evidence

```
$ pnpm typecheck      → tsc -b tsconfig.build.json — exit 0 (PASS)
$ pnpm test           → Vitest: 12 files / 62 tests passed
$ git status -sb      → ## main...origin/main ; clean before audit
```

- Boundary grep (core, excl. tests): only `node:crypto` in `util/id.ts`.
- Dependency graph: core has 0 workspace imports; adapters import only `@chunsik/core`;
  no cross-adapter imports; `app.module.ts` is the sole composition root.
- SQLite: 8 tables (id + JSON `data` + typed filter cols), 0 secondary indexes, WAL on,
  prepared statements throughout, defensive `ALTER` migrations.
- Security: stdin-only prompts, `maskSecrets` on stderr, allow-listed + secret-filtered
  file reads, fully parameterized SQL.

*Audit method note: read/search evidence-gathering was delegated to model-tier `haiku`
sub-agents (per project model-delegation policy); decisive boundary/security checks and
all judgments were performed directly. The audit produced this report only — no source
files were modified.*
