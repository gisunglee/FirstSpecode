-- ================================================================
-- MCP API 키 테이블 rename + 프로젝트 scope 컬럼 추가
--   작성일 : 2026-04-24
--   범위   : tb_cm_api_key → tb_cm_mcp_key 리네임 + prjct_id 추가
--
-- 배경:
--   tb_cm_api_key는 MCP 클라이언트 인증용 키(spk_...)를 저장하는 테이블.
--   그러나 유사 이름의 tb_pj_project_api_key(외부 AI provider 키 보관소)와
--   혼동을 일으켜 왔음 → 용도를 명확히 하려고 tb_cm_mcp_key로 개명.
--
--   또한 한 사용자가 여러 프로젝트의 멤버일 때 MCP 세션이 실수로 다른
--   프로젝트를 건드리는 사고를 막기 위해 prjct_id 컬럼으로 키 발급 시점에
--   프로젝트 단위 scope를 고정할 수 있게 함.
--
-- 호환성:
--   기존 발급 키는 prjct_id=NULL로 유지되어 "전역 키"로 동작 → break 없음.
--   신규 키는 발급 시 prjctId 지정 가능 (옵션).
--
-- 실행 방법:
--   1) 이 파일을 DB 클라이언트(psql 등)로 실행 (데이터 보존을 위해
--      Prisma migrate의 DROP+CREATE 대신 이 수동 RENAME 사용)
--   2) `npx prisma generate` 로 클라이언트 재생성
--   3) 애플리케이션 재기동
--
-- 롤백이 필요하면 이 파일 하단의 [ROLLBACK] 섹션 참조
-- ================================================================

BEGIN;

-- ── ① 테이블 rename ─────────────────────────────────────────────
ALTER TABLE tb_cm_api_key RENAME TO tb_cm_mcp_key;

-- ── ② 제약/인덱스 rename (naming 일관성) ──────────────────────
ALTER TABLE  tb_cm_mcp_key  RENAME CONSTRAINT tb_cm_api_key_pkey TO tb_cm_mcp_key_pkey;
ALTER INDEX  idx_api_key_mber                  RENAME TO idx_mcp_key_mber;

-- key_hash UNIQUE 제약의 이름(Postgres 자동 생성 또는 기존 명)도 명시 변경
DO $$
DECLARE
  _cname TEXT;
BEGIN
  SELECT conname INTO _cname
  FROM   pg_constraint
  WHERE  conrelid = 'tb_cm_mcp_key'::regclass
    AND  contype  = 'u';
  IF _cname IS NOT NULL AND _cname <> 'tb_cm_mcp_key_key_hash_key' THEN
    EXECUTE format('ALTER TABLE tb_cm_mcp_key RENAME CONSTRAINT %I TO tb_cm_mcp_key_key_hash_key', _cname);
  END IF;
END $$;

-- ── ③ prjct_id 컬럼 추가 (nullable) ────────────────────────────
--     NULL = 전역 키(모든 멤버십 프로젝트), 값 = 해당 프로젝트 고정
ALTER TABLE tb_cm_mcp_key ADD COLUMN prjct_id VARCHAR;

COMMENT ON COLUMN tb_cm_mcp_key.prjct_id IS '프로젝트 scope 고정 (NULL=전역 키, 값=해당 프로젝트 외 접근 시 403)';

-- ── ④ FK (프로젝트 삭제 시 cascade — 유령 키 방지) ─────────────
ALTER TABLE tb_cm_mcp_key
  ADD CONSTRAINT fk_mcp_key_prjct
  FOREIGN KEY (prjct_id)
  REFERENCES tb_pj_project(prjct_id)
  ON DELETE CASCADE;

-- ── ⑤ 인덱스 (scope 조회 성능) ─────────────────────────────────
CREATE INDEX idx_mcp_key_prjct ON tb_cm_mcp_key(prjct_id);

-- ── ⑥ 테이블/컬럼 주석 ─────────────────────────────────────────
COMMENT ON TABLE  tb_cm_mcp_key              IS 'MCP 키 — Claude Code 등 외부 AI 클라이언트 인바운드 인증용 (spk_ prefix + SHA-256 해시)';
COMMENT ON COLUMN tb_cm_mcp_key.api_key_id   IS '키 UUID';
COMMENT ON COLUMN tb_cm_mcp_key.mber_id      IS '키 소유 회원 ID (발급자)';
COMMENT ON COLUMN tb_cm_mcp_key.key_hash     IS 'SHA-256(원문) — 원문 자체는 저장 금지';
COMMENT ON COLUMN tb_cm_mcp_key.key_prefix   IS '목록 식별용 12자 prefix (spk_ + 앞 8자)';
COMMENT ON COLUMN tb_cm_mcp_key.key_nm       IS '사용자가 붙인 키 이름';
COMMENT ON COLUMN tb_cm_mcp_key.last_used_dt IS '마지막 사용 시각 (fire-and-forget 비동기 갱신)';
COMMENT ON COLUMN tb_cm_mcp_key.revoke_dt    IS '폐기 시각 — NULL이 아니면 인증 거부';

COMMIT;


-- ================================================================
-- [ROLLBACK] — 원상복구 (prjct_id 컬럼/인덱스/FK 제거 + 테이블명 원복)
-- ================================================================
-- BEGIN;
-- ALTER TABLE tb_cm_mcp_key DROP CONSTRAINT fk_mcp_key_prjct;
-- DROP INDEX  idx_mcp_key_prjct;
-- ALTER TABLE tb_cm_mcp_key DROP COLUMN prjct_id;
-- ALTER INDEX idx_mcp_key_mber                   RENAME TO idx_api_key_mber;
-- ALTER TABLE tb_cm_mcp_key RENAME CONSTRAINT tb_cm_mcp_key_pkey TO tb_cm_api_key_pkey;
-- ALTER TABLE tb_cm_mcp_key RENAME TO tb_cm_api_key;
-- COMMIT;
