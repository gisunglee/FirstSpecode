-- ========================================================================
-- 전역 검색용 prjct_id 인덱스 추가
--
-- 목적: 프로젝트별 필터링 + 이름 검색 쿼리 성능 개선
-- 대상: 검색 API가 UNION 할 7개 엔티티
-- 안전성: IF NOT EXISTS 로 재실행 가능, 기존 인덱스 영향 없음
--
-- 적용 방법:
--   1) Supabase SQL Editor 에서 전체 복사 실행, 또는
--   2) psql 에서: \i prisma/sql/add-search-indexes.sql
--
-- 참고: contains 검색(ILIKE '%kw%')은 B-tree 인덱스를 다 활용하진 못하지만,
--       prjct_id 로 먼저 필터링되면 스캔 범위가 극적으로 줄어 실질 성능 개선.
-- ========================================================================

CREATE INDEX IF NOT EXISTS tb_rq_task_prjct_idx          ON tb_rq_task          (prjct_id);
CREATE INDEX IF NOT EXISTS tb_rq_requirement_prjct_idx   ON tb_rq_requirement   (prjct_id);
CREATE INDEX IF NOT EXISTS tb_ds_unit_work_prjct_idx     ON tb_ds_unit_work     (prjct_id);
CREATE INDEX IF NOT EXISTS tb_ds_screen_prjct_idx        ON tb_ds_screen        (prjct_id);
CREATE INDEX IF NOT EXISTS tb_ds_area_prjct_idx          ON tb_ds_area          (prjct_id);
CREATE INDEX IF NOT EXISTS tb_ds_function_prjct_idx      ON tb_ds_function      (prjct_id);
CREATE INDEX IF NOT EXISTS tb_ds_db_table_prjct_idx      ON tb_ds_db_table      (prjct_id);
