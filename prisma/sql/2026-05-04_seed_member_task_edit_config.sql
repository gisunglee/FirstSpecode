-- ================================================================
-- 시스템 환경설정 템플릿 추가 — MEMBER_TASK_UPT_PSBL_YN
--   작성일 : 2026-05-04
--   목적   : 멤버(MEMBER) 역할이 과업을 등록/수정/삭제할 수 있는지 토글.
--            기본값 'N' — OWNER/ADMIN 또는 PM/PL 직무만 과업 편집 가능.
--            'Y' 로 바꾸면 MEMBER 도 자유롭게 과업 편집 가능.
--
--   적용 범위:
--     - POST   /api/projects/{id}/tasks
--     - PUT    /api/projects/{id}/tasks/{taskId}
--     - DELETE /api/projects/{id}/tasks/{taskId}
--     - PUT    /api/projects/{id}/tasks/sort
--     - POST   /api/projects/{id}/tasks/{taskId}/copy
--
--   기본값이 'N' 이므로 프로젝트 생성 시 자동 복사되지 않는다
--   (POST /api/projects 의 default_value='Y' 필터). 운영자가 필요하면
--   환경설정 페이지에서 "+ 설정 추가" 또는 admin/config-templates 의
--   기본값을 'Y' 로 바꿔서 신규 프로젝트에 자동 주입할 수 있다.
--
--   기존 프로젝트에는 자동 반영되지 않으므로, 필요한 프로젝트별로 환경설정
--   페이지에서 직접 설정을 추가/수정해야 한다.
--
--   UUID 네임스페이스: 22222222-... (다른 sys_config_template 시드와 동일)
--
--   실행 방법:
--     psql ... < 2026-05-04_seed_member_task_edit_config.sql
--
--   멱등: ON CONFLICT (config_key) DO NOTHING — 재실행 안전.
-- ================================================================

BEGIN;

INSERT INTO tb_sys_config_template
  (sys_tmpl_id, config_group, config_key, config_label, config_dc,
   value_type, default_value, select_options, sort_ordr, use_yn)
VALUES
  ('22222222-2222-2222-2222-000000000003',
   '권한',
   'MEMBER_TASK_UPT_PSBL_YN',
   '멤버 과업 수정 가능 여부',
   'OFF: OWNER/ADMIN 또는 PM/PL 직무만 과업 등록·수정·삭제 가능. ON: 멤버(MEMBER)도 과업을 자유롭게 편집할 수 있습니다.',
   'BOOLEAN', 'N', NULL, 10, 'Y')
ON CONFLICT (config_key) DO NOTHING;

COMMIT;


-- ================================================================
-- [ROLLBACK] — 시드 제거 (이미 프로젝트에 복사된 설정값은 보존됨)
-- ================================================================
-- BEGIN;
-- DELETE FROM tb_sys_config_template
--  WHERE config_key = 'MEMBER_TASK_UPT_PSBL_YN';
-- COMMIT;
