-- ================================================================
-- 프롬프트 템플릿에 기획실 매트릭스 차원 추가 — tb_ai_prompt_template
--   작성일 : 2026-05-04
--   범위   : 기획실(plan-studio) 산출물 프롬프트를 DB로 통합 관리하기 위해
--            (구분 × 형식) 매트릭스 차원을 두 컬럼으로 추가.
--            기존 사용처(UNIT_WORK/SCREEN/AREA/FUNCTION)는 두 컬럼 모두 NULL.
--
--   배경:
--     - 기획실 AI 태스크는 ref_ty_code='PLAN_STUDIO_ARTF',
--       task_ty_code='PLAN_STUDIO_ARTF_GENERATE' 단일값으로 운영 중.
--     - 산출물 entity(tb_ds_plan_studio_artf)는 (artf_div_code, artf_fmt_code) 로
--       이미 분리돼 있으나, 프롬프트는 .claude/prompts/plan-studio/{div}-{fmt}.md
--       로컬 파일에서 따로 관리되어 운영 채널이 갈라져 있었다.
--     - 프롬프트 관리 화면 한 곳에서 통합 관리하도록 매칭 키를 확장.
--
--   매칭 규칙:
--     - 기획실:    ref_ty_code='PLAN_STUDIO_ARTF' AND task_ty_code='PLAN_STUDIO_ARTF_GENERATE'
--                  AND div_code = ? AND fmt_code = ?
--     - 그 외:     div_code IS NULL AND fmt_code IS NULL  (기존 그대로)
--
--   왜 task_ty_code 에 추가하지 않고 별도 컬럼인가:
--     - task_ty_code 는 "동사"(DESIGN/INSPECT/IMPACT...) 차원.
--       div_code 는 "명사"(IA/JOURNEY/ERD...) 차원으로 의미가 다름.
--     - tb_ds_plan_studio_artf 의 (artf_div_code, artf_fmt_code) 와 1:1 일치시켜
--       매트릭스 표현·쿼리·코드 가독성을 모두 정합화.
--
--   실행 방법:
--     1) 이 파일을 psql 등으로 실행
--     2) `npx prisma generate` 로 클라이언트 재생성
--     3) 이어서 seed 파일(2026-05-04_seed_plan_studio_prompts.sql) 실행 예정
-- ================================================================

BEGIN;

-- 산출물 구분 (IA/JOURNEY/FLOW/MOCKUP/ERD/PROCESS) — 기획실 전용
-- 다른 사용처에서는 NULL.  값 도메인은 tb_ds_plan_studio_artf.artf_div_code 와 동일.
ALTER TABLE tb_ai_prompt_template
  ADD COLUMN IF NOT EXISTS div_code VARCHAR(20) NULL;

-- 출력 형식 (MD/MERMAID/HTML) — 기획실 전용 (현재).
-- 향후 다른 사용처에서 출력 포맷이 필요해질 경우(예: PDF) 그대로 재사용 가능한 직교 차원.
ALTER TABLE tb_ai_prompt_template
  ADD COLUMN IF NOT EXISTS fmt_code VARCHAR(20) NULL;

COMMENT ON COLUMN tb_ai_prompt_template.div_code
  IS '산출물 구분 — PLAN_STUDIO_ARTF 전용 (IA/JOURNEY/FLOW/MOCKUP/ERD/PROCESS). 그 외 사용처는 NULL.';
COMMENT ON COLUMN tb_ai_prompt_template.fmt_code
  IS '출력 형식 — PLAN_STUDIO_ARTF 전용 (MD/MERMAID/HTML). 그 외 사용처는 NULL.';

-- 매트릭스 매칭 핫패스 인덱스
-- 기획실 산출물 생성 시점에 (ref_ty_code, task_ty_code, div_code, fmt_code) 4컬럼 EQ 매칭 발생.
-- 부분 인덱스(WHERE) 가 효율적이지만 Prisma schema 가 부분 인덱스 표현 불가 →
-- `db push` 동기화 시 schema 와 차이가 생기므로 일반 인덱스로 통일.
CREATE INDEX IF NOT EXISTS idx_ai_tmpl_plan_studio
  ON tb_ai_prompt_template (ref_ty_code, task_ty_code, div_code, fmt_code);

COMMIT;


-- ================================================================
-- [ROLLBACK] — 컬럼·인덱스 제거 (기획실 매트릭스 데이터 손실)
-- ================================================================
-- BEGIN;
-- DROP INDEX IF EXISTS idx_ai_tmpl_plan_studio;
-- ALTER TABLE tb_ai_prompt_template DROP COLUMN IF EXISTS fmt_code;
-- ALTER TABLE tb_ai_prompt_template DROP COLUMN IF EXISTS div_code;
-- COMMIT;
