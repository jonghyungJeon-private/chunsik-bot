# Development Mode

## 목적

이 문서는 Chunsik의 개발 실행과 승인 방식을 정의하는 canonical source다.
일반 제품 개발의 절차 비용을 줄이면서 Architecture invariant, mutation safety,
검증 사실성, 외부·비가역 작업의 독립 승인 경계를 유지한다.

기본 모드는 `FAST DELIVERY MODE`다. `STRICT GOVERNANCE MODE`는 이 문서에 명시된
고위험 실행 경계에만 사용한다.

## 1. FAST DELIVERY MODE — Default

하나의 명시적인 Sprint 또는 Task 실행 승인은 승인된 범위 안에서 다음을 함께 허용한다.

- 계획 구체화
- 구현과 작업 범위 내 리팩터링
- 테스트 작성 및 수정
- focused test
- typecheck
- build
- 범위 내 실패의 원인 분석, 수정, 재검증
- 필요한 제품·개발 문서 갱신
- local commit

실행자는 concrete blocker가 없으면 승인된 범위를 검증과 local commit까지 끝낸다.
승인 문구는 scope와 제외 경계를 명확히 해야 한다.

예:

> Sprint 3A 구현·테스트·빌드·커밋 승인. Push/PR/Merge/Runtime은 미승인.

일반 개발에서는 다음을 기본 산출물로 만들지 않는다.

- execution packet
- canonical/raw packet SHA
- evidence 전용 Markdown
- Plan/Implementation/Build/Test/Commit 단계별 재승인
- 단순 retry를 위한 별도 승인
- 동일 branch/HEAD/status의 반복 증빙

검증 결과는 chat의 종료 보고에 기록한다. 지속 보존이 제품 요구사항인 문서만 저장소에 작성한다.

## 2. Architecture Review Required

다음 변경은 구현과 검증 후, merge 전에 독립 Chief Architect Review가 필요하다.

- Capability 또는 Aggregate 경계 변경
- dependency direction 변경
- 새로운 public API 계약
- database schema 또는 migration
- approval/security model 변경
- 영속성 소유권 변경
- ADR이 필요한 장기 결정

Architecture Review는 일반 구현·테스트를 시작하기 위한 packet gate가 아니다.
Architecture 변경은 기존 `ARCHITECTURE.md`, `DECISIONS.md`, ADR 규칙을 계속 따른다.
Reviewer와 implementer는 동일할 수 없다.

## 3. STRICT GOVERNANCE MODE

다음 작업은 FAST DELIVERY 승인에 포함되지 않으며 각각 명시적인 별도 승인이 필요하다.

- Push
- PR 생성 또는 변경
- Merge
- Runtime Start, Stop, Restart
- Discord Connection 또는 Action
- AI Provider의 실제 외부 실행
- Runtime Data Mutation
- Workspace Apply
- Live UAT
- Production 또는 Release Gate
- destructive filesystem/database operation
- secret 접근 또는 노출 위험이 있는 작업

Strict 작업은 필요할 때만 짧은 execution plan과 pre/post validation을 사용한다.
Packet과 evidence 파일은 위험을 통제하는 데 구체적으로 필요할 때만 만든다.
한 Strict 작업의 승인은 다른 Strict 작업으로 자동 승계되지 않는다.

## 4. 승인 묶음

일상 개발의 Plan, Implementation, Build, Test, Commit은 하나의 Sprint Execution
승인으로 묶는다. 승인 범위 밖 기능, Architecture 결정, 외부 시스템 작업은 포함되지 않는다.

사용자가 진단·설명·review만 요청하면 read-only로 수행하며 변경 승인을 추론하지 않는다.
사용자가 Sprint/Task 실행을 명시적으로 승인하면 승인된 scope의 검증과 local commit까지 수행할 수 있다.
Push/PR/Merge/Runtime 등 Strict 작업은 항상 별도 승인을 받는다.

## 5. Retry Policy

