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

/**
 * Display-relevant shape of an AI code-change proposal (AI Code Generation Preview, ADR-0038).
 * Application-layer, not domain, not persisted — deliberately narrower than `CodeProposal` (no
 * id/Ref/providerId). `changes` contains only paths that normalized-matched the validated
 * `targetFiles` the request was approved for; `outOfScopeWarnings` holds everything else the AI
 * proposed touching, which is never rendered as content — AI-proposed paths are untrusted.
 */
export interface CodeChangePreview {
  changes: Array<{ path: string; kind: 'update' | 'delete'; excerpt?: string }>;
  outOfScopeWarnings: string[];
}

/**
 * Display-relevant shape of a unified-diff-style code-change preview (Unified Diff Preview, ADR-0039).
 * Application-layer, not domain, not persisted. `unified`/`binary` come straight from a
 * `WorkspaceManager.diff()` `FileDiff` — current-content-vs-proposed, never AI-authored diff text.
 * Every entry's `kind` is `'update' | 'delete'` — `'add'` is rejected as a failure before this DTO is
 * built (`ConversationRuntime.runCodeGenerationPreview`).
 */
export interface CodeDiffPreview {
  changes: Array<{ path: string; kind: 'update' | 'delete'; unified: string; binary: boolean }>;
  outOfScopeWarnings: string[];
}

/**
 * Display DTO for a generated PatchSet (Approved Apply Context → PatchSet Preview, ADR-0041).
 * Application-layer, not domain — each entry is a `PatchOperation` reshaped for display. `unified` came
 * from `WorkspaceManager.diff`, never AI-authored text. A PatchSet existing means a REPRESENTATION was
 * generated; it does NOT mean it was applied (no file/command/git mutation).
 */
export interface PatchSetPreview {
  operations: Array<{ path: string; kind: 'add' | 'update' | 'delete'; unified: string }>;
}

/** Per-stream tail kept in a reply excerpt (lines), before the char cap applies. */
const MAX_SUMMARY_LINES = 20;
/** Char cap on the rendered excerpt, leaving headroom under Discord's 2000-char message limit. */
const MAX_SUMMARY_CHARS = 1200;
/** Hard cap on the full rendered reply (excerpt + surrounding sentences), same reason. */
const MAX_MESSAGE_CHARS = 1900;
/** The command-runner adapter's own truncation marker (`maskCommandOutput`, ADR-0028). */
const ADAPTER_TRUNCATION_MARKER = '…[truncated]';
/** Per-file excerpt cap before the overall message clamp applies (AI Code Generation Preview, ADR-0038). */
const MAX_PREVIEW_EXCERPT_CHARS = 800;
/** Bound on how many out-of-scope paths are listed before truncating (ADR-0038). */
const MAX_OUT_OF_SCOPE_WARNING_PATHS = 5;
/** Per-file diff line/char caps before the reserved-budget assembly applies (Unified Diff Preview,
 *  ADR-0039) — independent of MAX_PREVIEW_EXCERPT_CHARS (different content shape). Lowered to 1000
 *  chars (from an initial 2000) so a single file's diff leaves headroom for the header, footer, and
 *  other files' blocks within MAX_MESSAGE_CHARS (CA Round 1 Required Change #2). */
const MAX_DIFF_LINES_PER_FILE = 40;
const MAX_DIFF_CHARS_PER_FILE = 1000;
/** Fixed upper bound on the "N개 파일... 생략했어요" notice's length (N is bounded by
 *  MAX_TARGET_CANDIDATES = 5 upstream, so always short) — reserved up front so the notice never has to
 *  compete for budget after the fact (ADR-0039). */
const MAX_OMITTED_NOTICE_CHARS = 40;
/** Slack for line-join overhead across header/blocks/footer (ADR-0039, CA Round 1 Required Change #2). */
const DIFF_BUDGET_MARGIN_CHARS = 20;

const DIFF_PREVIEW_HEADER =
  '코드 변경 제안을 diff로 보여드려요. 아직 실제로 적용되지 않았어요. 파일은 수정되지 않았어요.';
const DIFF_PREVIEW_FOOTER = '이 제안을 실제로 적용하는 기능은 아직 지원하지 않아요.';

