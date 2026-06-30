# Sprint 2f Implementation Plan — CAP-006 Workspace Write Capability

- **Status:** ✅ APPROVED WITH CHANGES (Planning review) — plan updated with the CA's 5
  changes; cleared to implement. (Round-2 changes reflected below.)
- **Capability:** **CAP-006 — Workspace Write** (canonical roadmap: after Patch, before
  Command Execution).
- **Date:** 2026-06-30 · **Base:** `main` @ `849ff02` (CAP-001…005 merged).
- **Process:** V2 architecture-first, Step 1 (Implementation Plan). Plan → review →
  approval → implementation. Do not bypass the planning gate.

---

## 1. 구현 계획 요약

Workspace Write는 **승인된 `PatchSet`을 실제 워크스페이스 파일에 적용(apply)** 하는
capability다. 패치를 만들지 않고(Patch가 함), 승인하지 않고(Approval), 계획하지 않고
(Planning), git을 만지지 않고(Git), 명령을 실행하지 않는다(Command Execution). 오직
`PatchSet`을 **소비(read-only)** 하여 파일시스템을 변경하고, 그 결과를 자기 aggregate
**`WorkspaceChange`** 에 기록한다.

```
PatchSet (immutable, CAP-005)  →  WorkspaceChange (CAP-006, owned)  →  WorkspaceWriter (adapter, node:fs)
```

핵심 구성: `WorkspaceChange` aggregate (+ `WorkspaceChangeRef`, `WorkspaceChangeStatus`,
`FileChangeResult`), `WorkspaceWriteManager` (core), `WorkspaceWriter` port + adapter,
`WorkspaceChangeRepository` + `SqliteWorkspaceChangeRepository` + **migration v4**.

## 1b. Round-2 changes applied (CA Planning review — these override the sections below)

1. **Best-effort apply (NOT stop-on-first-failure).** WorkspaceWriter attempts **every**
   operation; each yields a `FileChangeResult` (`applied`/`failed`/`skipped`). Final
   `WorkspaceChange.status` is derived after all attempts. (Supersedes §9.)
2. **Idempotency is `WorkspaceChange.status`-based.** One `WorkspaceChange` per `PatchSet`:
   `APPLIED` → no-op (return existing); `FAILED`/`PARTIALLY_APPLIED`/`APPLYING` →
   re-attempt (best-effort, updates the same aggregate). (Supersedes §8.)
3. **`WorkspaceChangeStatus` = `PENDING | APPLYING | APPLIED | PARTIALLY_APPLIED | FAILED`**
   (Rollback-capability-stable). (Supersedes §15.)
4. **WorkspaceWriter Atomic Unit = File.** A PatchSet is **not** a transaction; each file
   is applied atomically (temp-write + rename / unlink). (Clarifies §6/§16.)
5. **`FileChangeResult` = `{ path, operation, status, message, durationMs }`.** (Supersedes §15.)

Non-blocking (kept as planned): no Rollback (future capability), no Resume (records only),
Repository-Independent (no git). `WorkspaceChange` is the **Execution History** starting point.

## 2. Scope (제안 — minimal safe)

- **`WorkspaceChange` aggregate (WS Write 소유)** — 한 `PatchSet` 적용의 결과/상태.
- **`WorkspaceWriteManager.apply(input)`** — 결정적 게이트 + 적용 오케스트레이션:
  1. **Approval 검사 (Ref만):** `approvalRef.status === APPROVED` **그리고**
     `approvalRef.executionPlanRef.id === patchSet.executionPlanRef.id` (CAP-005에서 확립한
     plan-scoped 참조 무결성). 불일치 시 거부. (`ApprovalManager` 미조회)
  2. **Idempotency:** `workspaceChanges.findByPatchSet(patchSet.id)`에 이미 `APPLIED`가 있으면
     재적용하지 않고 그대로 반환.
  3. `WorkspaceChange`(status `APPLYING`) 생성 → `PatchSet.operations`를 순서대로
     `WorkspaceWriter`로 적용 → 파일별 `FileChangeResult` 기록 → 최종 status 확정 → 영속.
