/**
 * billing/subscription — 구독 도메인 서비스 (규칙은 여기, 라우트는 얇게)
 *
 * 흐름 요약 (정책 §1-4 ~ §1-6, §3 2단계):
 *   BASIC 시작   beginCardRegistration("start") → PG 카드 등록 → completeCardRegistration
 *                → 빌링키 발급 → 즉시 첫 결제(INITIAL) → 구독 ACTIVE → 회원 plan_code=BASIC → 잠금 전부 해제
 *   좌석 추가    changeSeats(n > 현재) → 남은 일수 일할 즉시 결제(SEAT_ADD) → seat_cnt 반영
 *   좌석 축소    changeSeats(n < 현재) → pending_seat_cnt 예약 → 다음 결제 시 적용 (환불 없음)
 *   해지         cancelSubscription → CANCEL_SCHEDULED, 기간 말 배치가 CANCELED·FREE·잠금
 *   해지 취소    uncancelSubscription → ACTIVE
 *   카드 변경    beginCardRegistration("change") → completeCardRegistration → 빌링키 교체.
 *                PAST_DUE 였다면 곧바로 재결제 시도
 *   정기 결제    attemptRecurringCharge — 배치(daily.ts)·카드 변경에서 호출. 실패 시 PAST_DUE,
 *                재시도 소진 시 terminateSubscription(EXPIRED)
 *
 * 회원 plan_code / plan_expire_dt 는 "실효 플랜"의 미러다. 구독이 살아 있으면 BASIC/NULL,
 * 종료되면 FREE/NULL 로 여기서만 써 준다 → requirePermission·planLimits 는 그대로 동작.
 *
 * 동시성 원칙 — 결제 작업 토큰 (2026-09-21, 정책 §1-5):
 *   PG 호출은 DB 트랜잭션 안에 넣을 수 없다(pgbouncer 트랜잭션 풀링, 토스 최대 60초). 그래서
 *   "청구 시작 → PG 응답 → 결과 반영" 구간을 구독 행의 billing_op_token 으로 묶는다.
 *     ① 청구 직전 beginBillingOperation — 읽은 버전(mdfcn_dt)이 그대로이고 토큰이 없거나 만료(2분)됐을 때만
 *        토큰을 발급·선점. 실패면 다른 결제가 진행 중 → 청구 없이 물러난다(이중 결제 방지).
 *     ② 그 사이 들어오는 다른 변경(연기·종료·해지·카드·좌석·탈퇴)은 guardedSubscriptionUpdate 가
 *        "토큰이 없거나 만료됐을 때만" 갱신하고, 아니면 409 BILLING_CONCURRENT_OPERATION.
 *        → "PG 응답 대기 중 관리자가 종료" 같은 상태 불일치를 막는다.
 *     ③ 결제 결과 반영은 "내 토큰이 그대로일 때만". 0건이면(2분 넘어 다른 작업이 인계) 결제 이력은
 *        남기고 구독은 건드리지 않은 채 CRITICAL 로그 → 운영자가 PG 콘솔과 대조해 수동 반영.
 *   첫 결제는 구독 행이 없을 수 있어 회원 행(mdfcn_dt)을 선점한다.
 *   토스 어댑터를 붙일 때 Idempotency-Key·결제 상태 조회(UNKNOWN 복구)를 이 토큰 위에 얹는다.
 *
 * 트랜잭션 원칙:
 *   PG 호출(외부)은 트랜잭션 밖에서, DB 반영은 한 트랜잭션으로. 결제는 성공했는데 DB 가 실패하면
 *   tb_bl_payment 에 기록이 없으므로 운영자가 PG 콘솔 대조로 찾아 수동 반영한다(로그 ERROR).
 *   메일은 커밋 뒤에 await 로 보내고(서버리스에서 void 는 유실) 실패해도 흐름을 되돌리지 않는다(emails.ts).
 */

import type { Prisma, PrismaClient, TbBlPayment, TbBlSubscription } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { decryptBillingKey, encryptBillingKey } from "./billing-key";
import { getMemberEffectivePlan } from "@/lib/planLimits";
import type { PlanCode } from "@/lib/permissions";
import {
  BILLING_CALLBACK_PATH,
  BILLING_ERROR_CODES as E,
  BILLING_OP_TIMEOUT_MS,
  ENDED_REASON,
  type EndedReason,
  isLiveSubscriptionStatus,
  PAYMENT_STATUS,
  PAYMENT_TYPE,
  PRODUCTS,
  RETRY_POLICY,
  SEAT_INPUT_LIMITS,
  SPECODE_PRODUCT,
  SUBSCRIPTION_STATUS as S,
  type PaymentType,
  type SubscriptionStatus,
} from "./constants";
import { BillingError } from "./errors";
import { buildCustomerKey, getPaymentGateway, type CardRegistrationStart, type IssuedBillingKey } from "./gateway";
import { addDays, kstDayOfMonth, monthlyAmount, nextPeriodEnd, prorationForAddedSeats, type ProrationResult } from "./pricing";
import { countUsedSeats } from "./seats";
import { autoUnlockIfSingle, countLockedProjects, lockAllOwnedProjects, unlockAllOwnedProjects } from "./lock";
import {
  sendCancelConfirmedEmail,
  sendDowngradedEmail,
  sendPaymentFailedEmail,
  sendPaymentReceiptEmail,
} from "./emails";

type Db = PrismaClient | Prisma.TransactionClient;

/** 결제 주체 — requireBillingActor 결과와 같은 모양 */
export type BillingActorRef = { mberId: string; email: string };

const product = PRODUCTS[SPECODE_PRODUCT];

// ═══════════════════════════════════════════════════════════════════════════
// 조회
// ═══════════════════════════════════════════════════════════════════════════

export async function findSubscription(mberId: string, db: Db = prisma): Promise<TbBlSubscription | null> {
  return db.tbBlSubscription.findUnique({
    where: { mber_id_prdct_code: { mber_id: mberId, prdct_code: SPECODE_PRODUCT } },
  });
}

/** 관리자 수동 플랜 변경 409 판정 등 — 살아 있는 구독이 있는가 */
export async function hasLiveSubscription(mberId: string, db: Db = prisma): Promise<boolean> {
  const sub = await findSubscription(mberId, db);
  return !!sub && isLiveSubscriptionStatus(sub.sbscrptn_sttus_code);
}

/** 화면·API 응답용 — 빌링키·PG 내부 식별자는 절대 내려보내지 않는다 */
export type SubscriptionDto = {
  subscriptionId:     string;
  productCode:        string;
  productName:        string;
  status:             SubscriptionStatus;
  seatCnt:            number;
  pendingSeatCnt:     number | null;
  unitPrice:          number;
  /** 다음 결제 예정 금액 — 축소 예약이 있으면 예약 좌석 기준 */
  nextChargeAmount:   number;
  card:               { company: string; numberMasked: string } | null;
  provider:           string;
  currentPeriodStart: string | null;
  currentPeriodEnd:   string | null;
  nextBillAt:         string | null;
  failCnt:            number;
  lastFailAt:         string | null;
  cancelRequestedAt:  string | null;
  endedAt:            string | null;
  /** 종료 사유 (CANCELED/EXPIRED 일 때). 옛 데이터는 null */
  endedReason:        EndedReason | null;
  /** 지금 PG 청구가 진행 중(토큰 살아 있음) — 화면은 변경 버튼을 잠시 막는다 */
  opInProgress:       boolean;
};

