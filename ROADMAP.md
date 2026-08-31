# Chunsik — Roadmap

Lightweight, living roadmap: **direction and sequence only.** Rules live in
`ARCHITECTURE.md`, decisions in `DECISIONS.md`, present status in
`CURRENT_STATE.md`. This file does not duplicate them.

## Edition evolution

- **Personal Edition (now)** — local-first, single actor, Discord, CLI providers, SQLite.
- **Team Edition** — multi-actor; storage / queue / event transport swapped to networked implementations.
- **Hosted / SaaS Edition** — multi-tenant. Tenancy is a **v3** scope dimension layered onto Actor/Session; **not built now** and no multi-tenant abstractions are introduced early (YAGNI).

> An edition step changes **adapters / wiring / reserved seams — never Core contracts**
> (`ARCHITECTURE.md` §13). A forced Core-contract change requires an ADR first.

## Major milestones

- **M0 — Repository operating system** ✅ done (Sprint 0).
- **M1 — Walking skeleton:** one natural-language flow, end to end (Sprint 1a → 1b).
- **M2 — Memory & multi-provider:** ✅ done for the ratified scope — provider-neutral routing/Ollama,
  ContextBuilder ranking and bounded compression, durable memory, and read-only connectors. Codex remains deferred.
- **M3 — Personal Work OS foundations:** **active** — Resource identity, a read-only Work Surface, and the
  narrow CAP-011 Work Model follow the ratified M3 Architecture Rebaseline (ADR-0074/0075).

Current operational phase: **M3**. The `v1.0.0` source release is complete and closed at
`80bbc94de0493c24036197dabc2ff00dbcd20cbf`; tag creation/push is not an outstanding release task. M3 activation
does not claim Production Runtime readiness.

## Sprint roadmap

| Sprint | Goal | Notes |
|---|---|---|
| **0** ✅ | Bootstrap the repository operating system | docs + collaboration model |
| **1a** | Walking skeleton: Discord adapter + minimal Session + SQLite persistence + **echo** reply | validates I/O + persistence + boundaries; **no cognition** |
| **1b** | Intent classification + Planner + ContextBuilder + PromptComposer + capability routing + Claude CLI execution | natural language only, no slash commands; provider chosen by **router**, never hardcoded |
| **M3A-1** | `ResourceRef` + read-only Work Surface | no WorkItem persistence or migration |
| **M3A-2** | CAP-011 WorkItem repository + additive migration + persisted personal-work state | ADR-0075 |
| **Future** | Memory improvements · Codex · additional connectors | per ADR sequence |

## Deferred capabilities (YAGNI)

Reserve a seam **only when expensive to retrofit.** Most of these already map onto
**existing ports / ADRs** and need **no action now**:

| Capability | Absorbed by | Action now |
|---|---|---|
| MCP | separate future `ToolProvider` adapter boundary | deferred; do not use `ConnectorProvider` or AI-provider types |
| Plugin ecosystem | ADR-0007 (bundle of existing ports) | none |
| Multi-agent runtime | ADR-0008 (`AgentProfile` seam) | `AgentProfile` remains deferred to M3D; no runtime now |
| Remote workspace | `WorkspaceProvider` (`kind: 'remote'`) | none |
| Local model manager | `AiProvider` availability/health | none |
| Multimodal | keep `Artifact`/`Resource` from assuming text-only | note only |
| Search | future bounded resource retrieval + `VectorProvider` | deferred; `ResourceResolver` is not implemented |
| Feedback learning, Feature registry, Scheduler, Notification | future additive services | none (no Core seam) |

## Non-goals (v1)

- Not a Discord bot framework — Discord is one adapter.
- No AI HTTP API (CLI only). No Postgres/Redis. No multi-tenancy.
- No slash-command UX. No autonomous agent loops, no dynamic plugin loading, no Workflow engine.