- **`WorkspaceWriter` 포트 + 어댑터** — `node:fs`만 사용해 적용:
  `add`/`update`는 현재 파일에 **unified diff(jsdiff `applyPatch`)** 를 적용해 기록, `delete`는
  파일 삭제. 경로는 워크스페이스 루트로 **샌드박스**(CAP-001 `resolveWithin` 재사용). git 호출 없음.
- **영속:** `WorkspaceChangeRepository`(`findByPatchSet`) + `SqliteWorkspaceChangeRepository`
  + **migration v4** (`workspace_changes` 테이블).
- 테스트 + capability 문서 + ADR-0027.

## 3. Out of Scope (명시)

- ❌ **Patch 생성** (CAP-005), **Approval** (CAP-004), **Planning** (CAP-003), **Git/commit/
  repo 변경** (CAP-002), **Command 실행** (CAP-007), **AI Provider** (CAP-008/009).
- ❌ `PatchSet`/`ExecutionPlan`/`ApprovalRequest` **변경** — 전부 read-only 참조.
- ❌ **자동 Rollback** — 별도 미래 capability로 제안(§Rollback, Q6).
- ❌ **Failure 후 재개(resume)** 엔진 — v1은 상태 기록만(Q7).
- ❌ orchestrator/Discord 배선, 새 user-facing 흐름.

## 4. Architecture Impact

- **Capability 경계 유지:** Workspace ≠ Git, WS Write ≠ Patch/Approval/Planning/Command/AI.
  WS Write는 **filesystem 변경(write)** 의 유일 소유자. git·repo·commit은 절대 건드리지 않음.
- **Aggregate Ownership:** WS Write는 `WorkspaceChange`만 소유·변경. 다른 aggregate는 Ref로만
  참조(`PatchRef`, `executionPlanRef`, `approvalRef`, `WorkspaceRef`).
- **합성은 상위에서:** `WorkspaceWriteManager`는 `PatchSet`(immutable)과 `ApprovalRef`,
  `WorkspaceRef`를 **입력으로 받음**. `PatchManager`/`ApprovalManager`/`GitManager`를 import하지
  않음. (안전 전제 — "git tree clean" 같은 사전조건은 상위 합성층이 `GitManager`로 확인.)
- **Core 순수성:** core는 `WorkspaceWriter` 포트만 알고 `child_process`-free 유지. 모든 fs는 어댑터.
- **migration runner 재사용**(ADR-0020): 4번째 영속 aggregate.

## 5. Aggregate Ownership (CA Q1)

| 질문 | 답 |
|---|---|
| WS Write가 소유하는 aggregate | **`WorkspaceChange` 단 하나** (생성·상태전이 가능) |
| `PatchSet` 변경? | ❌ 절대. read-only 소비, immutable (CAP-005) |
| `ExecutionPlan` 변경? | ❌ 절대. `executionPlanRef`로 참조만 |
| `ApprovalRequest` 변경? | ❌ 절대. `approvalRef`로 참조만 |
| `WorkspaceChange`만 소유? | ✅ 그렇다 |

`WorkspaceChange`는 WS Write의 소유 aggregate이므로 **자기 상태는 변경 가능**(APPLYING→APPLIED 등).
이는 immutable인 `PatchSet`과 다르며 Aggregate Ownership Rule(ADR-0025)에 부합한다.

## 6. Apply Flow (CA Q2)

```
WorkspaceWriteManager.apply({ patchSet, approvalRef, workspaceRef })
  ├─ (1) approval 검사: APPROVED + executionPlanRef 일치 (Ref만)         [거부 시 throw]
  ├─ (2) idempotency: findByPatchSet → APPLIED면 기존 반환
  ├─ (3) WorkspaceChange 생성 (status=APPLYING, patchRef/executionPlanRef/approvalRef/workspaceRef)
  ├─ (4) for op of patchSet.operations:  WorkspaceWriter.apply(workspaceRef, op) → FileChangeResult
  ├─ (5) 결과 집계 → status 확정 (APPLIED / PARTIALLY_APPLIED / FAILED)
  └─ (6) WorkspaceChange 영속 → 반환
```
- `WorkspaceWriter`는 **Patch를 생성하지 않음** — `PatchOperation`(path/operation/diff)을 받아
  파일에 적용만. `add`/`update` = `applyPatch(current, op.diff)` 후 write, `delete` = 파일 삭제.
