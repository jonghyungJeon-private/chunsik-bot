# Sprint 2g Implementation Plan — CAP-007 Command Execution Capability

- **Status:** ✅ APPROVED WITH CHANGES (Planning review) — cleared to implement. The CA's
  three Merge-Blocking items are applied: **MB-1** command identity (`commandHash`), **MB-2**
  approval policy (LOW/MEDIUM → none, HIGH → APPROVED+plan-scope, CRITICAL/destructive →
  refused), **MB-3** allow-list (`pnpm`/`npm`/`node`). Settles Q1 (approval/risk) and Q2
  (allow-list); Q3 (relocate `runCommand`) done. Implemented in ADR-0028. Non-blocking items
  NOT implemented.
- **Capability:** **CAP-007 — Command Execution** (canonical roadmap: after Workspace Write).
- **Date:** 2026-06-30 · **Base:** `main` @ `0953868` (CAP-001…006 merged).
- **Process:** V2 architecture-first, Step 1 (Implementation Plan). Plan → review → approval →
  implementation. Do not bypass the planning gate.

---

## 1. Objective

Run a command (build / test / lint / etc.) inside a workspace **after** an approved patch has
been applied (CAP-006), and record the run as a `CommandExecution` (Execution History). It is
the **riskiest** capability — arbitrary process execution — so it is **approval-gated**,
**risk-assessed**, and **adapter-isolated**. It runs commands; it never edits files, never
generates patches/plans, never calls git, never calls AI.

```
… → Patch → Workspace Write (apply) → [Command Execution: run command → CommandExecution]
```

## 2. Scope (proposed minimal safe scope)

- **`CommandExecution` aggregate (CAP-007-owned)** — the Execution History of one command run.
- **`CommandExecutionManager.run(input)`** — gates + runs + records:
  1. **Approval (Ref only):** `approvalRef.status === APPROVED` **and**
     `approvalRef.executionPlanRef.id === input.executionPlanRef.id` (plan-scoped — CAP-005/006).
  2. **Risk gate:** `RiskPolicy.assessCommand(command)`; if it `requiresApproval` (HIGH/CRITICAL)
     and there is no APPROVED approval → refuse. CRITICAL-destructive patterns refused (Q).
  3. Run via the **`CommandRunner`** port; record exit code, **sanitized + bounded** stdout/
     stderr, duration, status; persist.
- **`CommandRunner` port + adapter** — argument-array `spawn` (no shell string, no `shell:true`),
  **timeout**, **cwd = workspace root**, **stderr/stdout masked** (secret patterns) and
  size-capped. Relocate the misplaced `WorkspaceProvider.runCommand` stub here (Workspace ≠
  Command Execution), mirroring how CAP-002 relocated `gitStatus`.
- **Persistence:** `CommandExecutionRepository` + `SqliteCommandExecutionRepository` +
  **migration v5** (`command_executions`).
- Tests + capability doc + ADR-0028.

## 3. Out of Scope (explicit)

- ❌ File edits / patch application (CAP-006), Patch generation (CAP-005), Planning, Git, AI.
- ❌ AI-driven command generation (Codex/Ollama, CAP-008/009) — they may *produce* a command to
  run; CAP-007 only executes a given command.
- ❌ Streaming output, retries, parallel/pipelined commands, background/long-lived processes.
- ❌ Mutating `WorkspaceChange`/`PatchSet`/`ExecutionPlan`/`ApprovalRequest` (references only).
- ❌ Orchestrator/Discord wiring; rollback/resume.

## 4. Architecture Impact

- **Aggregate Ownership:** owns only `CommandExecution`; references `executionPlanRef`,
  `approvalRef`, `workspaceRef`, and (likely) `workspaceChangeRef` — mutates none.
- **Adapter isolation:** all process execution in the `CommandRunner` adapter
  (`node:child_process`, argv array). **Core stays `child_process`-free**; the manager only
  consults `RiskPolicy` (deterministic) + the port.