승인된 범위 안에서 test, typecheck, build 또는 deterministic validation이 실패하면:

1. 원인을 분석한다.
2. 같은 범위의 문제면 수정한다.
3. 필요한 검증을 다시 실행한다.
4. 최대 2회의 수정 루프를 수행한다.
5. 해결되지 않거나 scope 확대가 필요하면 blocker를 보고한다.

각 수정 루프마다 packet, evidence 문서, 별도 승인을 만들지 않는다.
외부 실행이나 destructive action이 새로 필요해지면 retry가 아니라 Strict 승인 경계로 멈춘다.

## 6. Concrete Blocker

다음 중 하나가 실제로 확인된 경우에만 concrete blocker로 중단한다.

- 승인 범위를 넘어서는 변경이 필요하다.
- Architecture/ADR 또는 settled decision과 충돌한다.
- 보호해야 할 dirty work와 안전하게 분리할 수 없다.
- 필요한 dependency, credential, executable 또는 외부 시스템이 사용할 수 없다.
- 두 번의 범위 내 수정 루프 후에도 검증이 실패한다.
- 보안, secret, destructive mutation 또는 데이터 손실 위험이 발견된다.
- 확인되지 않은 제품 결정을 임의로 선택해야 한다.

작업이 어렵거나 시간이 걸린다는 이유, 이미 승인된 검증 단계, 같은 범위의 첫 실패,
packet이 없다는 이유는 blocker가 아니다.

## 7. Verification 수준

검증은 변경 위험과 범위에 비례한다.

- 코드 변경: focused test, typecheck, 관련 build를 기본으로 한다.
- deterministic plumbing: 관련 성공·실패 경로를 테스트한다.
- 문서-only 변경: Markdown 구조, 링크/참조, 충돌 검색, `git diff --check`를 수행하며
  제품 Build/Test는 생략할 수 있다.
- Architecture 변경: invariant와 ADR/decision 정합성을 추가 검토한다.
- Strict 실행: 실행 직전 target/state 확인과 실행 후 결과/state 확인을 수행한다.

실행하지 않은 test, 확인하지 않은 SHA·Runtime·clean state를 추측하지 않는다.
실패를 숨기거나 passing evidence로 대체하지 않는다.

## 8. 보고 형식

일반 Sprint 종료 보고는 다음만 간결하게 포함한다.

```text
CURRENT MAIN
COMPLETED
VALIDATION
CHANGED FILES
SAFETY
APPROVAL BOUNDARY
NEXT STEP
```

명령과 결과는 실제 실행한 것만 기록한다. Evidence 전용 파일을 만들지 않는다.

## 9. Stage 2A 기존 evidence 보존

Stage 2A Provider Continuity re-validation은 보류한다.

- Layer 1 retry1 packet은 실행하지 않는다.
- Layer 1 retry1 execution 승인은 취소됐다.
- Layer 2 packet과 execution은 승인되지 않았다.
- Provider semantic validation은 `FAIL` 상태를 유지한다.
- 기존 packet과 evidence는 audit history로 수정·삭제·overwrite·cleanup하지 않는다.
- 이 보류 상태는 일반 제품 개발을 차단하지 않는다.

Stage 2A를 재개하려면 당시 상태와 별도의 Strict Provider 실행 승인을 다시 확인한다.

## 10. 충돌과 우선순위

개발 실행 방식과 승인 묶음에 관해 기존 문서와 충돌하면 이 문서가 우선한다.
`AGENTS.md`, agent별 지침, review checklist는 이 문서를 요약·참조해야 하며 같은 규칙을
복제하지 않는다. 오래된 packet 중심 절차와 모든 Build/Test/Commit의 독립 승인 요구는
deprecated다.

이 우선순위는 `ARCHITECTURE.md`, 승인된 ADR, Project Invariant, mutation safety,
secret 보호, 확인되지 않은 상태를 추측하지 않는 규칙을 변경하지 않는다.