- `PatchSet` → `WorkspaceChange` → `WorkspaceWriter` 순서 그대로.

## 7. Approval Enforcement (CA Q3)

- **`ApprovalRef`만 검사**: `status === APPROVED` + `executionPlanRef.id === patchSet.executionPlanRef.id`.
- **`ApprovalManager` 미조회** (입력으로 받은 Ref 계약만으로 검증 — CAP-005와 동일 원칙).
- **`ApprovalRequest` aggregate 미변경.**

## 8. Idempotency (CA Q4)

- `WorkspaceChange`는 **`patchSet.id` 기준**으로 조회 가능(`findByPatchSet`).
- 동일 `PatchSet` 재적용 시: 이미 `APPLIED`면 **재기록/재쓰기 없이 기존 `WorkspaceChange` 반환**.
  (unified diff는 두 번 적용 시 깨끗이 적용되지 않으므로 — 이중 적용 자체를 막는 게 핵심.)
- 권장: `WorkspaceChange`는 PatchSet당 1개. (대안: 매 시도 새 레코드 — Q로 제시)

## 9. Partial Failure (CA Q5)

- 5개 중 3 성공 / 2 실패 → `WorkspaceChange.status = PARTIALLY_APPLIED`,
  `operations: FileChangeResult[]` 에 파일별 `{ path, operation, status: applied|failed|skipped, error? }` 기록.
- 적용은 **순차 + 실패 시 중단(stop-on-first-failure)** 권장(블라스트 최소화): 실패 이후 op는 `skipped`.
  (대안: best-effort 전체 시도 — Q로 제시)
- **자동 롤백은 하지 않음**(§Rollback). 부분 적용 상태는 `WorkspaceChange`가 정확히 표현.

## 10. Rollback (CA Q6)

- **권장: CAP-006은 Rollback을 수행하지 않는다.** Rollback은 **별도 미래 capability**(또는 Git
  capability 기반 복구)로 분리.
- 안전망: 적용 전 **clean git tree 사전조건**(상위 합성층이 `GitManager`로 확인)으로 git revert 가능
  상태를 보장 → 부분 적용도 git으로 되돌릴 수 있음. WS Write는 git을 직접 호출하지 않음.
- `WorkspaceChange`는 무엇이 적용/실패했는지 정밀 기록하여 미래 Rollback의 입력이 된다.

## 11. Failure Recovery (CA Q7)

- **권장: v1은 "실패 기록만"** — 프로세스 중단 시 `WorkspaceChange`는 `APPLYING`/`PARTIALLY_APPLIED`로
  남고, **자동 resume은 하지 않음**(unified diff 재적용 비멱등 위험). 재개 엔진은 미래 과제.
- (대안: 멱등 재적용 가능한 표현으로 확장 — Q로 제시.)

## 12. Repository Independence (CA Q8)

- **git 호출 0**, **repo 상태 변경 0**, **commit 0**. WS Write는 순수 파일시스템 write/delete만.
  (`WorkspaceWriter` 어댑터는 `node:fs`만 사용, `child_process`/git 미사용 — boundary 테스트로 검증.)

## 13. Patch Contract (CA Q9)

- `PatchSet`을 **읽기만** 함. **수정하지 않음.** `PatchSet`은 immutable(CAP-005). `PatchOperation`을
  불변 입력으로 소비하여 적용. WS Write는 "Workspace Write는 PatchSet을 그대로 적용"한다.

## 14. Architecture Impact — 이후 Capability와의 관계 (CA Q10)

- **CAP-007 Command Execution:** WS Write가 파일을 적용한 **뒤** 빌드/테스트 등 명령 실행(별도
  aggregate `CommandExecution`). WS Write는 명령을 실행하지 않음. 순서: WS Write → Command Execution.
