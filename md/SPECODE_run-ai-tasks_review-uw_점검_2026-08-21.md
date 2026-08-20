# /run-ai-tasks · /review-uw 야간 점검 결과 (2026-08-21)

> 어제(2026-08-20) 커밋 중 `/run-ai-tasks`, `/review-uw`와 그 주변 인프라를 대상으로
> 전수 점검. 아래 커밋들을 확인함:
> - `7c4fb29` refactor: /review-uw 수정 & 공통보게도 수정
> - `58c4f18` feat: add guide selector logic and integrate into implementation request submission route
> - `bf1ae2c`, `4eaf7cd` 중 MCP/워커 경로에 겹치는 부분(`src/lib/mcp/api-client.ts`)

결론: **기능적으로 잘못된 부분은 없음.** 아래 항목들은 서로 잘 맞물려 있는 것까지 확인함.

- `review-uw.md` 오케스트레이터가 부르는 3개 서브에이전트(`prd-compliance-reviewer`,
  `code-quality-reviewer`, `ui-design-reviewer`)와 공용 규칙 파일(`report-format.md`,
  `severity-rules.md`)의 verdict/score 계산식이 서로 일치함.
- `review-uw.md`의 표준 가이드 카테고리 분류(UI / COMMON·SECURITY·ERROR 필수 /
  DATA·AUTH·API·FILE·BATCH·REPORT 선택)가 실제 서버의 `GuideCategory` enum 10종과
  정확히 일치함.
- 새로 추가된 MCP 도구 `search_standard_guides`/`get_standard_guide`가 호출하는
  `/api/projects/[id]/standard-guides` 라우트의 쿼리 파라미터(`category`, `search`,
  `use`)와 정확히 맞물림.
- `get_design_tree` 호출부(`review-uw.md`)가 서버 스키마의 `unitWorkIds` 1~20개
  제약과 충돌 없음(단건 배열로 호출).
- `guideSelector.ts`(구현요청 제출 시 COMMON/SECURITY/ERROR 가이드 자동 삽입)는
  `impl-request/submit/route.ts`에 null-safe하게 잘 붙어 있고, 이 라우트는 항상
  `task_ty_code: "IMPLEMENT"`만 생성하므로 다른 태스크 타입에 가이드가 잘못 섞여
  들어갈 여지도 없음.
- `workerCommandFiles.ts`에 나열된 11개 배포 파일 전부 실제로 존재하고 내용도 최신.
- `api-client.ts`의 JWT self-issue fallback 제거(`bf1ae2c`)는 워커/리뷰 경로에
  영향 없는 순수 보안 강화.

## 발견한 것 — 죽은 코드 (사소, 조치 필요)

`.claude/commands/` 안에 지금 안 쓰는 옛날 구현이 두 개 남아 있음:

- `.claude/commands/run_ai_tasks.py` (10.4KB) — `/run-ai-tasks`의 Python 버전.
  지금은 `run-ai-tasks.md` + `task_complete.mjs` 조합으로 완전히 대체됨.
- `.claude/commands/task_complete.py` (4KB) — 위와 같은 이유로 대체된 옛 결과
  전송 스크립트.

둘 다 `workerCommandFiles.ts`의 배포 목록에도 없고, 코드베이스 어디서도 참조되지
않음(grep 결과 0건). 어제 `87b6f36` 커밋에서 "미사용 md 파일 삭제"를 이미 했는데,
같은 성격의 미사용 `.py` 파일 두 개가 이번엔 빠진 것으로 보임. 동작에 영향은
없지만 — 나중에 누가 "Python 버전이 진짜인가 md 버전이 진짜인가" 헷갈릴 수 있어서
정리 대상으로 남겨둠. (직접 지우지는 않았음 — 삭제는 사용자 확인 후 진행 권장.)
