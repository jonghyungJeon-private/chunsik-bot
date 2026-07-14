# CLAUDE.md

`AGENTS.md`가 모든 AI coding agent의 canonical operating manual이다.
Claude Code는 먼저 `AGENTS.md`를 따르고 conditional loading router에 따라 필요한 문서만 읽는다.
매 세션에 root 문서나 `docs/ai/*` 전체를 일괄 로드하지 않는다.
요청이 `ARCHITECTURE.md` 또는 settled ADR과 충돌하면 mutation 없이 중단하고 보고한다.
