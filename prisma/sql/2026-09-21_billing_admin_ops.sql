-- 결제 관리자 운영·환불 원장·결제 작업 토큰 컬럼 추가 (2026-09-21)
--
-- 근거: .claude/biz/B.결제정책.md §1-5(결제 작업 토큰), §1-7(환불 2유형·종료 사유), §1-10(관리자 결제 화면)
--
-- 전부 "nullable 컬럼 추가"만 있다. DROP·타입 변경·백필 UPDATE 없음.
--   - PostgreSQL 에서 nullable ADD COLUMN 은 테이블 재작성이 없다.
--   - 배포 전 옛 코드는 새 컬럼을 모르므로 그대로 동작한다 (추가 → 배포 순서).
--   - 이미 종료된 구독의 ended_rsn_code 는 NULL 로 둔다. 과거 사유를 추정해 채우면 그게 오염이다.
--
-- tb_bl_subscription
--   ended_rsn_code          종료 사유. USER_CANCEL | PAYMENT_RETRY_EXHAUSTED | ADMIN_TERMINATE | MEMBER_WITHDRAWAL | REFUND_WITHDRAWAL
--                           상태(CANCELED/EXPIRED)는 그대로 두고 "왜"를 보조 정보로 남긴다. 재구독 시 NULL 리셋.
--   billing_op_token        결제 작업 토큰. PG 청구를 시작한 요청이 발급·보유. 결제 결과는 이 토큰이 그대로일 때만 반영하고,
--   billing_op_started_dt   토큰이 살아 있는(2분 미만) 동안 연기·종료·해지·카드 변경·좌석 변경은 409 로 막는다.
--                           → "PG 응답 대기 중 관리자가 종료" 같은 상태 불일치 차단. 2분 넘은 토큰은 만료 취급.
-- tb_bl_payment
--   orig_pymnt_id           REFUND 행이 가리키는 원 결제. 자기 참조 FK. 누적 환불액·잔액 계산의 근거.
--   refund_rsn_code         환불 유형. WITHDRAWAL(청약철회: 전액·구독 종료 필수) | ADJUSTMENT(운영 보정: 전액/부분·구독 유지)
--   pg_cancel_key           PG 취소 트랜잭션 키 (토스 cancels[].transactionKey). Mock 은 NULL. 토스 연결 시 채운다.
--   pymnt_sttus_code 에 값 PARTIALLY_REFUNDED 추가 (DDL 변경 없음, 코드 상수). 누적 환불 = 원 금액이면 REFUNDED.

BEGIN;

ALTER TABLE public.tb_bl_subscription
  ADD COLUMN IF NOT EXISTS ended_rsn_code        varchar(30),
  ADD COLUMN IF NOT EXISTS billing_op_token      varchar(36),
  ADD COLUMN IF NOT EXISTS billing_op_started_dt timestamp(3);

COMMENT ON COLUMN public.tb_bl_subscription.ended_rsn_code IS
  '종료 사유: USER_CANCEL | PAYMENT_RETRY_EXHAUSTED | ADMIN_TERMINATE | MEMBER_WITHDRAWAL | REFUND_WITHDRAWAL. 상태(CANCELED/EXPIRED)의 보조 정보. 재구독 시 NULL';
COMMENT ON COLUMN public.tb_bl_subscription.billing_op_token IS
  '진행 중인 결제 작업 토큰. 결제 결과는 이 토큰이 그대로일 때만 반영, 살아 있는 동안 다른 변경은 409. 2분 넘으면 만료';
COMMENT ON COLUMN public.tb_bl_subscription.billing_op_started_dt IS
  '결제 작업 토큰 발급 시각 (만료 판정용)';

ALTER TABLE public.tb_bl_payment
  ADD COLUMN IF NOT EXISTS orig_pymnt_id   text,
  ADD COLUMN IF NOT EXISTS refund_rsn_code varchar(20),
  ADD COLUMN IF NOT EXISTS pg_cancel_key   varchar(200);

-- 자기 참조 FK — 참조 동작은 Prisma 선택적 관계 기본값과 같게 (drift 방지)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_bl_payment_orig_fk') THEN
    ALTER TABLE public.tb_bl_payment
      ADD CONSTRAINT tb_bl_payment_orig_fk FOREIGN KEY (orig_pymnt_id) REFERENCES public.tb_bl_payment(pymnt_id)
        ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 원 결제별 환불 합계 조회용
CREATE INDEX IF NOT EXISTS tb_bl_payment_orig_idx ON public.tb_bl_payment (orig_pymnt_id);

COMMENT ON COLUMN public.tb_bl_payment.orig_pymnt_id IS
  'REFUND 행이 가리키는 원 결제(pymnt_id). 누적 환불액·잔액 계산 근거';
COMMENT ON COLUMN public.tb_bl_payment.refund_rsn_code IS
  '환불 유형: WITHDRAWAL(청약철회, 전액, 구독 종료) | ADJUSTMENT(운영 보정, 전액/부분, 구독 유지). REFUND 행에만';
COMMENT ON COLUMN public.tb_bl_payment.pg_cancel_key IS
  'PG 취소 트랜잭션 키 (토스 cancels[].transactionKey). Mock 은 NULL';

COMMIT;
