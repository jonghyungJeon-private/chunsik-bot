# Development Mode

## 목적

이 문서는 Chunsik의 개발 실행과 승인 방식을 정의하는 canonical source다.
일반 제품 개발의 절차 비용을 줄이면서 Architecture invariant, mutation safety,
검증 사실성, 외부·비가역 작업의 독립 승인 경계를 유지한다.

기본 모드는 `FAST DELIVERY MODE`이며, Product Owner의 standing milestone delegation 아래
`AUTONOMOUS_DEV_MODE = ENABLED`, `ACTIVE_MILESTONE = M2`이다.
`STRICT GOVERNANCE MODE`는 이 문서에 명시된 고위험 실행 경계에만 사용한다.

## 1. FAST DELIVERY MODE — Default

하나의 명시적인 Sprint 또는 Task 실행 승인은 승인된 범위 안에서 다음을 함께 허용한다. 이 승인은
Product Owner가 직접 부여하거나, 아래 standing delegation 안에서 Architect AI가 task를 생성하며 부여할 수 있다.

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

## 1A. Autonomous Development Standing Delegation

Product Owner는 `QUIRKYBOT_DEV_V1`에 필요한 LOW/MEDIUM-risk local development에 한해 Architect AI를
delegated Chief Architect로 지정한다. 역할은 다음과 같다.

- Human: Manager / Product Owner / UAT / Debugger / High-Risk Approver
- Kiro Architect: milestone gap을 선택하고 bounded task와 local implementation approval을 발행
- Codex Builder: 승인된 task 구현·검증·문서화·local commit
- Claude Reviewer: 독립 review, `PASS | FIX | ARCH | HUMAN` 판정

Architect-generated task가 active milestone에 필요하고, ratified architecture와 repository invariant 안에 있으며,
LOW/MEDIUM risk로 검증 가능하면 그 task 자체가 승인된 local implementation scope다. 기존 human-authored
Sprint/Task나 추가 one-off Product Owner 승인을 선행 조건으로 요구하지 않는다.

Standing delegation은 다음을 함께 허용한다.

- 계획, 구현, 범위 내 리팩터링
- unit/focused/regression test, lint/format, typecheck, build
- 필요한 canonical documentation sync와 local commit
- active milestone에 필요한 local/dev DB schema·migration 작업, migration apply, seed/fixture, bounded persistence,
  DB test, disposable/test DB reset/recreate, bounded local data migration
- 같은 범위의 Builder/Reviewer remediation 최대 2회
- 위 workflow를 수행하는 trusted development control-plane의 Kiro/Codex/Claude turn

이 delegation은 Chunsik 제품 안에 agent runtime을 추가하지 않으며 `ARCHITECTURE.md`의 제품 runtime 규칙을
변경하지 않는다. Development control-plane agent transport는 delegated workflow 수행에만 사용할 수 있다.
Chunsik application Runtime, application AI Provider, network/Discord 실행은 여전히 Strict Human gate다.
DB 작업은 아래 `AUTONOMOUS_DEV_DB` 조건을 만족하는 local/development target만 standing delegation에 포함된다.

Architecture-sensitive implementation은 architecture decision이 ratified되었고, 구현이 그 경계 안에 있으며,
active milestone에 필요하고 High/Critical 경계를 넘지 않을 때 Architect AI가 `IMPLEMENT`로 승인할 수 있다.
Ratification은 무제한 구현 지시가 아니며, Architect는 필요성·범위·검증 가능성을 매 task마다 확인한다.

Architect는 다음 이유만으로 `HUMAN_REQUIRED`를 반환하지 않는다.

- 구현이 아직 시작되지 않음
- human-authored Sprint entry가 없음
- ratified architecture 안의 Medium-risk 구현에 one-off approval이 없음
- task 완료에 test/build/documentation/local commit이 필요함

각 task는 “`QUIRKYBOT_DEV_V1` 달성에 필요한가?”에 답해야 한다. 아니면 backlog/defer한다. DEV_V1 acceptance
criteria를 만족하면 `MILESTONE_REACHED`를 반환하고 feature/hardening을 멈춘 뒤 Product Owner의 UAT/debugging으로
제어를 돌려준다.

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

### 3A. Autonomous Development DB

`AUTONOMOUS_DEV_DB = APPROVED`다. Active development milestone에 필요할 때 Architect/Codex는 다음을 별도
Human 승인 없이 수행할 수 있다.

- local/dev SQLite create/open과 WAL/journal 초기화
- schema design, migration implementation, local/dev migration apply와 schema/`user_version` 갱신
- development seed/fixture, 정상 application persistence, DB-related test
- disposable/test DB reset/recreate와 bounded local development data migration

