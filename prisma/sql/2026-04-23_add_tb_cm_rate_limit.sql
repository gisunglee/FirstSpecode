-- ================================================================
-- Rate Limit 카운터 테이블 신규 — tb_cm_rate_limit
--   작성일 : 2026-04-23
--   범위   : 인증 엔드포인트(로그인/가입/재설정/토큰갱신) 남용 방어
--   알고리즘: Fixed Window Counter (PostgreSQL INSERT ON CONFLICT 원자 업서트)
--
-- 사용:
--   키 포맷 = "<ENDPOINT>_<DIMENSION>:<value>"
--     예) LOGIN_IP:1.2.3.4, RESET_EMAIL:foo@bar.com, REFRESH_IP:10.0.0.1
--   checkRateLimit() 헬퍼(src/lib/rateLimit.ts)에서 upsert 호출
--
-- 실행 방법:
--   1) 이 파일을 DB 클라이언트(psql 등)로 실행
--   2) 실행 후 `npx prisma generate` 로 클라이언트 재생성
--   3) 애플리케이션 재기동
--
-- 롤백이 필요하면 이 파일 하단의 [ROLLBACK] 섹션 참조
-- ================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS tb_cm_rate_limit (
  rate_key_val    VARCHAR(200) NOT NULL,
  window_start_dt TIMESTAMP(3) NOT NULL,
  req_cnt         INTEGER      NOT NULL DEFAULT 0,
  creat_dt        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updt_dt         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tb_cm_rate_limit_pkey PRIMARY KEY (rate_key_val)
);

COMMENT ON TABLE  tb_cm_rate_limit                 IS 'Rate Limit 카운터 (인증 엔드포인트 남용 방어)';
COMMENT ON COLUMN tb_cm_rate_limit.rate_key_val    IS '키: "<ENDPOINT>_<DIMENSION>:<value>" 형식 (예: LOGIN_IP:1.2.3.4)';
COMMENT ON COLUMN tb_cm_rate_limit.window_start_dt IS '현재 고정 윈도우 시작 시각';
COMMENT ON COLUMN tb_cm_rate_limit.req_cnt         IS '해당 윈도우 내 누적 요청 수';
COMMENT ON COLUMN tb_cm_rate_limit.creat_dt        IS '최초 생성 시각';
COMMENT ON COLUMN tb_cm_rate_limit.updt_dt         IS '마지막 갱신 시각';

-- TTL 정리용 인덱스 — 배치/크론으로 오래된 행 삭제 시 사용
CREATE INDEX IF NOT EXISTS tb_cm_rate_limit_window_idx
  ON tb_cm_rate_limit (window_start_dt);

COMMIT;


-- ================================================================
-- [ROLLBACK] — 테이블 제거 (카운터 데이터 손실)
-- ================================================================
-- BEGIN;
-- DROP TABLE IF EXISTS tb_cm_rate_limit;
-- COMMIT;
