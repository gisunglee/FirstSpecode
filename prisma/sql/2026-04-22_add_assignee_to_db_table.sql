-- ================================================================
-- 담당자 컬럼 추가 — tb_ds_db_table (DB 테이블)
--   작성일 : 2026-04-22
--   범위   : TbDsDbTable.asign_mber_id
--   참고   : 단위업무/과업/요구사항/화면과 동일한 담당자 패턴.
--            FK는 설정하지 않음 (퇴장 멤버의 과거 담당 기록 보존 목적)
-- ================================================================

BEGIN;

ALTER TABLE tb_ds_db_table
  ADD COLUMN IF NOT EXISTS asign_mber_id VARCHAR(36) NULL;

COMMENT ON COLUMN tb_ds_db_table.asign_mber_id IS '담당자 회원 ID (tb_cm_member.mber_id) — FK 미설정, NULL=미지정';

COMMIT;


-- ================================================================
-- [ROLLBACK]
-- ================================================================
-- BEGIN;
-- ALTER TABLE tb_ds_db_table DROP COLUMN IF EXISTS asign_mber_id;
-- COMMIT;
