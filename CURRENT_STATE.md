# Chunsik — Current State

A snapshot of where the repository is **right now**. Updated as part of every
sprint's definition-of-done. It deliberately avoids duplicating `ARCHITECTURE.md`
(rules) or `ROADMAP.md` (direction); for the status of individual concepts see the
`[NOW]/[RESERVE]/[LATER]` labels in `ARCHITECTURE.md`.

- **Phase:** Sprint 0 complete — repository operating system established.
- **Next:** Sprint 1a (walking skeleton) — awaiting go-ahead.

## What exists

- pnpm monorepo; **framework-agnostic core** (domain, 7 ports, application services).
- One package per concrete provider — **all SKELETON** (throw `NotImplementedError`).
- NestJS composition root wiring ports → providers via injection tokens.
- Docs: `README`, `ARCHITECTURE`, `DECISIONS` (ADR-0001…0013), `AGENTS`, `CLAUDE`,
  `ROADMAP`, `CURRENT_STATE`, `CHANGELOG`, `docs/templates/ADR_TEMPLATE.md`.

## What is NOT implemented yet

- All `AiProvider.execute` / `isAvailable` (Claude/Codex/Ollama CLI).
- `DiscordPlatformAdapter`, `SqliteStorageProvider`, local Queue/Vector/Workspace.
- `IntentClassifier.classify`, `Planner.plan`, `ChunsikCore.handleApprovalDecision`.
- Not yet introduced (decisions recorded, built per sprint): `Session`, `Actor`,
  `ContextBuilder`, `PromptComposer`, domain events, `ResourceRef`, `Usage`/cost.

## Validation

- `pnpm typecheck` — passes (exit 0).
- Boundary enforced — Core cannot resolve adapter packages.
