-- Supabase Storage 임시 업로드 추적 테이블 (2026-09-26)
--
-- 목적:
--   브라우저가 서명 URL로 Storage 업로드를 마쳤지만 최종 첨부 DB 저장까지 도달하지 못한
--   파일만 기록한다. 일일 배치는 만료 행의 정확한 경로만 삭제하므로 버킷 전체를 매일
--   조회할 필요가 없다. 전체 스캔은 주기적인 안전 감사로만 남긴다.
--
-- 무중단 적용 순서:
--   1) 이 DDL을 먼저 적용한다. 기존 코드가 참조하지 않는 새 테이블이라 서비스 영향이 없다.
--   2) 새 코드를 배포한다. 배포 중 구버전 서버가 완료한 업로드는 cleanup이 최종 첨부 참조를
--      다시 확인하므로 Storage 객체를 삭제하지 않고 pending 행만 정리한다.
--
-- FK를 두지 않는 이유:
--   회원/프로젝트가 먼저 삭제돼도 Storage 정리에 필요한 경로가 CASCADE로 사라지면 안 된다.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tb_cm_storage_upload_pending (
  upload_id      text         NOT NULL,
  mber_id        text         NOT NULL,
  prjct_id       text,
  ref_tbl_nm     text         NOT NULL,
  ref_id         text         NOT NULL,
  orgnl_file_nm  text         NOT NULL,
  stor_file_nm   text         NOT NULL,
  file_path_nm   text         NOT NULL,
  file_sz        bigint       NOT NULL,
  file_extsn_nm  text         NOT NULL,
  file_ty_code   text         NOT NULL,
  mime_ty        text         NOT NULL,
  expiry_dt      timestamp(3) NOT NULL,
  creat_dt       timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tb_cm_storage_upload_pending_pkey PRIMARY KEY (upload_id),
  CONSTRAINT tb_cm_storage_upload_pending_file_path_nm_key UNIQUE (file_path_nm)
);

CREATE INDEX IF NOT EXISTS tb_cm_storage_upload_pending_expiry_idx
  ON public.tb_cm_storage_upload_pending (expiry_dt);

CREATE INDEX IF NOT EXISTS tb_cm_storage_upload_pending_mber_idx
  ON public.tb_cm_storage_upload_pending (mber_id, creat_dt DESC);

COMMENT ON TABLE public.tb_cm_storage_upload_pending IS
  'Supabase Storage 직접 업로드 중 최종 첨부로 확정되지 않은 객체의 정리 대기 목록';
COMMENT ON COLUMN public.tb_cm_storage_upload_pending.expiry_dt IS
  '이 시각 이후 배치가 최종 첨부 참조를 재확인한 뒤 Storage 객체를 정리할 수 있음';

COMMIT;
