-- ================================================================
-- 시스템 기본 환경설정 템플릿 신규 — tb_sys_config_template
--   작성일 : 2026-04-24
--   범위   : 프로젝트 생성 시 tb_pj_project_config 로 복사될 "원본" 설정.
--            운영자가 이 테이블에만 레코드를 관리해 두면 이후 신규로
--            만들어지는 모든 프로젝트에 자동으로 기본 설정이 채워진다.
--
--   설계 선택:
--     - prjct_id=NULL 방식(프롬프트/설계 양식)은 런타임 OR 병합이라 원본
--       값이 모든 프로젝트에 즉시 영향 → 환경설정에는 부적합.
--     - 여기서는 별도 테이블 + 프로젝트 생성 시점 실제 복사로 프로젝트별
--       독립 진화를 보장한다.
--
--   실행 방법:
--     1) 이 파일 전체를 psql 로 실행
--     2) prisma/schema.prisma 에 TbSysConfigTemplate 모델 반영
--     3) npx prisma db push (no-op 확인) → npx prisma generate
--     4) 이어서 seed 파일(2026-04-24_seed_tb_sys_config_template.sql) 실행
--
--   롤백이 필요하면 이 파일 하단의 [ROLLBACK] 섹션 참조.
-- ================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS tb_sys_config_template (
  sys_tmpl_id    VARCHAR(36)  NOT NULL,
  -- 설정 그룹 — 화면에서 카테고리처럼 묶어 보여줌 (예: '설계', 'AI', '알림')
  config_group   VARCHAR(50)  NOT NULL DEFAULT 'GENERAL',
  -- 설정 구분 키 — 전역 유니크. 프로젝트 설정(tb_pj_project_config.config_key) 와 1:1 매칭
  config_key     VARCHAR(100) NOT NULL,
  config_label   VARCHAR(200) NOT NULL DEFAULT '',
  config_dc      TEXT         NULL,
  -- 값 유형: TEXT | BOOLEAN | SELECT | NUMBER
  -- UI 편집 컴포넌트 분기에 쓰이므로 템플릿이 정답(프로젝트 복사본도 동일 값 유지)
  value_type     VARCHAR(20)  NOT NULL DEFAULT 'TEXT',
  default_value  VARCHAR(500) NOT NULL DEFAULT '',
  -- SELECT 타입일 때 옵션 목록 (예: [{"value":"A","label":"옵션A"},...])
  select_options JSONB        NULL,
  sort_ordr      INTEGER      NOT NULL DEFAULT 0,
  -- 시스템 활성 플래그. N 이면 신규 프로젝트에 복사되지 않음 (단종 설정)
  use_yn         CHAR(1)      NOT NULL DEFAULT 'Y',
  creat_dt       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  mdfcn_dt       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tb_sys_config_template_pkey PRIMARY KEY (sys_tmpl_id)
);

-- config_key 는 전역 유니크 (프로젝트 복사 시 중복 키 충돌 방지)
CREATE UNIQUE INDEX IF NOT EXISTS tb_sys_config_template_key_uk
  ON tb_sys_config_template (config_key);

-- 프로젝트 생성 시 복사 쿼리의 핫패스 — use_yn='Y' 를 group/sort 순으로 조회
CREATE INDEX IF NOT EXISTS tb_sys_config_template_grp_idx
  ON tb_sys_config_template (use_yn, config_group, sort_ordr);

COMMENT ON TABLE  tb_sys_config_template                IS '시스템 기본 환경설정 템플릿 — 프로젝트 생성 시 복사 원본';
COMMENT ON COLUMN tb_sys_config_template.sys_tmpl_id    IS 'PK UUID';
COMMENT ON COLUMN tb_sys_config_template.config_group   IS '설정 그룹 (화면 카테고리)';
COMMENT ON COLUMN tb_sys_config_template.config_key     IS '고유 키 (전역 유니크). tb_pj_project_config.config_key 와 매칭';
COMMENT ON COLUMN tb_sys_config_template.config_label   IS '화면 표시명';
COMMENT ON COLUMN tb_sys_config_template.config_dc      IS '설명';
COMMENT ON COLUMN tb_sys_config_template.value_type     IS 'TEXT|BOOLEAN|SELECT|NUMBER — 편집 UI 분기';
COMMENT ON COLUMN tb_sys_config_template.default_value  IS '프로젝트 생성 시 config_value 로 복사되는 초기값';
COMMENT ON COLUMN tb_sys_config_template.select_options IS 'SELECT 타입일 때 옵션 JSON';
COMMENT ON COLUMN tb_sys_config_template.sort_ordr      IS '정렬 순서 (작을수록 먼저)';
COMMENT ON COLUMN tb_sys_config_template.use_yn         IS '활성여부 Y/N (N 이면 신규 프로젝트 복사 대상에서 제외)';

COMMIT;


-- ================================================================
-- [ROLLBACK] — 테이블 제거 (템플릿 데이터 손실, 기존 프로젝트 설정은 보존)
-- ================================================================
-- BEGIN;
-- DROP TABLE IF EXISTS tb_sys_config_template;
-- COMMIT;
