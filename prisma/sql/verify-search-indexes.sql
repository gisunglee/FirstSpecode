-- 검증용 — 방금 추가한 7개 인덱스가 실제로 존재하는지 확인
SELECT tablename, indexname
FROM pg_indexes
WHERE indexname IN (
  'tb_rq_task_prjct_idx',
  'tb_rq_requirement_prjct_idx',
  'tb_ds_unit_work_prjct_idx',
  'tb_ds_screen_prjct_idx',
  'tb_ds_area_prjct_idx',
  'tb_ds_function_prjct_idx',
  'tb_ds_db_table_prjct_idx'
)
ORDER BY tablename;
