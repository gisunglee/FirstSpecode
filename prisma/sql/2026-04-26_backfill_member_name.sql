-- ================================================================
-- mber_nm NULL/빈값 회원 일괄 보정 — tb_cm_member
--   작성일 : 2026-04-26
--   범위   : TbCmMember.mber_nm
--   목적   : 멤버 목록·담당자 select 등에서 "(이름 없음)" 으로 표시되는
--            기존 회원의 회원명을 이메일 로컬파트(@ 앞부분)로 일괄 보정
--
--   배경:
--     - 이메일 회원가입 경로에서 mber_nm 미설정으로 NULL 저장된 이력
--     - 소셜 fallback 도입 이전에 가입한 회원도 동일 문제 가능
--     - 회원가입 코드(register/social)는 이미 fallback 적용 — 이 SQL 로 잔여 데이터 정리
--
-- 실행 방법:
--   1) 이 파일 전체를 DB 클라이언트(또는 psql)로 실행
--   2) 별도의 prisma generate 불필요 (스키마 변경 없음)
--   3) 즉시 반영 — 애플리케이션 재기동 불필요
--
-- 롤백이 필요하면 이 파일 하단의 [ROLLBACK] 섹션 참조
-- ================================================================

BEGIN;

-- 보정 대상 미리 확인 (참고용 — 실제 UPDATE 전에 SELECT 로 갯수 점검 권장)
-- SELECT COUNT(*) AS target_count
--   FROM tb_cm_member
--  WHERE (mber_nm IS NULL OR mber_nm = '')
--    AND email_addr IS NOT NULL
--    AND POSITION('@' IN email_addr) > 0;

UPDATE tb_cm_member
   SET mber_nm = SPLIT_PART(email_addr, '@', 1)
 WHERE (mber_nm IS NULL OR mber_nm = '')
   AND email_addr IS NOT NULL
   AND POSITION('@' IN email_addr) > 0;

COMMIT;


-- ================================================================
-- [ROLLBACK] — 일괄 보정으로 채워진 mber_nm 을 다시 NULL 로 되돌리는 안전한 방법은 없음
-- (보정 후 사용자가 수동으로 이름을 바꿨을 가능성 때문). 필요하다면 백업 테이블에서 복구.
-- 보정 직후 즉시 되돌리고 싶다면 보정 직전에 아래 백업 테이블을 미리 만들어 두고 사용:
-- ================================================================
-- 보정 전 백업 (선택):
-- CREATE TABLE tb_cm_member__backup_20260426 AS
--   SELECT mber_id, mber_nm FROM tb_cm_member
--    WHERE mber_nm IS NULL OR mber_nm = '';
--
-- 롤백:
-- BEGIN;
-- UPDATE tb_cm_member m
--    SET mber_nm = b.mber_nm
--   FROM tb_cm_member__backup_20260426 b
--  WHERE m.mber_id = b.mber_id;
-- COMMIT;
-- DROP TABLE tb_cm_member__backup_20260426;
