-- tb_qa_test_case 에 그룹명(구분) 컬럼 추가 — 기능 시나리오의 도메인 그룹핑용
-- IF NOT EXISTS 로 멱등 보장.
ALTER TABLE "tb_qa_test_case" ADD COLUMN IF NOT EXISTS "grp_nm" TEXT;
