# Short AI Prompts

사용자가 복사하는 짧은 명령 모음이다. AI는 요청 없이 이 문서를 자동으로 읽지 않는다.

## Normal Implementation

```text
AGENTS.md를 따르라.

Task:
...

Approved:
- implementation
- related tests
- typecheck

Prohibited:
- commit
- push
- PR
- merge

완료 후 검증 증거를 제출하고 중단하라.
```

## Agent Session Switch

```text
새 AI Agent 세션이 이전 작업을 이어서 수행한다.

현재 Agent의 기본 진입 문서를 따르고 다음을 읽어라:
- AGENTS.md
- docs/ai/SESSION_STATE.md
- docs/ai/HANDOFF.md

repository 상태를 직접 검증하라.
검증된 현재 상태를 기준으로 EXACT NEXT STEP 하나만 수행하라.
Agent 또는 모델 교체를 승인 범위 확대로 해석하지 마라.
```

## Read-Only Review

```text
AGENTS.md와 docs/ai/REVIEW_CHECKLIST.md를 따르라.
구현하지 말고 Read-Only Review만 수행하라.
수정, Commit, Push, PR, Merge는 금지한다.
```

## Commit Only

```text
승인된 diff의 Commit만 승인한다.
branch, HEAD, staged files를 직접 확인하라.
Push, PR, Merge는 금지한다.
완료 후 중단하라.
```

## Push And PR

```text
승인된 commit의 Push와 PR 생성만 승인한다.
exact base/head와 remote SHA를 직접 확인하라.
Merge는 금지한다.
완료 후 중단하라.
```

## Architecture Task

```text
AGENTS.md의 router에 따라 ARCHITECTURE.md와 DECISIONS.md를 읽어라.
현재 코드를 직접 확인하고 승인된 Architecture 범위만 수행하라.
불일치하면 mutation 없이 중단하라.
```

## Session Resume

```text
AGENTS.md, docs/ai/SESSION_STATE.md, docs/ai/HANDOFF.md를 읽어라.
branch, HEAD, git status, diff, 승인 경계를 직접 검증하라.
불일치하면 mutation 없이 중단하라.
EXACT NEXT STEP 하나만 수행하고 중단하라.
```
