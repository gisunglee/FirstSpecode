-- ============================================================================
-- 2026-07-16  tb_pj_project 에 단계별 일정(분석/설계/구현/테스트) 컬럼 추가
--
-- 배경:
--   프로젝트 설정 화면에 전체 기간(bgng_de/end_de) 외에 분석·설계·구현·테스트
--   4단계별 시작일/종료일을 관리하고 싶다는 요청.
--   단계 수가 고정(4개)이고 조회/조인 요구도 없어 별도 테이블 없이
--   프로젝트 테이블에 8개 컬럼으로 바로 추가한다.
-- ============================================================================

BEGIN;

ALTER TABLE public.tb_pj_project
  ADD COLUMN anls_bgng_de timestamp NULL,
  ADD COLUMN anls_end_de  timestamp NULL,
  ADD COLUMN dsgn_bgng_de timestamp NULL,
  ADD COLUMN dsgn_end_de  timestamp NULL,
  ADD COLUMN dev_bgng_de  timestamp NULL,
  ADD COLUMN dev_end_de   timestamp NULL,
  ADD COLUMN test_bgng_de timestamp NULL,
  ADD COLUMN test_end_de  timestamp NULL;

COMMIT;
