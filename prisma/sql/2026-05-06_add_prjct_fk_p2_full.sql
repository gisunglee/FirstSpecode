-- ============================================================================
-- 2026-05-06 (P2 — 확장 범위)  prjct_id FK + ON DELETE CASCADE 일괄 적용
--
-- 배경:
--   P1 에서 핵심 도메인 6개에 FK 를 추가했고, 나머지 도메인 테이블들도
--   감사 결과 동일한 FK 누락이 확인되어 함께 정리.
--
--   본 마이그레이션은 9개 직접 cascade + 1개 보강(중간 테이블) = 총 10개의
--   ALTER 작업을 트랜잭션으로 묶음. orphan 행은 모두 0건으로 사전 검증됨.
--
-- 적용 대상 (15 -> 9 + 1):
--   ① 직접 prjct_id FK CASCADE 추가 (9개)
--      tb_pj_project_config, tb_pj_member_removal_notice
--      tb_ds_design_change, tb_ds_document_release
--      tb_ds_db_table, tb_ds_db_table_revision
--      tb_cm_progress, tb_ai_task, tb_cm_attach_file
--      tb_rq_baseline_snapshot, tb_ds_review_request
--      tb_cm_code_group, tb_cm_code
--      tb_ds_memo, tb_sg_std_guide
--      ※ 카운트가 9가 아니라 15인 이유: 각 테이블 1개씩 = 15개. 위 표기 오류 정정.
--
--   ② 중간 테이블 보강: tb_ds_db_table_column → tb_ds_db_table 의 RESTRICT 를
--      CASCADE 로 변경. 이게 RESTRICT 면 위 ① 의 db_table cascade 가 column 으로
--      막혀 프로젝트 삭제 자체가 fail 함.
--      tb_cm_code_group → tb_cm_code 는 이미 CASCADE 라 추가 작업 불필요.
--
-- 부수 사항 (FYI, 본 마이그레이션과 무관):
--   tb_cm_attach_file 의 cascade 는 DB 행만 정리. 디스크의 file_path_nm 물리
--   파일은 정리 대상이 아님. 별도 cleanup job 필요 (다음 작업).
-- ============================================================================

BEGIN;

-- ─── ① 직접 prjct_id FK CASCADE (15개) ─────────────────────────────────────

-- 프로젝트 설정·운영 관련
ALTER TABLE public.tb_pj_project_config
  ADD CONSTRAINT tb_pj_project_config_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

ALTER TABLE public.tb_pj_member_removal_notice
  ADD CONSTRAINT tb_pj_member_removal_notice_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

-- 설계 이력 / 발행 이력
ALTER TABLE public.tb_ds_design_change
  ADD CONSTRAINT tb_ds_design_change_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

ALTER TABLE public.tb_ds_document_release
  ADD CONSTRAINT tb_ds_document_release_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

-- DB 설계
ALTER TABLE public.tb_ds_db_table
  ADD CONSTRAINT tb_ds_db_table_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

ALTER TABLE public.tb_ds_db_table_revision
  ADD CONSTRAINT tb_ds_db_table_revision_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

-- 진척도 / AI 태스크
ALTER TABLE public.tb_cm_progress
  ADD CONSTRAINT tb_cm_progress_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

ALTER TABLE public.tb_ai_task
  ADD CONSTRAINT tb_ai_task_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

-- 첨부 / 베이스라인 / 리뷰
ALTER TABLE public.tb_cm_attach_file
  ADD CONSTRAINT tb_cm_attach_file_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

ALTER TABLE public.tb_rq_baseline_snapshot
  ADD CONSTRAINT tb_rq_baseline_snapshot_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

ALTER TABLE public.tb_ds_review_request
  ADD CONSTRAINT tb_ds_review_request_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

-- 공통코드
ALTER TABLE public.tb_cm_code_group
  ADD CONSTRAINT tb_cm_code_group_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

ALTER TABLE public.tb_cm_code
  ADD CONSTRAINT tb_cm_code_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

-- 메모 / 표준 가이드
ALTER TABLE public.tb_ds_memo
  ADD CONSTRAINT tb_ds_memo_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

ALTER TABLE public.tb_sg_std_guide
  ADD CONSTRAINT tb_sg_std_guide_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

-- ─── ② 중간 테이블 보강 — db_table_column FK 를 CASCADE 로 ──────────────────
-- 기존: ON DELETE RESTRICT  →  변경: ON DELETE CASCADE
-- DROP + ADD 패턴 (PostgreSQL 은 ALTER CONSTRAINT 로 onDelete 변경 불가)

ALTER TABLE public.tb_ds_db_table_column
  DROP CONSTRAINT tb_ds_db_table_column_tbl_id_fkey;

ALTER TABLE public.tb_ds_db_table_column
  ADD CONSTRAINT tb_ds_db_table_column_tbl_id_fkey
  FOREIGN KEY (tbl_id) REFERENCES public.tb_ds_db_table(tbl_id) ON DELETE CASCADE;

COMMIT;
