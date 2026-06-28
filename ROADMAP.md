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
- **M2 — Memory & multi-provider:** Codex/Ollama, ContextBuilder ranking, read-only connectors.
- **M3 — Team Edition foundations:** Actor/Policy, networked transports, telemetry.

## Sprint roadmap

| Sprint | Goal | Notes |
|---|---|---|
| **0** ✅ | Bootstrap the repository operating system | docs + collaboration model |
| **1a** | Walking skeleton: Discord adapter + minimal Session + SQLite persistence + **echo** reply | validates I/O + persistence + boundaries; **no cognition** |
| **1b** | Intent classification + Planner + ContextBuilder + PromptComposer + capability routing + Claude CLI execution | natural language only, no slash commands; provider chosen by **router**, never hardcoded |
| **Future** | Memory improvements · Codex · Ollama · Connectors (read-only) | per ADR sequence |

## Deferred capabilities (YAGNI)

Reserve a seam **only when expensive to retrofit.** Most of these already map onto
**existing ports / ADRs** and need **no action now**:

| Capability | Absorbed by | Action now |
|---|---|---|
| MCP | `AiProvider` / `ResourceResolver` | none (not a new Core concept) |
| Plugin ecosystem | ADR-0007 (bundle of existing ports) | none |
| Multi-agent runtime | ADR-0008 (`AgentProfile` seam) | none |
| Remote workspace | `WorkspaceProvider` (`kind: 'remote'`) | none |
| Local model manager | `AiProvider` availability/health | none |
| Multimodal | keep `Artifact`/`Resource` from assuming text-only | note only |
| Search | `ResourceResolver` + `VectorProvider` | none |
| Feedback learning, Feature registry, Scheduler, Notification | future additive services | none (no Core seam) |

## Non-goals (v1)

- Not a Discord bot framework — Discord is one adapter.
- No AI HTTP API (CLI only). No Postgres/Redis. No multi-tenancy.
- No slash-command UX. No autonomous agent loops, no dynamic plugin loading, no Workflow engine.
