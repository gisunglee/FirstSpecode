-- ────────────────────────────────────────────────────────────────────────
-- PK constraint 이름 정렬 — schema와 DB의 PK 이름이 어긋나면
-- Prisma 가 RenamePrimaryKey 를 시도하다 다른 변경과 합쳐 SQL syntax error 발생.
-- 모든 변경 대상 테이블의 PK 이름을 schema 정의와 동일하게 맞춘다.
--
-- 데이터 영향: 없음 (이름만 RENAME, 컬럼·제약 동일)
-- ────────────────────────────────────────────────────────────────────────

-- 헬퍼 함수: 테이블의 현재 PK 이름을 원하는 이름으로 RENAME
CREATE OR REPLACE FUNCTION pg_temp.rename_pk(tbl text, target text)
RETURNS void AS $$
DECLARE
  current_name text;
BEGIN
  SELECT conname INTO current_name
  FROM pg_constraint
  WHERE conrelid = tbl::regclass AND contype = 'p';

  IF current_name IS NULL THEN
    RAISE NOTICE 'No PK on %', tbl;
  ELSIF current_name = target THEN
    RAISE NOTICE '% PK already named %', tbl, target;
  ELSE
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', tbl, current_name, target);
    RAISE NOTICE 'Renamed % PK: % -> %', tbl, current_name, target;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ── @id(map:"pk_ai_prompt_template") 같이 명시 매핑된 테이블 ───────────────
SELECT pg_temp.rename_pk('tb_ai_prompt_template', 'pk_ai_prompt_template');
SELECT pg_temp.rename_pk('tb_ai_design_template', 'pk_ai_design_template');

-- ── 기본 이름(<table>_pkey) 사용 — drift 가 의심되는 테이블 ──────────────
SELECT pg_temp.rename_pk('tb_ds_document_release', 'tb_ds_document_release_pkey');
SELECT pg_temp.rename_pk('tb_sg_std_guide',        'tb_sg_std_guide_pkey');
SELECT pg_temp.rename_pk('tb_sys_attach_file',     'tb_sys_attach_file_pkey');
SELECT pg_temp.rename_pk('tb_sys_config_template', 'tb_sys_config_template_pkey');
SELECT pg_temp.rename_pk('tb_sys_docs_page',       'tb_sys_docs_page_pkey');
SELECT pg_temp.rename_pk('tb_sys_docs_section',    'tb_sys_docs_section_pkey');

-- 2026-05-29 추가 — _pk 접미사 사용 중인 두 테이블도 같이 정렬
SELECT pg_temp.rename_pk('tb_cm_batch_job',        'tb_cm_batch_job_pkey');
SELECT pg_temp.rename_pk('tb_cm_batch_job_item',   'tb_cm_batch_job_item_pkey');
