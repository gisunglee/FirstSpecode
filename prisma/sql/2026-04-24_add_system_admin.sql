-- ================================================================
-- 시스템 전체 관리자(SaaS Super Admin) 도입
--   작성일 : 2026-04-24
--   범위   : tb_cm_member.sys_role_code (컬럼 추가)
--            tb_sys_admin_support_session (신규 테이블)
--            tb_sys_admin_audit (신규 테이블)
--
--   배경
--     프로젝트 단위 4-role(OWNER/ADMIN/MEMBER/VIEWER)만 존재했고,
--     SaaS 플랫폼 자체의 전체 관리자(설계 양식·프롬프트 템플릿 등
--     전역 리소스 관리 + 고객 지원) 역할이 없었다.
--
--   설계 원칙
--     1) sys_role_code 는 DB UPDATE로만 설정. UI/API 로 변경 불가.
--        → 탈취 시 권한 연쇄 상승(system admin → system admin 임명) 차단
--     2) 평소엔 자기 프로젝트만 접근. 다른 프로젝트는 "지원 세션" 을
--        발급해야만 읽기 전용 접근 가능 (tb_sys_admin_support_session).
--     3) 모든 관리자 행동은 tb_sys_admin_audit 에 기록.
--     4) CHECK 제약으로 허용된 값만 저장 (fail-secure).
--
-- 실행 방법:
--   1) 이 파일 전체를 DB 클라이언트(또는 psql)로 실행
--   2) 실행 후 `npx prisma generate` 로 클라이언트 재생성
--   3) 애플리케이션 재기동
--
-- 롤백이 필요하면 이 파일 하단의 [ROLLBACK] 섹션 참조
-- ================================================================

BEGIN;

-- ─── 1) tb_cm_member.sys_role_code 컬럼 ─────────────────────────────
ALTER TABLE tb_cm_member
  ADD COLUMN IF NOT EXISTS sys_role_code VARCHAR(20) DEFAULT NULL;

COMMENT ON COLUMN tb_cm_member.sys_role_code
  IS '시스템 역할: SUPER_ADMIN = 전역 관리자 / NULL = 일반 사용자. DB UPDATE로만 설정.';

-- 허용 값만 저장되도록 강제 (fail-secure)
-- 현재는 SUPER_ADMIN 1단계. 나중에 확장하려면 이 제약을 재작성.
ALTER TABLE tb_cm_member
  DROP CONSTRAINT IF EXISTS chk_sys_role_code;

ALTER TABLE tb_cm_member
  ADD CONSTRAINT chk_sys_role_code
  CHECK (sys_role_code IS NULL OR sys_role_code IN ('SUPER_ADMIN'));

-- ─── 2) tb_sys_admin_support_session (지원 세션) ────────────────────
-- 시스템 관리자가 고객 프로젝트에 "읽기 전용"으로 진입할 때 발급.
-- 30분 만료. 관리자가 수동 종료 가능. 쓰기 API 는 이 세션이 있어도 차단.
CREATE TABLE IF NOT EXISTS tb_sys_admin_support_session (
  sess_id         VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::text,
  admin_mber_id   VARCHAR(36)  NOT NULL,
  prjct_id        VARCHAR(36)  NOT NULL,
  memo            TEXT,                              -- 진입 사유 (필수 입력 권장)
  expires_dt      TIMESTAMP    NOT NULL,             -- 발급 시점 + 30분
  ended_dt        TIMESTAMP,                         -- 조기 종료 시각 (NULL = 진행중)
  creat_dt        TIMESTAMP    NOT NULL DEFAULT now()
);

COMMENT ON TABLE  tb_sys_admin_support_session
  IS '시스템 관리자의 고객 프로젝트 지원 세션 — 읽기 전용 접근 허용';
COMMENT ON COLUMN tb_sys_admin_support_session.admin_mber_id IS '세션 소유 관리자 (tb_cm_member.mber_id)';
COMMENT ON COLUMN tb_sys_admin_support_session.prjct_id      IS '접근 대상 프로젝트';
COMMENT ON COLUMN tb_sys_admin_support_session.memo          IS '진입 사유 (감사 기록)';
COMMENT ON COLUMN tb_sys_admin_support_session.expires_dt    IS '자동 만료 시각 (발급 + 30분)';
COMMENT ON COLUMN tb_sys_admin_support_session.ended_dt      IS '조기 종료 시각 (NULL = 진행중)';

-- 활성 세션 조회 인덱스 (requirePermission 에서 초고속 조회)
CREATE INDEX IF NOT EXISTS idx_sys_support_sess_active
  ON tb_sys_admin_support_session(admin_mber_id, prjct_id, expires_dt, ended_dt);

-- ─── 3) tb_sys_admin_audit (감사 로그) ──────────────────────────────
CREATE TABLE IF NOT EXISTS tb_sys_admin_audit (
  audit_id        VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::text,
  admin_mber_id   VARCHAR(36)  NOT NULL,             -- 행동 주체 (시스템 관리자)
  action_type     VARCHAR(40)  NOT NULL,             -- SUPPORT_SESSION_OPEN | SUPPORT_SESSION_END | USER_SUSPEND | TEMPLATE_UPDATE ...
  target_type     VARCHAR(40),                       -- PROJECT | USER | TEMPLATE | null
  target_id       VARCHAR(36),
  memo            TEXT,                              -- 자유 메모 (사유 등)
  ip_addr         VARCHAR(45),                       -- IPv6 최대 45자
  user_agent      VARCHAR(255),
  creat_dt        TIMESTAMP    NOT NULL DEFAULT now()
);

COMMENT ON TABLE  tb_sys_admin_audit IS '시스템 관리자 행동 감사 로그 — 책임추적성';
COMMENT ON COLUMN tb_sys_admin_audit.action_type IS '행동 유형 (열거형 문자열)';
COMMENT ON COLUMN tb_sys_admin_audit.target_type IS '대상 엔티티 유형';
COMMENT ON COLUMN tb_sys_admin_audit.target_id   IS '대상 엔티티 식별자';

-- 관리자별 최근순 조회
CREATE INDEX IF NOT EXISTS idx_sys_audit_admin
  ON tb_sys_admin_audit(admin_mber_id, creat_dt DESC);

-- 대상 엔티티로 역조회 (예: "이 프로젝트에 누가 지원 들어왔는지")
CREATE INDEX IF NOT EXISTS idx_sys_audit_target
  ON tb_sys_admin_audit(target_type, target_id);

COMMIT;


-- ================================================================
-- 최초 관리자 임명 — 수동 실행 (주석 해제 후 이메일 바꿔서 실행)
-- ================================================================
-- UPDATE tb_cm_member
--   SET sys_role_code = 'SUPER_ADMIN'
--   WHERE email_addr = 'lgs479@gmail.com';


-- ================================================================
-- [ROLLBACK] — 순서대로 실행
-- ================================================================
-- BEGIN;
-- DROP TABLE IF EXISTS tb_sys_admin_audit;
-- DROP TABLE IF EXISTS tb_sys_admin_support_session;
-- ALTER TABLE tb_cm_member
--   DROP CONSTRAINT IF EXISTS chk_sys_role_code,
--   DROP COLUMN IF EXISTS sys_role_code;
-- COMMIT;
