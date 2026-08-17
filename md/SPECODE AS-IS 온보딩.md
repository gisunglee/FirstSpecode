# SPECODE AS-IS 온보딩 구현 로그

> 시작일: 2026-08-17
> 목표: 2차 사업(기존 시스템 위 증축) 프로젝트가 1차 시스템 정보 없이 SPECODE를 쓰는
> 문제 해결 — 고객 로컬에서 실행하는 온보딩 절차용 최소 인프라 구축

## 결정된 범위

- 화면 UI 신규 개발 없음 — MCP 도구 + 커맨드 프롬프트로만 구현
- bulk-import 계열 미사용(전체 트랜잭션 롤백 리스크) — 개별 create_* 호출로 하나씩 등록
- `tb_ds_review_request`(동료 피어리뷰) 재사용 안 함 — 만족도 평가 필드 등 목적 불일치로
  `tb_ds_asis_question` 별도 신설

## 구현 및 검증

- Part A — `create_db_table`/`update_db_table` MCP 도구: 기존
  `/api/projects/[id]/db-tables` API 래핑만, 신규 비즈니스 로직 없음
- Part B — `tb_ds_asis_question` 신규 테이블(`purpose_code`/`batch_id`로 용도 태깅,
  조건 없는 전체 조회는 API 레벨에서 차단) + API route 2개 + MCP 도구 3개
  (`create_asis_question`/`list_asis_questions`/`answer_asis_question`)
- Part C — `.claude/commands/onboard-asis.md` 커맨드 작성, `get_worker_command_files`로
  배포 등록

검증 결과:

- `npx tsc --noEmit`: 통과
- `npm run test:asis-question:db`: 생성 → 필터 조회(`purpose_code`+`batch_id`) → 답변
  등록 → `OPEN→ANSWERED` 상태 전환 → rollback(잔존 데이터 0) → 존재하지 않는 프로젝트
  FK 거부까지 실제 DB에서 통과
- Part A는 밑바탕 API가 기존 코드라 별도 기능 검증 대상 아님. MCP 레벨 end-to-end
  호출은 로컬 dev 서버 꺼짐 + 배포 전이라 미실행

## 발견한 별개 이슈 (이번 작업과 무관 — 미해결로 남김)

`prisma db push` 시도 중 `tb_ds_col_mapping_group`/`tb_sp_sync_item`/`tb_sp_sync_run`
에서 제약조건 이름·컬럼 타입 불일치와 FK 5개 누락을 발견함. 이번 작업과 무관해 손대지
않았고, raw SQL(`prisma/sql/2026-08-17_create_asis_question.sql`)로 신규 테이블만
분리 적용함.

**참고**: `SPECODE 구현-설계 동기화.md` 라운드 7에서 같은 종류 드리프트를 "diff 0"까지
복구했다고 기록돼 있는데, 지금 다시 같은 세 테이블에서 드리프트가 발견됨 — 라운드 7
이후 스키마가 다시 어긋난 것으로 보임. 별도 확인 필요.

## 다음 단계

- 배포 후 실제 MCP 호출로 Part A/B end-to-end 재검증
- 위 드리프트 재발 원인 확인