- **Approval enforced by Ref** (no `ApprovalManager` query) — consistent with CAP-005/006.
- **Reuses** `CommandResult` domain (CAP-001), `RiskPolicy.assessCommand`, the migration runner
  (v5), and the secret-masking approach used by `ai-cli`'s CLI runner.

## 5. ADR Impact

- **New ADR-0028 — CAP-007 Command Execution.** Records: `CommandExecution` aggregate;
  approval + risk gating; argv-array/no-shell/timeout/cwd/masked-output execution; relocation of
  `runCommand` off `WorkspaceProvider`; Repository/AI independence; persistence + migration v5.
- May note the relocation as completing the `WorkspaceProvider` cleanup. (Outline in §16.)

## 6. New Domain Concepts

- **`CommandExecutionStatus`** (enum): `PENDING | RUNNING | SUCCEEDED | FAILED | TIMED_OUT`.
- **`CommandExecution`** (aggregate): `{ id, executionPlanRef, approvalRef, workspaceRef,
  workspaceChangeRef?, command: string, args: string[], status, exitCode?, stdout, stderr,
  durationMs, riskLevel, createdAt, updatedAt }` (stdout/stderr masked + capped).
- **`CommandExecutionRef`** — `{ id, status }`.
- **`RunCommandInput`** — `{ executionPlanRef, approvalRef, workspaceRef, workspaceChangeRef?,
  command, args, timeoutMs? }`.
- Reuses `CommandResult` (CAP-001), `WorkspaceRef`, `ApprovalRef`, `ExecutionPlanRef`,
  `WorkspaceChangeRef`, `RiskLevel`.

## 7. Ports / Adapters

- **`CommandRunner`** (new port) — `run(rootPath, command, args, opts): Promise<CommandResult>`;
  token `COMMAND_RUNNER`. Adapter (new `@chunsik/command-local` **or** reuse a process adapter)
  uses argv-array `spawn`, timeout, cwd, masked output (Q on package location).
- **`CommandExecutionRepository`** (`findByWorkspaceChange`/`findByExecutionPlan`) +
  `SqliteCommandExecutionRepository` (+ migration v5).
- **Remove** `runCommand` from `WorkspaceProvider` (relocated). `RunCommandOptions` moves with it.

## 8. Files Likely to Be Modified / Created (plan-only — none touched yet)

New: `domain/command-execution.ts`; `ports/command-runner.port.ts`;
`application/command-execution-manager.ts`; a process adapter (`@chunsik/command-local` or
extend an existing adapter); `Sqlite*` repo; migration v5; tests; `docs/capabilities/command-execution.md`.
Modified: `enums.ts` (`CommandExecutionStatus`), domain/ports/app barrels, `tokens.ts`
(`COMMAND_RUNNER`), `storage-provider.port.ts` (`commandExecutions`), `workspace-provider.port.ts`
(remove `runCommand`), `workspace-local` (remove the `runCommand` stub), `app.module.ts`,
`DECISIONS.md`/`CURRENT_STATE.md`/`CHANGELOG.md`, migrations + tests.

## 9. Blast Radius

- Compile-time: new port/aggregate/manager + relocating `runCommand` (single stubbed impl, no
  live caller). New package (if chosen) → monorepo `references`.
- Runtime: not orchestrator-wired → near-zero live impact; migration v5 additive/backward-compatible.
- Data: new `command_executions` table. Net: **Medium** (first arbitrary-execution surface).

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Arbitrary/destructive command execution | **High** | Approval-gated (Ref) + `RiskPolicy.assessCommand`; CRITICAL patterns refused; argv-array only (no shell); optional allow-list (Q) |
| Command/shell injection | High | argv array, never a shell string, never `shell: true`; command + args passed separately |
| Secret leakage via output/env | Med | mask stdout/stderr (token patterns), cap size; controlled `env` (no blanket process env passthrough) (Q) |
| Runaway / hanging process | Med | required timeout → `TIMED_OUT`; kill on timeout |
| Mutating others' aggregates | Med | references only; owns `CommandExecution` |

