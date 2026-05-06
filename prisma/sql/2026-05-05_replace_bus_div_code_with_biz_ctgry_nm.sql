-- ============================================================================
-- 2026-05-05  bus_div_code(VARCHAR 6, 코드) → biz_ctgry_nm(VARCHAR 100, 자유 텍스트)
--
-- 배경:
--   기존 bus_div_code 는 AUTH/SYSTEM/PRJCT/USER/AI/ETC 6종 고정 코드였으나,
--   "프로젝트마다 운영 분류 기준이 다르다" 는 요구로 자유 텍스트 카테고리로 전환.
--   예: "회원", "예산서", "결산서", "배치" 등 프로젝트별 자유 입력.
--
--   화면에서는 distinct 자동완성으로 일관성을 보조하고, 색상은 텍스트 해시로
--   결정해 같은 카테고리는 항상 같은 색으로 보이게 한다.
--
-- 명명:
--   - 컬럼명을 biz_ctgry_nm 으로 변경 (기존 tb_ds_screen.ctgry_l_nm 와 패턴 일치).
--   - 코드(_code) → 이름(_nm) 으로 의미가 바뀌었음을 컬럼명에 반영.
--
-- 데이터 처리:
--   현 시점 데이터 0건이지만 향후를 위해 backfill 절차도 포함 (안전망).
-- ============================================================================

BEGIN;

-- ① 새 컬럼 추가 — 기존 행이 있다면 빈 문자열로 일단 채움
ALTER TABLE public.tb_cm_standard_info
  ADD COLUMN biz_ctgry_nm VARCHAR(100) NOT NULL DEFAULT '';

-- ② 기존 코드 → 한글 분류명으로 backfill
UPDATE public.tb_cm_standard_info
SET biz_ctgry_nm = CASE bus_div_code
  WHEN 'AUTH'   THEN '인증'
  WHEN 'SYSTEM' THEN '시스템'
  WHEN 'PRJCT'  THEN '프로젝트'
  WHEN 'USER'   THEN '사용자'
  WHEN 'AI'     THEN 'AI'
  WHEN 'ETC'    THEN '기타'
  ELSE bus_div_code  -- 미정의 코드는 원본 그대로 보존
END;

-- ③ DEFAULT 제거 — 이후 INSERT 는 명시적으로 값을 줘야 함
ALTER TABLE public.tb_cm_standard_info
  ALTER COLUMN biz_ctgry_nm DROP DEFAULT;

-- ④ 옛 컬럼 제거
ALTER TABLE public.tb_cm_standard_info
  DROP COLUMN bus_div_code;

COMMIT;
