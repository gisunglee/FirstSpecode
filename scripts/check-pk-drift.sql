-- 6개 테이블의 현재 PK constraint 이름 + 컬럼 구성 진단
-- 출력 보고 어떻게 어긋나 있는지 파악
SELECT
  c.conrelid::regclass::text AS table_name,
  c.conname                   AS current_pk_name,
  c.conrelid::regclass::text || '_pkey' AS expected_pk_name,
  pg_get_constraintdef(c.oid) AS pk_definition
FROM pg_constraint c
WHERE c.contype = 'p'
  AND c.conrelid::regclass::text IN (
    'tb_ds_document_release',
    'tb_sg_std_guide',
    'tb_sys_attach_file',
    'tb_sys_config_template',
    'tb_sys_docs_page',
    'tb_sys_docs_section'
  )
ORDER BY c.conrelid::regclass::text;
