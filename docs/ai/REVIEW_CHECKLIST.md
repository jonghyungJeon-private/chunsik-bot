# AI Review Checklist

Implementation, Commit, Push, PR, Merge, Runtime 또는 Gate review 때만 읽는다.
Review는 read-only가 기본이며 승인되지 않은 다음 단계로 넘어가지 않는다.

## Implementation Review

- 승인된 task와 scope가 명확한가?
- changed files가 승인 목록과 정확히 일치하는가?
- unrelated tracked/untracked 변경을 건드리지 않았는가?
- `apps -> adapters -> core` 의존 방향을 지켰는가?
- Core에 concrete provider/platform/storage/driver type이 유입되지 않았는가?
- Aggregate와 mutation owner가 기존 ownership을 침범하지 않는가?
- Provider 선택과 prompt shaping 책임이 올바른 layer에 있는가?
- 필요한 tests와 `pnpm typecheck`를 실제로 실행했는가?
- 실행 명령, exit code, 결과가 보고와 일치하는가?
- `git diff --check`가 통과하는가?
- Architecture 변경이면 승인된 ADR이 있는가?
- Reviewer와 implementer가 분리됐는가?

## Commit Review

- Commit에 대한 별도 명시 승인이 있는가?
- current branch, HEAD, expected parent SHA를 직접 확인했는가?
- staged files가 승인된 changed files만 포함하는가?
- user-owned untracked files가 제외됐는가?
- staged diff와 working-tree diff를 각각 확인했는가?
- commit subject가 Conventional Commits 형식인가?
- 필요한 trailer가 정확한가?
- `main`과 보호 branch/commit이 움직이지 않았는가?
- Commit 이후 Push/PR/Merge가 여전히 미승인임을 확인했는가?

## Push / PR Review

- Push와 PR 각각 별도 승인이 있는가?
- exact base/head branch와 remote를 확인했는가?
- push할 commit full SHA가 review된 SHA와 같은가?
- remote SHA를 push 전후 직접 확인했는가?
- PR changed files와 diff가 승인 scope와 일치하는가?
- test/typecheck evidence가 현재 commit에 대응하는가?
- mergeability와 review comments를 확인했는가?
- Merge 승인 없이 merge하지 않았는가?

## Runtime / Live Review

- 실제 served revision full SHA를 확인했는가?
- active workspace와 repository root가 명확한가?
- disposable workspace인지 product repository인지 구분했는가?
- ApprovalRequest가 exact ExecutionPlan/operation에 binding됐는가?
- Preview approval과 Apply approval이 분리됐는가?
- explicit apply request 없이 `WorkspaceWrite`가 실행되지 않았는가?
- `WorkspaceChange`와 `CommandExecution` 사실을 직접 확인했는가?
- filesystem diff와 Git mutation을 각각 확인했는가?
- Runtime Restart와 Live UAT 승인이 각각 있는가?
- Cleanup은 별도 승인을 받았는가?

## Final Quality Check

- 산출물 유형과 mutation owner가 맞는가?
- 승인 경계를 넘지 않았는가?
- 독립 검증이 수행됐는가?
- SHA, test, diff, clean state를 추측하지 않았는가?
- 변경 여부에 맞는 mutation safety 문구를 사용했는가?
- 다음 단계가 정확히 하나인가?
- 이전 승인이 다음 단계로 자동 승계되지 않았는가?
