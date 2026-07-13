# AI Handoff

Claude Code와 Codex 사이의 모델 전환 때만 사용한다. 이전 모델의 보고는 참고 자료이며,
다음 모델은 repository 상태와 승인 경계를 직접 확인한다.

## Rules

- SHA는 full SHA로 기록한다.
- 실행하지 않은 test 결과를 추측하지 않는다.
- 변경 적용 여부가 불명확하면 그대로 명시한다.
- 모델 전환은 승인 범위를 확대하지 않는다.
- `EXACT NEXT STEP`은 하나의 action만 기록한다.
- 승인된 작업을 마치면 `STOP CONDITION`에 따라 중단한다.

## Compact Template

```text
# AI HANDOFF

FROM:
TO:
TIMESTAMP:

CURRENT BRANCH:
CURRENT HEAD:
BASE SHA:
ORIGIN MAIN:

CURRENT TASK:
COMPLETED:
CHANGED FILES:
TESTS:
WORKING TREE:

APPROVALS GRANTED:
APPROVALS NOT GRANTED:

MUTATIONS PERFORMED:
MUTATIONS NOT PERFORMED:

OPEN RISKS:
EXACT NEXT STEP:
STOP CONDITION:

NEXT MODEL MUST VERIFY:
- branch
- HEAD
- git status
- diff
- approval boundary
```

긴 대화, 전체 Architecture, Sprint 연혁을 복사하지 않는다.
