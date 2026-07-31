-- ============================================================================
-- 2026-07-31  구현 변경 스펙 정합성 2~4단계 확장
--
-- 기존 1차 수직 흐름을 유지하면서 다음을 추가한다.
--   - 후속 변경·증거 검증·draft/override 메타데이터
--   - FIX_SOURCE / 임시 예외 / MODEL_GAP / 3-way 병합 결과
--   - 단위업무·화면·영역 설명 적용
--   - 확정된 파일·심볼의 스펙-소스 연결지도
--
-- 모두 additive ALTER이며 기존 receipt/item 데이터는 보존한다.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tb_sp_source_repository (
  repository_id             text          NOT NULL DEFAULT gen_random_uuid()::text,
  prjct_id                  text          NOT NULL,
  repo_key                  varchar(200)  NOT NULL,
  provider_code             varchar(30)   NOT NULL,
  provider_repository_path  varchar(500)  NOT NULL,
  repository_url            varchar(2000),
  api_base_url               varchar(1000) NOT NULL,
  default_branch_nm          varchar(200)  NOT NULL DEFAULT 'main',
  encpt_token_val            text,
  mask_token_val             text,
  encpt_webhook_secret_val   text,
  webhook_active_yn          char(1)       NOT NULL DEFAULT 'N',
  creat_mber_id              text,
  use_yn                     char(1)       NOT NULL DEFAULT 'Y',
  creat_dt                   timestamp     NOT NULL DEFAULT now(),
  mdfcn_dt                   timestamp     NOT NULL DEFAULT now(),
  CONSTRAINT tb_sp_source_repository_pk PRIMARY KEY (repository_id),
  CONSTRAINT tb_sp_source_repository_prjct_fk
    FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE,
  CONSTRAINT tb_sp_source_repository_scope_uk UNIQUE (prjct_id, repo_key)
);

CREATE INDEX IF NOT EXISTS tb_sp_source_repository_provider_idx
  ON public.tb_sp_source_repository (provider_code, provider_repository_path);

INSERT INTO public.tb_sys_config_template
  (sys_tmpl_id, config_group, config_key, config_label, config_dc,
   value_type, default_value, select_options, sort_ordr, use_yn)
VALUES
  ('22222222-2222-2222-2222-000000000036',
   '스펙 정합성', 'SPEC_RECONCILE_GATE_POLICY', 'CI 정합성 gate 정책',
   'WARN은 경고만, BLOCK은 미해결 receipt 또는 미확정 head가 있을 때 allowed=false를 반환합니다.',
   'SELECT', 'WARN', '["WARN","BLOCK"]'::jsonb, 360, 'Y'),
  ('22222222-2222-2222-2222-000000000037',
   '스펙 정합성', 'SPEC_RECONCILE_DIFF_RETENTION_DAYS', 'Source Diff 보관기간 (일)',
   'CLOSED receipt의 patch/content evidence 보관기간입니다. 기간 이후에도 경로·hash·판단 이력은 유지됩니다.',
   'NUMBER', '90', NULL, 370, 'Y'),
  ('22222222-2222-2222-2222-000000000038',
   '스펙 정합성', 'SPEC_RECONCILE_BLOCK_RISKS', '차단 위험도',
   'BLOCK 정책에서 차단 사유로 취급할 미해결 위험도를 쉼표로 구분합니다.',
   'TEXT', 'HIGH,CRITICAL', NULL, 380, 'Y')
ON CONFLICT (config_key) DO UPDATE SET
  config_group = EXCLUDED.config_group,
  config_label = EXCLUDED.config_label,
  config_dc = EXCLUDED.config_dc,
  value_type = EXCLUDED.value_type,
  select_options = EXCLUDED.select_options,
  use_yn = 'Y';

INSERT INTO public.tb_pj_project_config
  (config_id, prjct_id, config_group, config_key, config_value, config_label,
   config_dc, value_type, default_value, select_options, sort_ordr)
SELECT
  gen_random_uuid()::text,
  p.prjct_id,
  t.config_group,
  t.config_key,
  t.default_value,
  t.config_label,
  t.config_dc,
  t.value_type,
  t.default_value,
  t.select_options,
  t.sort_ordr
