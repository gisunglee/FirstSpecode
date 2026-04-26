-- ================================================================
-- tb_cm_mcp_key 에 키 용도 구분 컬럼 추가
--
-- 배경:
--   기존 MCP 키는 모두 Claude Code MCP 도구 인증용으로 발급됐다.
--   /run-ai-tasks 워커가 이 키를 재활용하면서 "이 키를 어디 채널에서 쓸 건지"
--   를 명시할 필요가 생겼다. 두 채널이 같은 키를 공유하면 한쪽 노출이
--   다른 쪽 노출로 번지므로 발급 시점부터 분리한다.
--
-- 컬럼:
--   key_use_se_code
--     'CLIENT' — Claude Code MCP 도구용 (기본값 — 기존 키 모두 이걸로 채워짐)
--     'WORKER' — /run-ai-tasks 워커용 (프로젝트 scope 강제, 전역 발급 불가)
--
-- 무결성:
--   CHECK 제약으로 두 값 외에는 INSERT 자체가 거부됨.
--   향후 새 종류('ADMIN' 등) 추가 시 제약을 다시 작성.
--
-- 마이그레이션 안전성:
--   IF NOT EXISTS, DROP CONSTRAINT IF EXISTS 로 재실행 안전 (멱등).
--   기존 키들은 default 'CLIENT' 로 자동 분류 — 어차피 모두 Claude Code 용이었음.
--
-- 작성일 : 2026-04-26
-- ================================================================

BEGIN;

-- 1) 컬럼 추가 — DEFAULT 'CLIENT' 로 기존 행 자동 채움 + NOT NULL 보장
ALTER TABLE tb_cm_mcp_key
  ADD COLUMN IF NOT EXISTS key_use_se_code VARCHAR(20) NOT NULL DEFAULT 'CLIENT';

-- 2) 허용값 제약 — 잘못된 값(예: 'WORKERS' 오타) INSERT 자체 차단
ALTER TABLE tb_cm_mcp_key
  DROP CONSTRAINT IF EXISTS chk_mcp_key_use_se_code;

ALTER TABLE tb_cm_mcp_key
  ADD CONSTRAINT chk_mcp_key_use_se_code
  CHECK (key_use_se_code IN ('CLIENT', 'WORKER'));

-- 3) 워커 키 검색 인덱스 — (mberId, useSe, revoked) 복합
--    워커 인증 시 mber_id + key_use_se_code='WORKER' + revoke_dt IS NULL
--    조합으로 자주 조회되므로 복합 인덱스 추가.
CREATE INDEX IF NOT EXISTS idx_mcp_key_use_se
  ON tb_cm_mcp_key (mber_id, key_use_se_code, revoke_dt);

COMMIT;

-- ================================================================
-- 검증 쿼리 (참고용 — 실행 후 수동 확인)
-- ================================================================
-- 1) 기존 키들이 모두 'CLIENT' 로 채워졌는지 확인:
--    SELECT key_use_se_code, COUNT(*) FROM tb_cm_mcp_key
--     WHERE revoke_dt IS NULL GROUP BY key_use_se_code;
--
-- 2) CHECK 제약 동작 검증 (이건 거부되어야 정상):
--    INSERT INTO tb_cm_mcp_key (api_key_id, mber_id, prjct_id, key_hash, key_prefix, key_nm, key_use_se_code)
--    VALUES ('test', 'test', 'ALL', 'test', 'spk_xxxx', 'test', 'INVALID');
--    → ERROR: new row for relation "tb_cm_mcp_key" violates check constraint
--
-- 3) 인덱스 존재 확인:
--    \d+ tb_cm_mcp_key   (psql)
--    또는 SELECT * FROM pg_indexes WHERE tablename = 'tb_cm_mcp_key';
