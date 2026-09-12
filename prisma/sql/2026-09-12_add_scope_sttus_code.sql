-- 설계 5계층 "사업 범위 구분" — 요구사항/단위업무/화면/영역/기능
--
-- 목적:
--   고도화(2차 이상) 사업에서 "이번 사업으로 만든 것"과 "이전 사업 결과물"을
--   산출물 출력·공수 집계에서 갈라내기 위함.
--   tb_ds_db_table.tbl_sttus_code 가 DB 테이블에 대해 이미 쓰던 방식을
--   설계 5계층으로 확장한 것이다.
--
-- 허용값: 'NEW' | 'MODIFIED' | 'EXISTING' | 'DEPRECATED'
--   NEW        — 이번 사업에서 신규 등록
--   MODIFIED   — 이전 사업에 있었고 이번 사업에서 수정
--   EXISTING   — 이전 사업 그대로. 상위 맥락 제공용으로만 등록됨
--   DEPRECATED — 이번 사업에서 걷어냄
--
-- DEFAULT 를 'NEW' 로 두는 이유 (tbl_sttus_code 의 'EXISTING' 과 반대):
--   tbl_sttus_code 는 AS-IS 스키마를 통째로 쓸어담는 도구라 '기존'이 기본이었다.
--   설계 5계층은 반대다 — 평소 등록되는 항목은 이번 사업 산출물이 정상이고,
--   AS-IS 항목만 온보딩 경로에서 EXISTING 을 명시해 넣는다.
--   'EXISTING' 을 기본으로 두면 앞으로 등록하는 설계가 전부 이전 사업분으로
--   찍혀 산출물에서 조용히 빠진다 — 제출 직전에나 발견되는 종류의 사고다.
--
-- 별도 백필 UPDATE 가 없는 이유:
--   PostgreSQL 11+ 는 DEFAULT 가 있는 NOT NULL 컬럼 추가를 "fast default" 로
--   처리한다 — 기존 행을 실제로 쓰지 않고 카탈로그에만 기본값을 기록하므로
--   테이블 재작성(rewrite) 없이 즉시 끝나고, 조회 시 기존 행은 'NEW' 로 읽힌다.
--   현재 등록된 데이터는 전부 이번 사업분이므로 'NEW' 가 곧 정답이다.
--   (이전 사업분 중 이번에 손댄 항목은 AS-IS 등록 과정에서 MODIFIED 로 내린다.)

BEGIN;

ALTER TABLE public.tb_rq_requirement
  ADD COLUMN IF NOT EXISTS scope_sttus_code varchar(10) NOT NULL DEFAULT 'NEW';

ALTER TABLE public.tb_ds_unit_work
  ADD COLUMN IF NOT EXISTS scope_sttus_code varchar(10) NOT NULL DEFAULT 'NEW';

ALTER TABLE public.tb_ds_screen
  ADD COLUMN IF NOT EXISTS scope_sttus_code varchar(10) NOT NULL DEFAULT 'NEW';

ALTER TABLE public.tb_ds_area
  ADD COLUMN IF NOT EXISTS scope_sttus_code varchar(10) NOT NULL DEFAULT 'NEW';

ALTER TABLE public.tb_ds_function
  ADD COLUMN IF NOT EXISTS scope_sttus_code varchar(10) NOT NULL DEFAULT 'NEW';

COMMENT ON COLUMN public.tb_rq_requirement.scope_sttus_code IS '사업 범위 구분 — NEW | MODIFIED | EXISTING | DEPRECATED';
COMMENT ON COLUMN public.tb_ds_unit_work.scope_sttus_code   IS '사업 범위 구분 — NEW | MODIFIED | EXISTING | DEPRECATED';
COMMENT ON COLUMN public.tb_ds_screen.scope_sttus_code      IS '사업 범위 구분 — NEW | MODIFIED | EXISTING | DEPRECATED';
COMMENT ON COLUMN public.tb_ds_area.scope_sttus_code        IS '사업 범위 구분 — NEW | MODIFIED | EXISTING | DEPRECATED';
COMMENT ON COLUMN public.tb_ds_function.scope_sttus_code    IS '사업 범위 구분 — NEW | MODIFIED | EXISTING | DEPRECATED';

-- ── 산출물 출력 범위 (프로젝트 설정) ────────────────────────────────────────
-- ALL    — 전체 출력 (기본). 이전 사업분까지 포함하고 항목마다 구분을 표기한다.
-- SCOPED — 이번 사업분 + 그 상위 계층만.
ALTER TABLE public.tb_pj_project_settings
  ADD COLUMN IF NOT EXISTS artifact_scope_code varchar(10) NOT NULL DEFAULT 'ALL';

COMMENT ON COLUMN public.tb_pj_project_settings.artifact_scope_code IS '산출물 출력 범위 — ALL | SCOPED';

COMMIT;
