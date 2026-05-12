-- ────────────────────────────────────────────────────────────────────────
-- QA 도메인 6개 테이블 직접 생성 (db push 우회)
--
-- 사유:
--   db push 시 다수의 기존 테이블에 PK metadata drift 가 누적되어
--   Prisma engine 이 RenamePrimaryKey + Type SafeCast 를 한 ALTER 로 합치다
--   syntax error 발생. drift 정리는 별도 이슈로 분리.
--
-- 본 스크립트는 NEW 테이블 생성만 수행 — 기존 테이블·데이터 영향 없음.
-- ────────────────────────────────────────────────────────────────────────

-- 1. tb_qa_test_spec
CREATE TABLE IF NOT EXISTS "tb_qa_test_spec" (
  "test_spec_id"         TEXT        NOT NULL,
  "prjct_id"             TEXT        NOT NULL,
  "test_spec_display_id" TEXT        NOT NULL,
  "test_kind_code"       TEXT        NOT NULL,
  "test_spec_nm"         TEXT        NOT NULL,
  "test_spec_dc"         TEXT,
  "sttus_code"           TEXT        NOT NULL DEFAULT 'DRAFT',
  "asign_mber_id"        TEXT,
  "sort_ordr"            INTEGER     NOT NULL DEFAULT 0,
  "creat_dt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "mdfcn_dt"             TIMESTAMP(3),
  CONSTRAINT "tb_qa_test_spec_pkey" PRIMARY KEY ("test_spec_id")
);
CREATE INDEX IF NOT EXISTS "tb_qa_test_spec_prjct_idx" ON "tb_qa_test_spec"("prjct_id");

-- 2. tb_qa_test_spec_uw (명세서 ↔ 단위업무 매핑)
CREATE TABLE IF NOT EXISTS "tb_qa_test_spec_uw" (
  "test_spec_id"  TEXT NOT NULL,
  "unit_work_id"  TEXT NOT NULL,
  "sort_ordr"     INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "tb_qa_test_spec_uw_pkey" PRIMARY KEY ("test_spec_id", "unit_work_id")
);
CREATE INDEX IF NOT EXISTS "tb_qa_test_spec_uw_uw_idx" ON "tb_qa_test_spec_uw"("unit_work_id");

-- 3. tb_qa_test_case
CREATE TABLE IF NOT EXISTS "tb_qa_test_case" (
  "test_case_id"  TEXT        NOT NULL,
  "prjct_id"      TEXT        NOT NULL,
  "test_spec_id"  TEXT        NOT NULL,
  "case_no"       INTEGER     NOT NULL,
  "ctgry_code"    TEXT        NOT NULL,
  "scenario_cn"   TEXT        NOT NULL,
  "expected_cn"   TEXT        NOT NULL,
  "ai_gen_yn"     TEXT        NOT NULL DEFAULT 'N',
  "sort_ordr"     INTEGER     NOT NULL DEFAULT 0,
  "creat_dt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "mdfcn_dt"      TIMESTAMP(3),
  CONSTRAINT "tb_qa_test_case_pkey" PRIMARY KEY ("test_case_id")
);
CREATE INDEX IF NOT EXISTS "tb_qa_test_case_prjct_idx" ON "tb_qa_test_case"("prjct_id");
CREATE INDEX IF NOT EXISTS "tb_qa_test_case_spec_idx"  ON "tb_qa_test_case"("test_spec_id");

-- 4. tb_qa_test_round
CREATE TABLE IF NOT EXISTS "tb_qa_test_round" (
  "round_id"      TEXT        NOT NULL,
  "prjct_id"      TEXT        NOT NULL,
  "test_spec_id"  TEXT        NOT NULL,
  "round_no"      INTEGER     NOT NULL,
  "envir_code"    TEXT        NOT NULL DEFAULT 'DEV',
  "bld_vrsn_nm"   TEXT,
  "bgng_dt"       TIMESTAMP(3),
  "end_dt"        TIMESTAMP(3),
  "sttus_code"    TEXT        NOT NULL DEFAULT 'IN_PROGRESS',
  "creat_dt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tb_qa_test_round_pkey" PRIMARY KEY ("round_id"),
  CONSTRAINT "tb_qa_test_round_uniq" UNIQUE ("test_spec_id", "round_no")
);
CREATE INDEX IF NOT EXISTS "tb_qa_test_round_prjct_idx" ON "tb_qa_test_round"("prjct_id");

-- 5. tb_qa_test_result
CREATE TABLE IF NOT EXISTS "tb_qa_test_result" (
  "result_id"     TEXT        NOT NULL,
  "prjct_id"      TEXT        NOT NULL,
  "round_id"      TEXT        NOT NULL,
  "test_case_id"  TEXT        NOT NULL,
  "result_code"   TEXT        NOT NULL DEFAULT 'NA',
  "remark_cn"     TEXT,
  "test_mber_id"  TEXT,
  "test_dt"       TIMESTAMP(3),
  "creat_dt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "mdfcn_dt"      TIMESTAMP(3),
  CONSTRAINT "tb_qa_test_result_pkey" PRIMARY KEY ("result_id"),
  CONSTRAINT "tb_qa_test_result_uniq" UNIQUE ("round_id", "test_case_id")
);
CREATE INDEX IF NOT EXISTS "tb_qa_test_result_prjct_idx" ON "tb_qa_test_result"("prjct_id");

