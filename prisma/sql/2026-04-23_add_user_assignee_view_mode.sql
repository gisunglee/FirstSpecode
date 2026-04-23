-- ================================================================
-- 전역 담당자 필터 모드 컬럼 추가 — tb_cm_member
--   작성일 : 2026-04-23
--   범위   : TbCmMember.asignee_view_mode
--   목적   : GNB "내 담당 모드" 토글의 상태를 DB에 저장
--            - 값: 'all' (전체) | 'me' (본인 담당만)
--            - 디바이스/브라우저 불문 계정별 저장
--
-- 실행 방법:
--   1) 이 파일 전체를 DB 클라이언트(또는 psql)로 실행
--   2) 실행 후 `npx prisma generate` 로 클라이언트 재생성
--   3) 애플리케이션 재기동
--
-- 롤백이 필요하면 이 파일 하단의 [ROLLBACK] 섹션 참조
-- ================================================================

BEGIN;

ALTER TABLE tb_cm_member
  ADD COLUMN IF NOT EXISTS asignee_view_mode VARCHAR(10) NOT NULL DEFAULT 'all';

COMMENT ON COLUMN tb_cm_member.asignee_view_mode IS '전역 담당자 필터 모드: all | me';

COMMIT;


-- ================================================================
-- [ROLLBACK] — 컬럼 제거
-- ================================================================
-- BEGIN;
-- ALTER TABLE tb_cm_member DROP COLUMN IF EXISTS asignee_view_mode;
-- COMMIT;
