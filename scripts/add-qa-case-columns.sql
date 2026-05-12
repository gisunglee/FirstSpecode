-- tb_qa_test_case 컬럼 확장 — Phase 1: 케이스 항목 풍부화
-- IF NOT EXISTS 로 멱등 보장 (재실행 안전)

ALTER TABLE "tb_qa_test_case" ADD COLUMN IF NOT EXISTS "precondition_cn" TEXT;
ALTER TABLE "tb_qa_test_case" ADD COLUMN IF NOT EXISTS "test_data_cn"    TEXT;
ALTER TABLE "tb_qa_test_case" ADD COLUMN IF NOT EXISTS "test_account_cn" TEXT;
ALTER TABLE "tb_qa_test_case" ADD COLUMN IF NOT EXISTS "priort_code"     TEXT NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE "tb_qa_test_case" ADD COLUMN IF NOT EXISTS "applicable_yn"   TEXT NOT NULL DEFAULT 'Y';
ALTER TABLE "tb_qa_test_case" ADD COLUMN IF NOT EXISTS "remark_cn"       TEXT;