-- 6. tb_qa_defect
CREATE TABLE IF NOT EXISTS "tb_qa_defect" (
  "defect_id"          TEXT        NOT NULL,
  "prjct_id"           TEXT        NOT NULL,
  "result_id"          TEXT        NOT NULL,
  "defect_display_id"  TEXT        NOT NULL,
  "defect_cn"          TEXT        NOT NULL,
  "sttus_code"         TEXT        NOT NULL DEFAULT 'OPEN',
  "asign_mber_id"      TEXT,
  "fix_cn"             TEXT,
  "fix_dt"             TIMESTAMP(3),
  "creat_dt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "mdfcn_dt"           TIMESTAMP(3),
  CONSTRAINT "tb_qa_defect_pkey" PRIMARY KEY ("defect_id")
);
CREATE INDEX IF NOT EXISTS "tb_qa_defect_prjct_idx"  ON "tb_qa_defect"("prjct_id");
CREATE INDEX IF NOT EXISTS "tb_qa_defect_result_idx" ON "tb_qa_defect"("result_id");

-- 7. tb_qa_evidence
CREATE TABLE IF NOT EXISTS "tb_qa_evidence" (
  "evidence_id"     TEXT        NOT NULL,
  "prjct_id"        TEXT        NOT NULL,
  "result_id"       TEXT        NOT NULL,
  "file_nm"         TEXT        NOT NULL,
  "file_path"       TEXT        NOT NULL,
  "file_size"       INTEGER     NOT NULL,
  "mime_ty_code"    TEXT,
  "upload_mber_id"  TEXT,
  "creat_dt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tb_qa_evidence_pkey" PRIMARY KEY ("evidence_id")
);
CREATE INDEX IF NOT EXISTS "tb_qa_evidence_prjct_idx" ON "tb_qa_evidence"("prjct_id");

-- ────────────────────────────────────────────────────────────────────────
-- Foreign Keys (CASCADE — 프로젝트/명세서 삭제 시 자동 정리)
-- ────────────────────────────────────────────────────────────────────────

-- tb_qa_test_spec → tb_pj_project
ALTER TABLE "tb_qa_test_spec"
  ADD CONSTRAINT "tb_qa_test_spec_prjct_fk"
  FOREIGN KEY ("prjct_id") REFERENCES "tb_pj_project"("prjct_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- tb_qa_test_spec_uw → tb_qa_test_spec / tb_ds_unit_work
ALTER TABLE "tb_qa_test_spec_uw"
  ADD CONSTRAINT "tb_qa_test_spec_uw_spec_fk"
  FOREIGN KEY ("test_spec_id") REFERENCES "tb_qa_test_spec"("test_spec_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tb_qa_test_spec_uw"
  ADD CONSTRAINT "tb_qa_test_spec_uw_uw_fk"
  FOREIGN KEY ("unit_work_id") REFERENCES "tb_ds_unit_work"("unit_work_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- tb_qa_test_case
ALTER TABLE "tb_qa_test_case"
  ADD CONSTRAINT "tb_qa_test_case_spec_fk"
  FOREIGN KEY ("test_spec_id") REFERENCES "tb_qa_test_spec"("test_spec_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tb_qa_test_case"
  ADD CONSTRAINT "tb_qa_test_case_prjct_fk"
  FOREIGN KEY ("prjct_id") REFERENCES "tb_pj_project"("prjct_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- tb_qa_test_round
ALTER TABLE "tb_qa_test_round"
  ADD CONSTRAINT "tb_qa_test_round_spec_fk"
  FOREIGN KEY ("test_spec_id") REFERENCES "tb_qa_test_spec"("test_spec_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tb_qa_test_round"
  ADD CONSTRAINT "tb_qa_test_round_prjct_fk"
  FOREIGN KEY ("prjct_id") REFERENCES "tb_pj_project"("prjct_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- tb_qa_test_result
ALTER TABLE "tb_qa_test_result"
  ADD CONSTRAINT "tb_qa_test_result_round_fk"
  FOREIGN KEY ("round_id") REFERENCES "tb_qa_test_round"("round_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tb_qa_test_result"
  ADD CONSTRAINT "tb_qa_test_result_case_fk"
  FOREIGN KEY ("test_case_id") REFERENCES "tb_qa_test_case"("test_case_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tb_qa_test_result"
  ADD CONSTRAINT "tb_qa_test_result_prjct_fk"
  FOREIGN KEY ("prjct_id") REFERENCES "tb_pj_project"("prjct_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- tb_qa_defect
ALTER TABLE "tb_qa_defect"
  ADD CONSTRAINT "tb_qa_defect_result_fk"
  FOREIGN KEY ("result_id") REFERENCES "tb_qa_test_result"("result_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tb_qa_defect"
  ADD CONSTRAINT "tb_qa_defect_prjct_fk"
  FOREIGN KEY ("prjct_id") REFERENCES "tb_pj_project"("prjct_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- tb_qa_evidence
ALTER TABLE "tb_qa_evidence"
  ADD CONSTRAINT "tb_qa_evidence_result_fk"
  FOREIGN KEY ("result_id") REFERENCES "tb_qa_test_result"("result_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tb_qa_evidence"
  ADD CONSTRAINT "tb_qa_evidence_prjct_fk"
  FOREIGN KEY ("prjct_id") REFERENCES "tb_pj_project"("prjct_id") ON DELETE CASCADE ON UPDATE CASCADE;
