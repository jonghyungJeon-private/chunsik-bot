import { Capability, IntentType } from '../domain';
import type { InboundMessage, Intent } from '../domain';
import type { CapabilityRouter } from './capability-router';
import { isNegated } from './intent-negation';

/**
 * Classifies a natural-language message into an Intent. v1 is MINIMAL and
 * deterministic:
 *   - "register this project: <path>" → REGISTER_PROJECT (ADR-0018)
 *   - "analyze/explain this project/repo/structure" → PROJECT_ANALYSIS (ADR-0019)
 *   - everything else → general chat (becomes a Task).
 * AI-driven classification arrives later; the `router` is held for it.
 */
export class IntentClassifier {
  constructor(private readonly router: CapabilityRouter) {}

  async classify(message: InboundMessage): Promise<Intent> {
    void this.router;
    const text = message.text.trim();

    // Explicit preview command (Sprint 4c-Follow-up, ADR-0062 draft) — an unambiguous entry into the code-change
    // preview pipeline (IMPLEMENT_CODE → planningOnly → HIGH-risk plan approval → CodeGeneration preview),
    // independent of NL phrasing. It never applies/commits/pushes — it stops at the read-only diff preview.
    if (/^\/preview\b/i.test(text)) {
      const rest = text.replace(/^\/preview\b\s*/i, '').trim();
      return {
        type: IntentType.IMPLEMENT_CODE,
        capability: Capability.CODE_IMPLEMENTATION,
        confidence: 1,
        requiresWork: true,
        summary: (rest || 'Preview a code change').slice(0, 200),
        raw: { kind: 'preview' },
      };
    }

    const path = IntentClassifier.extractLocalPath(text);
    if (path && /등록|register/i.test(text)) {
      return {
        type: IntentType.REGISTER_PROJECT,
        capability: Capability.READONLY_LOOKUP,
        confidence: 1,
        requiresWork: false,
        summary: `Register project: ${path}`,
        raw: { path },
      };
    }

    // Test-run request (CAP live execution, ADR-0033). The classifier judges the intent + a
    // normalized `raw.kind` ONLY — the concrete command is the IntentResolver's decision.
    const testKind = IntentClassifier.detectTestRun(text);
    if (testKind) {
      return {
        type: IntentType.RUN_TESTS,
        capability: Capability.TEST_EXECUTION,
        confidence: 1,
        requiresWork: true,
        summary: text.slice(0, 200) || 'Run tests',
        raw: { kind: testKind },
      };
    }

    // Code-change request (live planning, ADR-0035). The classifier judges intent + a normalized
    // `raw.kind` ONLY — no implementation instruction, target-file guess, patch hint, or command.
    const codeChangeKind = IntentClassifier.detectCodeChange(text);
    if (codeChangeKind) {
      return {
        type: IntentType.IMPLEMENT_CODE,
        capability: Capability.CODE_IMPLEMENTATION,
        confidence: 1,
        requiresWork: true,
        summary: text.slice(0, 200) || 'Change code',
        raw: { kind: codeChangeKind },
      };
    }

    if (IntentClassifier.isProjectAnalysis(text)) {
      return {
        type: IntentType.PROJECT_ANALYSIS,
        capability: Capability.PROJECT_ANALYSIS,
        confidence: 1,
        requiresWork: true,
        summary: text.slice(0, 200) || 'Analyze the active project',
      };
    }

    return {
      type: IntentType.CHAT,
      capability: Capability.GENERAL_CHAT,
      confidence: 1,
      requiresWork: true,
      summary: text.slice(0, 200) || '(empty message)',
    };
  }

