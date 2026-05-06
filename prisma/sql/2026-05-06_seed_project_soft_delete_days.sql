-- ============================================================================
-- 2026-05-06  소프트 삭제 보관기간 기본값 시드
--
-- 배경:
--   tb_pj_project 에 soft delete 가 도입되면서, "OWNER 가 삭제 요청 후 며칠
--   동안 보관할지" 를 운영자가 조정할 수 있어야 한다.
--
--   PROJECT_SOFT_DELETE_DAYS = 기본 14일.
--   배치(project-hard-delete) 는 이 값을 읽어 hard_del_dt 임계 비교에 사용.
--
-- 멱등: ON CONFLICT (config_key) DO NOTHING — 재실행 안전.
-- ============================================================================

BEGIN;

INSERT INTO tb_sys_config_template
  (sys_tmpl_id, config_group, config_key, config_label, config_dc,
   value_type, default_value, select_options, sort_ordr, use_yn)
VALUES
  -- 프로젝트 소프트 삭제 보관기간 (일)
  -- OWNER 가 삭제 요청 후 N일 동안 hard delete 를 보류한다.
  -- 이 기간 동안 OWNER 는 복구 가능, SUPER_ADMIN 은 항상 조회 가능.
  ('22222222-2222-2222-2222-000000000010',
   '운영',
   'PROJECT_SOFT_DELETE_DAYS',
   '프로젝트 소프트 삭제 보관기간 (일)',
   'OWNER 가 프로젝트 삭제를 요청한 뒤, 실제 hard delete 가 이뤄지기까지 보관할 일수입니다. 이 기간 동안 OWNER 는 복구할 수 있습니다.',
   'NUMBER', '14', NULL, 100, 'Y')
ON CONFLICT (config_key) DO NOTHING;

COMMIT;
