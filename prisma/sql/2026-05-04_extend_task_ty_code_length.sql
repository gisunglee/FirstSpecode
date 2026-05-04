-- ================================================================
-- task_ty_code 길이 확장 — tb_ai_prompt_template
--   작성일 : 2026-05-04
--   사유   : 'PLAN_STUDIO_ARTF_GENERATE' (25자) 를 시드 INSERT 시
--            VARCHAR(20) 길이 초과로 실패함.
--            동일 값이 들어가는 tb_ai_task.task_ty_code 는 text 타입이라
--            기존 운영 코드는 정상 동작하지만, 프롬프트 템플릿 측은 길이 부족.
--   변경   : VARCHAR(20) → VARCHAR(30)
--            기존 데이터 손실 없는 안전한 확장 ALTER.
--
--   실행 방법:
--     psql $DATABASE_URL -f prisma/sql/2026-05-04_extend_task_ty_code_length.sql
-- ================================================================

BEGIN;

ALTER TABLE tb_ai_prompt_template
  ALTER COLUMN task_ty_code TYPE VARCHAR(30);

COMMIT;


-- ================================================================
-- [ROLLBACK] — 길이를 다시 줄이려면 PLAN_STUDIO_ARTF_GENERATE 행을
--   먼저 삭제하거나 다른 짧은 코드로 갱신해야 함.  주의 필요.
-- ================================================================
-- BEGIN;
-- DELETE FROM tb_ai_prompt_template WHERE task_ty_code = 'PLAN_STUDIO_ARTF_GENERATE';
-- ALTER TABLE tb_ai_prompt_template ALTER COLUMN task_ty_code TYPE VARCHAR(20);
-- COMMIT;
