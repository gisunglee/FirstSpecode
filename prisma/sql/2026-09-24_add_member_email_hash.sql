-- tb_cm_member.email_hash 추가 — 회원 탈퇴 시 이메일 익명화 (2026-09-24)
--
-- 이유:
--   탈퇴는 논리삭제(WITHDRAWN)인데 email_addr(UNIQUE) 를 그대로 두어 탈퇴한 이메일로는
--   영구히 재가입이 불가능했다(회원 row 를 정리하는 배치가 없음). 탈퇴 시 email_addr 를
--   NULL 로 비워 재가입을 열고, 대신 HMAC-SHA256(소문자 이메일, 키=JWT_SECRET) 을 이 컬럼에 남긴다(가명처리).
--   해시는 운영자가 "이 이메일이 탈퇴한 회원인가"(결제 분쟁·문의 대응) 를 찾는 용도.
--   회원 row 자체는 FK(creat_mber_id·owner_mber_id·결제 이력 등) 때문에 지우지 않는다.
--
-- 적용 순서 (2단계 DDL 규칙):
--   nullable 컬럼 추가만이라 옛 코드와 공존 가능 → ① 이 파일 적용 → ② 새 코드 배포. 단일 단계.
--   ②를 ①보다 먼저 배포하면 탈퇴 라우트의 UPDATE 가 "column does not exist" 로 실패한다.
--
-- 백필: 2026-09-24 읽기 전용 점검 결과 WITHDRAWN 회원 0명 → 기존 데이터 정리 불필요.

BEGIN;

ALTER TABLE public.tb_cm_member
  ADD COLUMN IF NOT EXISTS email_hash varchar(64);

COMMENT ON COLUMN public.tb_cm_member.email_hash IS
  '탈퇴 시 원본 이메일의 SHA-256(hex). 탈퇴 회원 식별용. 활성 회원은 NULL';

COMMIT;

-- 인덱스는 두지 않는다 (2026-09-24 사용자 결정 "알터만"). 회원 수십 명 규모라 관리자 검색의
-- email_hash 정확일치는 순차 스캔으로 충분. 회원이 수만 명 규모가 되면 아래를 별도 적용:
--   CREATE INDEX idx_cm_member_email_hash ON public.tb_cm_member (email_hash) WHERE email_hash IS NOT NULL;