  /**
   * Detect a test-run request → its kind, or undefined. Deterministic, conservative (KO + EN). The
   * kind is a classification tag only; the resolver maps it to a fixed allow-listed command (ADR-0033).
   */
  private static detectTestRun(text: string): 'typecheck' | 'test' | undefined {
    // Negation-aware (Sprint 4c-Follow-up, ADR-0062 draft): a NEGATED test/typecheck phrase ("테스트 실행하지 마",
    // "pnpm test 실행하지 마", "do not run tests") must NOT be read as a RUN_TESTS request — otherwise a
    // preview-only request that prohibits tests would run `pnpm test` (the Gate 4B observation). Each matched
    // token is guarded with isNegated(); a non-negated test request behaves exactly as before (ADR-0033).
    const typecheck = text.match(/(typecheck|타입\s*체크|type\s*check)/i);
    if (typecheck && !isNegated(text, typecheck.index ?? 0, typecheck[0].length)) return 'typecheck';
    const pnpmTest = text.match(/\bpnpm\s+test\b/i);
    if (pnpmTest && !isNegated(text, pnpmTest.index ?? 0, pnpmTest[0].length)) return 'test';
    const testNoun = text.match(/(테스트|\btest\b)/i);
    const actionVerb = /(돌려|실행|run|해줘|해 줘)/i.test(text);
    if (testNoun && actionVerb && !isNegated(text, testNoun.index ?? 0, testNoun[0].length)) return 'test';
    return undefined;
  }

  /**
   * Detect a code-change request → its kind, or undefined. Deterministic, conservative (KO + EN).
   * Kind is a classification tag only — never an implementation instruction (ADR-0035).
   */
  private static detectCodeChange(text: string): 'fix' | 'change' | 'refactor' | 'preview' | undefined {
    // Preview-only requests (Sprint 4c-Follow-up, ADR-0062 draft) — a preview phrase needs NO change verb; it is
    // still a CODE_IMPLEMENTATION intent that reuses the planningOnly → plan-approval → CodeGeneration-preview
    // pipeline and stops at the read-only diff preview (ELIGIBLE). Checked first so a preview phrasing wins.
    const previewWords =
      /(변경\s*미리\s*보기|코드\s*변경\s*미리\s*보기|패치\s*미리\s*보기|diff\s*미리\s*보기|미리\s*보기만|미리\s*보기\s*(?:생성|만들|보여)|코드\s*변경\s*초안|파일\s*변경안|patch\s+preview|diff\s+preview|preview\s+only|preview\s+the\s+change|(?:generate|show|make|create)\s+(?:me\s+)?(?:a\s+)?(?:code\s+|patch\s+|diff\s+)?preview)/i;
    if (previewWords.test(text)) return 'preview';
    if (/(리팩터|리팩토링|refactor)/i.test(text)) return 'refactor';
    const bugish = /(버그|bug|에러|오류|error)/i;
    const fixVerb = /(고쳐|고치|수정|fix)/i;
    if (bugish.test(text) && fixVerb.test(text)) return 'fix';
    const changeVerb = /(고쳐|고치|수정해|수정\s*해|바꿔|바꾸어|변경해|구현해|fix|change|modify|implement)/i;
    const codeish = /(코드|code|파일|file|부분|함수|function|버그|bug)/i;
    if (changeVerb.test(text) && codeish.test(text)) return 'change';
    return undefined;
  }

  /** First absolute POSIX path in the text, if any. */
  private static extractLocalPath(text: string): string | undefined {
    const match = text.match(/(\/[^\s]+)/);
    return match ? match[1] : undefined;
  }

  /**
   * Heuristic detection of a project structure/analysis request. Matches an
   * analysis verb and a project/structure noun in either order (KO + EN), so both
   * "이 프로젝트 구조 설명해줘" and "explain the structure of this repo" classify.
   */
  private static isProjectAnalysis(text: string): boolean {
    const noun = /(구조|아키텍처|레포|프로젝트|패키지|repo|project|package|structure|architecture)/i;
    const verb = /(분석|설명|알려|analyz|explain|describe|overview)/i;
    return /(분석|analyz)/i.test(text) || (noun.test(text) && verb.test(text));
  }
}
