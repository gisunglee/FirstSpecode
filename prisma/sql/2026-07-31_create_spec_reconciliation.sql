-- ============================================================================
-- 2026-07-31  구현 변경 수집 및 스펙 정합성 확정 (UW-00036)
--
-- 적용 순서:
--   1. 프로젝트·저장소·브랜치별 source baseline
--   2. 구현 변경 receipt
--   3. receipt의 스펙 변경 후보 item
--
-- 안전 규칙:
--   - 같은 ai_task에는 receipt 하나만 허용한다.
--   - receipt 종료 시 baseline version을 낙관적으로 비교한다.
--   - item은 대상 PK·필드·before hash·전체 before/after 값을 보관한다.
-- ============================================================================

BEGIN;

CREATE TABLE public.tb_sp_source_baseline (
  baseline_id                       text         NOT NULL DEFAULT gen_random_uuid()::text,
  prjct_id                          text         NOT NULL,
  repo_key                          varchar(200) NOT NULL,
  repo_provider_code                varchar(30)  NOT NULL DEFAULT 'LOCAL',
  branch_nm                         varchar(200) NOT NULL,
  checkpoint_ty_code                varchar(30)  NOT NULL,
  last_reconciled_commit_sha        varchar(128),
  last_reconciled_manifest_hash     char(64),
  checkpoint_version_no             integer      NOT NULL DEFAULT 0,
  history_audit_code                varchar(30)  NOT NULL DEFAULT 'NOT_AUDITED',
  last_receipt_id                   text,
  reconciled_mber_id                text,
  reconciled_dt                     timestamp,
  checkpoint_metadata_data          jsonb,
  use_yn                            char(1)      NOT NULL DEFAULT 'Y',
  creat_dt                          timestamp    NOT NULL DEFAULT now(),
  mdfcn_dt                          timestamp    NOT NULL DEFAULT now(),
  CONSTRAINT tb_sp_source_baseline_pk PRIMARY KEY (baseline_id),
  CONSTRAINT tb_sp_source_baseline_prjct_fk
    FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE,
  CONSTRAINT tb_sp_source_baseline_scope_uk UNIQUE (prjct_id, repo_key, branch_nm),
  CONSTRAINT tb_sp_source_baseline_checkpoint_ck CHECK (
    (checkpoint_ty_code = 'GIT_COMMIT' AND last_reconciled_commit_sha IS NOT NULL)
    OR
    (checkpoint_ty_code = 'SOURCE_MANIFEST' AND last_reconciled_manifest_hash IS NOT NULL)
  )
);

CREATE INDEX tb_sp_source_baseline_prjct_dt_idx
  ON public.tb_sp_source_baseline (prjct_id, mdfcn_dt DESC);