export function toSubscriptionDto(sub: TbBlSubscription, now = new Date()): SubscriptionDto {
  const nextSeats = sub.pending_seat_cnt ?? sub.seat_cnt;
  return {
    subscriptionId:     sub.sbscrptn_id,
    productCode:        sub.prdct_code,
    productName:        PRODUCTS[sub.prdct_code as keyof typeof PRODUCTS]?.name ?? sub.prdct_code,
    status:             sub.sbscrptn_sttus_code as SubscriptionStatus,
    seatCnt:            sub.seat_cnt,
    pendingSeatCnt:     sub.pending_seat_cnt,
    unitPrice:          sub.unit_price,
    nextChargeAmount:   monthlyAmount(nextSeats, sub.unit_price),
    card:               sub.card_co_nm && sub.card_no_masked ? { company: sub.card_co_nm, numberMasked: sub.card_no_masked } : null,
    provider:           sub.pg_provdr_code,
    currentPeriodStart: sub.crrnt_perd_bgng_dt?.toISOString() ?? null,
    currentPeriodEnd:   sub.crrnt_perd_end_dt?.toISOString() ?? null,
    nextBillAt:         sub.next_bill_dt?.toISOString() ?? null,
    failCnt:            sub.fail_cnt,
    lastFailAt:         sub.last_fail_dt?.toISOString() ?? null,
    cancelRequestedAt:  sub.cancel_reqst_dt?.toISOString() ?? null,
    endedAt:            sub.ended_dt?.toISOString() ?? null,
    endedReason:        (sub.ended_rsn_code as EndedReason | null) ?? null,
    opInProgress:       isBillingOperationLive(sub, now),
  };
}

export type BillingOverview = {
  /** 회원의 실효 플랜 (구독이 없어도 관리자 부여 BASIC 등일 수 있다) */
  plan:               PlanCode;
  subscription:       SubscriptionDto | null;
  usedSeats:          number;
  lockedProjectCount: number;
  product:            { code: string; name: string; unitPrice: number };
  /** 현재 PG 구현 — 화면이 Mock 안내 문구를 띄울 때 사용 */
  provider:           string;
};

export async function getBillingOverview(mberId: string): Promise<BillingOverview> {
  const [plan, sub, usedSeats, lockedProjectCount] = await Promise.all([
    getMemberEffectivePlan(mberId),
    findSubscription(mberId),
    countUsedSeats(mberId),
    countLockedProjects(mberId),
  ]);
  return {
    plan,
    subscription: sub ? toSubscriptionDto(sub) : null,
    usedSeats,
    lockedProjectCount,
    product:  { code: SPECODE_PRODUCT, name: product.name, unitPrice: product.unitPrice },
    provider: getPaymentGateway().provider,
  };
}

export type PaymentDto = {
  paymentId:   string;
  type:        PaymentType;
  status:      string;
  amount:      number;
  seatCnt:     number;
  periodStart: string | null;
  periodEnd:   string | null;
  receiptUrl:  string | null;
  failReason:  string | null;
  orderId:     string;
  approvedAt:  string | null;
  createdAt:   string;
  /** REFUND 행: 원 결제 ID · 환불 유형. 그 외 null */
  origPaymentId: string | null;
  refundReason:  string | null;
};

/** 결제 행 → DTO. 사용자 화면·관리자 화면이 같은 매핑을 쓴다 (한 곳) */
export function toPaymentDto(p: TbBlPayment): PaymentDto {
  return {
    paymentId:   p.pymnt_id,
    type:        p.pymnt_ty_code as PaymentType,
    status:      p.pymnt_sttus_code,
    amount:      p.amt,
    seatCnt:     p.seat_cnt,
    periodStart: p.perd_bgng_dt?.toISOString() ?? null,
    periodEnd:   p.perd_end_dt?.toISOString() ?? null,
    receiptUrl:  p.receipt_url,
    failReason:  p.fail_rsn_cn,
    orderId:     p.pg_order_id,
    approvedAt:  p.apprv_dt?.toISOString() ?? null,
    createdAt:   p.creat_dt.toISOString(),
    origPaymentId: p.orig_pymnt_id,
    refundReason:  p.refund_rsn_code,
  };
}

/** 결제 내역 — 최신순. 첫 결제 실패(구독 행 없음)도 mber_id 로 함께 나온다 */
export async function listPayments(mberId: string, limit = 50): Promise<PaymentDto[]> {
  const rows = await prisma.tbBlPayment.findMany({
    where:   { mber_id: mberId },
    orderBy: { creat_dt: "desc" },
    take:    limit,
  });
  return rows.map(toPaymentDto);
}

// ═══════════════════════════════════════════════════════════════════════════
// 카드 등록 (시작 / 변경)
// ═══════════════════════════════════════════════════════════════════════════

export type CardRegistrationPurpose = "start" | "change";

function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

/** 좌석 수 입력 검증 — 범위 + 사용 좌석 이상 */
function assertSeatCount(seatCnt: number, usedSeats: number): void {
  if (!Number.isInteger(seatCnt) || seatCnt < SEAT_INPUT_LIMITS.min || seatCnt > SEAT_INPUT_LIMITS.max) {
    throw new BillingError(
      E.SEAT_COUNT_INVALID,
      `좌석 수는 ${SEAT_INPUT_LIMITS.min}~${SEAT_INPUT_LIMITS.max} 사이여야 합니다.`,
      400,
    );
  }
  if (seatCnt < usedSeats) {
    throw new BillingError(
      E.SEAT_COUNT_INVALID,
      `현재 편집 멤버가 ${usedSeats}명이라 좌석을 ${usedSeats}개보다 적게 둘 수 없습니다. ` +
        "멤버를 뷰어로 바꾸거나 제거한 뒤 다시 시도해 주세요.",
      400,
      { usedSeats },
    );
  }
}

/**
 * 카드 등록 시작 — PG 창으로 보낼 정보를 돌려준다.
 *   start : 살아 있는 구독이 없어야 하고 seatCnt 필수
 *   change: 살아 있는 구독이 있어야 함
 * successUrl 에 purpose·seatCnt 를 실어 두면 콜백 화면이 그대로 서버에 넘긴다.
 * (서버는 콜백에서 좌석 수를 다시 검증하므로 URL 값을 신뢰해서 생기는 위험은 없다.)
 */
export async function beginCardRegistration(
  actor: BillingActorRef,
  purpose: CardRegistrationPurpose,
  seatCnt?: number,
): Promise<CardRegistrationStart> {
  const sub = await findSubscription(actor.mberId);
  const live = !!sub && isLiveSubscriptionStatus(sub.sbscrptn_sttus_code);

  if (purpose === "start") {
    if (live) throw new BillingError(E.ALREADY_SUBSCRIBED, "이미 구독 중입니다.", 409);
    if (seatCnt === undefined) throw new BillingError(E.SEAT_COUNT_INVALID, "좌석 수를 입력해 주세요.", 400);
    assertSeatCount(seatCnt, await countUsedSeats(actor.mberId));
  } else if (!live) {
    throw new BillingError(E.NO_SUBSCRIPTION, "변경할 구독이 없습니다.", 404);
  }

  const base = `${appUrl()}${BILLING_CALLBACK_PATH}?purpose=${purpose}`;
  const successUrl = purpose === "start" ? `${base}&seatCnt=${seatCnt}` : base;
  const failUrl    = `${base}&result=fail`;

  return getPaymentGateway().startCardRegistration({
    customerKey: buildCustomerKey(actor.mberId),
    successUrl,
    failUrl,
  });
}

