-- ============================================================================
-- 2026-05-06  배치 잡 실행 로그 테이블 신설
--
-- 배경:
--   tb_pj_project 에 soft delete 가 도입되면서, 보관 기간이 지난 프로젝트를
--   배치(project-hard-delete)가 영구 삭제하는 흐름이 생겼다. 향후 디스크
--   orphan 파일 정리(attach-file-cleanup) 등 다른 정기 작업도 추가될 예정.
--
--   이런 작업들은 "언제 누가 무엇을 얼마나 성공/실패했는지" 가 운영 추적의
--   기본이므로, 잡 실행 단위(tb_cm_batch_job) + 항목별 결과(tb_cm_batch_job_item)
--   2개 테이블로 표준화한다.
--
-- 잡 종류 (job_ty_code):
--   PROJECT_HARD_DELETE   보관 기간이 지난 soft-deleted 프로젝트의 영구 삭제
--   ATTACH_FILE_CLEANUP   DB 행 없는 디스크 orphan 첨부파일 정리
--
-- 인덱스:
--   - tb_cm_batch_job:    (job_ty_code, bgng_dt DESC)  -- 잡 종류별 최신 이력 조회
--   - tb_cm_batch_job_item: (job_id, sttus_code)       -- 잡별 성공/실패 필터
-- ============================================================================

BEGIN;

-- ─── 잡 실행 단위 ───────────────────────────────────────────────────────────
CREATE TABLE public.tb_cm_batch_job (
  job_id        text                NOT NULL,
  job_ty_code   text                NOT NULL,
  job_nm        text                NOT NULL DEFAULT '',
  trgr_ty_code  text                NOT NULL DEFAULT 'CRON',
  trgr_mber_id  text                NULL,
  sttus_code    text                NOT NULL DEFAULT 'RUNNING',
  bgng_dt       timestamp           NOT NULL DEFAULT now(),
  end_dt        timestamp           NULL,
  trgt_cnt      integer             NOT NULL DEFAULT 0,
  success_cnt   integer             NOT NULL DEFAULT 0,
  fail_cnt      integer             NOT NULL DEFAULT 0,
  skip_cnt      integer             NOT NULL DEFAULT 0,
  error_msg     text                NULL,
  summary_json  jsonb               NULL,
  CONSTRAINT tb_cm_batch_job_pk PRIMARY KEY (job_id)
);

CREATE INDEX tb_cm_batch_job_ty_dt_idx
  ON public.tb_cm_batch_job (job_ty_code, bgng_dt DESC);

-- ─── 항목별 처리 결과 ───────────────────────────────────────────────────────
CREATE TABLE public.tb_cm_batch_job_item (
  item_id       text                NOT NULL,
  job_id        text                NOT NULL,
  trgt_ty_code  text                NOT NULL,
  trgt_id       text                NOT NULL,
  trgt_label    text                NULL,
  sttus_code    text                NOT NULL,
  error_msg     text                NULL,
  processed_dt  timestamp           NOT NULL DEFAULT now(),
  meta_json     jsonb               NULL,
  CONSTRAINT tb_cm_batch_job_item_pk PRIMARY KEY (item_id),
  CONSTRAINT tb_cm_batch_job_item_job_fk
    FOREIGN KEY (job_id)
    REFERENCES public.tb_cm_batch_job(job_id)
    ON DELETE CASCADE
);

CREATE INDEX tb_cm_batch_job_item_job_sttus_idx
  ON public.tb_cm_batch_job_item (job_id, sttus_code);

COMMIT;
