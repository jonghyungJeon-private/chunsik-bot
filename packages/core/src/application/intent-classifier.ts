import { Capability, IntentType } from '../domain';
import type { InboundMessage, Intent } from '../domain';
import type { CapabilityRouter } from './capability-router';

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
    if (/(typecheck|타입\s*체크|type\s*check)/i.test(text)) return 'typecheck';
    const mentionsTest = /(테스트|\btest\b)/i.test(text);
    const actionVerb = /(돌려|실행|run|해줘|해 줘)/i.test(text);
    if ((mentionsTest && actionVerb) || /\bpnpm\s+test\b/i.test(text)) return 'test';
    return undefined;
  }

  /**
   * Detect a code-change request → its kind, or undefined. Deterministic, conservative (KO + EN).
   * Kind is a classification tag only — never an implementation instruction (ADR-0035).
   */
  private static detectCodeChange(text: string): 'fix' | 'change' | 'refactor' | undefined {
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
