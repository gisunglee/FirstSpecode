-- ================================================================
-- 시스템 환경설정 템플릿 기본 시드 — tb_sys_config_template
--   작성일 : 2026-04-24
--   범위   : 현재 화면(스펙설정 → 환경설정)에서 확인된 2건을 시드로 등록.
--              - UNIQUE_CODE_USE_YN (프로젝트 유일 코드 사용 여부)
--              - CODE_DEL_PSBL_YN  (코드 삭제 가능 여부)
--            둘 다 그룹 '설계', BOOLEAN, 기본값 'Y'.
--
--   UUID 네임스페이스: 22222222-... (설계 양식 seed 11111111-... 와 분리)
--
--   실행 방법:
--     psql ... < 2026-04-24_seed_tb_sys_config_template.sql
--
--   멱등: ON CONFLICT (config_key) DO NOTHING — 재실행 안전.
-- ================================================================

BEGIN;

INSERT INTO tb_sys_config_template
  (sys_tmpl_id, config_group, config_key, config_label, config_dc,
   value_type, default_value, select_options, sort_ordr, use_yn)
VALUES
  -- 프로젝트 유일 코드 사용 여부 — 동일 코드의 중복 입력 차단
  ('22222222-2222-2222-2222-000000000001',
   '설계',
   'UNIQUE_CODE_USE_YN',
   '프로젝트 유일 코드 사용 여부',
   '동일 코드의 중복 입력을 차단합니다. ON 이면 프로젝트 내에서 동일 코드 재사용이 불가합니다.',
   'BOOLEAN', 'Y', NULL, 10, 'Y'),

  -- 코드 삭제 가능 여부 — 참조 없는 코드의 삭제 허용
  ('22222222-2222-2222-2222-000000000002',
   '설계',
   'CODE_DEL_PSBL_YN',
   '코드 삭제 가능 여부',
   '참조 없는 코드의 삭제를 허용합니다. OFF 면 삭제 대신 비활성(use_yn=N) 만 가능합니다.',
   'BOOLEAN', 'Y', NULL, 20, 'Y')
ON CONFLICT (config_key) DO NOTHING;

COMMIT;


-- ================================================================
-- [ROLLBACK] — 시드 2건 제거 (이미 프로젝트에 복사된 설정값은 보존됨)
-- ================================================================
-- BEGIN;
-- DELETE FROM tb_sys_config_template
--  WHERE config_key IN ('UNIQUE_CODE_USE_YN', 'CODE_DEL_PSBL_YN');
-- COMMIT;