export type CardRegistrationInput = {
  authKey:     string;
  customerKey: string;
  purpose:     CardRegistrationPurpose;
  seatCnt?:    number;
};

export type CardRegistrationOutcome =
  | { purpose: "start";  subscription: SubscriptionDto }
  | { purpose: "change"; subscription: SubscriptionDto; retry: RecurringChargeResult | null };

/** PG 콜백 — 빌링키 발급 후 목적에 따라 첫 결제 또는 카드 교체 */
export async function completeCardRegistration(
  actor: BillingActorRef,
  input: CardRegistrationInput,
  now = new Date(),
): Promise<CardRegistrationOutcome> {
  // 다른 사람의 authKey 를 내 계정에 붙이는 시도 차단 — customerKey 는 회원별 고정값
  if (input.customerKey !== buildCustomerKey(actor.mberId)) {
    throw new BillingError(E.CUSTOMER_KEY_MISMATCH, "카드 등록 정보가 현재 계정과 일치하지 않습니다.", 403);
  }

  const gw = getPaymentGateway();
  let issued: IssuedBillingKey;
  try {
    issued = await gw.issueBillingKey({ authKey: input.authKey, customerKey: input.customerKey });
  } catch (err) {
    console.error("[billing] 빌링키 발급 실패:", err);
    throw new BillingError(E.GATEWAY_UNAVAILABLE, "카드 등록에 실패했습니다. 다시 시도해 주세요.", 502);
  }

  if (input.purpose === "start") {
    if (input.seatCnt === undefined) throw new BillingError(E.SEAT_COUNT_INVALID, "좌석 수가 없습니다.", 400);
    const sub = await activateSubscription(actor, issued, input.seatCnt, now);
    return { purpose: "start", subscription: toSubscriptionDto(sub) };
  }

  // ── 카드 변경 ────────────────────────────────────────────────────────────
  const sub = await findSubscription(actor.mberId);
  if (!sub || !isLiveSubscriptionStatus(sub.sbscrptn_sttus_code)) {
    throw new BillingError(E.NO_SUBSCRIPTION, "변경할 구독이 없습니다.", 404);
  }
  // 청구 진행 중이면 카드를 바꾸지 않는다 — 결과 반영과 교차하면 어느 카드로 결제됐는지 흐려진다
  const updated = await guardedSubscriptionUpdate(sub.sbscrptn_id, {
    billing_key:     encryptBillingKey(issued.billingKey),
    card_co_nm:      issued.cardCompany,
    card_no_masked:  issued.cardNumberMasked,
    pg_provdr_code:  gw.provider,
    pg_customer_key: input.customerKey,
  }, now);

  // 재시도 중이었다면 새 카드로 바로 청구 — 사용자가 3일을 기다리지 않게
  let retry: RecurringChargeResult | null = null;
  if (updated.sbscrptn_sttus_code === S.PAST_DUE) {
    const r = await attemptRecurringCharge(updated, actor.email, now, "RETRY");
    // 배치가 같은 순간 재시도 중이면 결과를 알 수 없으니 "카드 변경됨" 만 알린다
    retry = r.ok || !r.skipped ? r : null;
  }
  const latest = (await findSubscription(actor.mberId)) ?? updated;
  return { purpose: "change", subscription: toSubscriptionDto(latest), retry };
}

/** 첫 결제 → ACTIVE. 실패하면 이력만 남기고 구독 행은 만들지 않는다(기존 행은 그대로) */
async function activateSubscription(
  actor: BillingActorRef,
  issued: IssuedBillingKey,
  seatCnt: number,
  now: Date,
): Promise<TbBlSubscription> {
  const existing = await findSubscription(actor.mberId);
  if (existing && isLiveSubscriptionStatus(existing.sbscrptn_sttus_code)) {
    throw new BillingError(E.ALREADY_SUBSCRIBED, "이미 구독 중입니다.", 409);
  }
  assertSeatCount(seatCnt, await countUsedSeats(actor.mberId));

  // 이중 결제 방지 — 구독 행이 아직 없을 수 있어 회원 행을 선점한다 (콜백 화면 새로고침·중복 제출 대비)
  if (!(await claimMemberForBilling(actor.mberId, now))) {
    throw concurrentOperationError();
  }

  const gw          = getPaymentGateway();
  const customerKey = buildCustomerKey(actor.mberId);
  const amount      = monthlyAmount(seatCnt, product.unitPrice);
  const orderId     = newOrderId(now);

  const charge = await gw.charge({
    billingKey:    issued.billingKey,
    customerKey,
    amount,
    orderId,
    orderName:     `${product.name} ${seatCnt}좌석 (1개월)`,
    customerEmail: actor.email,
  });

  if (!charge.ok) {
    await prisma.tbBlPayment.create({
      data: {
        sbscrptn_id:      existing?.sbscrptn_id ?? null,
        mber_id:          actor.mberId,
        pymnt_ty_code:    PAYMENT_TYPE.INITIAL,
        amt:              amount,
        seat_cnt:         seatCnt,
        pymnt_sttus_code: PAYMENT_STATUS.FAILED,
        pg_provdr_code:   gw.provider,
        pg_order_id:      orderId,
        fail_rsn_cn:      `${charge.code}: ${charge.message}`,
      },
    });
    throw new BillingError(E.PAYMENT_FAILED, `결제가 거절되었습니다. ${charge.message}`, 402, { pgCode: charge.code });
  }

  const periodStart = now;
  const periodEnd   = nextPeriodEnd(periodStart, kstDayOfMonth(periodStart));
  const encryptedKey = encryptBillingKey(issued.billingKey);

  const sub = await prisma.$transaction(async (tx) => {
    const s = await tx.tbBlSubscription.upsert({
      where: { mber_id_prdct_code: { mber_id: actor.mberId, prdct_code: SPECODE_PRODUCT } },
      create: {
        mber_id:             actor.mberId,
        prdct_code:          SPECODE_PRODUCT,
        sbscrptn_sttus_code: S.ACTIVE,
        seat_cnt:            seatCnt,
        pending_seat_cnt:    null,
        unit_price:          product.unitPrice,
        billing_key:         encryptedKey,
        card_co_nm:          issued.cardCompany,
        card_no_masked:      issued.cardNumberMasked,
        pg_provdr_code:      gw.provider,
        pg_customer_key:     customerKey,
        crrnt_perd_bgng_dt:  periodStart,
        crrnt_perd_end_dt:   periodEnd,
        next_bill_dt:        periodEnd,
        prentc_dt:           null,
        fail_cnt:            0,
        creat_dt:            now,
        mdfcn_dt:            now,
      },
      update: {
        // 재구독 — 종료된 행을 되살린다. 단가는 현재 판매가로 새로 계약
        sbscrptn_sttus_code: S.ACTIVE,
        seat_cnt:            seatCnt,
        pending_seat_cnt:    null,
        unit_price:          product.unitPrice,
        billing_key:         encryptedKey,
        card_co_nm:          issued.cardCompany,
        card_no_masked:      issued.cardNumberMasked,
        pg_provdr_code:      gw.provider,
        pg_customer_key:     customerKey,
        crrnt_perd_bgng_dt:  periodStart,
        crrnt_perd_end_dt:   periodEnd,
        next_bill_dt:        periodEnd,
        prentc_dt:           null,
        fail_cnt:            0,
        last_fail_dt:        null,
        cancel_reqst_dt:     null,
        ended_dt:            null,
        ended_rsn_code:      null,
        billing_op_token:    null,
        billing_op_started_dt: null,
        mdfcn_dt:            now,
      },
    });
    await tx.tbBlPayment.create({
      data: paidPaymentData({
        sbscrptnId: s.sbscrptn_id, mberId: actor.mberId, type: PAYMENT_TYPE.INITIAL, amount, seatCnt,
        periodStart, periodEnd, provider: gw.provider, orderId,
        paymentKey: charge.paymentKey, receiptUrl: charge.receiptUrl, approvedAt: charge.approvedAt,
      }),
    });
    await mirrorPlan(tx, actor.mberId, product.planCode, now);
    // 강등으로 잠겨 있던 프로젝트가 있으면 재결제로 전부 해제 (정책 §1-6 "재결제하면 전부 즉시 해제")
    await unlockAllOwnedProjects(actor.mberId, tx);
    return s;
  });

  await sendPaymentReceiptEmail({
    to: actor.email, productName: product.name, kind: "INITIAL", amount, seatCnt,
    periodStart, periodEnd, cardLabel: cardLabel(sub), receiptUrl: charge.receiptUrl, nextBillAt: periodEnd,
  });
  return sub;
}