FROM public.tb_pj_project p
CROSS JOIN public.tb_sys_config_template t
WHERE t.config_key IN (
  'SPEC_RECONCILE_GATE_POLICY',
  'SPEC_RECONCILE_DIFF_RETENTION_DAYS',
  'SPEC_RECONCILE_BLOCK_RISKS'
)
ON CONFLICT (prjct_id, config_key) DO NOTHING;

ALTER TABLE public.tb_sp_source_baseline
  ADD COLUMN IF NOT EXISTS repo_provider_code varchar(30) NOT NULL DEFAULT 'LOCAL',
  ADD COLUMN IF NOT EXISTS checkpoint_metadata_data jsonb,
  ADD COLUMN IF NOT EXISTS use_yn char(1) NOT NULL DEFAULT 'Y';

ALTER TABLE public.tb_sp_impl_receipt
  ADD COLUMN IF NOT EXISTS client_submission_key varchar(100),
  ADD COLUMN IF NOT EXISTS parent_receipt_id text,
  ADD COLUMN IF NOT EXISTS ancestry_verify_yn char(1),
  ADD COLUMN IF NOT EXISTS diff_hash char(64),
  ADD COLUMN IF NOT EXISTS evidence_verify_data jsonb,
  ADD COLUMN IF NOT EXISTS override_rsn_cn text,
  ADD COLUMN IF NOT EXISTS override_mber_id text,
  ADD COLUMN IF NOT EXISTS pr_url text,
  ADD COLUMN IF NOT EXISTS manifest_data jsonb,
  ADD COLUMN IF NOT EXISTS selected_target_data jsonb,
  ADD COLUMN IF NOT EXISTS analysis_scope_data jsonb,
  ADD COLUMN IF NOT EXISTS risk_summary_data jsonb,
  ADD COLUMN IF NOT EXISTS review_sttus_code varchar(30) NOT NULL DEFAULT 'NEEDS_REVIEW',
  ADD COLUMN IF NOT EXISTS revwr_mber_id text,
  ADD COLUMN IF NOT EXISTS analysis_version varchar(50),
  ADD COLUMN IF NOT EXISTS head_stable_yn char(1) NOT NULL DEFAULT 'Y',
  ADD COLUMN IF NOT EXISTS verified_dt timestamp;

CREATE UNIQUE INDEX IF NOT EXISTS tb_sp_impl_receipt_submission_uk
  ON public.tb_sp_impl_receipt (prjct_id, client_submission_key)
  WHERE client_submission_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS tb_sp_impl_receipt_parent_idx
  ON public.tb_sp_impl_receipt (parent_receipt_id);

ALTER TABLE public.tb_sp_reconcile_item
  ADD COLUMN IF NOT EXISTS resolution_evidence_data jsonb,
  ADD COLUMN IF NOT EXISTS exception_expire_dt timestamp,
  ADD COLUMN IF NOT EXISTS exception_owner_mber_id text,
  ADD COLUMN IF NOT EXISTS followup_task_id text,
  ADD COLUMN IF NOT EXISTS review_request_id text,
  ADD COLUMN IF NOT EXISTS merge_preview_cn text,
  ADD COLUMN IF NOT EXISTS merge_latest_hash char(64),
  ADD COLUMN IF NOT EXISTS merge_conflict_data jsonb,
  ADD COLUMN IF NOT EXISTS batch_origin_data jsonb,
  ADD COLUMN IF NOT EXISTS resolved_dt timestamp;

