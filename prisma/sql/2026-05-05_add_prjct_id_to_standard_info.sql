-- ============================================================================
-- 2026-05-05  tb_cm_standard_info 를 프로젝트 단위로 전환
--
-- 배경:
--   기존에는 전역 lookup 테이블이었으나 프로젝트마다 운영 기준이 다르다는
--   요구가 분명해져 프로젝트 단위로 분리.
--
-- 설계:
--   - prjct_id NOT NULL + FK + ON DELETE CASCADE
--     (프로젝트 삭제 시 해당 기준 정보도 함께 정리)
--   - 유니크 제약을 (std_info_code, std_bgng_de) → (prjct_id, std_info_code, std_bgng_de)
--     로 확장. 이래야 다른 프로젝트가 같은 코드+시작일 조합을 자유롭게 쓸 수 있다.
--   - prjct_id 단독 인덱스 추가 — 목록 조회는 prjct_id 로 필터하므로 핵심 경로.
--
-- 데이터 처리:
--   기존 4건은 모두 테스트 가비지 (3건 del_yn=Y, 1건 "132" 더미) → TRUNCATE.
--   실데이터가 있었다면 NOT NULL DEFAULT 후 backfill → DROP DEFAULT 패턴이 필요.
-- ============================================================================

BEGIN;

-- 테스트 데이터 정리
TRUNCATE TABLE public.tb_cm_standard_info;

-- prjct_id 컬럼 추가 (NOT NULL + FK)
ALTER TABLE public.tb_cm_standard_info
  ADD COLUMN prjct_id text NOT NULL;

ALTER TABLE public.tb_cm_standard_info
  ADD CONSTRAINT tb_cm_standard_info_prjct_id_fkey
  FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE;

-- 기존 글로벌 유니크 → 프로젝트 포함 유니크
ALTER TABLE public.tb_cm_standard_info
  DROP CONSTRAINT IF EXISTS tb_cm_standard_info_std_info_code_std_bgng_de_key;

DROP INDEX IF EXISTS public.tb_cm_standard_info_std_info_code_std_bgng_de_key;

ALTER TABLE public.tb_cm_standard_info
  ADD CONSTRAINT tb_cm_standard_info_prjct_std_code_bgng_key
  UNIQUE (prjct_id, std_info_code, std_bgng_de);

-- 목록 조회 가속용 인덱스 (prjct_id 단독)
CREATE INDEX tb_cm_standard_info_prjct_id_idx
  ON public.tb_cm_standard_info (prjct_id);

COMMIT;
