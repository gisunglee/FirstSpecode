-- ================================================================
-- 기존 프로젝트 환경설정 백필 — tb_pj_project_config
--   작성일 : 2026-04-24
--   범위   : 이 시점에 이미 존재하는 모든 프로젝트에 대해,
--            tb_sys_config_template 에는 있지만 프로젝트 설정에 없는
--            config_key 만 신규 insert. 이미 사용자가 입력/수정한 값은
--            손대지 않는다.
--
--   전제   : DDL(2026-04-24_add_tb_sys_config_template.sql) 및
--            seed(2026-04-24_seed_tb_sys_config_template.sql) 가 선행되어
--            tb_sys_config_template 에 최소 1건 이상 존재해야 함.
--
--   멱등: NOT EXISTS 로 중복 방지. 재실행 시 아무 변화 없음.
-- ================================================================

BEGIN;

-- PG 13+ 는 gen_random_uuid() 내장. 구버전이면 아래 주석 해제.
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO tb_pj_project_config (
  config_id, prjct_id, config_group, config_key, config_value,
  config_label, config_dc, value_type, default_value, select_options,
  sort_ordr, creat_dt, mdfcn_dt
)
SELECT
  gen_random_uuid(),
  p.prjct_id,
  t.config_group,
  t.config_key,
  -- 백필 시에도 초기값은 템플릿 default_value. 이미 사용자가 값을 바꿔둔
  -- 프로젝트에는 NOT EXISTS 조건으로 건드리지 않음 (아래 WHERE 절 참조).
  t.default_value,
  t.config_label,
  t.config_dc,
  t.value_type,
  t.default_value,
  t.select_options,
  t.sort_ordr,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM tb_pj_project p
CROSS JOIN tb_sys_config_template t
-- 복사 조건은 프로젝트 생성 API 와 동일 (use_yn='Y' AND default_value='Y')
WHERE t.use_yn        = 'Y'
  AND t.default_value = 'Y'
  AND NOT EXISTS (
    SELECT 1
    FROM tb_pj_project_config c
    WHERE c.prjct_id   = p.prjct_id
      AND c.config_key = t.config_key
  );

-- 확인용 (실행 후 0 이 아니면 누락이 있다는 뜻)
-- SELECT p.prjct_id, COUNT(c.*) AS cnt
--   FROM tb_pj_project p
--   LEFT JOIN tb_pj_project_config c
--     ON c.prjct_id = p.prjct_id
--    AND c.config_key IN (SELECT config_key FROM tb_sys_config_template WHERE use_yn='Y')
--  GROUP BY p.prjct_id
--  HAVING COUNT(c.*) < (SELECT COUNT(*) FROM tb_sys_config_template WHERE use_yn='Y');

COMMIT;


-- ================================================================
-- [ROLLBACK] — 주의: 백필로 삽입된 레코드만 정확히 식별하기 어려움.
--   실행 직후라면 아래처럼 creat_dt 가 실행 시각 근처인 것만 삭제 가능.
--   단, 같은 시각에 사용자가 직접 추가한 레코드가 있으면 함께 지워짐 —
--   프로덕션에서는 반드시 백업 후 실행할 것.
-- ================================================================
-- BEGIN;
-- DELETE FROM tb_pj_project_config
--  WHERE config_key IN (SELECT config_key FROM tb_sys_config_template WHERE use_yn='Y')
--    AND creat_dt >= '2026-04-24 00:00:00';
-- COMMIT;
