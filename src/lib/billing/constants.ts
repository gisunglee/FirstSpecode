/**
 * billing/constants — 결제·구독 도메인 상수 (단일 진실 소스)
 *
 * 역할:
 *   - 상품 카탈로그(상품 코드 → 플랜·단가), 구독·결제 상태 코드, 재시도 정책, 에러 코드
 *   - 라우트·서비스·화면이 문자열을 직접 쓰지 않고 여기 상수를 참조한다
 *
 * 왜 상품 코드를 두는가:
 *   구독 테이블은 SPECODE 전용이 아니다(정책 §1-10). 표준화닷컴 상품은 PRODUCTS 에 한 줄
 *   추가하면 같은 구독·결제·배치 코드가 그대로 돈다.
 *
 * 가격 숫자는 요금제 페이지(siteInfo.PRICING)와 같은 상수를 쓴다 — 페이지와 청구 금액이
 * 어긋나는 사고를 막기 위해 두 곳에 숫자를 두지 않는다.
 *
 * 정책 근거: .claude/biz/B.결제정책.md §1-2 티어, §1-4 좌석, §1-5 실패 정책, §3 2단계
 */

import { PRICING } from "@/app/intro/_components/siteInfo";
import type { PlanCode } from "@/lib/permissions";

// ─── 상품 ────────────────────────────────────────────────────────────────────

export const PRODUCT_CODES = {
  SPECODE_BASIC: "SPECODE_BASIC",
} as const;
export type ProductCode = (typeof PRODUCT_CODES)[keyof typeof PRODUCT_CODES];

export type ProductSpec = {
  /** 결제창·영수증·메일에 표시되는 상품명 */
  name: string;
  /** 이 상품이 활성화하는 회원 플랜 (tb_cm_member.plan_code 미러 값) */
  planCode: PlanCode;
  /** 좌석당 월 단가 (부가세 포함, 원) */
  unitPrice: number;
};

export const PRODUCTS: Record<ProductCode, ProductSpec> = {
  SPECODE_BASIC: {
    name:      "SPECODE BASIC",
    planCode:  "BASIC",
    unitPrice: PRICING.basicSeatMonthlyKrw,
  },
};

/** SPECODE 앱이 현재 판매하는 유일한 상품 — 화면·API 는 이 코드를 기본값으로 쓴다 */
export const SPECODE_PRODUCT: ProductCode = PRODUCT_CODES.SPECODE_BASIC;

// ─── 구독 상태 ───────────────────────────────────────────────────────────────

export const SUBSCRIPTION_STATUS = {
  /** 정상 — 다음 결제일에 자동 청구 */
  ACTIVE:           "ACTIVE",
  /** 결제 실패 후 재시도 중 — 플랜 혜택은 유지(정책 §1-5) */
  PAST_DUE:         "PAST_DUE",
  /** 해지 요청됨 — 현재 주기 종료까지 사용, 종료 시 CANCELED */
  CANCEL_SCHEDULED: "CANCEL_SCHEDULED",
  /** 해지 확정 — FREE 강등·잠금 완료 */
  CANCELED:         "CANCELED",
  /** 재시도 소진 — FREE 강등·잠금 완료 */
  EXPIRED:          "EXPIRED",
} as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];

/** 플랜 혜택이 살아 있는 상태 — 좌석 상한·관리자 수동 부여 409 판정에 사용 */
export const LIVE_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  SUBSCRIPTION_STATUS.ACTIVE,
  SUBSCRIPTION_STATUS.PAST_DUE,
  SUBSCRIPTION_STATUS.CANCEL_SCHEDULED,
];

