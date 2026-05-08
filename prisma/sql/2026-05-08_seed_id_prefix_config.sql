-- ============================================================================
-- 2026-05-08  표시 ID prefix 환경설정 시드
--
-- 배경:
--   요구사항/스토리/과업/단위업무/화면/영역/기능 의 displayId 채번 시
--   사용되던 prefix(REQ, STR, SFR, UW, SCR, AR, FN) 가 API route 에 하드코딩되어 있었음.
--   프로젝트별로 prefix 를 자유롭게 변경할 수 있도록 환경설정 인프라
--   (tb_sys_config_template / tb_pj_project_config) 에 항목을 추가한다.
--
--   - 신규 프로젝트는 생성 시 sys_template 에서 자동 복사됨.
--   - 기존 프로젝트는 별도 backfill 마이그레이션(PR 4)에서 채워 넣을 예정.
--   - 정책: 변경 자체는 자유. 단 이미 채번된 displayId 가 있을 경우
--           기존 ID 와 새 ID 가 섞이게 되므로 UI 에서 경고 안내. (서버 잠금 X)
--
-- 멱등: ON CONFLICT (config_key) DO NOTHING — 재실행 안전.
-- ============================================================================

BEGIN;

INSERT INTO tb_sys_config_template
  (sys_tmpl_id, config_group, config_key, config_label, config_dc,
   value_type, default_value, select_options, sort_ordr, use_yn)
VALUES
  ('33333333-3333-3333-3333-000000000001',
   'ID_PREFIX',
   'PREFIX_REQUIREMENT',
   '요구사항 표시 ID prefix',
   '요구사항 displayId 채번 시 사용되는 prefix 입니다. 예: REQ → REQ-00001',
   'TEXT', 'REQ', NULL, 10, 'Y'),

  ('33333333-3333-3333-3333-000000000002',
   'ID_PREFIX',
   'PREFIX_USER_STORY',
   '사용자 스토리 표시 ID prefix',
   '사용자 스토리 displayId 채번 시 사용되는 prefix 입니다. 예: STR → STR-00001',
   'TEXT', 'STR', NULL, 20, 'Y'),

  ('33333333-3333-3333-3333-000000000003',
   'ID_PREFIX',
   'PREFIX_TASK',
   '과업 표시 ID prefix',
   '과업(SFR) displayId 채번 시 사용되는 prefix 입니다. 예: SFR → SFR-00001',
   'TEXT', 'SFR', NULL, 30, 'Y'),

  ('33333333-3333-3333-3333-000000000004',
   'ID_PREFIX',
   'PREFIX_UNIT_WORK',
   '단위업무 표시 ID prefix',
   '단위업무 displayId 채번 시 사용되는 prefix 입니다. 예: UW → UW-00001',
   'TEXT', 'UW', NULL, 40, 'Y'),

  ('33333333-3333-3333-3333-000000000005',
   'ID_PREFIX',
   'PREFIX_SCREEN',
   '화면 표시 ID prefix',
   '화면 displayId 채번 시 사용되는 prefix 입니다. 예: SCR → SCR-00001',
   'TEXT', 'SCR', NULL, 50, 'Y'),

  ('33333333-3333-3333-3333-000000000006',
   'ID_PREFIX',
   'PREFIX_AREA',
   '영역 표시 ID prefix',
   '영역 displayId 채번 시 사용되는 prefix 입니다. 예: AR → AR-00001',
   'TEXT', 'AR', NULL, 60, 'Y'),

  ('33333333-3333-3333-3333-000000000007',
   'ID_PREFIX',
   'PREFIX_FUNCTION',
   '기능 표시 ID prefix',
   '기능 displayId 채번 시 사용되는 prefix 입니다. 예: FN → FN-00001',
   'TEXT', 'FN', NULL, 70, 'Y')
ON CONFLICT (config_key) DO NOTHING;

COMMIT;
