-- ============================================================================
-- 2026-05-06  핫픽스: prjct_id FK 3개에 CASCADE 누락 보강
--
-- 배경:
--   P1/P2 마이그레이션에서 도메인 테이블 21개에는 ON DELETE CASCADE 를 정리해
--   두었지만, 다음 3개 테이블의 prjct_id FK 가 누락되어 있었다.
--   - tb_pj_project_invitation  : 초대 이력
--   - tb_pj_project_api_key     : 외부 AI provider API 키
--   - tb_pj_settings_history    : 프로젝트 설정 변경 이력
--
--   특히 tb_pj_settings_history 는 프로젝트 PUT(수정) 시마다 행이 누적되므로,
--   "프로젝트 정보를 한 번이라도 수정한 모든 프로젝트"는 DELETE 자체가
--   FK 위반으로 실패했다. 본 마이그레이션이 그 차단을 해소한다.
--
-- 적용:
--   기존 RESTRICT FK 를 DROP → CASCADE FK 로 ADD.
--   제약명은 Prisma 기본명(<table>_<field>_fkey) 으로 가정하되, 환경 차이를
--   대비해 IF EXISTS 로 안전하게 처리.
-- ============================================================================

BEGIN;

-- ─── tb_pj_project_invitation ──────────────────────────────────────────────
ALTER TABLE public.tb_pj_project_invitation
  DROP CONSTRAINT IF EXISTS tb_pj_project_invitation_prjct_id_fkey;

ALTER TABLE public.tb_pj_project_invitation
  ADD CONSTRAINT tb_pj_project_invitation_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

-- ─── tb_pj_project_api_key ─────────────────────────────────────────────────
ALTER TABLE public.tb_pj_project_api_key
  DROP CONSTRAINT IF EXISTS tb_pj_project_api_key_prjct_id_fkey;

ALTER TABLE public.tb_pj_project_api_key
  ADD CONSTRAINT tb_pj_project_api_key_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

-- ─── tb_pj_settings_history ────────────────────────────────────────────────
ALTER TABLE public.tb_pj_settings_history
  DROP CONSTRAINT IF EXISTS tb_pj_settings_history_prjct_id_fkey;

ALTER TABLE public.tb_pj_settings_history
  ADD CONSTRAINT tb_pj_settings_history_prjct_fk
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

COMMIT;