export function isLiveSubscriptionStatus(status: string): boolean {
  return (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

// ─── 결제 이력 ───────────────────────────────────────────────────────────────

export const PAYMENT_TYPE = {
  /** 구독 시작 첫 결제 */
  INITIAL:   "INITIAL",
  /** 월 정기 결제 (재시도 포함) */
  RECURRING: "RECURRING",
  /** 좌석 추가 일할 결제 */
  SEAT_ADD:  "SEAT_ADD",
  /** 환불 (v1 은 토스 콘솔 수동 — 이력 기록용) */
  REFUND:    "REFUND",
} as const;
export type PaymentType = (typeof PAYMENT_TYPE)[keyof typeof PAYMENT_TYPE];

export const PAYMENT_STATUS = {
  PAID:     "PAID",
  FAILED:   "FAILED",
  REFUNDED: "REFUNDED",
} as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

// ─── PG ──────────────────────────────────────────────────────────────────────

export const PG_PROVIDER = {
  MOCK: "MOCK",
  TOSS: "TOSS",
} as const;
export type PgProviderCode = (typeof PG_PROVIDER)[keyof typeof PG_PROVIDER];

export const PG_EVENT_STATUS = {
  RECEIVED:  "RECEIVED",
  PROCESSED: "PROCESSED",
  IGNORED:   "IGNORED",
  FAILED:    "FAILED",
} as const;

// ─── 결제 실패·안내 정책 (정책 §1-5, §1-9) ───────────────────────────────────

export const RETRY_POLICY = {
  /** 첫 실패 뒤 재시도 횟수. 전부 실패하면 EXPIRED (초기 1회 + 재시도 3회 = 최대 4회 시도) */
  maxRetryCount: PRICING.retryCount,
  /** 재시도 간격(일) */
  intervalDays:  PRICING.retryIntervalDays,
} as const;

/** 정기결제 사전 안내 메일 — 결제 N일 전 (카드사 가이드라인 7일) */
export const PRENOTICE_DAYS = PRICING.prenoticeDays;

// ─── 좌석 입력 범위 ──────────────────────────────────────────────────────────
// 상한은 입력 실수(예: 9999) 방어용. 실제로 이만큼 필요하면 ENTERPRISE 문의 경로다.
export const SEAT_INPUT_LIMITS = {
  min: 1,
  max: 500,
} as const;

// ─── 에러 코드 (프론트 분기용) ────────────────────────────────────────────────

export const BILLING_ERROR_CODES = {
  /** 이미 살아 있는 구독이 있어 새로 시작할 수 없음 */
  ALREADY_SUBSCRIBED:   "BILLING_ALREADY_SUBSCRIBED",
  /** 구독이 없거나 종료됨 */
  NO_SUBSCRIPTION:      "BILLING_NO_SUBSCRIPTION",
  /** 현재 상태에서 허용되지 않는 동작 (예: PAST_DUE 에서 좌석 추가) */
  INVALID_STATE:        "BILLING_INVALID_STATE",
  /** 좌석 수가 사용 좌석보다 작거나 범위를 벗어남 */
  SEAT_COUNT_INVALID:   "BILLING_SEAT_COUNT_INVALID",
  /** PG 결제 거절·실패 */
  PAYMENT_FAILED:       "BILLING_PAYMENT_FAILED",
  /** 카드 등록 콜백의 customerKey 가 로그인 사용자와 다름 */
  CUSTOMER_KEY_MISMATCH: "BILLING_CUSTOMER_KEY_MISMATCH",
  /** PG 어댑터 미구현·설정 오류 */
  GATEWAY_UNAVAILABLE:  "BILLING_GATEWAY_UNAVAILABLE",
  /** 같은 구독에 대한 결제 작업이 동시에 들어옴 — 하나만 처리하고 나머지는 거절 (이중 결제 방지) */
  CONCURRENT_OPERATION: "BILLING_CONCURRENT_OPERATION",
  /** 프로젝트가 결제 잠금 상태 — 쓰기 차단 */
  PROJECT_LOCKED:       "PROJECT_LOCKED",
  /** 잠금 해제 조건 미충족 (멤버·좌석 상한 초과) */
  UNLOCK_OVER_LIMIT:    "PROJECT_UNLOCK_OVER_LIMIT",
} as const;

// ─── 경로 ────────────────────────────────────────────────────────────────────

/** 구독·결제 설정 화면 */
export const BILLING_PATH = "/settings/billing";
/** PG 리다이렉트가 돌아오는 앱 화면 (Bearer 인증은 리다이렉트에 실리지 않아 화면이 API 를 대신 호출) */
export const BILLING_CALLBACK_PATH = "/settings/billing/callback";
/** Mock PG 창 (PAYMENT_GATEWAY=mock 전용) */
export const MOCK_PG_WINDOW_PATH = "/billing/pg-window";