/** PatchSet preview (Sprint 2t, ADR-0041). CA Round 1 Required Change #3: "패치 미리보기" framing —
 *  never a bare "패치를 만들었어요" a non-developer could read as "applied." */
const PATCH_PREVIEW_HEADER =
  '패치 미리보기를 만들었어요. 아직 실제 파일에는 적용하지 않았어요. 파일은 수정되지 않았어요.';
const PATCH_PREVIEW_FOOTER = '실제 파일 적용은 아직 지원하지 않아요.';

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
 * A fence guaranteed longer than any backtick run already inside `excerpt` (AI Code Generation
 * Preview, ADR-0038 — CA Round 1) — untrusted AI content can never break the surrounding message's
 * Markdown structure.
 */
function fenceFor(excerpt: string): string {
  const longestRun = Math.max(2, ...(excerpt.match(/`+/g) ?? ['']).map((r) => r.length));
  return '`'.repeat(longestRun + 1);
}

/** Bounded, comma-joined out-of-scope path list with a "외 N개" suffix when truncated (ADR-0038). */
function renderOutOfScopeWarning(paths: string[]): string | undefined {
  if (!paths.length) return undefined;
  const shown = paths.slice(0, MAX_OUT_OF_SCOPE_WARNING_PATHS);
  const suffix = paths.length > shown.length ? ` 외 ${paths.length - shown.length}개` : '';
  return `참고: ${shown.join(', ')}${suffix}에도 변경을 제안했지만, 확인된 대상 파일이 아니라서 보여드리지 않았어요.`;
}

/** Clamp one file's unified diff to a bounded number of lines, then chars (Unified Diff Preview,
 *  ADR-0039); reports whether either cap fired so the caller can add a truncation notice. */
function clampDiffText(unified: string): { text: string; truncated: boolean } {
  const lines = unified.split('\n');
  const lineTruncated = lines.length > MAX_DIFF_LINES_PER_FILE;
  let text = (lineTruncated ? lines.slice(0, MAX_DIFF_LINES_PER_FILE) : lines).join('\n');
  const charTruncated = text.length > MAX_DIFF_CHARS_PER_FILE;
  if (charTruncated) text = text.slice(0, MAX_DIFF_CHARS_PER_FILE);
  return { text, truncated: lineTruncated || charTruncated };
}

/**
 * Render one changed file's block (Unified Diff Preview, ADR-0039). Binary and size-skipped files must
 * say plainly that a diff could not be displayed — never phrased as if one was shown — and repeat that
 * the file was not modified (CA Round 1 Required Change #4).
 */
function renderDiffChange(c: CodeDiffPreview['changes'][number]): string {
  if (c.binary) return `- ${c.path}: 바이너리 파일이라 diff를 표시할 수 없어요. (파일은 수정되지 않았어요)`;
  if (!c.unified.trim()) {
    return `- ${c.path}: 내용이 너무 커서 diff를 표시할 수 없어요. (파일은 수정되지 않았어요)`;
  }
  const { text, truncated } = clampDiffText(c.unified);
  const fence = fenceFor(text);
  const label = c.kind === 'delete' ? `${c.path} (삭제 제안)` : c.path;
  const note = truncated ? '\n(diff가 길어서 일부만 보여드렸어요.)' : '';
  return `- ${label}\n${fence}diff\n${text}\n${fence}${note}`;
}

/** Render one PatchSet operation's block (Sprint 2t, ADR-0041). Operations only ever carry a real
 *  unified diff here — binary/empty/add are rejected before PatchSet generation — so this reuses the
 *  same bounded, backtick-safe rendering as {@link renderDiffChange}. */
function renderPatchOperation(op: PatchSetPreview['operations'][number]): string {
  const { text, truncated } = clampDiffText(op.unified);
  const fence = fenceFor(text);
  const label = op.kind === 'delete' ? `${op.path} (삭제)` : op.path;
  const note = truncated ? '\n(diff가 길어서 일부만 보여드렸어요.)' : '';
  return `- ${label}\n${fence}diff\n${text}\n${fence}${note}`;
}

/**
 * Budget-aware, backtick-safe block assembly shared by the diff and PatchSet previews (Sprint 2r/2t).
 * The header + footer are reserved budget FIRST; pre-rendered blocks are then added until the remaining
 * budget is used up, and any that don't fit are DROPPED (never truncated mid-block) with a bounded
 * "N개 생략" notice — so the mandatory safety wording always survives. The trailing clampToMessageBudget
 * is a defensive backstop, not the primary guarantee.
 */
function assembleBoundedBody(header: string, footerLines: string[], blocks: string[]): string {
  const footer = footerLines.join('\n');
  const reserved = header.length + footer.length + MAX_OMITTED_NOTICE_CHARS + DIFF_BUDGET_MARGIN_CHARS;
  const bodyBudget = Math.max(0, MAX_MESSAGE_CHARS - reserved);

  const kept: string[] = [];
  let used = 0;
  let omitted = 0;
  for (const block of blocks) {
    if (used + block.length > bodyBudget) {
      omitted++;
      continue;
    }
    used += block.length;
    kept.push(block);
  }

  const lines = [header, ...kept];
  if (omitted > 0) lines.push(`(길이 제한으로 파일 ${omitted}개의 diff는 생략했어요.)`);
  lines.push(...footerLines);
  return clampToMessageBudget(lines.join('\n'));
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

  /**
   * Reply for "취소" while a code-change scope clarification is pending (Multi-turn Code Scope
   * Clarification, ADR-0037). No ExecutionPlan/ApprovalRequest/Patch ever existed for this request —
   * the wording must not imply an execution or plan was cancelled, only that the request itself was
   * dropped. Distinct from composeExecutionResult('CANCELLED')'s "작업을 취소했어요", which could be
   * misread as cancelling in-flight work that never existed.
   */
  composeScopeClarificationCancelled(context: ConversationContext): OutboundMessage {
    return {
      context,
      text: '코드 변경 요청을 취소했어요. 다시 필요하시면 파일 경로와 함께 새로 요청해 주세요.',
    };
  }

  /**
   * A successful AI code-change proposal preview (AI Code Generation Preview, ADR-0038). Repeats,
   * not merely mentions once, that nothing was applied — never uses wording that could be read as
   * "적용했어요"/"수정했어요"/"반영했어요"/"변경 완료". AI content is rendered inside a fence
   * guaranteed safe against backticks already present in the (untrusted) excerpt.
   */
  composeCodeGenerationPreview(context: ConversationContext, preview: CodeChangePreview): OutboundMessage {
    const lines = [
      '코드 변경 제안이 준비됐어요. 아직 실제로 적용되지 않았어요. 파일은 수정되지 않았어요.',
      ...preview.changes.map((c) => {
        if (c.kind === 'delete') return `- ${c.path} (삭제 제안 — 아직 적용되지 않음)`;
        const excerpt = (c.excerpt ?? '').slice(0, MAX_PREVIEW_EXCERPT_CHARS);
        const fence = fenceFor(excerpt);
        return `- ${c.path}\n${fence}\n${excerpt}\n${fence}`;
      }),
    ];
    const warning = renderOutOfScopeWarning(preview.outOfScopeWarnings);
    if (warning) lines.push(warning);
    lines.push('이 제안을 실제로 적용하는 기능은 아직 지원하지 않아요.');
    return { context, text: clampToMessageBudget(lines.join('\n')) };
  }

  /** AI Code Generation failed to produce a usable proposal (ADR-0038). CA-specified wording verbatim. */
  composeCodeGenerationPreviewFailed(context: ConversationContext): OutboundMessage {
    return { context, text: '코드 변경 제안을 생성하지 못했어요.\n파일은 수정되지 않았어요.' };
  }

  /**
   * Every proposed path was outside the validated targetFiles (AI Code Generation Preview, ADR-0038).
   * Distinct from {@link composeCodeGenerationPreviewFailed}: generation itself succeeded, but
   * nothing it proposed matched the confirmed target — a different, more precise claim. Never
   * presented as a successful proposal.
   */
  composeCodeGenerationPreviewNoValidChange(context: ConversationContext, outOfScopeWarnings: string[]): OutboundMessage {
    const lines = ['AI가 제안한 변경이 확인된 대상 파일과 일치하지 않아 보여드릴 수 없어요.', '파일은 수정되지 않았어요.'];
    const warning = renderOutOfScopeWarning(outOfScopeWarnings);
    if (warning) lines.push(warning);
    return { context, text: clampToMessageBudget(lines.join('\n')) };
  }

  /**
   * A successful unified-diff-style code-change preview (Unified Diff Preview, ADR-0039). Supersedes
   * {@link composeCodeGenerationPreview} as the primary success rendering for a post-approval
   * CodeGeneration preview — that method is retained, unreached from this call site, the same accepted
   * status ADR-0038 gave `composePlanningOnlyApproved`. Must repeat, not merely mention once, that
   * nothing was applied.
   *
   * CA Round 1 Required Change #2: the header and footer (incl. the out-of-scope warning, if any, and
   * a bound on the "files omitted" notice) are reserved budget FIRST; only the remaining budget is
   * spent on file blocks, which are dropped (not truncated mid-block) once that budget is used up. This
   * guarantees the safety wording survives even when the diff content alone would have exceeded
   * MAX_MESSAGE_CHARS — the trailing clampToMessageBudget call below is now a defensive backstop, not
   * the primary guarantee.
   */
  composeCodeDiffPreview(context: ConversationContext, preview: CodeDiffPreview): OutboundMessage {
    const warning = renderOutOfScopeWarning(preview.outOfScopeWarnings);
    const footerLines = [...(warning ? [warning] : []), DIFF_PREVIEW_FOOTER];
    const blocks = preview.changes.map(renderDiffChange);
    return { context, text: assembleBoundedBody(DIFF_PREVIEW_HEADER, footerLines, blocks) };
  }

  /**
   * The second approval exists to authorize FILE MODIFICATION — distinct from the first approval (which
   * only authorized generating a preview) (Explicit Preview Apply Approval, ADR-0040). Must say so
   * explicitly, mention that actual apply will re-validate/re-diff against the latest file content, and
   * name all three decision words (not just 승인/취소).
   */
  composeApplyApprovalRequested(context: ConversationContext, targetFiles: string[]): OutboundMessage {
    return {
      context,
      text:
        `AI가 준비한 코드 변경을 실제 파일(${targetFiles.join(', ')})에 적용하려면 별도 승인이 필요해요.\n` +
        '이 승인은 미리보기 생성이 아니라 실제 파일 수정을 위한 것이에요. 아직 파일은 수정되지 않았어요.\n' +
        '실제 적용 시에는 최신 파일 내용으로 다시 확인해요.\n' +
        '진행하려면 "승인", 거절하려면 "거절", 그만두려면 "취소"라고 답해 주세요.',
    };
  }

  /**
   * Explicit apply intent detected, but no eligible preview/refs to apply (ADR-0040). Never creates an
   * approval.
   */
  composeApplyPreviewUnavailable(context: ConversationContext): OutboundMessage {
    return {
      context,
      text: '적용할 수 있는 코드 변경 미리보기가 없어요. 먼저 코드 변경을 요청하고 미리보기를 확인해 주세요.',
    };
  }

  /**
   * The apply approval was recorded (or was already approved and the user asked again) — this sprint
   * does not implement the apply step itself (ADR-0040). Must not read as if the task is complete —
   * never "적용 완료"/"반영 완료"/"수정했어요".
   */
  composeApplyApprovalRecorded(context: ConversationContext): OutboundMessage {
    return {
      context,
      text: '적용 승인만 기록했어요.\n아직 실제 파일 적용은 수행하지 않았어요.\n파일은 수정되지 않았어요.',
    };
  }

  /**
   * A generated PatchSet preview (Approved Apply Context → PatchSet Preview, ADR-0041). CA Round 1
   * Required Change #3: "패치 미리보기" framing — a PatchSet REPRESENTATION exists, nothing was applied.
   * Reuses the Sprint 2r budget-aware, backtick-safe block assembly. Must repeat, not merely mention
   * once, that files were not modified; never "적용했어요"/"반영했어요"/"수정했어요"/"변경 완료"/"적용 완료".
   */
  composePatchSetPreview(context: ConversationContext, preview: PatchSetPreview): OutboundMessage {
    const blocks = preview.operations.map(renderPatchOperation);
    return { context, text: assembleBoundedBody(PATCH_PREVIEW_HEADER, [PATCH_PREVIEW_FOOTER], blocks) };
  }

  /**
   * No approved apply context to build a patch from (ADR-0041, CA Q3) — no anchor / not APPROVED /
   * missing approval / missing proposal / all-out-of-scope. Never implies anything was generated or applied.
   */
  composePatchUnavailable(context: ConversationContext): OutboundMessage {
    return {
      context,
      text: '패치를 만들 수 있는 승인된 코드 변경이 없어요. 먼저 코드 변경을 요청하고 미리보기·적용 승인을 완료해 주세요.',
    };
  }

  /**
   * Approved, but the latest diff/generation could not be built cleanly (ADR-0041, CA Q7) — stale/add/
   * binary/empty/throw. Safe user-facing message; the failure reason is logged separately (never here).
   */
  composePatchGenerationFailed(context: ConversationContext): OutboundMessage {
    return {
      context,
      text: '승인된 변경으로 패치를 만들지 못했어요. 파일 내용이 바뀌었거나 표시할 수 없는 변경일 수 있어요. 파일은 수정되지 않았어요.',
    };
  }

  /**
   * A PatchSet was already generated (anchor PATCH_READY) and the user asked again (ADR-0041) — no
   * regeneration. Must not read as if the patch was applied.
   */
  composePatchAlreadyGenerated(context: ConversationContext): OutboundMessage {
    return {
      context,
      text: '이미 패치 미리보기를 만들어 뒀어요.\n아직 실제 파일 적용은 하지 않았어요.\n파일은 수정되지 않았어요.',
    };
  }

  /**
   * Successful workspace file mutation (PatchRef → WorkspaceWrite Apply, ADR-0042). CA Round 1 #5/#6/Q10:
   * says the file was modified, git COMMANDS were not run, commit/push were not performed, tests were not
   * run, and the working tree may now hold the change. Never "git 변경 없음"/committed/pushed/deployed/
   * verified/적용 완료 — after a write the working tree is NOT clean.
   */
  composeWorkspaceApplied(context: ConversationContext, targetFiles: string[]): OutboundMessage {
    return {
      context,
      text:
        `파일을 수정했어요: ${targetFiles.join(', ')}\n` +
        'git 명령은 실행하지 않았어요. 커밋/푸시는 하지 않았어요.\n' +
        '작업 트리에는 방금 적용한 파일 변경이 남아 있을 수 있어요.\n' +
        '테스트도 실행하지 않았어요.',
    };
  }

  /**
   * No PATCH_READY apply context to write (ADR-0042, CA Q4) — no anchor / not PATCH_READY / PATCH_READY
   * without patchRef. Never implies anything was written.
   */
  composeWorkspaceApplyUnavailable(context: ConversationContext): OutboundMessage {
    return {
      context,
      text: '지금 파일에 적용할 수 있는 준비된 패치가 없어요. 먼저 코드 변경 요청 → 승인 → 패치 생성을 완료해 주세요.',
    };
  }

  /**
   * PATCH_READY but the PatchSet is missing/invalid/unsupported, or WorkspaceWrite failed / the diff no
   * longer applies cleanly (stale/conflict) (ADR-0042, CA Q5/Q6). Safe; the reason is logged separately,
   * never here. CA Round 1 #5: "git 명령이나 테스트는 실행하지 않았어요", never "git 변경 없음".
   */
  composeWorkspaceApplyFailed(context: ConversationContext): OutboundMessage {
    return {
      context,
      text: '이 패치를 파일에 적용하지 못했어요. 파일 내용이 바뀌었거나 지원하지 않는 변경일 수 있어요. git 명령이나 테스트는 실행하지 않았어요.',
    };
  }

  /**
   * WORKSPACE_APPLIED + another final/patch/apply command (ADR-0042) — no re-apply, and must not hide the
   * applied state (CA Round 1 #8). CA Round 1 #5: "git 명령이나 테스트는 실행하지 않았어요".
   */
  composeWorkspaceAlreadyApplied(context: ConversationContext): OutboundMessage {
    return {
      context,
      text: '이미 파일을 수정했어요. git 명령이나 테스트는 실행하지 않았어요.',
    };
  }
}