// ═══════════════════════════════════════════════════════════════════════════
// 좌석
// ═══════════════════════════════════════════════════════════════════════════

export type SeatAdditionPreview = ProrationResult & {
  addSeats:         number;
  unitPrice:        number;
  newSeatCnt:       number;
  newMonthlyAmount: number;
  periodEnd:        string;
};

/** 좌석 추가 모달 — 일할 금액 미리보기 */
export async function previewSeatAddition(mberId: string, addSeats: number, now = new Date()): Promise<SeatAdditionPreview> {
  const sub = await requireActiveForSeatAdd(mberId, now);
  if (!Number.isInteger(addSeats) || addSeats < 1 || sub.seat_cnt + addSeats > SEAT_INPUT_LIMITS.max) {
    throw new BillingError(E.SEAT_COUNT_INVALID, `추가 좌석은 1개 이상, 합계 ${SEAT_INPUT_LIMITS.max}개 이하여야 합니다.`, 400);
  }
  const pr = prorationForAddedSeats({
    unitPrice: sub.unit_price, addSeats, now,
    periodStart: sub.crrnt_perd_bgng_dt!, periodEnd: sub.crrnt_perd_end_dt!,
  });
  return {
    ...pr,
    addSeats,
    unitPrice:        sub.unit_price,
    newSeatCnt:       sub.seat_cnt + addSeats,
    newMonthlyAmount: monthlyAmount(sub.seat_cnt + addSeats, sub.unit_price),
    periodEnd:        sub.crrnt_perd_end_dt!.toISOString(),
  };
}

/**
 * 좌석 추가는 ACTIVE 에서만 — 재시도 중이면 카드부터, 해지 예정이면 해지 취소부터.
 * 결제 주기가 이미 끝났는데 배치가 아직 갱신하지 않은 틈(하루 1회 배치)에는 남은 일수가 0 이라
 * 0원으로 좌석이 늘어나므로 거절한다 — 갱신 결제가 먼저다.
 */
async function requireActiveForSeatAdd(mberId: string, now: Date): Promise<TbBlSubscription> {
  const sub = await findSubscription(mberId);
  if (!sub || !isLiveSubscriptionStatus(sub.sbscrptn_sttus_code)) {
    throw new BillingError(E.NO_SUBSCRIPTION, "구독이 없습니다.", 404);
  }
  if (sub.sbscrptn_sttus_code === S.PAST_DUE) {
    throw new BillingError(E.INVALID_STATE, "정기 결제가 실패한 상태입니다. 결제 수단을 변경한 뒤 좌석을 추가할 수 있습니다.", 409);
  }
  if (sub.sbscrptn_sttus_code === S.CANCEL_SCHEDULED) {
    throw new BillingError(E.INVALID_STATE, "해지가 예약된 상태입니다. 해지를 취소한 뒤 좌석을 추가할 수 있습니다.", 409);
  }
  if (!sub.crrnt_perd_bgng_dt || !sub.crrnt_perd_end_dt) {
    throw new BillingError(E.INVALID_STATE, "결제 주기 정보가 없습니다. 운영자에게 문의해 주세요.", 500);
  }
  if (sub.crrnt_perd_end_dt <= now) {
    throw new BillingError(
      E.INVALID_STATE,
      "이번 결제 주기가 끝나 정기 결제를 기다리는 중입니다. 정기 결제가 처리된 뒤 좌석을 추가할 수 있습니다.",
      409,
    );
  }
  return sub;
}

export type SeatChangeResult =
  | { action: "ADDED";            seatCnt: number; addedSeats: number; amount: number; subscription: SubscriptionDto }
  | { action: "REDUCE_SCHEDULED"; seatCnt: number; pendingSeatCnt: number; appliesAt: string | null; subscription: SubscriptionDto }
  | { action: "REDUCE_CANCELED";  seatCnt: number; subscription: SubscriptionDto }
  | { action: "NO_CHANGE";        seatCnt: number; subscription: SubscriptionDto };

/**
 * PATCH seats — 목표 좌석 수 하나로 세 가지를 처리한다.
 *   현재보다 크면 즉시 일할 결제로 추가, 작으면 다음 결제일 축소 예약, 같으면 예약 취소.
 *   추가 결제가 성공하면 기존 축소 예약은 지운다(의도가 바뀐 것으로 본다 — 화면에서 안내).
 */
