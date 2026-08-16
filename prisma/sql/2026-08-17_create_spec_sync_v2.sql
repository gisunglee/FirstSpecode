-- ============================================================================
-- 2026-08-17  구현-설계 동기화 V2 (UW-00036)
--
-- 실행 결과와 항목별 사람 결정을 저장한다.
-- source baseline, Git provider, Diff, fingerprint와 source link는 저장하지 않는다.
-- V2 테이블을 먼저 만든 뒤 이 기능의 V1 전용 테이블과 대기 AI task를 제거한다.
-- 구현요청 snapshot(tb_sp_impl_snapshot)과 공통 설계 이력은 유지한다.
-- ============================================================================

BEGIN;

CREATE TABLE public.tb_sp_sync_run (
  sync_run_id                   text         NOT NULL DEFAULT gen_random_uuid()::text,
  prjct_id                      text         NOT NULL,
  unit_work_id                  text,
  unit_work_display_id          varchar(50)  NOT NULL,
  unit_work_nm                  varchar(500) NOT NULL,
  client_submission_key         varchar(100),
  sync_mode_code                varchar(20)  NOT NULL,
  sync_sttus_code               varchar(30)  NOT NULL DEFAULT 'RUNNING',
  design_snapshot_data          jsonb        NOT NULL,
  design_snapshot_hash          char(64)     NOT NULL,
  source_scope_data             jsonb,
  analysis_summary_data         jsonb,
  implementation_verdict_code   varchar(20),
  design_coverage_verdict_code  varchar(30),
  failure_cn                    text,
  req_mber_id                   text,
  analyzed_dt                   timestamp,
  compl_dt                      timestamp,
  creat_dt                      timestamp    NOT NULL DEFAULT now(),
  mdfcn_dt                      timestamp    NOT NULL DEFAULT now(),
  CONSTRAINT tb_sp_sync_run_pk PRIMARY KEY (sync_run_id),
  CONSTRAINT tb_sp_sync_run_prjct_fk
    FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE,
  CONSTRAINT tb_sp_sync_run_unit_work_fk
    FOREIGN KEY (unit_work_id) REFERENCES public.tb_ds_unit_work(unit_work_id) ON DELETE SET NULL,
  CONSTRAINT tb_sp_sync_run_mode_ck
    CHECK (sync_mode_code IN ('CHECK', 'DEEP_SYNC')),
  CONSTRAINT tb_sp_sync_run_sttus_ck
    CHECK (sync_sttus_code IN (
      'RUNNING', 'NEEDS_INPUT', 'NEEDS_REVIEW', 'COMPLETED', 'FAILED', 'CANCELLED'
    )),
  CONSTRAINT tb_sp_sync_run_impl_verdict_ck
    CHECK (
      implementation_verdict_code IS NULL
      OR implementation_verdict_code IN ('PASS', 'FAIL', 'UNKNOWN')
    ),
  CONSTRAINT tb_sp_sync_run_coverage_verdict_ck
    CHECK (
      design_coverage_verdict_code IS NULL
      OR design_coverage_verdict_code IN ('CLEAR', 'GAP_CANDIDATE', 'UNKNOWN')
    ),
  CONSTRAINT tb_sp_sync_run_snapshot_ck
    CHECK (jsonb_typeof(design_snapshot_data) = 'object'),
  CONSTRAINT tb_sp_sync_run_snapshot_hash_ck
    CHECK (design_snapshot_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tb_sp_sync_run_submission_uk
    UNIQUE (prjct_id, client_submission_key)
);

CREATE INDEX tb_sp_sync_run_prjct_dt_idx
  ON public.tb_sp_sync_run (prjct_id, creat_dt DESC);
CREATE INDEX tb_sp_sync_run_uw_dt_idx
  ON public.tb_sp_sync_run (prjct_id, unit_work_display_id, creat_dt DESC);
CREATE INDEX tb_sp_sync_run_sttus_idx
  ON public.tb_sp_sync_run (prjct_id, sync_sttus_code, creat_dt DESC);

CREATE TABLE public.tb_sp_sync_item (
  sync_item_id          text         NOT NULL DEFAULT gen_random_uuid()::text,
  sync_run_id           text         NOT NULL,
  finding_ty_code       varchar(30)  NOT NULL,
  result_code           varchar(40)  NOT NULL,
  importance_code       varchar(20)  NOT NULL,
  target_ref_ty_code    varchar(20),
  target_ref_id         text,
  target_field_nm       varchar(50),
  target_display_id     varchar(50),
  target_nm             varchar(500),
  design_statement_cn   text,
  source_fact_cn        text,
  reason_cn             text         NOT NULL,
  source_evidence_data  jsonb        NOT NULL DEFAULT '[]'::jsonb,
  confidence_code       varchar(20)  NOT NULL,
  before_value_cn       text,
  before_hash           char(64),
  proposed_value_cn     text,
  item_sttus_code       varchar(30)  NOT NULL DEFAULT 'INFORMATIONAL',
  decision_code         varchar(20),
  decision_rsn_cn       text,
  decision_mber_id      text,
  decision_dt           timestamp,
  design_change_id      text,
  creat_dt              timestamp    NOT NULL DEFAULT now(),
  mdfcn_dt              timestamp    NOT NULL DEFAULT now(),
  CONSTRAINT tb_sp_sync_item_pk PRIMARY KEY (sync_item_id),
  CONSTRAINT tb_sp_sync_item_run_fk
    FOREIGN KEY (sync_run_id) REFERENCES public.tb_sp_sync_run(sync_run_id) ON DELETE CASCADE,
  CONSTRAINT tb_sp_sync_item_design_change_fk
    FOREIGN KEY (design_change_id) REFERENCES public.tb_ds_design_change(chg_id) ON DELETE SET NULL,
  CONSTRAINT tb_sp_sync_item_design_change_uk UNIQUE (design_change_id),
  CONSTRAINT tb_sp_sync_item_finding_ck
    CHECK (finding_ty_code IN ('IMPLEMENTATION', 'DESIGN_COVERAGE')),
  CONSTRAINT tb_sp_sync_item_result_ck
    CHECK (result_code IN (
      'MATCH', 'MISMATCH', 'NOT_IMPLEMENTED', 'UNKNOWN',
      'IMPORTANT_GAP_CANDIDATE', 'GAP_CANDIDATE', 'STRUCTURE_GAP',
      'IMPLEMENTATION_DETAIL', 'OUT_OF_SCOPE'
    )),
  CONSTRAINT tb_sp_sync_item_importance_ck
    CHECK (importance_code IN ('CRITICAL', 'HIGH', 'NORMAL', 'DETAIL')),
  CONSTRAINT tb_sp_sync_item_confidence_ck
    CHECK (confidence_code IN ('LOW', 'MEDIUM', 'HIGH')),
  CONSTRAINT tb_sp_sync_item_sttus_ck
    CHECK (item_sttus_code IN (
      'INFORMATIONAL', 'PENDING', 'APPLIED', 'REJECTED', 'DEFERRED', 'DESIGN_CHANGED'
    )),
  CONSTRAINT tb_sp_sync_item_decision_ck
    CHECK (decision_code IS NULL OR decision_code IN ('APPLY', 'REJECT', 'DEFER')),
  CONSTRAINT tb_sp_sync_item_result_axis_ck
    CHECK (
      (finding_ty_code = 'IMPLEMENTATION'
        AND result_code IN ('MATCH', 'MISMATCH', 'NOT_IMPLEMENTED', 'UNKNOWN'))
      OR
      (finding_ty_code = 'DESIGN_COVERAGE'
        AND result_code IN (
          'IMPORTANT_GAP_CANDIDATE', 'GAP_CANDIDATE', 'STRUCTURE_GAP',
          'IMPLEMENTATION_DETAIL', 'OUT_OF_SCOPE', 'UNKNOWN'
        ))
    ),
  CONSTRAINT tb_sp_sync_item_target_shape_ck
    CHECK (
      (target_ref_ty_code IS NULL AND target_ref_id IS NULL AND target_field_nm IS NULL)
      OR
      (target_ref_ty_code IS NOT NULL AND target_ref_id IS NOT NULL AND target_field_nm IS NOT NULL)
    ),
  CONSTRAINT tb_sp_sync_item_axis_target_ck
    CHECK (
      finding_ty_code = 'DESIGN_COVERAGE'
      OR (
        finding_ty_code = 'IMPLEMENTATION'
        AND target_ref_ty_code IS NOT NULL
        AND target_ref_id IS NOT NULL
        AND target_field_nm IS NOT NULL
      )
    ),
  CONSTRAINT tb_sp_sync_item_evidence_ck
    CHECK (jsonb_typeof(source_evidence_data) = 'array'),
  CONSTRAINT tb_sp_sync_item_proposal_shape_ck
    CHECK (
      (before_value_cn IS NULL AND before_hash IS NULL AND proposed_value_cn IS NULL)
      OR
      (
        before_value_cn IS NOT NULL
        AND before_hash IS NOT NULL
        AND proposed_value_cn IS NOT NULL
        AND target_ref_ty_code IS NOT NULL
      )
    ),
  CONSTRAINT tb_sp_sync_item_target_field_ck
    CHECK (
      target_ref_ty_code IS NULL
      OR (target_ref_ty_code = 'UNIT_WORK' AND target_field_nm = 'unit_work_dc')
      OR (target_ref_ty_code = 'SCREEN' AND target_field_nm = 'scrn_dc')
      OR (target_ref_ty_code = 'AREA' AND target_field_nm = 'area_dc')
      OR (target_ref_ty_code = 'FUNCTION' AND target_field_nm = 'func_dc')
    ),
  CONSTRAINT tb_sp_sync_item_before_hash_ck
    CHECK (before_hash IS NULL OR before_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tb_sp_sync_item_proposal_result_ck
    CHECK (
      proposed_value_cn IS NULL
      OR (finding_ty_code = 'IMPLEMENTATION' AND result_code = 'MISMATCH')
      OR (
        finding_ty_code = 'DESIGN_COVERAGE'
        AND result_code IN ('IMPORTANT_GAP_CANDIDATE', 'GAP_CANDIDATE')
      )
    ),
  CONSTRAINT tb_sp_sync_item_decision_state_ck
    CHECK (
      (
        item_sttus_code = 'APPLIED'
        AND decision_code = 'APPLY'
        AND design_change_id IS NOT NULL
        AND decision_mber_id IS NOT NULL
        AND decision_dt IS NOT NULL
      )
      OR (
        item_sttus_code IN ('REJECTED', 'DEFERRED')
        AND decision_code = CASE
          WHEN item_sttus_code = 'REJECTED' THEN 'REJECT'
          ELSE 'DEFER'
        END
        AND decision_rsn_cn IS NOT NULL
        AND length(trim(decision_rsn_cn)) > 0
        AND decision_mber_id IS NOT NULL
        AND decision_dt IS NOT NULL
        AND design_change_id IS NULL
      )
      OR (
        item_sttus_code IN ('INFORMATIONAL', 'PENDING')
        AND decision_code IS NULL
        AND decision_mber_id IS NULL
        AND decision_dt IS NULL
        AND design_change_id IS NULL
      )
      OR (
        item_sttus_code = 'DESIGN_CHANGED'
        AND decision_code IS NULL
        AND decision_mber_id IS NOT NULL
        AND decision_dt IS NOT NULL
        AND design_change_id IS NULL
      )
    )
);

CREATE INDEX tb_sp_sync_item_run_sttus_idx
  ON public.tb_sp_sync_item (sync_run_id, item_sttus_code);
CREATE INDEX tb_sp_sync_item_target_idx
  ON public.tb_sp_sync_item (target_ref_ty_code, target_ref_id);

-- V1 정합성 전용 AI 작업은 대응 코드와 테이블이 함께 제거되므로 남기지 않는다.
DELETE FROM public.tb_ai_task
WHERE ref_ty_code IN (
  'SPEC_RECONCILIATION',
  'SPEC_RECONCILIATION_ROUTER',
  'SPEC_RECONCILIATION_BATCH'
);

-- V1에서만 사용한 프로젝트/시스템 설정도 런타임 코드와 함께 제거한다.
DELETE FROM public.tb_pj_project_config
WHERE config_key IN (
  'SPEC_RECONCILE_GATE_POLICY',
  'SPEC_RECONCILE_DIFF_RETENTION_DAYS',
  'SPEC_RECONCILE_BLOCK_RISKS'
);

DELETE FROM public.tb_sys_config_template
WHERE config_key IN (
  'SPEC_RECONCILE_GATE_POLICY',
  'SPEC_RECONCILE_DIFF_RETENTION_DAYS',
  'SPEC_RECONCILE_BLOCK_RISKS'
);

DROP TABLE IF EXISTS public.tb_sp_reconcile_item;
DROP TABLE IF EXISTS public.tb_sp_reconcile_batch;
DROP TABLE IF EXISTS public.tb_sp_impl_receipt;
DROP TABLE IF EXISTS public.tb_sp_spec_source_link;
DROP TABLE IF EXISTS public.tb_sp_source_baseline;
DROP TABLE IF EXISTS public.tb_sp_source_repository;

COMMIT;