- **CAP-008 Codex / CAP-009 Ollama (AI Provider):** 변경안(ProposedChange)을 **생성**하는 상류.
  전체 흐름: AI Provider → `ProposedChange` → Workspace.diff → Planning → Approval → Patch →
  **Workspace Write(적용)** → Command Execution(실행). WS Write는 provider 비의존.

## 15. New Domain Concepts

- **`WorkspaceChangeStatus`** (enum): `APPLYING | APPLIED | PARTIALLY_APPLIED | FAILED`
  (필요 최소; idempotency/부분실패 표현).
- **`FileChangeResult`** — `{ path; operation: PatchOperationKind; status: 'applied'|'failed'|'skipped'; error? }`.
- **`WorkspaceChange`** (aggregate) — `{ id; patchRef: PatchRef; executionPlanRef; approvalRef;
  workspaceRef: WorkspaceRef; status: WorkspaceChangeStatus; operations: FileChangeResult[];
  createdAt; updatedAt }`.
- **`WorkspaceChangeRef`** — `{ id; status }` (Ref 모델 일관).
- **`ApplyInput`** — `{ patchSet: PatchSet; approvalRef: ApprovalRef; workspaceRef: WorkspaceRef }`.
- 재사용: `PatchSet`/`PatchOperation`/`PatchRef`(CAP-005), `ApprovalRef`(CAP-004),
  `ExecutionPlanRef`(CAP-003), `WorkspaceRef`(CAP-001).

## 16. Ports / Adapters

- **`WorkspaceWriter`** (new port) — `apply(workspaceRef, op: PatchOperation): Promise<FileChangeResult>`
  (또는 배치). 토큰 `WORKSPACE_WRITER`. **어댑터**: `workspace-local`에 구현 권장(파일시스템 샌드박스
  `resolveWithin`·정책 재사용, jsdiff `applyPatch` 사용) — vs 새 패키지(Q로 제시).
- **`WorkspaceChangeRepository`** — `Repository<WorkspaceChange>` + `findByPatchSet(patchSetId)`;
  `SqliteWorkspaceChangeRepository` + migration v4 (`workspace_changes`: `id`, `patch_id`, `status`, `data`).
- 다른 포트 변경 없음.

## 17. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| 다중 파일 비원자적 적용(부분 상태) | High | stop-on-first-failure + `WorkspaceChange` 정밀 기록 + clean-tree 사전조건(상위 합성)으로 git 복구 가능; 자동 롤백은 미래 |
| unified diff 적용 충돌(`applyPatch` 실패) | Med | 해당 op `failed` 기록, 이후 `skipped`, status `PARTIALLY_APPLIED`; 충돌 자체가 자연스러운 실패 신호 |
| Path traversal / symlink escape | High | CAP-001 `resolveWithin` 샌드박스 재사용; 루트 밖 경로 거부 |
| 이중 적용(idempotency) | Med | `findByPatchSet` → APPLIED면 no-op 반환 |
| binary 파일 | Low | `metadata.binary`면 적용 skip/failed 명시(텍스트 diff 적용 불가) |
| 비멱등 재적용으로 인한 resume 위험 | Med | v1은 resume 미수행(기록만); 미래 과제 |

## 18. Validation

- `pnpm typecheck` + `pnpm test`:
  - **apply 성공**(add/update/delete) → `APPLIED`, 파일 내용 검증.
  - **approval 강제**: non-APPROVED 거부 / 다른 ExecutionPlan approvalRef 거부.
  - **idempotency**: 동일 PatchSet 두 번 → 두 번째는 재쓰기 없이 기존 반환.
  - **partial failure**: 일부 op 충돌 → `PARTIALLY_APPLIED` + 파일별 결과.
  - **PatchSet 무변경**(frozen-PatchSet 테스트) · **git 미호출** · **path 샌드박스**.
  - `SqliteWorkspaceChangeRepository` round-trip + `findByPatchSet`; **migration v4**.
  - boundary/dependency: WS Write는 다른 capability manager·git·child_process import 0.
- Live smoke / Discord 불요. 실제 fs 적용은 **temp 디렉터리**에서 테스트(실 워크스페이스 미변경).

