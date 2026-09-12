-- 설계 5계층 최종 수정 경로(출처) 추적 — 요구사항/단위업무/화면/영역/기능
--
-- 목적:
--   MCP 도구가 설계 내용을 수정한 경우를 화면에서 식별하기 위함.
--   기존에는 웹 화면 수정과 MCP 수정이 모두 mdfcn_mber_id(= 키 소유자)로만
--   기록되어 두 경로를 구분할 수 없었다.
--
-- 허용값: 'WEB' | 'MCP' | 'SYNC'
--   WEB  — 웹 화면에서 사용자가 직접 수정 (JWT 세션 인증)
--   MCP  — Claude Code 등 MCP 도구가 수정 (MCP 키 인증)
--   SYNC — 스펙 동기화 적용으로 수정 (lib/spec-sync/targetRegistry.ts)
--
-- DEFAULT 를 두지 않는 이유:
--   DEFAULT 'WEB' 을 주면 과거에 MCP 로 수정된 행까지 웹 수정으로 표시된다.
--   기존 행은 NULL(= 출처 모름) 로 두고 화면에서는 출처를 표시하지 않는다.
--
-- 운영 적용 안전성:
--   nullable + DEFAULT 없음 → PostgreSQL 에서 테이블 재작성(rewrite) 없이
--   카탈로그만 갱신하는 즉시 연산. 락 점유 시간이 짧다.

ALTER TABLE tb_rq_requirement
  ADD COLUMN IF NOT EXISTS mdfcn_src_code varchar(10);

ALTER TABLE tb_ds_unit_work
  ADD COLUMN IF NOT EXISTS mdfcn_src_code varchar(10);

ALTER TABLE tb_ds_screen
  ADD COLUMN IF NOT EXISTS mdfcn_src_code varchar(10);

ALTER TABLE tb_ds_area
  ADD COLUMN IF NOT EXISTS mdfcn_src_code varchar(10);

ALTER TABLE tb_ds_function
  ADD COLUMN IF NOT EXISTS mdfcn_src_code varchar(10);

COMMENT ON COLUMN tb_rq_requirement.mdfcn_src_code IS '최종 수정 경로 — WEB | MCP | SYNC';
COMMENT ON COLUMN tb_ds_unit_work.mdfcn_src_code   IS '최종 수정 경로 — WEB | MCP | SYNC';
COMMENT ON COLUMN tb_ds_screen.mdfcn_src_code      IS '최종 수정 경로 — WEB | MCP | SYNC';
COMMENT ON COLUMN tb_ds_area.mdfcn_src_code        IS '최종 수정 경로 — WEB | MCP | SYNC';
COMMENT ON COLUMN tb_ds_function.mdfcn_src_code    IS '최종 수정 경로 — WEB | MCP | SYNC';
