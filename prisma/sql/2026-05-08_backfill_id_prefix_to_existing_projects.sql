-- ============================================================================
-- 2026-05-08  기존 프로젝트에 ID prefix 환경설정 backfill
--
-- 배경:
--   2026-05-08_seed_id_prefix_config.sql 에서 tb_sys_config_template 에 7개
--   prefix 항목을 추가했다.
--   신규 프로젝트는 생성 시점에 sys_template → tb_pj_project_config 로 자동
--   복사되지만, 이 마이그레이션 이전에 만들어진 기존 프로젝트는 비어 있다.
--   각 기존 프로젝트의 tb_pj_project_config 에 7개 항목을 default_value 그대로
--   채워 넣어, 환경설정 페이지에서 즉시 보이도록 한다.
--
--   default_value 가 기존 하드코딩 prefix 와 동일하므로 채번 동작은 변하지 않는다.
--
-- 멱등: ON CONFLICT (prjct_id, config_key) DO NOTHING — 재실행 안전.
-- ============================================================================

BEGIN;

-- 시스템 표준 ID_PREFIX 항목 7개를, 모든 기존 프로젝트에 일괄 복사.
INSERT INTO tb_pj_project_config
  (config_id, prjct_id, config_group, config_key, config_value, config_label,
   config_dc, value_type, default_value, select_options, sort_ordr)
SELECT
  gen_random_uuid(),
  p.prjct_id,
  t.config_group,
  t.config_key,
  t.default_value,        -- 신규 프로젝트와 동일하게 default 값으로 채움
  t.config_label,
  t.config_dc,
  t.value_type,
  t.default_value,
  t.select_options,
  t.sort_ordr
FROM tb_pj_project p
CROSS JOIN tb_sys_config_template t
WHERE t.config_group = 'ID_PREFIX'
  AND t.use_yn = 'Y'
ON CONFLICT (prjct_id, config_key) DO NOTHING;

COMMIT;