## 19. Rollback (이번 구현 자체의 되돌리기)

- 순수 additive(새 domain/manager/port/adapter + `workspace_changes` 테이블 + migration v4).
  되돌리기 = `git revert` + 패키지/포트 제거. migration v4는 forward-only·멱등.
- 단, 이 capability가 만들어내는 **런타임 파일 변경**의 되돌리기는 §10(Rollback capability/ git) 참조.

## 20. Chief Architect Decision Questions

1. **Rollback (Q6):** CAP-006은 자동 롤백 **미수행**(별도 미래 capability) — 승인? 아니면 best-effort
   롤백을 포함?
2. **Partial failure 정책 (Q5):** **stop-on-first-failure**(권장) vs best-effort 전체 시도?
3. **Failure recovery (Q7):** v1은 **기록만**(resume 없음) — 승인?
4. **Idempotency 모델 (Q4):** PatchSet당 `WorkspaceChange` **1개**(재적용 no-op) vs 매 시도 새 레코드?
5. **WorkspaceWriter 어댑터 위치:** `workspace-local` **재사용**(권장) vs 새 패키지 `workspace-write-local`?
6. **Diff 적용 방식:** `PatchOperation.diff`(unified)를 **jsdiff `applyPatch`** 로 적용(권장) — 확정?
   (CAP-005가 newContent 미보관·diff만 보관하기로 했으므로 적용은 diff 기반.)
7. **`WorkspaceChangeStatus` 집합:** `APPLYING/APPLIED/PARTIALLY_APPLIED/FAILED` 최소셋 — 적정?
8. **clean-tree 사전조건:** 적용 전 git clean 확인을 **상위 합성층**(GitManager)이 담당 — 승인?
   (WS Write는 git 비호출 유지.)

---

## 21. ADR-0027 — outline only

> **Title:** ADR-0027 — CAP-006 Workspace Write Capability (apply, not generate)
> **Status:** (Proposed → Accepted on approval)

- **Context:** 승인·패치된 변경을 실제 파일에 적용하는 단계가 필요. "Patch generates,
  Workspace Write applies"의 후반부.
- **Decision:** `WorkspaceChange` aggregate(WS Write 소유, mutable) + `WorkspaceWriteManager`
  + `WorkspaceWriter` 포트/어댑터(node:fs, jsdiff applyPatch) + 영속/migration v4. Approval은
  plan-scoped `ApprovalRef`만 검사(ApprovalManager 미조회), `PatchSet` immutable read-only,
  git 미호출. Rollback/resume 미수행(미래). Aggregate Ownership/Referential Integrity 준수.
- **Consequences:** + 적용 단계 분리·결정적·감사가능; − 다중 파일 비원자성(완화책 명시),
  자동 롤백 부재(미래 capability).
- **Capability:** CAP-006. **Relates:** ADR-0026(Patch), ADR-0025(Approval/Ownership),
  ADR-0022(Workspace), ADR-0020(migrations).

## 22. docs/capabilities/workspace-write.md — outline only

> Purpose(PatchSet 적용) · Responsibilities(apply/WorkspaceChange/per-file 결과) ·
> Out of Scope(생성·승인·계획·git·command·AI·rollback·resume) · Public API
> (`WorkspaceWriteManager.apply`, `WorkspaceWriter` 포트, `WorkspaceChange`/`...Ref`/`...Status`,
> `FileChangeResult`) · Boundaries(WS Write ≠ Git/Patch/Approval/Planning/Command/AI; owns
> `WorkspaceChange`; Ref 통신; PatchSet immutable) · Future(Rollback capability, resume,
> 원자적 적용) · Related ADRs(0027, 0026, 0025, 0022, 0020).

---

## Next Step

V2 프로세스대로 **여기서 멈추고 Chief Architect Review를 기다립니다.** 승인/변경 시 그때
브랜치 생성 후 승인된 범위만 구현 → 검증 → 리뷰로 진행합니다. 코드/커밋/브랜치/프로토타입
없음 — 이 계획 문서 1개만 추가되었습니다.
