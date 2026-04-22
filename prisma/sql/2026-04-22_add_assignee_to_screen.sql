-- ================================================================
-- 담당자 컬럼 추가 — tb_ds_screen (화면)
--   작성일 : 2026-04-22
--   범위   : TbDsScreen.asign_mber_id
--   참고   : 단위업무/과업/요구사항과 동일한 담당자 패턴을 화면에도 확장.
--            FK는 설정하지 않음 (퇴장 멤버의 과거 담당 기록 보존 목적)
--
-- 실행 방법:
--   1) 이 파일 전체를 DB 클라이언트(또는 psql)로 실행
--   2) 실행 후 `npx prisma generate` 로 클라이언트 재생성
--   3) 애플리케이션 재기동
--
-- 롤백이 필요하면 이 파일 하단의 [ROLLBACK] 섹션 참조
-- ================================================================

BEGIN;

ALTER TABLE tb_ds_screen
  ADD COLUMN IF NOT EXISTS asign_mber_id VARCHAR(36) NULL;

COMMENT ON COLUMN tb_ds_screen.asign_mber_id IS '담당자 회원 ID (tb_cm_member.mber_id) — FK 미설정, NULL=미지정';

COMMIT;


-- ================================================================
-- [ROLLBACK] — 컬럼 제거 (데이터 손실 주의)
-- ================================================================
-- BEGIN;
-- ALTER TABLE tb_ds_screen DROP COLUMN IF EXISTS asign_mber_id;
-- COMMIT;
