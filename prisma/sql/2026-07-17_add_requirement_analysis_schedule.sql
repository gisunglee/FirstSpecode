-- ============================================================================
-- 2026-07-17  tb_rq_requirement 에 분석 일정/진척률 컬럼 추가
--
-- 배경:
--   프로젝트 설정에 단계별(분석/설계/구현/테스트) 전체 기간을 추가한 데 이어,
--   "분석 단계는 무엇으로 관리할까"를 요구사항(TbRqRequirement) 레벨로 결정했다.
--   설계가 화면(tb_ds_screen.design_bgng_de/design_end_de), 구현이 기능
--   (tb_ds_function.impl_bgng_de/impl_end_de) 레벨에서 일정을 갖는 것과 동일하게,
--   분석은 요구사항 레벨에서 일정을 갖는다. 담당자(asign_mber_id)는 이미 존재.
--
--   진척률(progrs_rt)도 tb_ds_unit_work.progrs_rt 와 동일한 패턴 — 별도
--   tb_cm_progress(다형 참조) 대신 단일 소유 컬럼으로 직접 관리한다
--   (요구사항은 단일 단계라 tb_cm_progress 의 다단계 다형 구조가 불필요).
-- ============================================================================

BEGIN;

ALTER TABLE public.tb_rq_requirement
  ADD COLUMN anls_bgng_de text    NULL,
  ADD COLUMN anls_end_de  text    NULL,
  ADD COLUMN progrs_rt    integer NOT NULL DEFAULT 0;

COMMIT;
