import { describe, expect, it, vi } from 'vitest';
import { CommandExecutionManager } from './command-execution-manager';
import { RiskPolicy } from './risk-policy';
import { ApprovalStatus, CommandExecutionStatus, WorkspaceChangeStatus } from '../domain';
import type {
  ApprovalRef,
  CommandExecution,
  RunCommandInput,
  WorkspaceRef,
} from '../domain';
import type { CommandRunOptions, CommandRunResult, CommandRunner, StorageProvider } from '../ports';

const planRef = { id: 'plan-1', goal: 'run the build' };
const approved: ApprovalRef = { id: 'appr-1', status: ApprovalStatus.APPROVED, executionPlanRef: planRef };
const workspaceRef: WorkspaceRef = { id: 'w1', rootPath: '/tmp/ws', kind: 'local-clone' };

/** In-memory commandExecutions store + a runner whose result is configurable. */
function harness(result: CommandRunResult = { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false }) {
  const rows = new Map<string, CommandExecution>();
  const storage = {
    commandExecutions: {
      async get(id: string) {
        return rows.get(id) ?? null;
      },
      async save(e: CommandExecution) {
        rows.set(e.id, e);
        return e;
      },
      async delete(id: string) {
        rows.delete(id);
      },
      async list() {
        return [...rows.values()];
      },
      async findByExecutionPlan(id: string) {
        return [...rows.values()].filter((e) => e.executionPlanRef.id === id);
      },
      async findByWorkspaceChange(id: string) {
        return [...rows.values()].filter((e) => e.workspaceChangeRef?.id === id);
      },
    },
  } as unknown as StorageProvider;
  const run = vi.fn(async (_c: string, _a: string[], _o: CommandRunOptions): Promise<CommandRunResult> => result);
  const runner: CommandRunner = { kind: 'fake', run };
  return { storage, runner, run, rows };
}

function input(over: Partial<RunCommandInput> = {}): RunCommandInput {
  return { executionPlanRef: planRef, workspaceRef, command: 'pnpm', args: ['test'], ...over };
}

function mgr(h = harness()) {
  return new CommandExecutionManager(h.storage, h.runner, new RiskPolicy());
}

describe('CommandExecutionManager (CAP-007, ADR-0028)', () => {
  it('runs an allow-listed MEDIUM command with no approval → SUCCEEDED, records identity', async () => {
    const h = harness();
    const exec = await mgr(h).run(input());
    expect(exec.status).toBe(CommandExecutionStatus.SUCCEEDED);
    expect(exec.exitCode).toBe(0);
    expect(exec.stdout).toBe('ok');
    expect(exec.commandHash).toMatch(/^[0-9a-f]{16}$/); // MB-1: deterministic identity persisted
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it('passes command + args as a separate argv array (no shell string)', async () => {
    const h = harness();
    await mgr(h).run(input({ command: 'pnpm', args: ['run', 'build'] }));
    const [command, args, options] = h.run.mock.calls[0]!;
    expect(command).toBe('pnpm');
    expect(args).toEqual(['run', 'build']); // never concatenated into one string
    expect(options.cwd).toBe(workspaceRef.rootPath); // cwd = workspace root
    expect(options.timeoutMs).toBeGreaterThan(0); // timeout always supplied
  });

  it('commandHash is deterministic for the same command+args, differs otherwise', async () => {
    const a = await mgr().run(input({ command: 'pnpm', args: ['test'] }));
    const b = await mgr().run(input({ command: 'pnpm', args: ['test'] }));
    const c = await mgr().run(input({ command: 'pnpm', args: ['build'] }));
    expect(a.commandHash).toBe(b.commandHash);
    expect(a.commandHash).not.toBe(c.commandHash);
  });

  it('refuses a command that is not allow-listed (fails closed, nothing persisted)', async () => {
    const h = harness();
    await expect(mgr(h).run(input({ command: 'git', args: ['push'] }))).rejects.toThrow(/allow-listed/);
    expect(h.run).not.toHaveBeenCalled();
    expect(await h.storage.commandExecutions.list()).toHaveLength(0);
  });

  it('refuses an absolute path even to an allow-listed binary (exact match, fails closed)', async () => {
    await expect(mgr().run(input({ command: '/usr/bin/node', args: [] }))).rejects.toThrow(/allow-listed/);
  });

  it('refuses a CRITICAL/destructive command regardless of approval (MB-2)', async () => {
    const h = harness();
    // allow-listed binary, but its args match a destructive pattern → CRITICAL.
    await expect(
      mgr(h).run(input({ command: 'node', args: ['-e', 'DROP TABLE users'], approvalRef: approved })),
    ).rejects.toThrow(/CRITICAL|destructive/);
    expect(h.run).not.toHaveBeenCalled();
  });

  it('requires an APPROVED approval for a HIGH command (MB-2)', async () => {
    const h = harness();
    // `npm publish` is HIGH per RiskPolicy.
    await expect(mgr(h).run(input({ command: 'npm', args: ['publish'] }))).rejects.toThrow(/APPROVED/);
    expect(h.run).not.toHaveBeenCalled();
  });

  it('runs a HIGH command when an APPROVED, plan-scoped approval is supplied', async () => {
    const h = harness();
    const exec = await mgr(h).run(input({ command: 'npm', args: ['publish'], approvalRef: approved }));
    expect(exec.status).toBe(CommandExecutionStatus.SUCCEEDED);
    expect(exec.approvalRef?.id).toBe('appr-1');
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it('rejects a HIGH command whose approval is scoped to a different ExecutionPlan', async () => {
    await expect(
      mgr().run(
        input({
          command: 'npm',
          args: ['publish'],
          approvalRef: { id: 'a', status: ApprovalStatus.APPROVED, executionPlanRef: { id: 'OTHER', goal: 'z' } },
        }),
      ),
    ).rejects.toThrow(/different ExecutionPlan/);
  });

  it('records a non-zero exit as FAILED (still persisted)', async () => {
    const h = harness({ exitCode: 1, stdout: '', stderr: 'boom', timedOut: false });
    const exec = await mgr(h).run(input());
    expect(exec.status).toBe(CommandExecutionStatus.FAILED);
    expect(exec.exitCode).toBe(1);
    expect(exec.stderr).toBe('boom');
  });

  it('records a timed-out run as TIMED_OUT (no exitCode)', async () => {
    const h = harness({ exitCode: null, stdout: '', stderr: '', timedOut: true });
    const exec = await mgr(h).run(input());
    expect(exec.status).toBe(CommandExecutionStatus.TIMED_OUT);
    expect(exec.exitCode).toBeUndefined();
  });

  it('persists into the Execution History (queryable by plan and change)', async () => {
    const h = harness();
    const exec = await mgr(h).run(input({ workspaceChangeRef: { id: 'wc-1', status: WorkspaceChangeStatus.APPLIED } }));
    expect((await h.storage.commandExecutions.findByExecutionPlan('plan-1')).map((e) => e.id)).toEqual([exec.id]);
    expect((await h.storage.commandExecutions.findByWorkspaceChange('wc-1')).map((e) => e.id)).toEqual([exec.id]);
  });

  it('never mutates the ApprovalRef it was given (aggregate ownership)', async () => {
    const ref = Object.freeze({ ...approved });
    const snapshot = JSON.stringify(ref);
    await mgr().run(input({ command: 'npm', args: ['publish'], approvalRef: ref }));
    expect(JSON.stringify(ref)).toBe(snapshot);
  });
});
