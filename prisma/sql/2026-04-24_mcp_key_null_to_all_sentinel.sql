-- ================================================================
-- MCP 키 scope 컬럼 fail-secure 변경 — null 제거 + 'ALL' sentinel
--   작성일 : 2026-04-24 (후속 마이그레이션)
--   선행   : 2026-04-24_rename_api_key_add_prjct_scope.sql
--
-- 배경:
--   prjct_id=NULL을 "전역 키"로 해석하는 이전 설계는 위험.
--   애플리케이션 버그/누락으로 의도치 않게 NULL이 들어가면
--   자동으로 "모든 프로젝트 접근 가능한 전역 키"가 되기 때문.
--
-- 해결:
--   prjct_id를 NOT NULL로 만들고 'ALL' sentinel로 전역 표현.
--   - 'ALL'          → 전역 키 (명시적 선언)
--   - UUID           → 프로젝트 고정 키
--   - NULL           → DB 거부 (NOT NULL 위반) → fail-secure
--   DEFAULT는 의도적으로 설정 안 함 — 모든 INSERT가 명시적으로 값 지정하도록 강제.
--
--   FK (fk_mcp_key_prjct) 제거:
--     'ALL' 은 tb_pj_project에 존재하지 않는 값이라 FK 유지 불가.
--     프로젝트 삭제 시 scope 키 정리는 app 레이어에서 처리
--     (프로젝트가 삭제되면 그 scope 키는 멤버십 조회에서 어차피 403 처리됨).
--
-- 실행 방법:
--   1) 이 파일을 DB 클라이언트(psql 등)로 실행
--   2) `npx prisma generate` 로 클라이언트 재생성
--   3) 애플리케이션 재기동
--
-- 롤백이 필요하면 이 파일 하단의 [ROLLBACK] 섹션 참조
-- ================================================================

BEGIN;

-- ── ① FK 제거 ('ALL' sentinel이 실제 프로젝트 row가 아니라 FK 유지 불가) ──
ALTER TABLE tb_cm_mcp_key DROP CONSTRAINT fk_mcp_key_prjct;

-- ── ② 기존 NULL 값을 'ALL' 로 일괄 이관 (전역 키) ─────────────────
UPDATE tb_cm_mcp_key SET prjct_id = 'ALL' WHERE prjct_id IS NULL;

-- ── ③ NOT NULL 제약 추가 — 향후 NULL INSERT 차단 ──────────────────
ALTER TABLE tb_cm_mcp_key ALTER COLUMN prjct_id SET NOT NULL;

-- 주의: DEFAULT 의도적으로 설정 안 함 — 모든 INSERT가 prjct_id를
--       명시 지정하도록 강제(fail-secure). @default("ALL") 붙이면
--       코드 누락 시 자동 전역 키가 되어버려 보안 취지 무력화됨.

-- ── ④ 주석 업데이트 ─────────────────────────────────────────────
COMMENT ON COLUMN tb_cm_mcp_key.prjct_id IS
  'MCP 키 scope — ''ALL'' = 전역 키(모든 멤버십 프로젝트), UUID = 프로젝트 고정 키. NOT NULL(fail-secure). INSERT 시 반드시 명시 지정할 것.';

COMMIT;


-- ================================================================
-- [ROLLBACK] — 원상복구 (nullable + FK 재생성)
-- ================================================================
-- BEGIN;
-- ALTER TABLE tb_cm_mcp_key ALTER COLUMN prjct_id DROP NOT NULL;
-- UPDATE tb_cm_mcp_key SET prjct_id = NULL WHERE prjct_id = 'ALL';
-- ALTER TABLE tb_cm_mcp_key
--   ADD CONSTRAINT fk_mcp_key_prjct
--   FOREIGN KEY (prjct_id)
--   REFERENCES tb_pj_project(prjct_id)
--   ON DELETE CASCADE;
-- COMMIT;
