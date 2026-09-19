-- 결제·구독 테이블 생성 + 프로젝트 잠금 컬럼 (결제 2단계)
--
-- 근거: .claude/biz/B.결제정책.md §3 "2단계 상세 설계" (2026-09-19 확정)
--
-- 구조 개요
--   tb_bl_subscription : 구독. 결제자 1인 × 상품 1개 = 1행. 상태만 바뀌고 행은 재사용.
--                        빌링키(암호화)·카드 표시 정보·현재 결제 주기·실패 횟수를 함께 가진다.
--                        상품 코드(prdct_code)를 두어 표준화닷컴 등 다른 상품도 같은 표에 붙인다.
--   tb_bl_payment      : 결제 이력. 영수증 화면·환불 판정(결제 후 유료 기능 사용 시점 비교)의 근거.
--                        sbscrptn_id 는 NULL 허용 — 첫 결제(INITIAL)가 실패하면 구독 행을 만들지 않고
--                        실패 이력만 남기기 때문. 조회는 mber_id 기준으로 한다.
--   tb_bl_pg_event     : PG 웹훅 원문. (pg_provdr_code, pg_event_id) UNIQUE 로 중복 수신을 멱등 처리.
--   tb_pj_project      : lock_yn / lock_dt 추가 — 강등·해지 시 소유 프로젝트 전체 읽기 전용 잠금.
--
-- 옛 코드와의 공존
--   전부 "추가"만 있다. 배포 전 옛 코드는 새 테이블·컬럼을 모르므로 그대로 동작한다.
--   lock_yn 은 NOT NULL DEFAULT 'N' — PostgreSQL 11+ 의 fast default 라 테이블 재작성이 없다.
--   tb_pj_project_settings.plan_code 삭제는 별도 파일(2026-09-20_drop_project_settings_plan_code.sql)로,
--   새 코드 배포 뒤에 적용한다.
--
-- 타입 관례
--   식별자 text (기존 tb_pj_*, tb_cm_* 과 동일, UUID 는 앱이 생성) · 금액 integer(원) ·
--   시각 timestamp(3) (Prisma DateTime 기본 매핑과 동일) · 코드 varchar.

BEGIN;