export async function changeSeats(actor: BillingActorRef, seatCnt: number, now = new Date()): Promise<SeatChangeResult> {
  const sub = await findSubscription(actor.mberId);
  if (!sub || !isLiveSubscriptionStatus(sub.sbscrptn_sttus_code)) {
    throw new BillingError(E.NO_SUBSCRIPTION, "구독이 없습니다.", 404);
  }
  const usedSeats = await countUsedSeats(actor.mberId);
  assertSeatCount(seatCnt, usedSeats);

  // ── 추가: 즉시 일할 결제 ────────────────────────────────────────────────
  if (seatCnt > sub.seat_cnt) {
    const active   = await requireActiveForSeatAdd(actor.mberId, now);
    const addSeats = seatCnt - active.seat_cnt;
    const pr = prorationForAddedSeats({
      unitPrice: active.unit_price, addSeats, now,
      periodStart: active.crrnt_perd_bgng_dt!, periodEnd: active.crrnt_perd_end_dt!,
    });
    if (!active.billing_key) {
      throw new BillingError(E.INVALID_STATE, "등록된 결제 수단이 없습니다. 결제 수단을 먼저 등록해 주세요.", 409);
    }
    // 0원 청구는 없다 — 남은 일수가 0 이거나 계산이 어긋난 경우 좌석만 늘어나는 사고 방지
    if (pr.amount <= 0) {
      throw new BillingError(E.INVALID_STATE, "일할 결제 금액이 0원이라 좌석을 추가할 수 없습니다. 정기 결제 뒤 다시 시도해 주세요.", 409);
    }
    // 이중 결제 방지 — 같은 구독 행을 다른 요청이 먼저 선점했으면 청구하지 않는다
    const opToken = await beginBillingOperation(active, now);
    if (!opToken) throw concurrentOperationError();

    const gw      = getPaymentGateway();
    const orderId = newOrderId(now);
    const charge  = await gw.charge({
      billingKey:    decryptBillingKey(active.billing_key),
      customerKey:   active.pg_customer_key,
      amount:        pr.amount,
      orderId,
      orderName:     `${product.name} 좌석 ${addSeats}개 추가 (남은 ${pr.remainingDays}일 일할)`,
      customerEmail: actor.email,
    });
    if (!charge.ok) {
      await prisma.tbBlPayment.create({
        data: {
          sbscrptn_id: active.sbscrptn_id, mber_id: actor.mberId, pymnt_ty_code: PAYMENT_TYPE.SEAT_ADD,
          amt: pr.amount, seat_cnt: addSeats, perd_bgng_dt: now, perd_end_dt: active.crrnt_perd_end_dt,
          pymnt_sttus_code: PAYMENT_STATUS.FAILED, pg_provdr_code: gw.provider, pg_order_id: orderId,
          fail_rsn_cn: `${charge.code}: ${charge.message}`,
        },
      });
      await releaseBillingOperation(active.sbscrptn_id, opToken, now);
      throw new BillingError(E.PAYMENT_FAILED, `좌석 추가 결제가 거절되었습니다. ${charge.message}`, 402, { pgCode: charge.code });
    }

    const updated = await prisma.$transaction(async (tx) => {
      // 내 토큰이 그대로일 때만 반영 — 2분 넘어 다른 작업이 인계했으면 구독은 건드리지 않는다
      const applied = await tx.tbBlSubscription.updateMany({
        where: { sbscrptn_id: active.sbscrptn_id, billing_op_token: opToken },
        data:  { seat_cnt: seatCnt, pending_seat_cnt: null, billing_op_token: null, billing_op_started_dt: null, mdfcn_dt: now },
      });
      await tx.tbBlPayment.create({
        data: paidPaymentData({
          sbscrptnId: active.sbscrptn_id, mberId: actor.mberId, type: PAYMENT_TYPE.SEAT_ADD, amount: pr.amount,
          seatCnt: addSeats, periodStart: now, periodEnd: active.crrnt_perd_end_dt!, provider: gw.provider, orderId,
          paymentKey: charge.paymentKey, receiptUrl: charge.receiptUrl, approvedAt: charge.approvedAt,
        }),
      });
      if (applied.count !== 1) {
        console.error(`[billing] CRITICAL 좌석 추가 결제는 승인(${orderId})됐으나 구독 반영 실패 — 토큰 인계됨. sub=${active.sbscrptn_id} 수동 대조 필요`);
        throw new BillingError(E.RECONCILE_REQUIRED, "결제는 완료되었지만 구독 반영이 지연되었습니다. 운영자가 확인 후 반영합니다.", 500);
      }
      return (await tx.tbBlSubscription.findUniqueOrThrow({ where: { sbscrptn_id: active.sbscrptn_id } }));
    }).catch(async (err) => {
      // 결제 이력이 롤백되지 않도록 — 반영 실패 시 이력만 다시 남긴다
      if (err instanceof BillingError && err.code === E.RECONCILE_REQUIRED) {
        await prisma.tbBlPayment.create({
          data: paidPaymentData({
            sbscrptnId: active.sbscrptn_id, mberId: actor.mberId, type: PAYMENT_TYPE.SEAT_ADD, amount: pr.amount,
            seatCnt: addSeats, periodStart: now, periodEnd: active.crrnt_perd_end_dt!, provider: gw.provider, orderId,
            paymentKey: charge.paymentKey, receiptUrl: charge.receiptUrl, approvedAt: charge.approvedAt,
          }),
        }).catch((e) => console.error("[billing] CRITICAL 결제 이력 기록도 실패:", e));
      }
      throw err;
    });

    await sendPaymentReceiptEmail({
      to: actor.email, productName: product.name, kind: "SEAT_ADD", amount: pr.amount, seatCnt: addSeats,
      periodStart: now, periodEnd: active.crrnt_perd_end_dt, cardLabel: cardLabel(updated),
      receiptUrl: charge.receiptUrl, nextBillAt: updated.next_bill_dt,
    });
    return { action: "ADDED", seatCnt, addedSeats: addSeats, amount: pr.amount, subscription: toSubscriptionDto(updated) };
  }

  // ── 축소: 다음 결제일 적용 예약 ─────────────────────────────────────────
  if (seatCnt < sub.seat_cnt) {
    const updated = await guardedSubscriptionUpdate(sub.sbscrptn_id, { pending_seat_cnt: seatCnt }, now);
    return {
      action: "REDUCE_SCHEDULED", seatCnt: sub.seat_cnt, pendingSeatCnt: seatCnt,
      appliesAt: sub.next_bill_dt?.toISOString() ?? null, subscription: toSubscriptionDto(updated),
    };
  }

  // ── 같음: 축소 예약 취소 ────────────────────────────────────────────────
  if (sub.pending_seat_cnt !== null) {
    const updated = await guardedSubscriptionUpdate(sub.sbscrptn_id, { pending_seat_cnt: null }, now);
    return { action: "REDUCE_CANCELED", seatCnt, subscription: toSubscriptionDto(updated) };
  }
  return { action: "NO_CHANGE", seatCnt, subscription: toSubscriptionDto(sub) };
}

// ═══════════════════════════════════════════════════════════════════════════
// 해지 / 해지 취소
// ═══════════════════════════════════════════════════════════════════════════

export type CancelResult = {
  status:     SubscriptionStatus;
  /** CANCEL_SCHEDULED 면 이 날까지 이용 가능. 즉시 종료면 null */
  periodEnd:  string | null;
  subscription: SubscriptionDto;
};

/**
 * 해지 — 기간 말 적용(정책 §1-7). ACTIVE → CANCEL_SCHEDULED.
 * PAST_DUE(결제 실패로 새 기간을 결제하지 못한 상태)에서 해지하면 남은 유료 기간이 없으므로 즉시 종료.
 */
export async function cancelSubscription(actor: BillingActorRef, now = new Date()): Promise<CancelResult> {
  const sub = await findSubscription(actor.mberId);
  if (!sub || !isLiveSubscriptionStatus(sub.sbscrptn_sttus_code)) {
    throw new BillingError(E.NO_SUBSCRIPTION, "해지할 구독이 없습니다.", 404);
  }

  if (sub.sbscrptn_sttus_code === S.CANCEL_SCHEDULED) {
    return { status: S.CANCEL_SCHEDULED, periodEnd: sub.crrnt_perd_end_dt?.toISOString() ?? null, subscription: toSubscriptionDto(sub) };
  }

  if (sub.sbscrptn_sttus_code === S.PAST_DUE) {
    await terminateSubscription(sub, S.CANCELED, now, actor.email, ENDED_REASON.USER_CANCEL);
    const ended = (await findSubscription(actor.mberId))!;
    return { status: S.CANCELED, periodEnd: null, subscription: toSubscriptionDto(ended) };
  }

  const updated = await guardedSubscriptionUpdate(sub.sbscrptn_id, { sbscrptn_sttus_code: S.CANCEL_SCHEDULED, cancel_reqst_dt: now }, now);
  if (updated.crrnt_perd_end_dt) {
    await sendCancelConfirmedEmail({ to: actor.email, productName: product.name, periodEnd: updated.crrnt_perd_end_dt });
  }
  return { status: S.CANCEL_SCHEDULED, periodEnd: updated.crrnt_perd_end_dt?.toISOString() ?? null, subscription: toSubscriptionDto(updated) };
}

