import type {
  ApprovalRequest,
  Artifact,
  ConversationContext,
  OutboundMessage,
} from '../domain';
import type { AiExecutionResult } from '../ports';

/**
 * The terminal/halt status of an execution turn (Conversation Runtime, ADR-0032). Kept as a
 * narrow local union so ResponseComposer does not depend on the orchestrator module; the runtime
 * passes the Execution Orchestrator's `ExecutionOutcome.status` (a superset) through unchanged.
 */
export type ExecutionReplyStatus =
  | 'COMPLETED'
  | 'AWAITING_APPROVAL'
  | 'DENIED'
  | 'STOPPED_ON_FAILURE'
  | 'CANCELLED';

/**
 * Display-relevant facts for one test/typecheck `CommandExecution` (Test Result Detail UX,
 * ADR-0034). An Application-layer DTO — not domain, not persisted, deliberately narrower than
 * `CommandExecution` itself: no id/Ref/hash/status, only what is safe and useful to render.
 * `ConversationRuntime` assembles it from the aggregate it already reads (`frameTestResult`); it
 * never truncates the streams or writes any text — that stays entirely inside `ResponseComposer`.
 */
export interface TestResultDetail {
  kind: 'test' | 'typecheck';
  command: string;
  args: string[];
  /** Absent for TIMED_OUT — the process was killed, it never produced a real exit. */
  exitCode?: number;
  durationMs: number;
  /** Already masked + size-capped by the command-runner adapter (ADR-0028) — never re-masked here. */
  stdout: string;
  stderr: string;
}

/** Per-stream tail kept in a reply excerpt (lines), before the char cap applies. */
const MAX_SUMMARY_LINES = 20;
/** Char cap on the rendered excerpt, leaving headroom under Discord's 2000-char message limit. */
const MAX_SUMMARY_CHARS = 1200;
/** Hard cap on the full rendered reply (excerpt + surrounding sentences), same reason. */
const MAX_MESSAGE_CHARS = 1900;
/** The command-runner adapter's own truncation marker (`maskCommandOutput`, ADR-0028). */
const ADAPTER_TRUNCATION_MARKER = '…[truncated]';

/** Which stream a rendered excerpt came from, and which non-empty stream was left out. */
interface OutputSummary {
  chosenStream: 'stdout' | 'stderr' | 'none';
  omittedStream?: 'stdout' | 'stderr';
  excerpt: string;
  truncated: boolean;
}

/**
 * Deterministic, non-AI summarization of one command's captured output (Test Result Detail UX,
 * ADR-0034). Prefers `stdout` (test runners/typecheckers report there); falls back to `stderr` only
 * when `stdout` is empty — a single stream, never an interleaved merge of both. Keeps the **tail**
 * (last `MAX_SUMMARY_LINES` lines, then `MAX_SUMMARY_CHARS` chars) since the actionable detail for a
 * failing test/typecheck run is at the end. Truncating already-masked text cannot re-expose
 * anything (CA review Q3) — this is a length transform only, not a second masking pass.
 */
function summarizeOutput(stdout: string, stderr: string): OutputSummary {
  const chosenStream: OutputSummary['chosenStream'] = stdout.trim()
    ? 'stdout'
    : stderr.trim()
      ? 'stderr'
      : 'none';
  if (chosenStream === 'none') {
    return { chosenStream, excerpt: '', truncated: false };
  }
  // stdout-preferred can only ever omit stderr (stderr is chosen only when stdout is empty) —
  // don't hide that stderr output existed (CA review, required change #1).
  const omittedStream = chosenStream === 'stdout' && stderr.trim() ? 'stderr' : undefined;

  const raw = chosenStream === 'stdout' ? stdout : stderr;
  const adapterTruncated = raw.includes(ADAPTER_TRUNCATION_MARKER);
  const lines = raw.split('\n');
  const lineTruncated = lines.length > MAX_SUMMARY_LINES;
  const tail = lineTruncated ? lines.slice(-MAX_SUMMARY_LINES) : lines;

  let excerpt = tail.join('\n');
  const charTruncated = excerpt.length > MAX_SUMMARY_CHARS;
  if (charTruncated) excerpt = excerpt.slice(excerpt.length - MAX_SUMMARY_CHARS);

  return {
    chosenStream,
    ...(omittedStream ? { omittedStream } : {}),
    excerpt,
    truncated: adapterTruncated || lineTruncated || charTruncated,
  };
}

/** `durationMs` as seconds with one decimal, e.g. `"30.0s"`. */
function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

