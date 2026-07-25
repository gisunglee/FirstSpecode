-- ============================================================================
-- 2026-07-24  컬럼 매핑에 "그룹" 개념 도입
--
-- 배경:
--   기능(FUNCTION) 컬럼 매핑이 지금까지는 ref_id 하나당 flat한 목록 1개뿐이었다.
--   조회 기능처럼 결과 그룹이 여러 개인 설계(예: "검색 결과 그리드", "요약 카드")를
--   표현하려면 매핑을 이름 붙은 그룹 단위로 여러 세트 가질 수 있어야 한다.
--
--   그룹 이름은 별도 테이블(tb_ds_col_mapping_group)에 저장한다.
--   tb_ds_col_mapping 에 grp_nm을 직접 넣지 않는 이유: 그룹명 변경이 여러 행에
--   걸쳐 중복 저장되면 한꺼번에 업데이트해야 하고 오타로 그룹이 쪼개질 위험이 있음.
--
--   기존 tb_ds_col_mapping 데이터는 테스트 데이터라 백필 없이 전부 삭제하고,
--   grp_id를 처음부터 NOT NULL로 추가한다 (매핑은 반드시 그룹에 속함).
-- ============================================================================

BEGIN;

-- ─── 그룹 테이블 신설 ────────────────────────────────────────────────────────
CREATE TABLE public.tb_ds_col_mapping_group (
  grp_id      text      NOT NULL,
  ref_ty_code text      NOT NULL,
  ref_id      text      NOT NULL,
  grp_nm      text      NOT NULL,
  sort_ordr   integer   NOT NULL DEFAULT 0,
  creat_dt    timestamp NOT NULL DEFAULT now(),
  CONSTRAINT tb_ds_col_mapping_group_pk PRIMARY KEY (grp_id)
);

CREATE INDEX tb_ds_col_mapping_group_ref_idx
  ON public.tb_ds_col_mapping_group (ref_ty_code, ref_id, sort_ordr);

-- ─── 기존 매핑(테스트 데이터) 삭제 후 grp_id 컬럼 추가 ─────────────────────────
DELETE FROM public.tb_ds_col_mapping;

ALTER TABLE public.tb_ds_col_mapping
  ADD COLUMN grp_id text NOT NULL,
  ADD CONSTRAINT tb_ds_col_mapping_grp_fk
    FOREIGN KEY (grp_id) REFERENCES public.tb_ds_col_mapping_group(grp_id)
    ON DELETE CASCADE;

CREATE INDEX tb_ds_col_mapping_grp_idx
  ON public.tb_ds_col_mapping (grp_id);

COMMIT;
