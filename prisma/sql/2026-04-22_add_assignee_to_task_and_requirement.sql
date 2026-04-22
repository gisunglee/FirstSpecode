-- ================================================================
-- 담당자 컬럼 추가 — tb_rq_task, tb_rq_requirement
--   작성일 : 2026-04-22
--   범위   : TbRqTask.asign_mber_id / TbRqRequirement.asign_mber_id
--   참고   : 단위업무(tb_ds_unit_work.asign_mber_id)와 동일한 패턴을
--            과업·요구사항에도 확장. FK는 설정하지 않음
--            (퇴장한 멤버의 과거 담당 기록 보존 목적)
--
-- 실행 방법:
--   1) 이 파일 전체를 DB 클라이언트(또는 psql)로 실행
--   2) 실행 후 `npx prisma generate` 로 클라이언트 재생성
--   3) 애플리케이션 재기동
--
-- 롤백이 필요하면 이 파일 하단의 [ROLLBACK] 섹션 참조
-- ================================================================

BEGIN;

-- ── 1. tb_rq_task — 담당자 컬럼 추가 ──────────────────────────────
ALTER TABLE tb_rq_task
  ADD COLUMN IF NOT EXISTS asign_mber_id VARCHAR(36) NULL;

COMMENT ON COLUMN tb_rq_task.asign_mber_id IS '담당자 회원 ID (tb_cm_member.mber_id) — FK 미설정, NULL=미지정';


-- ── 2. tb_rq_requirement — 담당자 컬럼 추가 ──────────────────────
ALTER TABLE tb_rq_requirement
  ADD COLUMN IF NOT EXISTS asign_mber_id VARCHAR(36) NULL;

COMMENT ON COLUMN tb_rq_requirement.asign_mber_id IS '담당자 회원 ID (tb_cm_member.mber_id) — FK 미설정, NULL=미지정';

COMMIT;


-- ================================================================
-- [ROLLBACK] — 컬럼 제거 (데이터 손실 주의)
-- ================================================================
-- BEGIN;
-- ALTER TABLE tb_rq_task         DROP COLUMN IF EXISTS asign_mber_id;
-- ALTER TABLE tb_rq_requirement  DROP COLUMN IF EXISTS asign_mber_id;
-- COMMIT;
