# CLAUDE.md

**Follow `AGENTS.md`.** It is the canonical operating manual for all AI coding
agents in this repo. Before editing, read — in this order:

1. `ARCHITECTURE.md` — the rules code must obey.
2. `DECISIONS.md` — settled decisions and why (do not re-litigate).
3. `AGENTS.md` — how to work, boundaries, forbidden changes.

## Claude Code operational notes

- Run `pnpm typecheck` before finishing any change; it must exit 0.
- This is a pnpm monorepo with strict inward dependencies (`apps → adapters →
  core`). If an import won't resolve across a boundary, that is the architecture
  working as intended — redesign, don't add the dependency.
- If a request conflicts with `ARCHITECTURE.md` or a settled ADR, stop and
  surface it rather than working around it (see `AGENTS.md` §8).
