# Capability — Command Execution (CAP-007)

> V2 is capability-driven. Lightweight doc for the **Command Execution** capability.
> Authority: `DECISIONS.md` (ADR-0028). Shared contract: `docs/execution-plan.md`.

## Purpose

Run ONE command (build / test / lint / …) inside a workspace and record **what happened**
as a `CommandExecution` — the **Execution History** aggregate. The **riskiest** capability
(arbitrary process execution), so it is allow-listed, risk-assessed, approval-gated, and
adapter-isolated. The last aggregate of the Execution Ledger.

```
Planning → Approval → Patch → Workspace Write → [Command Execution: run command → CommandExecution]
```

> **Workspace Write applies files. Command Execution runs commands.** Never merged.

## Responsibilities

- Own the **`CommandExecution`** aggregate (the only thing it mutates).
- `CommandExecutionManager.run({ executionPlanRef, approvalRef?, workspaceRef,
  workspaceChangeRef?, command, args, timeoutMs? })` — three deterministic gates, in order,
  BEFORE the runner is ever invoked:
  1. **Allow-list** (MB-3): `command` must be one of `pnpm` / `npm` / `node` (exact match,
     fails closed). Anything else is refused.
  2. **Dangerous-arg** (review): the allow-list is **command + arg aware** — an allow-listed
     `node` may not use eval-style flags (`-e` / `--eval` / `-p` / `--print`, incl. `=value`
     and short clusters like `-pe`), which would otherwise run arbitrary code.
  3. **Risk** (MB-2): `RiskPolicy.assessCommand(command + args)`. **CRITICAL** (a destructive
     pattern matched) → **refused outright, regardless of approval**.
  4. **Approval (Ref only)** (MB-2): **HIGH** → requires an APPROVED, **plan-scoped**
     `ApprovalRef` (`approvalRef.executionPlanRef.id === executionPlanRef.id`; no
     `ApprovalManager` query). **LOW/MEDIUM** → run without approval.
- Stamp **command identity** (MB-1): `commandHash` = content hash of `command` + `args`.
- Delegate execution to the **`CommandRunner`** port; record exit code, masked + capped
  stdout/stderr, duration, and derived status.
- Persist via `CommandExecutionRepository` / `SqliteCommandExecutionRepository` (migration v5).

## Out of Scope

- ❌ Editing files / applying patches (CAP-006), generating patches (CAP-005), Planning,
  Git, AI.
- ❌ AI-driven command generation (CAP-008/009 may *produce* a command; CAP-007 only runs it).
- ❌ **Retry** (Execution Orchestrator's responsibility), streaming output, parallel/pipelined
  commands, background / long-lived processes.
- ❌ Mutating `ExecutionPlan` / `ApprovalRequest` / `PatchSet` / `WorkspaceChange` (refs only).
- ❌ A shell. Commands run as an **argv array**, never `shell: true`, never a shell string.

## Public API

- `CommandExecutionManager` (`run`/`get`/`findByExecutionPlan`/`findByWorkspaceChange`).
  Allow-list is injectable (`DEFAULT_ALLOWED_COMMANDS`); timeout defaults to
  `DEFAULT_COMMAND_TIMEOUT_MS`.
- Port `CommandRunner` (`run(command, args, { cwd, timeoutMs, env? }) → CommandRunResult`;
  token `COMMAND_RUNNER`; adapter `LocalCommandRunner` in `@chunsik/command-local`,
  `node:child_process` argv-array `spawnSync`, `shell:false`, **minimal env by default
  (PATH/HOME — never the full parent `process.env`)**, masked + size-capped output).
- **Execution-safety boundary (4 controls):** command allow-list · dangerous-arg blocking ·
  minimal child env · output masking + size cap.
- Domain: `CommandExecution` (aggregate, **Execution History**; carries `commandHash` — the
  command identity), `CommandExecutionRef`, `CommandExecutionStatus`
  (`PENDING|RUNNING|SUCCEEDED|FAILED|TIMED_OUT`), `RunCommandInput`. Reuses `CommandResult`.
- **Command identity contract:** `commandHash` records exactly which command (`command` +
  `args`) ran — the basis for audit / duplicate detection / resume and a future retry.

## Future Expansion

- **Retry / Resume** owned by a future Execution Orchestrator (uses `commandHash`).
- **Streaming output** (follow-up ADR); **ExitCode as a Value Object** (structure kept open).
- Widening the allow-list / risk policy (config or per-project) — a policy decision, not a
  change to the gate. **Background / long-lived processes** are a separate future capability.

## Boundaries (Aggregate Ownership Rule — ADR-0025)

- **Command Execution owns `CommandExecution`.** References `executionPlanRef`/`approvalRef`/
  `workspaceRef`/`workspaceChangeRef`; mutates none of them.
- Command Execution ≠ Workspace Write ≠ Patch ≠ Git ≠ Approval ≠ Planning ≠ AI Provider.
- **Core stays `child_process`-free** — all process execution is in the adapter.

## Related ADRs

- **ADR-0028** — CAP-007 Command Execution (primary; "run, gated").
- ADR-0027 (Workspace Write) · ADR-0026 (Patch) · ADR-0025 (Approval + Aggregate Ownership) ·
  ADR-0023 (Git relocation precedent) · ADR-0020 (SQLite migrations).
