-- ============================================================================
-- 2026-05-05  reference_info → standard_info 리네임
--
-- 배경:
--   테이블/컬럼 prefix는 ref_*(reference)로 만들어졌으나 화면 라벨은 "기준 정보"
--   였음. 영문(reference="참조")과 한글("기준") 의미 미스매치를 정리하기 위해
--   테이블/컬럼명을 standard_*/std_* 로 통일.
--
-- 영향 범위:
--   - 이 테이블은 다른 도메인 테이블과 FK 없음(독립 lookup)
--   - 사용처: reference-info 화면 한 세트만 (API 2개 + page 1개)
--   - 데이터 4건 (대부분 테스트용) → ALTER 만으로 충분 (CTAS 불필요)
--
-- 주의:
--   - PostgreSQL 의 ALTER TABLE ... RENAME 은 트랜잭션 안에서 안전.
--   - PK/Unique 제약 이름도 함께 갱신해서 향후 마이그레이션에서 혼동 방지.
-- ============================================================================

BEGIN;

-- ① 테이블 rename
ALTER TABLE public.tb_cm_reference_info
  RENAME TO tb_cm_standard_info;

-- ② PK 제약 이름 정리 (자동 생성된 이름이지만 명시적으로 갱신)
ALTER TABLE public.tb_cm_standard_info
  RENAME CONSTRAINT tb_cm_reference_info_pkey TO tb_cm_standard_info_pkey;

-- ③ 컬럼 rename — ref_* → std_*
ALTER TABLE public.tb_cm_standard_info RENAME COLUMN ref_info_id      TO std_info_id;
ALTER TABLE public.tb_cm_standard_info RENAME COLUMN ref_info_code    TO std_info_code;
ALTER TABLE public.tb_cm_standard_info RENAME COLUMN ref_bgng_de      TO std_bgng_de;
ALTER TABLE public.tb_cm_standard_info RENAME COLUMN ref_end_de       TO std_end_de;
ALTER TABLE public.tb_cm_standard_info RENAME COLUMN ref_info_nm      TO std_info_nm;
ALTER TABLE public.tb_cm_standard_info RENAME COLUMN ref_data_ty_code TO std_data_ty_code;
ALTER TABLE public.tb_cm_standard_info RENAME COLUMN main_ref_val     TO main_std_val;
ALTER TABLE public.tb_cm_standard_info RENAME COLUMN sub_ref_val      TO sub_std_val;
ALTER TABLE public.tb_cm_standard_info RENAME COLUMN ref_info_dc      TO std_info_dc;

-- ④ 유니크 인덱스 rename
ALTER INDEX public.tb_cm_reference_info_ref_info_code_ref_bgng_de_key
  RENAME TO tb_cm_standard_info_std_info_code_std_bgng_de_key;

COMMIT;