/** 해지 취소 — 기간이 끝나기 전이면 ACTIVE 로 복귀 */
export async function uncancelSubscription(actor: BillingActorRef, now = new Date()): Promise<SubscriptionDto> {
  const sub = await findSubscription(actor.mberId);
  if (!sub || sub.sbscrptn_sttus_code !== S.CANCEL_SCHEDULED) {
    throw new BillingError(E.INVALID_STATE, "해지 예약 상태가 아닙니다.", 409);
  }
  if (sub.crrnt_perd_end_dt && sub.crrnt_perd_end_dt <= now) {
    throw new BillingError(E.INVALID_STATE, "이용 기간이 이미 끝나 해지를 취소할 수 없습니다. 새로 구독해 주세요.", 409);
  }
  const updated = await guardedSubscriptionUpdate(sub.sbscrptn_id, { sbscrptn_sttus_code: S.ACTIVE, cancel_reqst_dt: null }, now);
  return toSubscriptionDto(updated);
}

// ═══════════════════════════════════════════════════════════════════════════
// 정기 결제 / 종료 (배치·카드 변경·탈퇴에서 호출)
// ═══════════════════════════════════════════════════════════════════════════

export type RecurringChargeResult =
  /** applied=false: 결제는 승인됐지만 토큰이 인계돼 구독에 반영하지 못함 — 이력만 남김, 운영자 수동 대조 */
  | { ok: true;  periodEnd: Date; amount: number; seatCnt: number; applied: boolean }
  | { ok: false; expired: boolean; failCnt: number; reason: string; skipped?: false }
  /** 다른 요청(배치·카드 변경)이 같은 구독을 먼저 청구 중 — 시도하지 않았고 실패로 세지도 않는다 */
  | { ok: false; skipped: true; expired: false; failCnt: number; reason: string };

/**
 * 정기 결제 1회 시도.
 *   - 새 주기는 이전 주기 종료 시각부터 이어진다(재시도로 며칠 늦어도 이용은 연속이었으므로).
 *   - 축소 예약(pending_seat_cnt)은 이 결제부터 적용.
 *   - 실패: fail_cnt+1 → PAST_DUE + 실패 메일. 재시도 소진(초기 1회 + 3회)이면 EXPIRED 강등.
 */
export async function attemptRecurringCharge(
  sub: TbBlSubscription,
  email: string,
  now: Date,
  kind: "RENEWAL" | "RETRY",
): Promise<RecurringChargeResult> {
  // 이중 결제 방지 — 배치와 카드 변경 즉시 재결제가 겹칠 수 있다. 선점 실패면 청구 없이 물러난다.
  const opToken = await beginBillingOperation(sub, now);
  if (!opToken) {
    return { ok: false, skipped: true, expired: false, failCnt: sub.fail_cnt, reason: "다른 결제 처리가 진행 중" };
  }

  const gw      = getPaymentGateway();
  const seatCnt = sub.pending_seat_cnt ?? sub.seat_cnt;
  const amount  = monthlyAmount(seatCnt, sub.unit_price);
  const orderId = newOrderId(now);

  // 새 주기 — 이전 종료 시각에서 이어 붙인다. 한 달 넘게 지연된 비정상 상황이면 지금부터.
  const anchorDay = await resolveAnchorDay(sub, now);
  let periodStart = sub.crrnt_perd_end_dt ?? now;
  let periodEnd   = nextPeriodEnd(periodStart, anchorDay);
  if (periodEnd <= now) {
    periodStart = now;
    periodEnd   = nextPeriodEnd(now, anchorDay);
  }

  const chargeResult = sub.billing_key
    ? await gw.charge({
        billingKey:    decryptBillingKey(sub.billing_key),
        customerKey:   sub.pg_customer_key,
        amount,
        orderId,
        orderName:     `${product.name} ${seatCnt}좌석 (정기 결제)`,
        customerEmail: email,
      })
    : { ok: false as const, code: "NO_BILLING_KEY", message: "등록된 결제 수단이 없습니다." };

  // ── 성공 ────────────────────────────────────────────────────────────────
  if (chargeResult.ok) {
    const applied = await prisma.$transaction(async (tx) => {
      // 결제 이력은 무조건 남긴다 — 돈이 움직였다
      await tx.tbBlPayment.create({
        data: paidPaymentData({
          sbscrptnId: sub.sbscrptn_id, mberId: sub.mber_id, type: PAYMENT_TYPE.RECURRING, amount, seatCnt,
          periodStart, periodEnd, provider: gw.provider, orderId,
          paymentKey: chargeResult.paymentKey, receiptUrl: chargeResult.receiptUrl, approvedAt: chargeResult.approvedAt,
        }),
      });
      // 구독 반영은 내 토큰이 그대로일 때만 (토큰 인계 = 2분 초과 → 다른 작업이 상태를 바꿨을 수 있음)
      const r = await tx.tbBlSubscription.updateMany({
        where: { sbscrptn_id: sub.sbscrptn_id, billing_op_token: opToken },
        data: {
          sbscrptn_sttus_code: S.ACTIVE,
          seat_cnt:            seatCnt,
          pending_seat_cnt:    null,
          crrnt_perd_bgng_dt:  periodStart,
          crrnt_perd_end_dt:   periodEnd,
          next_bill_dt:        periodEnd,
          prentc_dt:           null,
          fail_cnt:            0,
          last_fail_dt:        null,
          billing_op_token:    null,
          billing_op_started_dt: null,
          mdfcn_dt:            now,
        },
      });
      if (r.count !== 1) return false;
      await mirrorPlan(tx, sub.mber_id, product.planCode, now);
      await unlockAllOwnedProjects(sub.mber_id, tx);
      return true;
    });
    if (!applied) {
      console.error(`[billing] CRITICAL 정기 결제 승인(${orderId})됐으나 구독 반영 실패 — 토큰 인계됨. sub=${sub.sbscrptn_id} 수동 대조 필요`);
      return { ok: true, periodEnd, amount, seatCnt, applied: false };
    }
    const updated = (await prisma.tbBlSubscription.findUnique({ where: { sbscrptn_id: sub.sbscrptn_id } })) ?? sub;
    await sendPaymentReceiptEmail({
      to: email, productName: product.name, kind: "RECURRING", amount, seatCnt, periodStart, periodEnd,
      cardLabel: cardLabel(updated), receiptUrl: chargeResult.receiptUrl, nextBillAt: periodEnd,
    });
    return { ok: true, periodEnd, amount, seatCnt, applied: true };
  }

  // ── 실패 ────────────────────────────────────────────────────────────────
  const failCnt = sub.fail_cnt + 1;
  const reason  = `${chargeResult.code}: ${chargeResult.message}`;
  await prisma.tbBlPayment.create({
    data: {
      sbscrptn_id: sub.sbscrptn_id, mber_id: sub.mber_id, pymnt_ty_code: PAYMENT_TYPE.RECURRING,
      amt: amount, seat_cnt: seatCnt, perd_bgng_dt: periodStart, perd_end_dt: periodEnd,
      pymnt_sttus_code: PAYMENT_STATUS.FAILED, pg_provdr_code: gw.provider, pg_order_id: orderId,
      fail_rsn_cn: reason,
    },
  });

  // 초기 실패(1) + 재시도 3회(2,3,4) 를 다 쓰면 강등 — 종료는 내 토큰으로 이어서 처리
  if (failCnt > RETRY_POLICY.maxRetryCount) {
    const r = await prisma.tbBlSubscription.updateMany({
      where: { sbscrptn_id: sub.sbscrptn_id, billing_op_token: opToken },
      data:  { fail_cnt: failCnt, last_fail_dt: now, mdfcn_dt: now },
    });
    if (r.count !== 1) {
      console.error(`[billing] 결제 실패 반영 실패 — 토큰 인계됨. sub=${sub.sbscrptn_id}`);
      return { ok: false, expired: false, failCnt, reason };
    }
    const latest = (await prisma.tbBlSubscription.findUnique({ where: { sbscrptn_id: sub.sbscrptn_id } }))!;
    await terminateSubscription(latest, S.EXPIRED, now, email, ENDED_REASON.PAYMENT_RETRY_EXHAUSTED, { opToken });
    return { ok: false, expired: true, failCnt, reason };
  }

  const r = await prisma.tbBlSubscription.updateMany({
    where: { sbscrptn_id: sub.sbscrptn_id, billing_op_token: opToken },
    data:  { sbscrptn_sttus_code: S.PAST_DUE, fail_cnt: failCnt, last_fail_dt: now, billing_op_token: null, billing_op_started_dt: null, mdfcn_dt: now },
  });
  if (r.count !== 1) {
    console.error(`[billing] 결제 실패 반영 실패 — 토큰 인계됨. sub=${sub.sbscrptn_id}`);
    return { ok: false, expired: false, failCnt, reason };
  }
  await sendPaymentFailedEmail({
    to: email, productName: product.name, amount, attemptNo: failCnt,
    nextRetryAt: addDays(now, RETRY_POLICY.intervalDays), reason: chargeResult.message,
  });
  void kind;  // 회차 표기는 fail_cnt 로 충분 — kind 는 배치 로그 메타에서만 쓴다
  return { ok: false, expired: false, failCnt, reason };
}

