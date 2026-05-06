-- ============================================================================
-- 2026-05-06  핵심 도메인 테이블에 prjct_id FK + ON DELETE CASCADE 추가
--
-- 배경:
--   보안 점검 중 다음 6개 핵심 도메인 테이블이 prjct_id 컬럼은 있으나
--   tb_pj_project 와 FK 관계가 없어, 프로젝트 삭제 시 고아 데이터가 영구
--   잔존하는 위험이 있음을 발견.
--
--   읽기 격리는 API 가드로 작동 중 — 데이터 노출 위험은 없음.
--   본 마이그레이션은 데이터 정합성·정리 자동화 목적.
--
-- 사전 조건 검증 완료(2026-05-06):
--   6개 테이블 모두 orphan 행 0건 — ALTER ADD CONSTRAINT 가 안전하게 통과.
--
-- 적용 후 효과:
--   prisma.tbPjProject.delete({ where: { prjct_id } }) 호출 시
--   아래 6개 테이블 + 그 자식 테이블이 자동으로 함께 정리됨.
--
-- 주의:
--   tb_pj_project_member 등은 이미 별도 FK 가 걸려 있어 본 마이그레이션 대상이 아님.
--   tb_ds_design_change / tb_ai_task / tb_cm_attach_file 등 추가 8개 테이블은
--   P2 로 분리 (다음 작업).
-- ============================================================================

BEGIN;

-- ① tb_ds_unit_work — 요구사항 → 단위업무 체인의 시작점
ALTER TABLE public.tb_ds_unit_work
  ADD CONSTRAINT tb_ds_unit_work_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

-- ② tb_ds_screen — 단위업무 → 화면
ALTER TABLE public.tb_ds_screen
  ADD CONSTRAINT tb_ds_screen_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

-- ③ tb_ds_area — 화면 → 영역
ALTER TABLE public.tb_ds_area
  ADD CONSTRAINT tb_ds_area_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

-- ④ tb_ds_function — 영역 → 기능
ALTER TABLE public.tb_ds_function
  ADD CONSTRAINT tb_ds_function_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

-- ⑤ tb_rq_task — 과업
ALTER TABLE public.tb_rq_task
  ADD CONSTRAINT tb_rq_task_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

-- ⑥ tb_rq_requirement — 요구사항
ALTER TABLE public.tb_rq_requirement
  ADD CONSTRAINT tb_rq_requirement_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

COMMIT;
