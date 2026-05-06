-- ============================================================================
-- 2026-05-06  tb_pj_project 에 soft delete 도입
--
-- 배경:
--   기존 DELETE /api/projects/[id] 는 트랜잭션 내에서 즉시 hard delete 를
--   수행했다. CASCADE 로 23개 도메인 테이블이 한꺼번에 사라지므로 OWNER 가
--   실수로 삭제할 경우 복구가 사실상 불가능했다.
--
--   이제는 DELETE 시 다음 4개 컬럼만 세팅하고 행은 보존한다.
--   별도 배치(project-hard-delete)가 hard_del_dt 를 지나면 일괄 정리한다.
--
-- 컬럼:
--   - del_yn       Char(1)  DEFAULT 'N'   -- 'Y' 면 삭제 예정
--   - del_dt       Timestamp NULL         -- 삭제 요청 시각
--   - del_mber_id  Text NULL              -- 삭제 요청한 멤버 ID (OWNER)
--   - hard_del_dt  Timestamp NULL         -- 실제 hard delete 예정 시각
--
-- 인덱스:
--   배치는 (del_yn='Y' AND hard_del_dt <= now()) 로 매일 1회 스캔한다.
--   복합 인덱스로 그 조건을 빠르게 추리도록 추가.
--
-- 보관 기간:
--   기본 14일. TbSysConfigTemplate.PROJECT_SOFT_DELETE_DAYS 로 운영자가 조정.
--   (다음 마이그레이션에서 시드)
-- ============================================================================

BEGIN;

ALTER TABLE public.tb_pj_project
  ADD COLUMN del_yn      char(1)   NOT NULL DEFAULT 'N',
  ADD COLUMN del_dt      timestamp NULL,
  ADD COLUMN del_mber_id text      NULL,
  ADD COLUMN hard_del_dt timestamp NULL;

CREATE INDEX tb_pj_project_soft_del_idx
  ON public.tb_pj_project (del_yn, hard_del_dt);

COMMIT;