CREATE TABLE public.tb_sp_source_repository (
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

CREATE INDEX tb_sp_source_repository_provider_idx
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
ON CONFLICT (config_key) DO NOTHING;

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

CREATE TABLE public.tb_sp_impl_receipt (
  receipt_id             text         NOT NULL DEFAULT gen_random_uuid()::text,
  prjct_id               text         NOT NULL,
  origin_ty_code         varchar(30)  NOT NULL DEFAULT 'IMPLEMENTATION',
  client_submission_key  varchar(100),
  parent_receipt_id      text,
  ai_task_id             text,
  baseline_id            text         NOT NULL,
  baseline_version_no    integer      NOT NULL,
  base_checkpoint_val    varchar(128) NOT NULL,
  head_checkpoint_val    varchar(128) NOT NULL,
  checkpoint_ty_code     varchar(30)  NOT NULL,
  source_evidence_data   jsonb        NOT NULL,
  evidence_trust_code    varchar(30)  NOT NULL DEFAULT 'LOCAL_AGENT_ATTESTED',
  evidence_verify_code   varchar(30)  NOT NULL DEFAULT 'ATTESTED',
  ancestry_verify_yn     char(1),
  diff_hash              char(64),
  evidence_verify_data   jsonb,
  override_rsn_cn        text,
  override_mber_id       text,
  pr_url                 text,
  summary_cn             text,
  manifest_data          jsonb,
  selected_target_data   jsonb,
  analysis_scope_data    jsonb,
  risk_summary_data      jsonb,
  review_sttus_code      varchar(30)  NOT NULL DEFAULT 'NEEDS_REVIEW',
  revwr_mber_id          text,
  analysis_version       varchar(50),
  head_stable_yn         char(1)      NOT NULL DEFAULT 'Y',
  receipt_sttus_code     varchar(30)  NOT NULL DEFAULT 'NEEDS_REVIEW',
  submit_mber_id         text,
  close_mber_id          text,
  verified_dt            timestamp,
  close_dt               timestamp,
  creat_dt               timestamp    NOT NULL DEFAULT now(),
  mdfcn_dt               timestamp    NOT NULL DEFAULT now(),
  CONSTRAINT tb_sp_impl_receipt_pk PRIMARY KEY (receipt_id),
  CONSTRAINT tb_sp_impl_receipt_prjct_fk
    FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE,
  CONSTRAINT tb_sp_impl_receipt_ai_task_fk
    FOREIGN KEY (ai_task_id) REFERENCES public.tb_ai_task(ai_task_id) ON DELETE SET NULL,
  CONSTRAINT tb_sp_impl_receipt_baseline_fk
    FOREIGN KEY (baseline_id) REFERENCES public.tb_sp_source_baseline(baseline_id) ON DELETE RESTRICT,
  CONSTRAINT tb_sp_impl_receipt_ai_task_uk UNIQUE (ai_task_id),
  CONSTRAINT tb_sp_impl_receipt_submission_uk UNIQUE (prjct_id, client_submission_key),
  CONSTRAINT tb_sp_impl_receipt_checkpoint_ck CHECK (
    checkpoint_ty_code IN ('GIT_COMMIT', 'SOURCE_MANIFEST')
  )
);

CREATE INDEX tb_sp_impl_receipt_prjct_sttus_idx
  ON public.tb_sp_impl_receipt (prjct_id, receipt_sttus_code, creat_dt DESC);

CREATE INDEX tb_sp_impl_receipt_baseline_ver_idx
  ON public.tb_sp_impl_receipt (baseline_id, baseline_version_no);

CREATE INDEX tb_sp_impl_receipt_parent_idx
  ON public.tb_sp_impl_receipt (parent_receipt_id);

CREATE TABLE public.tb_sp_reconcile_batch (
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

CREATE INDEX tb_sp_reconcile_batch_receipt_sttus_idx
  ON public.tb_sp_reconcile_batch (receipt_id, batch_sttus_code, batch_no);

CREATE INDEX tb_sp_reconcile_batch_prjct_dt_idx
  ON public.tb_sp_reconcile_batch (prjct_id, creat_dt DESC);

CREATE TABLE public.tb_sp_reconcile_item (
  item_id                  text        NOT NULL DEFAULT gen_random_uuid()::text,
  receipt_id               text        NOT NULL,
  classification_code      varchar(30) NOT NULL DEFAULT 'SPEC_CHANGE',
  target_ref_ty_code       varchar(30) NOT NULL,
  target_ref_id            varchar(36) NOT NULL,
  target_field_nm          varchar(50) NOT NULL,
  target_hierarchy_data    jsonb       NOT NULL,
  source_evidence_data     jsonb       NOT NULL,
  source_fact_cn           text        NOT NULL,
  inferred_impact_cn       text,
  before_value_cn          text        NOT NULL,
  proposed_value_cn        text        NOT NULL,
  before_hash              char(64)    NOT NULL,
  risk_code                varchar(20) NOT NULL DEFAULT 'MEDIUM',
  confidence_code          varchar(20) NOT NULL DEFAULT 'MEDIUM',
  item_sttus_code          varchar(30) NOT NULL DEFAULT 'PENDING',
  decision_code            varchar(30),
  decision_rsn_cn          text,
  decision_mber_id         text,
  decision_dt              timestamp,
  design_change_id         text,
  resolution_evidence_data jsonb,
  exception_expire_dt      timestamp,
  exception_owner_mber_id  text,
  followup_task_id          text,
  review_request_id         text,
  merge_preview_cn          text,
  merge_latest_hash         char(64),
  merge_conflict_data       jsonb,
  batch_origin_data         jsonb,
  resolved_dt               timestamp,
  creat_dt                 timestamp   NOT NULL DEFAULT now(),
  mdfcn_dt                 timestamp   NOT NULL DEFAULT now(),
  CONSTRAINT tb_sp_reconcile_item_pk PRIMARY KEY (item_id),
  CONSTRAINT tb_sp_reconcile_item_receipt_fk
    FOREIGN KEY (receipt_id) REFERENCES public.tb_sp_impl_receipt(receipt_id) ON DELETE CASCADE,
  CONSTRAINT tb_sp_reconcile_item_target_field_ck CHECK (
    (target_ref_ty_code = 'UNIT_WORK' AND target_field_nm = 'unit_work_dc')
    OR (target_ref_ty_code = 'SCREEN' AND target_field_nm = 'scrn_dc')
    OR (target_ref_ty_code = 'AREA' AND target_field_nm = 'area_dc')
    OR (target_ref_ty_code = 'FUNCTION' AND target_field_nm = 'func_dc')
  )
);

CREATE INDEX tb_sp_reconcile_item_receipt_sttus_idx
  ON public.tb_sp_reconcile_item (receipt_id, item_sttus_code);

CREATE INDEX tb_sp_reconcile_item_target_idx
  ON public.tb_sp_reconcile_item (target_ref_ty_code, target_ref_id);

CREATE TABLE public.tb_sp_spec_source_link (
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

CREATE INDEX tb_sp_spec_source_link_path_idx
  ON public.tb_sp_spec_source_link (prjct_id, source_path, use_yn);

CREATE INDEX tb_sp_spec_source_link_target_idx
  ON public.tb_sp_spec_source_link (target_ref_ty_code, target_ref_id, use_yn);

COMMIT;