export type TerminationStatus = typeof S.CANCELED | typeof S.EXPIRED;
export type TerminationResult = { lockedCount: number; autoUnlockedProjectId: string | null };

/**
 * 구독 종료의 트랜잭션 본체 — 상태·종료 사유·빌링키 삭제·FREE 미러·잠금·자동 해제.
 *   status: CANCELED(해지·탈퇴·관리자·환불) | EXPIRED(재시도 소진)
 *   endedReason: 왜 끝났는지 (ended_rsn_code)
 *   opToken: 결제 작업 안에서 이어서 종료할 때(재시도 소진) 내 토큰. 없으면 "토큰 없음/만료" 조건으로 갱신.
 * 조건에 맞는 행이 없으면(다른 결제 작업 진행 중) 409 — 호출자의 트랜잭션이 롤백된다.
 * 관리자 환불(청약철회)처럼 같은 트랜잭션에서 다른 일을 함께 해야 하는 호출자가 쓴다.
 */
export async function terminateSubscriptionTx(
  tx: Prisma.TransactionClient,
  sub: TbBlSubscription,
  status: TerminationStatus,
  now: Date,
  endedReason: EndedReason,
  opts: { opToken?: string } = {},
): Promise<TerminationResult> {
  const r = await tx.tbBlSubscription.updateMany({
    where: { sbscrptn_id: sub.sbscrptn_id, ...opTokenWhere(opts.opToken, now) },
    data: {
      sbscrptn_sttus_code: status,
      ended_dt:            now,
      ended_rsn_code:      endedReason,
      billing_key:         null,
      pending_seat_cnt:    null,
      next_bill_dt:        null,
      billing_op_token:    null,
      billing_op_started_dt: null,
      mdfcn_dt:            now,
    },
  });
  if (r.count !== 1) throw concurrentOperationError();
  await mirrorPlan(tx, sub.mber_id, "FREE", now);
  const lockedCount = await lockAllOwnedProjects(sub.mber_id, now, tx);
  const autoUnlockedProjectId = await autoUnlockIfSingle(sub.mber_id, tx);
  return { lockedCount: autoUnlockedProjectId ? lockedCount - 1 : lockedCount, autoUnlockedProjectId };
}

/** 종료 안내 메일 — 커밋 뒤에 호출 (잠긴 수·자동 해제 프로젝트명 포함) */
export async function sendTerminationNotice(
  sub: TbBlSubscription,
  status: TerminationStatus,
  email: string | null,
  result: TerminationResult,
): Promise<void> {
  if (!email) return;
  const autoName = result.autoUnlockedProjectId
    ? (await prisma.tbPjProject.findUnique({ where: { prjct_id: result.autoUnlockedProjectId }, select: { prjct_nm: true } }))?.prjct_nm ?? null
    : null;
  await sendDowngradedEmail({
    to: email, productName: product.name, reason: status,
    lockedCount: await countLockedProjects(sub.mber_id), autoUnlockedProjectName: autoName,
  });
}

/**
 * 구독 종료 → FREE 강등 + 소유 프로젝트 전부 잠금 (+ 1개뿐이면 자동 해제) + 안내 메일.
 * 빌링키는 지운다 — 종료된 구독으로 다시 출금될 길을 없앤다. 재구독은 카드를 다시 등록한다.
 */
export async function terminateSubscription(
  sub: TbBlSubscription,
  status: TerminationStatus,
  now: Date,
  email: string | null,
  endedReason: EndedReason,
  opts: { opToken?: string } = {},
): Promise<TerminationResult> {
  const result = await prisma.$transaction((tx) => terminateSubscriptionTx(tx, sub, status, now, endedReason, opts));
  await sendTerminationNotice(sub, status, email, result);
  return result;
}

/**
 * 회원 탈퇴 — 살아 있는 구독을 CANCELED 로 닫고 빌링키를 지운다 (정책 §1-10: 안 하면 탈퇴자 카드에서 계속 출금).
 * 탈퇴 라우트의 트랜잭션 안에서 호출. 프로젝트는 탈퇴 라우트가 보관 삭제하므로 여기서 잠그지 않는다.
 */