-- ─── 구독 ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_bl_subscription (
  sbscrptn_id          text         NOT NULL,
  mber_id              text         NOT NULL,
  prdct_code           varchar(30)  NOT NULL,                 -- SPECODE_BASIC (표준화닷컴은 코드 추가)
  sbscrptn_sttus_code  varchar(20)  NOT NULL,                 -- ACTIVE | PAST_DUE | CANCEL_SCHEDULED | CANCELED | EXPIRED
  seat_cnt             integer      NOT NULL,                 -- 구매 좌석 수
  pending_seat_cnt     integer,                               -- 축소 예약 (다음 결제일 적용). NULL = 예약 없음
  unit_price           integer      NOT NULL,                 -- 계약 좌석 단가 (부가세 포함, 원)
  billing_key          text,                                  -- PG 빌링키 (AES 암호화). 해지·탈퇴 시 NULL
  card_co_nm           varchar(50),                           -- 카드사 표시명
  card_no_masked       varchar(30),                           -- 마스킹 카드번호 (끝 4자리 등)
  pg_provdr_code       varchar(10)  NOT NULL,                 -- MOCK | TOSS
  pg_customer_key      varchar(100) NOT NULL,                 -- PG 고객 식별키 (회원별 고정)
  crrnt_perd_bgng_dt   timestamp(3),                          -- 현재 결제 주기 시작
  crrnt_perd_end_dt    timestamp(3),                          -- 현재 결제 주기 종료 (= 다음 결제 시각)
  next_bill_dt         timestamp(3),                          -- 다음 청구 시각 (배치 스캔 기준)
  prentc_dt            timestamp(3),                          -- 이번 주기 "결제 7일 전 안내" 발송 시각. 갱신 시 NULL 리셋 (중복 발송 방지)
  fail_cnt             integer      NOT NULL DEFAULT 0,       -- 연속 결제 실패 횟수 (성공 시 0)
  last_fail_dt         timestamp(3),                          -- 마지막 실패 시각 (재시도 간격 계산)
  cancel_reqst_dt      timestamp(3),                          -- 해지 요청 시각 (CANCEL_SCHEDULED)
  ended_dt             timestamp(3),                          -- 종료 시각 (CANCELED / EXPIRED)
  creat_dt             timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  mdfcn_dt             timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tb_bl_subscription_pkey PRIMARY KEY (sbscrptn_id),
  -- 참조 동작은 Prisma 기본값과 같게 명시 (db push 로 만든 스키마와 drift 없도록)
  CONSTRAINT tb_bl_subscription_mber_fk FOREIGN KEY (mber_id) REFERENCES public.tb_cm_member(mber_id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 결제자 1인 × 상품 1개 = 1행 (재구독 시 같은 행을 재사용)
CREATE UNIQUE INDEX IF NOT EXISTS tb_bl_subscription_mber_prdct_uk
  ON public.tb_bl_subscription (mber_id, prdct_code);

-- 일일 배치가 "종료되지 않은 구독"을 상태별로 훑을 때 사용
CREATE INDEX IF NOT EXISTS tb_bl_subscription_sttus_bill_idx
  ON public.tb_bl_subscription (sbscrptn_sttus_code, next_bill_dt);

COMMENT ON TABLE  public.tb_bl_subscription IS '구독 (결제자 1인 × 상품 1개 = 1행, 상태만 변경). 빌링키·카드·결제 주기·실패 횟수 포함';
COMMENT ON COLUMN public.tb_bl_subscription.sbscrptn_sttus_code IS 'ACTIVE | PAST_DUE(재시도 중) | CANCEL_SCHEDULED(기간 말 해지 예정) | CANCELED | EXPIRED(재시도 소진 강등)';
COMMENT ON COLUMN public.tb_bl_subscription.billing_key IS 'PG 빌링키 — src/lib/encrypt.ts AES-256 암호화 저장. 해지 확정·탈퇴 시 NULL';
COMMENT ON COLUMN public.tb_bl_subscription.prentc_dt IS '이번 결제 주기의 사전 안내(7일 전) 메일 발송 시각. 주기 갱신 시 NULL 로 리셋해 중복 발송을 막는다';

-- ─── 결제 이력 ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_bl_payment (
  pymnt_id           text         NOT NULL,
  sbscrptn_id        text,                                    -- NULL = 구독 행이 생기기 전의 첫 결제 실패
  mber_id            text         NOT NULL,
  pymnt_ty_code      varchar(20)  NOT NULL,                   -- INITIAL | RECURRING | SEAT_ADD | REFUND
  amt                integer      NOT NULL,                   -- 결제 금액 (원, 부가세 포함). REFUND 는 음수
  seat_cnt           integer      NOT NULL,                   -- 이 결제가 덮는 좌석 수 (SEAT_ADD 는 추가 좌석 수)
  perd_bgng_dt       timestamp(3),                            -- 이 결제가 덮는 기간 시작 (SEAT_ADD 는 결제 시점)
  perd_end_dt        timestamp(3),                            -- 이 결제가 덮는 기간 종료
  pymnt_sttus_code   varchar(20)  NOT NULL,                   -- PAID | FAILED | REFUNDED
  pg_provdr_code     varchar(10)  NOT NULL,                   -- MOCK | TOSS
  pg_pymnt_key       varchar(200),                            -- PG 결제 키 (성공 시)
  pg_order_id        varchar(64)  NOT NULL,                   -- 주문 ID — 시도마다 새로 발급, UNIQUE (멱등)
  receipt_url        text,                                    -- 영수증 URL
  fail_rsn_cn        text,                                    -- 실패 사유 (PG 코드+메시지)
  apprv_dt           timestamp(3),                            -- PG 승인 시각
  creat_dt           timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tb_bl_payment_pkey PRIMARY KEY (pymnt_id),
  CONSTRAINT tb_bl_payment_sbscrptn_fk FOREIGN KEY (sbscrptn_id) REFERENCES public.tb_bl_subscription(sbscrptn_id)
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS tb_bl_payment_order_uk
  ON public.tb_bl_payment (pg_order_id);

-- 결제 내역 화면 (회원별 최신순) · 환불 판정(최초 결제 시각) 조회
CREATE INDEX IF NOT EXISTS tb_bl_payment_mber_dt_idx
  ON public.tb_bl_payment (mber_id, creat_dt DESC);

COMMENT ON TABLE  public.tb_bl_payment IS '결제 이력. 영수증 화면·환불 판정(최초 결제 시각 이후 유료 기능 사용 여부) 근거';
COMMENT ON COLUMN public.tb_bl_payment.sbscrptn_id IS 'NULL 허용 — 첫 결제(INITIAL) 실패 시 구독 행을 만들지 않고 실패 이력만 남긴다. 조회는 mber_id 기준';

-- ─── PG 웹훅 이벤트 ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_bl_pg_event (
  event_id         text         NOT NULL,
  pg_provdr_code   varchar(10)  NOT NULL,                     -- MOCK | TOSS
  pg_event_id      varchar(200) NOT NULL,                     -- PG 측 이벤트 ID (멱등 키)
  event_ty_code    varchar(60)  NOT NULL,                     -- PG 이벤트 종류 원문
  payload          jsonb        NOT NULL,                     -- 수신 원문
  prcs_sttus_code  varchar(20)  NOT NULL DEFAULT 'RECEIVED',  -- RECEIVED | PROCESSED | IGNORED | FAILED
  prcs_dt          timestamp(3),
  prcs_rsn_cn      text,                                      -- 처리 결과 메모 (무시 사유·오류 메시지)
  creat_dt         timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tb_bl_pg_event_pkey PRIMARY KEY (event_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS tb_bl_pg_event_provdr_event_uk
  ON public.tb_bl_pg_event (pg_provdr_code, pg_event_id);

COMMENT ON TABLE public.tb_bl_pg_event IS 'PG 웹훅 원문 보관. (pg_provdr_code, pg_event_id) UNIQUE 로 중복 수신 멱등 처리';

-- ─── 프로젝트 잠금 플래그 ──────────────────────────────────────────────────
-- 강등(해지 확정·결제 실패 소진) 시 소유 프로젝트 전체에 'Y'. 조회는 되고 쓰기 권한만 403.
-- 해제: 재결제 성공 / 소유자 "활성화"(멤버 상한 이하) / 프로젝트 1개뿐이면 자동.
ALTER TABLE public.tb_pj_project
  ADD COLUMN IF NOT EXISTS lock_yn char(1) NOT NULL DEFAULT 'N',
  ADD COLUMN IF NOT EXISTS lock_dt timestamp(3);

COMMENT ON COLUMN public.tb_pj_project.lock_yn IS '결제 잠금 여부. Y = 읽기 전용(강등·해지). requirePermission 에서 쓰기 권한 403';
COMMENT ON COLUMN public.tb_pj_project.lock_dt IS '잠금 시각';

COMMIT;
