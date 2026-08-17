-- tb_ds_asis_question — AS-IS 온보딩 미해결 질문 저장소
-- 기존 tb_sp_sync_* 테이블 드리프트(제약조건 이름/컬럼 타입 불일치)와는 무관하게,
-- 이 테이블만 단독으로 생성한다. db push 대신 raw SQL로 실행하는 이유는
-- 위 드리프트가 함께 딸려와 무관한 기존 테이블을 건드리는 걸 피하기 위함.

CREATE TABLE "tb_ds_asis_question" (
    "question_id" VARCHAR(36) NOT NULL,
    "prjct_id" VARCHAR(36) NOT NULL,
    "purpose_code" VARCHAR(30) NOT NULL,
    "batch_id" VARCHAR(100),
    "ref_tbl_nm" VARCHAR(50) NOT NULL,
    "ref_id" VARCHAR(36) NOT NULL,
    "question_cn" TEXT NOT NULL,
    "answer_cn" TEXT,
    "status_code" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "req_mber_id" VARCHAR(36) NOT NULL,
    "revwr_mber_id" VARCHAR(36),
    "creat_dt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mdfcn_dt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answered_dt" TIMESTAMP(6),

    CONSTRAINT "pk_ds_asis_question" PRIMARY KEY ("question_id")
);

CREATE INDEX "idx_ds_asis_question_purpose" ON "tb_ds_asis_question"("prjct_id", "purpose_code", "status_code");

CREATE INDEX "idx_ds_asis_question_batch" ON "tb_ds_asis_question"("prjct_id", "batch_id");

CREATE INDEX "idx_ds_asis_question_ref" ON "tb_ds_asis_question"("ref_tbl_nm", "ref_id");

ALTER TABLE "tb_ds_asis_question" ADD CONSTRAINT "tb_ds_asis_question_prjct_fk" FOREIGN KEY ("prjct_id") REFERENCES "tb_pj_project"("prjct_id") ON DELETE CASCADE ON UPDATE CASCADE;