현재 Quoky의 `data/chunsik.db`는 `QUOKY_RUNTIME_ENV=dev`이고 configured local development DB path가 정확히
해당 target이며 Production/shared DB가 선택되지 않았음이 입증될 때 development/UAT DB로 승인된다. 조건이
불명확하거나 불일치하면 fail-closed한다. Schema contract, persistence ownership, migration strategy, aggregate
boundary 변경은 계속 ratified architecture와 독립 Architecture Review가 필요하지만, ratification 이후 local/dev
구현과 migration 실행에는 추가 Human 승인이 필요하지 않다.

Production/shared/live DB mutation, Production migration apply, non-disposable data의 drop/truncate/bulk destructive
mutation, irreversible data loss, shared/live backup·restore, DB credential/secret mutation은 이 delegation 밖이며
별도 Human 승인이 필요하다.

다음 작업은 FAST DELIVERY 승인에 포함되지 않으며 각각 명시적인 별도 승인이 필요하다.

- Push
- PR 생성 또는 변경
- Merge
- Runtime Start, Stop, Restart
- Discord Connection 또는 Action
- Chunsik application AI Provider의 실제 외부 실행
- task-under-test 또는 Chunsik application의 Network 실행
- delegated development DB 밖의 Runtime Data Mutation
- Workspace Apply
- Production/shared/live DB mutation 또는 migration apply
- Live UAT
- Production 또는 Release Gate
- delegated disposable/test DB reset·recreate 밖의 destructive filesystem/database operation
- secret 접근 또는 노출 위험이 있는 작업

Strict 작업은 필요할 때만 짧은 execution plan과 pre/post validation을 사용한다.
Packet과 evidence 파일은 위험을 통제하는 데 구체적으로 필요할 때만 만든다.
한 Strict 작업의 승인은 다른 Strict 작업으로 자동 승계되지 않는다.

`HUMAN_APPROVAL_REQUIRED`와 `HUMAN_MUST_PERSONALLY_EXECUTE`는 서로 다른 조건이다. 모든 Strict 작업에는
Product Owner의 명시적인 exact-scope 승인이 선행되어야 하며, 그 승인은 다른 capability, revision, milestone로
전이되지 않는다. 승인이 존재하면 trusted Quoky control-plane/UAT operator가 승인된 정확한 작업을 실행할 수
있다. 승인 없이 또는 승인 범위 밖에서 실행하는 것은 금지한다. 이 위임은 어떤 gate도 약화하지 않는다.

역할 경계는 다음과 같다.

- Kiro Architect: architecture, milestone gap 분석, bounded task와 local implementation approval 발행. Strict
  작업은 직접 실행하지 않는다.
- Trusted Quoky UAT operator: capability/revision/milestone에 대한 exact Product Owner 승인이 존재할 때만 해당
  Strict 작업을 실행한다.

따라서 Architect는 이미 정확히 승인된 Runtime/Provider/Network/Discord/Live-UAT 작업을 나중에 Quoky가
실행한다는 이유만으로 `HUMAN_REQUIRED`를 반환하지 않는다. Delegated local/dev 조건 밖의 DB/SQLite mutation처럼
별도 capability가 필요하거나, architecture blocker가 남아 있거나, exact authorization이 없거나 무효이면 계속
fail-closed한다.

다음 판단도 standing delegation 밖이며 `HUMAN_REQUIRED`다.

- product requirement가 모호하거나 둘 이상의 유효한 제품 방향 중 owner 선택이 필요함
- architecture invariant 변경 또는 ratify되지 않은 architecture decision이 필요함
- active milestone scope를 실질적으로 확대해야 함
- data-loss/security risk가 있거나 성공을 검증할 수 없음
- unrelated cleanup 또는 destructive operation이 필요함

일반 Builder code-edit workflow 안의 repository 파일 수정은 delegated local implementation이다. 반면 제품의
`PatchManager`/`WorkspaceWriteManager` Apply, 승인 scope 밖 filesystem mutation, Runtime data mutation은 Strict gate다.

## 4. 승인 묶음

일상 개발의 Plan, Implementation, Build, Test, Commit은 하나의 Sprint Execution
승인으로 묶는다. 승인 범위 밖 기능, Architecture 결정, 외부 시스템 작업은 포함되지 않는다.

사용자가 진단·설명·review만 요청하면 read-only로 수행하며 변경 승인을 추론하지 않는다.
사용자가 Sprint/Task 실행을 명시적으로 승인하거나 Architect AI가 standing delegation 안에서 task와 approval을
발행하면 승인된 scope의 검증과 local commit까지 수행할 수 있다.
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
