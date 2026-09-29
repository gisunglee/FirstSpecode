-- 결제 시도 행 선(先)기록 — PENDING 결제 (2026-09-30, 라이브 전 필수 ①)
--
-- 근거: .claude/biz/B.결제정책.md §1-5 결제 시도 원칙, §7-3 라이브 전 필수 ①
--
-- 왜 필요한가:
--   지금까지는 PG 를 호출한 "뒤에" 결제 이력을 남겼다. 통신이 끊기거나 프로세스가 죽으면 어떤 주문 ID 로
--   청구를 걸었는지 DB 에 흔적이 없고, 다음 시도가 새 주문 ID 로 다시 청구해 이중 결제가 날 수 있다.
--   토스 멱등키 가이드도 "오류 뒤 키를 바꿔 재시도하지 말라"고 한다. 그래서 PG 호출 **전에** PENDING 행을
--   만들고, 확정(PAID/FAILED)될 때까지 같은 주문 ID 로만 조회·재시도한다.
--
-- 전부 "nullable 컬럼 추가 + 그 컬럼의 UNIQUE 인덱스" 뿐이다. DROP·타입 변경·백필 없음.
--   - nullable ADD COLUMN 은 테이블 재작성이 없다. 옛 코드는 새 컬럼을 모르므로 그대로 동작한다(추가 → 배포).
--   - UNIQUE 는 NULL 을 여러 개 허용한다(PostgreSQL). 값이 있는 행(진행 중)끼리만 유일하다.
--
-- tb_bl_payment
--   pndng_lock_key    진행 중(PENDING) 동안 = mber_id, 확정되면 NULL. UNIQUE 라 "회원당 진행 중 시도 1건"이
--                     DB 에서 원자적으로 보장된다 → 첫 결제(구독 행이 없어 토큰을 심을 곳이 없던 경우)의 동시 이중
--                     청구도 여기서 막힌다. 부분 인덱스 대신 이 방식을 쓰는 이유: Prisma 스키마로 표현되어 drift 가 없다.
--   pndng_meta_json   확정 시 결과를 반영하는 데 필요한 문맥. INITIAL: 암호화 빌링키·카드 표시·customerKey,
--                     SEAT_ADD: 목표 좌석 수. 확정되면 NULL 로 지운다(빌링키는 구독 행에만 남긴다).
--   pymnt_sttus_code 에 값 PENDING 추가 (DDL 변경 없음, 코드 상수). 결제 목록·환불·집계에서 제외.

BEGIN;

ALTER TABLE public.tb_bl_payment
  ADD COLUMN IF NOT EXISTS pndng_lock_key  varchar(36),
  ADD COLUMN IF NOT EXISTS pndng_meta_json json;

CREATE UNIQUE INDEX IF NOT EXISTS tb_bl_payment_pndng_lock_uk
  ON public.tb_bl_payment (pndng_lock_key);

COMMENT ON COLUMN public.tb_bl_payment.pndng_lock_key IS
  '진행 중(PENDING) 결제 시도 잠금 — 값은 mber_id, 확정되면 NULL. UNIQUE 로 회원당 진행 중 1건';
COMMENT ON COLUMN public.tb_bl_payment.pndng_meta_json IS
  'PENDING 확정 시 반영에 필요한 문맥(INITIAL: 암호화 빌링키·카드 표시·customerKey / SEAT_ADD: 목표 좌석). 확정되면 NULL';

COMMIT;