export async function withdrawSubscription(tx: Prisma.TransactionClient, mberId: string, now: Date): Promise<boolean> {
  const sub = await findSubscription(mberId, tx);
  if (!sub || !isLiveSubscriptionStatus(sub.sbscrptn_sttus_code)) return false;
  // 청구 진행 중이면 탈퇴를 잠시 막는다(409) — 결제 결과와 교차하면 "돈은 받고 탈퇴" 가 된다. 몇 초 뒤 재시도로 충분
  const r = await tx.tbBlSubscription.updateMany({
    where: { sbscrptn_id: sub.sbscrptn_id, ...opTokenWhere(undefined, now) },
    data: {
      sbscrptn_sttus_code: S.CANCELED,
      cancel_reqst_dt:     sub.cancel_reqst_dt ?? now,
      ended_dt:            now,
      ended_rsn_code:      ENDED_REASON.MEMBER_WITHDRAWAL,
      billing_key:         null,
      pending_seat_cnt:    null,
      next_bill_dt:        null,
      billing_op_token:    null,
      billing_op_started_dt: null,
      mdfcn_dt:            now,
    },
  });
  if (r.count !== 1) throw concurrentOperationError();
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// 내부 헬퍼
// ═══════════════════════════════════════════════════════════════════════════

/** 회원 플랜 미러 — 구독이 플랜의 원천. 유료는 만료일 없음(NULL), FREE 도 NULL */
async function mirrorPlan(db: Db, mberId: string, planCode: PlanCode, now: Date): Promise<void> {
  await db.tbCmMember.update({
    where: { mber_id: mberId },
    data:  { plan_code: planCode, plan_expire_dt: null, mdfcn_dt: now },
  });
}

// ─── 결제 작업 토큰 ──────────────────────────────────────────────────────────

/** 토큰이 살아 있는가 — 있고, 발급 후 만료 시간(2분)이 지나지 않았다 */
export function isBillingOperationLive(sub: TbBlSubscription, now: Date): boolean {
  return !!sub.billing_op_token && !!sub.billing_op_started_dt &&
    sub.billing_op_started_dt.getTime() > now.getTime() - BILLING_OP_TIMEOUT_MS;
}

/**
 * "이 갱신을 지금 해도 되는가" 의 WHERE 조각.
 *   opToken 있음 → 내 토큰이 그대로일 때만 (결제 작업 안에서 이어서 갱신)
 *   opToken 없음 → 토큰이 없거나 만료됐을 때만 (결제 작업 밖의 일반 변경)
 */
function opTokenWhere(opToken: string | undefined, now: Date): Prisma.TbBlSubscriptionWhereInput {
  if (opToken) return { billing_op_token: opToken };
  return {
    OR: [
      { billing_op_token: null },
      { billing_op_started_dt: { lt: new Date(now.getTime() - BILLING_OP_TIMEOUT_MS) } },
    ],
  };
}

/**
 * 결제 작업 시작 — 읽은 버전(mdfcn_dt)이 그대로이고 토큰이 없거나 만료됐을 때만 내 토큰을 심는다.
 * UPDATE 한 문장이 원자적이라 두 요청이 같은 행을 동시에 읽어도 한 쪽만 1건을 갱신한다.
 * mdfcn_dt 도 함께 올려 두어(읽은 값 +1ms 이상) 같은 버전으로 다시 선점하지 못하게 한다.
 * 반환: 발급된 토큰 또는 null(다른 결제 진행 중)
 */
async function beginBillingOperation(sub: TbBlSubscription, now: Date): Promise<string | null> {
  const token   = randomUUID();
  const claimAt = new Date(Math.max(now.getTime(), sub.mdfcn_dt.getTime() + 1));
  const r = await prisma.tbBlSubscription.updateMany({
    where: { sbscrptn_id: sub.sbscrptn_id, mdfcn_dt: sub.mdfcn_dt, ...opTokenWhere(undefined, now) },
    data:  { billing_op_token: token, billing_op_started_dt: now, mdfcn_dt: claimAt },
  });
  return r.count === 1 ? token : null;
}

/** 결제 작업 해제 — 청구가 거절돼 반영할 것이 없을 때. 내 토큰일 때만 지운다 */
async function releaseBillingOperation(sbscrptnId: string, opToken: string, now: Date): Promise<void> {
  await prisma.tbBlSubscription.updateMany({
    where: { sbscrptn_id: sbscrptnId, billing_op_token: opToken },
    data:  { billing_op_token: null, billing_op_started_dt: null, mdfcn_dt: now },
  });
}

/**
 * 결제 작업 밖의 일반 변경(해지·해지 취소·축소 예약·카드 교체·연기 등) — 토큰이 없거나 만료됐을 때만.
 * 0건이면 지금 PG 청구가 진행 중 → 409. 성공 시 갱신된 행을 돌려준다.
 */
export async function guardedSubscriptionUpdate(
  sbscrptnId: string,
  data: Prisma.TbBlSubscriptionUpdateManyMutationInput,
  now: Date,
  db: Db = prisma,
): Promise<TbBlSubscription> {
  const r = await db.tbBlSubscription.updateMany({
    where: { sbscrptn_id: sbscrptnId, ...opTokenWhere(undefined, now) },
    data:  { ...data, mdfcn_dt: now },
  });
  if (r.count !== 1) throw concurrentOperationError();
  return db.tbBlSubscription.findUniqueOrThrow({ where: { sbscrptn_id: sbscrptnId } });
}

/**
 * 첫 결제용 선점 — 구독 행이 없을 수 있으므로 회원 행의 mdfcn_dt 를 같은 방식으로 쓴다.
 * 프로필 수정 같은 다른 갱신과 겹치면 드물게 409 가 나지만, 다시 시도하면 된다(이중 결제보다 낫다).
 */
async function claimMemberForBilling(mberId: string, now: Date): Promise<boolean> {
  const member = await prisma.tbCmMember.findUnique({ where: { mber_id: mberId }, select: { mdfcn_dt: true } });
  if (!member) return false;
  const base    = member.mdfcn_dt?.getTime() ?? 0;
  const claimAt = new Date(Math.max(now.getTime(), base + 1));
  const r = await prisma.tbCmMember.updateMany({
    where: { mber_id: mberId, mdfcn_dt: member.mdfcn_dt },
    data:  { mdfcn_dt: claimAt },
  });
  return r.count === 1;
}

export function concurrentOperationError(): BillingError {
  return new BillingError(
    E.CONCURRENT_OPERATION,
    "같은 구독에 대한 결제 처리가 이미 진행 중입니다. 잠시 후 구독 화면을 새로 고쳐 결과를 확인해 주세요.",
    409,
  );
}

/** 주문 ID — 시도마다 고유. 토스 규칙(6~64자, 영문·숫자·-_) 충족 */
function newOrderId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  return `SPC-${stamp}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function cardLabel(sub: TbBlSubscription): string | null {
  return sub.card_co_nm && sub.card_no_masked ? `${sub.card_co_nm} ${sub.card_no_masked}` : null;
}

/**
 * 결제일 기준(anchor) — 이 구독의 마지막 시작 결제(INITIAL PAID) 시각의 KST 일자.
 * 31일에 시작하면 2월엔 28일에 결제하지만 3월엔 다시 31일로 돌아오게 하기 위해 필요하다.
 * 이력이 없으면 현재 주기 시작일로 대체.
 */
async function resolveAnchorDay(sub: TbBlSubscription, now: Date): Promise<number> {
  const initial = await prisma.tbBlPayment.findFirst({
    where:   { sbscrptn_id: sub.sbscrptn_id, pymnt_ty_code: PAYMENT_TYPE.INITIAL, pymnt_sttus_code: PAYMENT_STATUS.PAID },
    orderBy: { creat_dt: "desc" },
    select:  { perd_bgng_dt: true, apprv_dt: true },
  });
  const base = initial?.perd_bgng_dt ?? initial?.apprv_dt ?? sub.crrnt_perd_bgng_dt ?? now;
  return kstDayOfMonth(base);
}

function paidPaymentData(p: {
  sbscrptnId: string; mberId: string; type: PaymentType; amount: number; seatCnt: number;
  periodStart: Date; periodEnd: Date; provider: string; orderId: string;
  paymentKey: string; receiptUrl: string | null; approvedAt: Date;
}): Prisma.TbBlPaymentUncheckedCreateInput {
  return {
    sbscrptn_id:      p.sbscrptnId,
    mber_id:          p.mberId,
    pymnt_ty_code:    p.type,
    amt:              p.amount,
    seat_cnt:         p.seatCnt,
    perd_bgng_dt:     p.periodStart,
    perd_end_dt:      p.periodEnd,
    pymnt_sttus_code: PAYMENT_STATUS.PAID,
    pg_provdr_code:   p.provider,
    pg_pymnt_key:     p.paymentKey,
    pg_order_id:      p.orderId,
    receipt_url:      p.receiptUrl,
    apprv_dt:         p.approvedAt,
  };
}