/** The fixed command shape ("pnpm test"), never a shell string — display only. */
function formatCommand(detail: Pick<TestResultDetail, 'command' | 'args'>): string {
  return [detail.command, ...detail.args].join(' ');
}

/**
 * Render the excerpt block: a fenced code block plus notice lines. Notice wording is deliberately
 * modest (CA review, required change #5) — it states that the log was cut, never that it is
 * "완전히 안전"/fully redacted; we trust the adapter's masking boundary (ADR-0028) without asserting
 * it to the user.
 */
function renderExcerptBlock(summary: OutputSummary): string {
  if (summary.chosenStream === 'none') return '출력이 없어요.';
  const lines = ['마지막 출력:', '```', summary.excerpt, '```'];
  if (summary.truncated) lines.push('출력이 길어서 마지막 부분만 보여드렸어요.');
  if (summary.omittedStream) {
    lines.push(`${summary.omittedStream} 출력도 있었지만, 여기서는 ${summary.chosenStream} 마지막 부분만 보여드려요.`);
  }
  return lines.join('\n');
}

/** Defensive final-length guard (CA review, required change #6) — belt-and-suspenders over the excerpt cap. */
function clampToMessageBudget(text: string): string {
  return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS - 1)}…` : text;
}

/**
 * Turns an execution result (or an approval prompt) into a normalized
 * OutboundMessage. The PlatformAdapter renders it natively. v1 implements a
 * straightforward pass-through; richer formatting per ArtifactKind is a TODO.
 *
 * Note: it deliberately never includes which provider was selected — the user
 * should not normally see that.
 */
export class ResponseComposer {
  compose(
    context: ConversationContext,
    result: AiExecutionResult,
    artifacts: Artifact[] = [],
  ): OutboundMessage {
    const text = result.text.trim() || '(빈 응답이에요. 다시 시도해 주세요.)';
    return {
      context,
      text,
      ...(artifacts.length ? { artifacts } : {}),
    };
  }

  composeApprovalNotice(context: ConversationContext, request: ApprovalRequest): OutboundMessage {
    return {
      context,
      text: `이 작업은 승인이 필요해요 (${request.riskLevel}):\n${request.reason}\n진행하려면 "승인", 그만두려면 "취소"라고 답해 주세요.`,
    };
  }

  /**
   * Generic "this needs approval" prompt for when only a reference (not the full `ApprovalRequest`)
   * is at hand — e.g. a fresh execution that halted at `AWAITING_APPROVAL` (Conversation Runtime,
   * ADR-0032). Keeps all user-facing text inside ResponseComposer.
   */
  composeApprovalRequired(context: ConversationContext): OutboundMessage {
    return {
      context,
      text: '이 작업은 승인이 필요해요. 진행하려면 "승인", 그만두려면 "취소"라고 답해 주세요.',
    };
  }

  /**
   * Code-change-specific "approval required" prompt (Live Code Change Planning, ADR-0035). More
   * specific than {@link composeApprovalRequired}: names this as a code-change request and states
   * explicitly that no file is modified yet — a `planningOnly` halt never mutates.
   */
  composeCodeChangeApprovalRequired(context: ConversationContext): OutboundMessage {
    return {
      context,
      text:
        '이 작업은 코드 변경으로 이어질 수 있어 승인이 필요해요.\n' +
        '이번 단계에서는 실제 파일을 수정하지 않고 계획/승인까지만 진행해요.\n' +
        '진행하려면 "승인", 그만두려면 "취소"라고 답해 주세요.',
    };
  }

  /**
   * Reply for "승인" on a `planningOnly` CODE_IMPLEMENTATION request (Live Code Change Planning,
   * ADR-0035). Must NEVER read as "the code was fixed" — nothing was generated, patched, or written
   * this sprint. Distinct from {@link composeExecutionResult}('COMPLETED'), which would falsely
   * imply the work happened.
   */
  composePlanningOnlyApproved(context: ConversationContext): OutboundMessage {
    return {
      context,
      text:
        '승인은 확인했어요. 이번 단계에서는 코드 수정 전 계획까지만 진행했어요. ' +
        '실제 코드 제안/수정은 다음 단계에서 진행할 수 있어요.',
    };
  }

  /**
   * Map a finished/halted execution turn to a natural reply (Conversation Runtime, ADR-0032). The
   * runtime never builds reply text itself — it hands the outcome status (and any produced
   * artifacts) here. AWAITING_APPROVAL is handled by {@link composeApprovalNotice}, not here.
   */
  composeExecutionResult(
    context: ConversationContext,
    status: ExecutionReplyStatus,
    artifacts: Artifact[] = [],
  ): OutboundMessage {
    const text =
      status === 'COMPLETED'
        ? '요청하신 작업을 완료했어요.'
        : status === 'DENIED'
          ? '승인이 거절되어 작업을 진행하지 않았어요.'
          : status === 'CANCELLED'
            ? '작업을 취소했어요.'
            : '작업을 진행하던 중 문제가 생겨서 멈췄어요. 다시 시도해 주세요.'; // STOPPED_ON_FAILURE
    return { context, text, ...(artifacts.length ? { artifacts } : {}) };
  }

  /** A user-facing failure reply (ADR-0015). Never includes technical detail. */
  composeError(context: ConversationContext, userMessage: string): OutboundMessage {
    return { context, text: userMessage };
  }

  /**
   * A **product test result** (Live Test Execution, ADR-0033; detail added in Test Result Detail
   * UX, ADR-0034). A failing test (exit ≠ 0) is the project's result — NOT a bot/system error — so
   * it is phrased as such. The runtime passes only raw facts (`TestResultDetail` + `passed`); all
   * summarization (excerpt tail/cap, omitted-stream notice, truncation notice) and wording live here.
   */
  composeTestResult(context: ConversationContext, detail: TestResultDetail & { passed: boolean }): OutboundMessage {
    const label = detail.kind === 'typecheck' ? '타입체크' : '테스트';
    const verdict = detail.passed ? `${label}가 모두 통과했어요. ✅` : `${label}에서 실패가 있었어요. ❌`;
    const summary = summarizeOutput(detail.stdout, detail.stderr);
    const text = clampToMessageBudget(
      [
        verdict,
        `명령: ${formatCommand(detail)}`,
        `종료 코드: ${detail.exitCode ?? '-'}`,
        `실행 시간: ${formatDuration(detail.durationMs)}`,
        renderExcerptBlock(summary),
      ].join('\n'),
    );
    return { context, text };
  }

  /**
   * A `TIMED_OUT` `CommandExecution` (Test Result Detail UX, ADR-0034). Distinct from
   * {@link composeTestResult} on purpose (CA review): the process was killed, not evaluated, so this
   * NEVER phrases it as a test failure and NEVER shows an exit code (none exists). `durationMs` is
   * the actual elapsed time, not the configured limit — `TestResultDetail` carries no such value, so
   * the wording only reports what happened, not what the limit was.
   */
  composeTestTimedOut(context: ConversationContext, detail: TestResultDetail): OutboundMessage {
    const label = detail.kind === 'typecheck' ? '타입체크' : '테스트';
    const text = clampToMessageBudget(
      [
        `${label}가 제한 시간 안에 끝나지 않아 중단됐어요.`,
        `명령: ${formatCommand(detail)}`,
        `실행 시간: ${formatDuration(detail.durationMs)}`,
      ].join('\n'),
    );
    return { context, text };
  }

  /** No active project — guide the user to register one first (ADR-0033). */
  composeNeedsProject(context: ConversationContext): OutboundMessage {
    return {
      context,
      text: '먼저 사용할 프로젝트를 등록해 주세요. (예: "이 프로젝트 등록해줘: /path/to/project")',
    };
  }

  /** The active project's workspace could not be opened (ADR-0033). */
  composeWorkspaceUnavailable(context: ConversationContext): OutboundMessage {
    return { context, text: '프로젝트 작업 공간을 열 수 없었어요. 프로젝트 경로를 확인해 주세요.' };
  }

  /** The command could not be run (timeout / refused / system error) — not a test result (ADR-0033). */
  composeCommandUnavailable(context: ConversationContext): OutboundMessage {
    return { context, text: '명령을 실행할 수 없었어요. 잠시 후 다시 시도해 주세요.' };
  }

  /**
   * Clarification prompt when a code-change request names no validated target file (Code Change
   * Scope Collection, ADR-0036). No ExecutionPlan/ApprovalRequest exists at this point — this is a
   * plain conversational reply, not an approval/waiting state. Wording is CA-specified (Round 1):
   * asks for a file path as the sufficient ask, frames natural-language scope as optional context
   * only, and tells the user to re-send the full request together with the path (no multi-turn
   * memory this sprint).
   */
  composeTargetScopeClarification(context: ConversationContext): OutboundMessage {
    return {
      context,
      text:
        '수정할 파일 경로와 함께 다시 요청해 주세요.\n' +
        '예: packages/core/src/application/foo.ts 파일에서 이 버그 고쳐줘\n\n' +
        '"로그인 처리 부분"처럼 설명만으로는 아직 부족해요. 어떤 부분을 고치려는지는 파일 경로와 함께 ' +
        '추가로 적어주면 더 좋아요.',
    };
  }
}