## 11. Security Considerations

- **argv-array `spawn`, no shell, no `shell:true`, timeout, cwd = workspace root**, masked +
  bounded output. `RiskPolicy.assessCommand` classifies; HIGH/CRITICAL require an APPROVED
  (plan-scoped) approval; destructive CRITICAL patterns refused outright (Q). Core stays
  `child_process`-free. This is the project's primary execution-safety boundary.

## 12. Validation

- `pnpm typecheck` + `pnpm test`: approval + plan-scope enforcement; risk gating (HIGH/CRITICAL
  without approval → refused); success/exit-code/timeout/failed status; **output masking**
  (secret not leaked); argv-array (no shell) assertion (fake runner); no mutation of referenced
  aggregates; `SqliteCommandExecutionRepository` round-trip + **migration v5**; boundary (core
  `child_process`-free; manager imports no other capability manager).
- Live smoke not required; SQLite verification of `command_executions`.

## 13. Rollback Strategy

- Additive + a port relocation (single stubbed impl, no live caller). Rollback = `git revert`
  + drop package; migration v5 forward-only/idempotent; no existing-table change.

## 14. Relationships & Aggregate Ownership

- **Consumes** a `WorkspaceChangeRef` (run after the patch is applied) + `workspaceRef`;
  references `executionPlanRef`/`approvalRef`. Owns **`CommandExecution`**.
- Command Execution ≠ Workspace Write ≠ Patch ≠ Git ≠ Approval ≠ Planning ≠ AI Provider.
- `CommandExecution` extends the **Execution History** (alongside `WorkspaceChange`).

## 15. Chief Architect Decision Questions

1. **Approval/risk policy:** does **every** command run require an APPROVED approval, or only
   HIGH/CRITICAL (per `RiskPolicy.assessCommand`; MEDIUM=local build/test auto)? Recommend:
   require approval for HIGH/CRITICAL; refuse CRITICAL-destructive patterns even with approval.
2. **Command allow-list:** v1 restrict to an allow-list (e.g. `pnpm`/`npm`/`node`/`git`-read),
   or rely solely on risk + approval? (Recommend a conservative allow-list for v1.)
3. **`runCommand` relocation:** remove from `WorkspaceProvider` → `CommandRunner` (recommended,
   like the CAP-002 `gitStatus` move), or leave the stub?
4. **Adapter package:** new `@chunsik/command-local` vs extend an existing adapter?
5. **Consumes `WorkspaceChangeRef`?** Required input (run is tied to an applied change) or optional?
6. **Output handling:** mask + cap (size?) + which `env` is passed (none/allow-listed)?
7. **`CommandExecutionStatus` set:** `PENDING/RUNNING/SUCCEEDED/FAILED/TIMED_OUT` — adequate?

## 16. ADR-0028 — outline only
> **Title:** ADR-0028 — CAP-007 Command Execution. **Decision:** `CommandExecution` aggregate;
> `CommandRunner` port/adapter (argv-array spawn, no shell, timeout, cwd, masked output);
> approval+risk gating; relocate `runCommand` off Workspace; persistence + migration v5; Repo/AI
> independent. **Relates:** ADR-0027 (WS Write), ADR-0025 (Approval/Ownership), ADR-0020 (migrations).

## 17. docs/capabilities/command-execution.md — outline only
> Purpose · Responsibilities · Out of Scope · Public API (`CommandExecutionManager`,
> `CommandRunner`, `CommandExecution`/`Ref`/`Status`) · Future (streaming, retries) · Boundaries
> (owns `CommandExecution`; ≠ Workspace Write/Patch/Git/AI) · Related ADRs.

---

## Next Step
Stop here and wait for Chief Architect review. On approval I implement only the approved scope,
validate, and produce the Sprint 2g review. No code/commit/branch/prototype until then —
Q1/Q2 (approval-risk policy + allow-list) in particular should be settled first.