CREATE TABLE IF NOT EXISTS public.tb_sp_reconcile_batch (
  batch_id             text         NOT NULL DEFAULT gen_random_uuid()::text,
  receipt_id           text         NOT NULL,
  prjct_id             text         NOT NULL,
  batch_no             integer      NOT NULL,
  batch_key            varchar(200) NOT NULL,
  scope_ty_code        varchar(30)  NOT NULL,
  scope_ref_id         varchar(36),
  scope_nm             varchar(300) NOT NULL,
  source_paths_data    jsonb        NOT NULL,
  target_refs_data     jsonb        NOT NULL,
  routing_data         jsonb,
  metrics_data         jsonb        NOT NULL,
  batch_sttus_code     varchar(30)  NOT NULL DEFAULT 'PLANNED',
  ai_task_id           text,
  analysis_result_data jsonb,
  summary_cn           text,
  failure_cn           text,
  retry_cnt            integer      NOT NULL DEFAULT 0,
  creat_dt             timestamp    NOT NULL DEFAULT now(),
  mdfcn_dt             timestamp    NOT NULL DEFAULT now(),
  compl_dt             timestamp,
  CONSTRAINT tb_sp_reconcile_batch_pk PRIMARY KEY (batch_id),
  CONSTRAINT tb_sp_reconcile_batch_receipt_fk
    FOREIGN KEY (receipt_id) REFERENCES public.tb_sp_impl_receipt(receipt_id) ON DELETE CASCADE,
  CONSTRAINT tb_sp_reconcile_batch_prjct_fk
    FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE,
  CONSTRAINT tb_sp_reconcile_batch_ai_task_fk
    FOREIGN KEY (ai_task_id) REFERENCES public.tb_ai_task(ai_task_id) ON DELETE SET NULL,
  CONSTRAINT tb_sp_reconcile_batch_ai_task_uk UNIQUE (ai_task_id),
  CONSTRAINT tb_sp_reconcile_batch_key_uk UNIQUE (receipt_id, batch_key)
);

CREATE INDEX IF NOT EXISTS tb_sp_reconcile_batch_receipt_sttus_idx
  ON public.tb_sp_reconcile_batch (receipt_id, batch_sttus_code, batch_no);

CREATE INDEX IF NOT EXISTS tb_sp_reconcile_batch_prjct_dt_idx
  ON public.tb_sp_reconcile_batch (prjct_id, creat_dt DESC);

ALTER TABLE public.tb_sp_reconcile_item
  DROP CONSTRAINT IF EXISTS tb_sp_reconcile_item_v1_target_ck;

ALTER TABLE public.tb_sp_reconcile_item
  DROP CONSTRAINT IF EXISTS tb_sp_reconcile_item_target_field_ck;

ALTER TABLE public.tb_sp_reconcile_item
  ADD CONSTRAINT tb_sp_reconcile_item_target_field_ck CHECK (
    (target_ref_ty_code = 'UNIT_WORK' AND target_field_nm = 'unit_work_dc')
    OR (target_ref_ty_code = 'SCREEN' AND target_field_nm = 'scrn_dc')
    OR (target_ref_ty_code = 'AREA' AND target_field_nm = 'area_dc')
    OR (target_ref_ty_code = 'FUNCTION' AND target_field_nm = 'func_dc')
  );

CREATE TABLE IF NOT EXISTS public.tb_sp_spec_source_link (
  link_id               text          NOT NULL DEFAULT gen_random_uuid()::text,
  prjct_id              text          NOT NULL,
  target_ref_ty_code    varchar(30)   NOT NULL,
  target_ref_id         varchar(36)   NOT NULL,
  source_kind_code      varchar(30)   NOT NULL,
  source_path           varchar(1000) NOT NULL,
  source_symbol         varchar(500)  NOT NULL DEFAULT '',
  relation_ty_code      varchar(30)   NOT NULL DEFAULT 'DIRECT',
  confidence_code       varchar(20)   NOT NULL DEFAULT 'MEDIUM',
  first_receipt_id      text          NOT NULL,
  last_receipt_id       text          NOT NULL,
  use_yn                char(1)       NOT NULL DEFAULT 'Y',
  creat_dt              timestamp     NOT NULL DEFAULT now(),
  mdfcn_dt              timestamp     NOT NULL DEFAULT now(),
  CONSTRAINT tb_sp_spec_source_link_pk PRIMARY KEY (link_id),
  CONSTRAINT tb_sp_spec_source_link_prjct_fk
    FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE,
  CONSTRAINT tb_sp_spec_source_link_scope_uk UNIQUE (
    prjct_id, target_ref_ty_code, target_ref_id,
    source_kind_code, source_path, source_symbol
  )
);

CREATE INDEX IF NOT EXISTS tb_sp_spec_source_link_path_idx
  ON public.tb_sp_spec_source_link (prjct_id, source_path, use_yn);

CREATE INDEX IF NOT EXISTS tb_sp_spec_source_link_target_idx
  ON public.tb_sp_spec_source_link (target_ref_ty_code, target_ref_id, use_yn);

COMMIT;
