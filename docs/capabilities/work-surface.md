# Personal Work Surface

M3A-1 exposes one read-only answer to “Show me what I need to work on.” It is a rebuildable, non-authoritative
application projection under ADR-0074, not a work database or workflow.

## Contract

- `ResourceRef { source, externalId }` is the stable value identity of an external input. It is not an Aggregate,
  connector payload, cache record, or output Artifact.
- `WorkSurfaceQuery.forActor(actor)` resolves only explicit `Actor.identities` entries for `jira` and `github`.
  It never fabricates, infers, or auto-links an identity.
- Jira and GitHub are queried through read-only `ConnectorProvider` implementations using the semantic
  `personal-work` query. Connector protocol rendering remains inside each adapter.
- Items are normalized to `ResourceRef`-backed application DTOs and stably sorted by source, title, and external id.
- Each source reports `AVAILABLE`, `IDENTITY_MISSING`, `NOT_CONFIGURED`, or `UNAVAILABLE`. A one-source result is
  explicitly `PARTIAL`; an unavailable source can never be silently rendered as “you have no work.”

## Boundaries

The surface persists nothing and introduces no `WorkItem`, repository, table, migration, lifecycle, connector
write, MCP/tool seam, agent, handoff, trigger, scheduler, receipt, ledger, graph, Workflow, or event sourcing.
GitHub pull-request lifecycle and writes remain exclusively on `RepositoryHostingProvider`. Conversation Runtime
only recognizes the bounded intent, invokes `WorkSurfaceQuery`, and hands the result to `ResponseComposer`.
