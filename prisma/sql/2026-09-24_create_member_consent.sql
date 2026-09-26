-- tb_cm_member_consent 생성 — 약관·개인정보 동의 기록 (2026-09-24)
--
-- 이유:
--   가입 흐름(이메일·소셜)에 약관/개인정보 동의가 없었다. 체크박스만 넣고 기록을 남기지 않으면
--   "동의했다"는 증빙이 없어 의미가 없으므로, 누가·무엇에·어느 버전으로·언제 동의했는지 남긴다.
--   회원 컬럼 2개로도 되지만 약관 개정 후 재동의하면 이전 기록이 덮여 사라진다 → 별도 테이블.
--
-- 규칙:
--   consent_type: TERMS(이용약관) | PRIVACY(개인정보 수집·이용) — CHECK 제약으로 오타 차단
--   consent_ver : 약관 시행일 "YYYY-MM-DD" (src/lib/consent.ts CURRENT_CONSENT_VERSION 과 일치)
--   탈퇴해도 지우지 않는다(증빙). 회원 row 도 익명화만 하므로 FK 는 유지된다.
--
-- 적용 순서 (2단계 DDL 규칙):
--   새 테이블 추가만이라 옛 코드와 공존 가능 → ① 이 파일 적용 → ② 새 코드 배포. 단일 단계.
--   ②를 ①보다 먼저 배포하면 가입 API 의 INSERT 가 "relation does not exist" 로 실패한다.
--
-- 제약 이름은 Prisma 기본 규칙(<table>_pkey, <table>_<col>_fkey)을 따라 migrate diff 에서 drift 로 잡히지 않게 한다.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tb_cm_member_consent (
  consent_id    text         NOT NULL,
  mber_id       text         NOT NULL,
  consent_type  varchar(20)  NOT NULL,
  consent_ver   varchar(20)  NOT NULL,
  agree_dt      timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_addr       varchar(64),
  CONSTRAINT tb_cm_member_consent_pkey PRIMARY KEY (consent_id),
  CONSTRAINT tb_cm_member_consent_mber_id_fkey
    FOREIGN KEY (mber_id) REFERENCES public.tb_cm_member(mber_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_cm_member_consent_type CHECK (consent_type IN ('TERMS', 'PRIVACY'))
);

CREATE INDEX IF NOT EXISTS idx_cm_member_consent_mber
  ON public.tb_cm_member_consent (mber_id);

COMMENT ON TABLE  public.tb_cm_member_consent IS '약관·개인정보 동의 기록. 재동의는 새 행. 탈퇴 후에도 보존(증빙)';
COMMENT ON COLUMN public.tb_cm_member_consent.consent_type IS 'TERMS(이용약관) | PRIVACY(개인정보 수집·이용)';
COMMENT ON COLUMN public.tb_cm_member_consent.consent_ver  IS '동의한 약관의 시행일 YYYY-MM-DD';

COMMIT;
