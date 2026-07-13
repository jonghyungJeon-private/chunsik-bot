# AGENTS.md - AI Coding Agent Operating Manual

이 문서는 Claude Code와 Codex를 포함한 모든 Implementation Agent의 canonical 공통 규칙이다.
Repository 문서가 source of truth이며 prompt나 이전 Agent의 self-report는 사실로 간주하지 않는다.

## Project Invariants

- Chunsik은 local-first, provider-independent AI platform이다. Discord와 model은 교체 가능한 구현이다.
- 의존 방향은 `apps -> adapters -> core`뿐이다. Core는 workspace package에 의존하지 않는다.
- Core는 concrete provider, NestJS, Discord, SQLite, CLI, adapter를 import하지 않는다.
- Adapter는 `@chunsik/core`와 자기 구현 library만 사용하며 다른 adapter에 의존하지 않는다.
- `apps/chunsik`만 concrete class와 port token을 연결하는 composition root다.
- 새 provider는 기존 port를 구현하는 별도 adapter package로 추가하고 composition root에서 wiring한다.
- 새 port의 interface와 DI token은 `packages/core/src/ports`에 둔다.
- Platform/storage/driver type은 port signature나 Core type을 통과할 수 없다.
- Architecture 변경은 승인된 ADR이 먼저 필요하다. `ARCHITECTURE.md`와 충돌하면 중단한다.

## Provider, Prompt, Context

- Core는 `AiProvider`에만 의존하며 provider `id`로 분기하거나 특정 CLI를 가정하지 않는다.
- Provider 선택은 `capabilities`, `priority`, `isAvailable()` 데이터로 결정한다.
- 선택된 provider는 `TaskRun.providerId`의 audit 정보이며 사용자에게 기본 노출하지 않는다.
- Provider별 prompt shaping과 CLI rendering은 adapter가 담당한다. v1에 AI HTTP API를 추가하지 않는다.
- Chunsik Memory가 source of truth이며 stateless CLI에는 generated context file로만 전달한다.
- `MemoryManager`는 CRUD/scope, `ContextBuilder`는 retrieve/rank/compress/budget,
  `PromptComposer`는 prompt layering, workspace는 context-file materialization을 소유한다.
- `Session`에 context/memory snapshot을 저장하지 않는다. Prompt template은 `prompts/` runtime asset이다.

## Conditional Loading

`docs/ai/*`와 상세 문서를 기본적으로 모두 읽지 않는다.

| Task type | Additional documents |
|---|---|
| Simple code implementation | relevant code only |
| Architecture/domain change | `ARCHITECTURE.md` + `DECISIONS.md` |
| Current sprint decision | `CURRENT_STATE.md` + relevant `ROADMAP.md` section |
| New session/model switch | `docs/ai/SESSION_STATE.md` + `docs/ai/HANDOFF.md` |
| Implementation/commit/PR review | `docs/ai/REVIEW_CHECKLIST.md` |
| Prompt examples | `docs/ai/PROMPTS.md` (human-requested only) |

Architecture 또는 settled decision과 충돌할 가능성이 있으면 반드시 root 문서를 읽는다.

## Approval Boundary

다음은 각각 별도 승인이다: Plan, Implementation, Test, Commit, Push, PR, Merge,
Runtime Restart, Discord Action, Workspace Apply, Sandbox Mutation, Live UAT, Gate, Cleanup.
이전 승인은 다음 단계로 자동 승계되지 않는다. 승인된 범위를 마치면 즉시 중단한다.
`Implementation` 승인은 mutation만 허용하며 `Test` 또는 `pnpm typecheck` 실행 승인을 포함하지 않는다.

명시 승인 없이 다음을 수행하지 않는다.

- commit, push, PR, merge, auto-delete, force-push
- destructive command, deploy, connector/external write
- runtime restart, WorkspaceWrite, sandbox/live mutation, Live UAT, Gate, cleanup

Command 실행 전 `RiskPolicy.assessCommand`를 적용한다. Approval gate는 planning이 아니라
external/destructive action을 감싼다.

## Before Mutation

직접 확인한다.

- current branch와 HEAD
- relevant base/origin state
- `git status --short`
- approved scope와 보호 대상

예상 SHA 불일치 또는 승인되지 않은 dirty-tree 충돌이면 mutation 없이 중단한다.
요청과 직접 관련된 파일만 읽고 수정하며 범위 확대가 필요하면 `NEEDS_SCOPE_EXPANSION`을 보고한다.

## Engineering Rules

- TypeScript `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`를 약화하지 않는다.
- 별도 `Test` 승인 범위에서 코드 변경 완료 전 `pnpm typecheck`와 Risk에 맞는 test를 실행한다.
  `Test`가 승인되지 않았으면 실행하지 않고 완료 보고에 명시한다.
- Deterministic plumbing은 test하고, 미구현 model cognition은 `NotImplementedError`로 유지한다.
- 시간과 ID는 shared `clock`/`id` utility를 사용한다.
- `Resource` input과 `Artifact` output을 합치지 않는다.
- Provider를 `Session`/`Task`/`Actor`에 pin하지 않는다.
- God-interface와 deferred Workflow/agent runtime/dynamic plugin loader를 조기 구현하지 않는다.
- 기존 style을 따르고 commit은 Conventional Commits 형식을 사용한다.

## Verification And Reporting

SHA, changed files, diff, tests, typecheck, clean/mutation state를 추측하지 않고 직접 확인한다.
테스트는 실제 명령과 결과만 보고한다. 코드와 문서의 사실 불일치는 보고하되 Architecture 규칙은 root 문서를 따른다.

완료 보고에는 다음을 짧게 포함한다.

```text
CURRENT MAIN
COMPLETED
PROJECT PROGRESS
SAFETY
APPROVAL BOUNDARY
NEXT STEP
```

Mutation이 없음을 branch/HEAD/status/diff 등으로 직접 확인한 경우에만 공식 문구를 그대로 사용한다:
"변경이 적용되지 않았음이 확인되었습니다."
직접 확인할 수 없으면 공식 문구를 그대로 사용한다: "변경 적용 여부를 확인할 수 없습니다."
변경을 수행한 경우에는 두 문구를 사용하지 않고 실제 변경을 보고한다.

## Architecture And Collaboration

- Boundary가 불명확하면 Core를 작게, adapter를 단순하게 유지하고 그래도 불명확하면 질문한다.
- `[RESERVE]` seam은 최소 interface/field만 만들고 `DECISIONS.md`에 기록한다.
- Product Owner가 architecture/product 최종 결정을 하고 Chief Architect가 architecture와 ADR을 관리한다.
- Architecture 변경은 `docs/templates/ADR_TEMPLATE.md`를 사용해 제안하며 Product Owner가 ratify한다.
- Reviewer와 implementer는 동일할 수 없다. 독립 Architecture/Implementation Review를 유지한다.
- Sprint Definition of Done은 `CURRENT_STATE.md`와 `CHANGELOG.md`를 갱신한다.
