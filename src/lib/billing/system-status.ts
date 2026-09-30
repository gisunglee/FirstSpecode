/**
 * billing/system-status — 관리자 "결제 시스템 안내" 화면의 실시간 상태 (SUPER_ADMIN 전용 API 가 호출)
 *
 * 역할:
 *   - 지금 결제가 어떤 모드로 돌고 있는지(Mock/Toss), 필요한 환경변수가 설정돼 있는지(값은 절대 노출하지 않고 존재 여부만),
 *     일일 배치가 언제 마지막으로 돌았고 외부 cron 이 실제로 부르고 있는지, 확정 안 된 결제·웹훅 실패가 있는지를 한 번에 돌려준다.
 *   - 안내 화면의 설명 텍스트는 화면 파일에 있고, 여기는 "현재 값"만 계산한다.
 *
 * 왜 따로 두는가:
 *   getBillingSummary 는 운영 지표(구독 수·매출)용이다. 여기는 "설정이 제대로 됐는가"라는 다른 질문에 답한다.
 *   환경변수 이름과 판정 기준이 한 곳에 모여 있어 env 가 추가되면 여기만 고친다.
 */

import { prisma } from "@/lib/prisma";
import { BILLING_OPEN } from "@/app/intro/_components/siteInfo";
import { BILLING_DAILY_JOB_TYPE } from "./daily";
import { getPaymentGateway } from "./gateway";
import { LIVE_SUBSCRIPTION_STATUSES, PAYMENT_STATUS, PAYMENT_TYPE, PENDING_PAYMENT_STALE_MS, PG_EVENT_STATUS } from "./constants";

const DAY_MS = 24 * 60 * 60 * 1000;
/** 하루 1회 cron 이 정상이면 마지막 CRON 실행이 이 안에 있어야 한다 (여유 2시간) */
const CRON_HEALTHY_WINDOW_MS = 26 * 60 * 60 * 1000;

export type EnvCheck = {
  name:     string;
  /** 설정됨 여부 — 값은 절대 내려보내지 않는다 */
  set:      boolean;
  /** 이 환경에서 반드시 있어야 하는가 */
  required: boolean;
  note:     string;
};

export type BillingSystemStatus = {
  checkedAt:   string;
  nodeEnv:     string;
  /** 현재 게이트웨이 — MOCK | TOSS */
  provider:    string;
  /** 토스 키가 테스트 키인가 (live_ 면 false). Mock 이면 null */
  tossTestMode: boolean | null;
  /** 인트로 요금제 버튼·푸터 사업자 표기 노출 여부 (siteInfo.BILLING_OPEN) */
  billingOpen: boolean;
  env:         EnvCheck[];
  batch: {
    lastAny:  { status: string; trigger: string; startedAt: string; targetCnt: number; successCnt: number; failCnt: number; skipCnt: number } | null;
    lastCron: { status: string; startedAt: string } | null;
    /** 마지막 CRON 실행이 26시간 안 → 외부 cron 이 살아 있다고 본다 */
    cronHealthy: boolean;
  };
  counts: {
    liveSubscriptions:      number;
    liveByProvider:         Record<string, number>;
    /** 확정 안 된 결제 시도 (10분 넘은 것) — 0 이어야 정상 */
    stalePendingCharges:    number;
    pendingChargesTotal:    number;
    /** 최근 24시간 웹훅 처리 실패 */
    webhookFailed24h:       number;
    webhookReceived24h:     number;
    /** 승인은 확인됐는데 구독에 반영 못 한 결제(미반영 표식) */
    paidUnapplied:          number;
  };
};

function envSet(name: string): boolean {
  return !!process.env[name]?.trim();
}

export async function getBillingSystemStatus(now = new Date()): Promise<BillingSystemStatus> {
  const gw = getPaymentGateway();
  const isProd = process.env.NODE_ENV === "production";
  const isToss = gw.provider === "TOSS";
  const secret = process.env.API_KEY_SECRET ?? "";

  const env: EnvCheck[] = [
    { name: "PAYMENT_GATEWAY",   set: envSet("PAYMENT_GATEWAY"),   required: false, note: "비우면 mock. 토스 전환 시 toss" },
    { name: "TOSS_CLIENT_KEY",   set: envSet("TOSS_CLIENT_KEY"),   required: isToss, note: "API 개별 연동 키(결제위젯 키 아님). 브라우저로 나가는 공개 키" },
    { name: "TOSS_SECRET_KEY",   set: envSet("TOSS_SECRET_KEY"),   required: isToss, note: "서버 전용. 유출 시 즉시 개발자센터에서 재발급" },
    { name: "API_KEY_SECRET",    set: secret.length >= 32,          required: isProd, note: "빌링키 암호화·customerKey HMAC·state 서명 키. 32자 이상. 한 번 정하면 바꾸지 않는다" },
    { name: "BATCH_CRON_SECRET", set: envSet("BATCH_CRON_SECRET"), required: isProd, note: "외부 cron 이 일일 배치를 부를 때 X-Cron-Secret 헤더" },
    { name: "SMTP_HOST",         set: envSet("SMTP_HOST"),         required: isProd, note: "영수증·실패·사전 안내·강등·관리자 알림 메일 5종" },
    { name: "SMTP_USER",         set: envSet("SMTP_USER"),         required: isProd, note: "" },
    { name: "SMTP_FROM",         set: envSet("SMTP_FROM"),         required: isProd, note: "" },
    { name: "APP_URL",           set: envSet("APP_URL"),           required: isProd, note: "PG 콜백 successUrl/failUrl 의 출처. 운영은 https://www.specode.co.kr" },
    { name: "MOCK_WEBHOOK_SECRET", set: envSet("MOCK_WEBHOOK_SECRET"), required: false, note: "Mock 웹훅 경로 열쇠. 비우면 경로 닫힘(정상)" },
    { name: "BILLING_MOCK_ALLOWED_EMAIL_DOMAINS", set: envSet("BILLING_MOCK_ALLOWED_EMAIL_DOMAINS"), required: false, note: "Mock 으로 구독 시작 가능한 도메인. 비우면 bareun.io" },
  ];

  const staleBefore = new Date(now.getTime() - PENDING_PAYMENT_STALE_MS);
  const dayAgo = new Date(now.getTime() - DAY_MS);

  const [lastAny, lastCron, liveRows, stalePending, pendingTotal, whFailed, whReceived, unapplied] = await Promise.all([
    prisma.tbCmBatchJob.findFirst({ where: { job_ty_code: BILLING_DAILY_JOB_TYPE }, orderBy: { bgng_dt: "desc" } }),
    prisma.tbCmBatchJob.findFirst({ where: { job_ty_code: BILLING_DAILY_JOB_TYPE, trgr_ty_code: "CRON" }, orderBy: { bgng_dt: "desc" }, select: { sttus_code: true, bgng_dt: true } }),
    prisma.tbBlSubscription.groupBy({ by: ["pg_provdr_code"], where: { sbscrptn_sttus_code: { in: [...LIVE_SUBSCRIPTION_STATUSES] } }, _count: { _all: true } }),
    prisma.tbBlPayment.count({ where: { pymnt_sttus_code: PAYMENT_STATUS.PENDING, pymnt_ty_code: { not: PAYMENT_TYPE.REFUND }, creat_dt: { lt: staleBefore } } }),
    prisma.tbBlPayment.count({ where: { pymnt_sttus_code: PAYMENT_STATUS.PENDING } }),
    prisma.tbBlPgEvent.count({ where: { prcs_sttus_code: PG_EVENT_STATUS.FAILED, creat_dt: { gte: dayAgo } } }),
    prisma.tbBlPgEvent.count({ where: { creat_dt: { gte: dayAgo } } }),
    prisma.tbBlPayment.count({ where: { pymnt_sttus_code: PAYMENT_STATUS.PAID, fail_rsn_cn: { contains: "미반영" } } }),
  ]);

  const liveByProvider: Record<string, number> = {};
  let liveSubscriptions = 0;
  for (const r of liveRows) {
    liveByProvider[r.pg_provdr_code] = r._count._all;
    liveSubscriptions += r._count._all;
  }

  return {
    checkedAt:    now.toISOString(),
    nodeEnv:      process.env.NODE_ENV ?? "development",
    provider:     gw.provider,
    tossTestMode: isToss ? (process.env.TOSS_SECRET_KEY ?? "").startsWith("test_") : null,
    billingOpen:  BILLING_OPEN,
    env,
    batch: {
      lastAny: lastAny ? {
        status: lastAny.sttus_code, trigger: lastAny.trgr_ty_code, startedAt: lastAny.bgng_dt.toISOString(),
        targetCnt: lastAny.trgt_cnt, successCnt: lastAny.success_cnt, failCnt: lastAny.fail_cnt, skipCnt: lastAny.skip_cnt,
      } : null,
      lastCron: lastCron ? { status: lastCron.sttus_code, startedAt: lastCron.bgng_dt.toISOString() } : null,
      cronHealthy: !!lastCron && lastCron.bgng_dt.getTime() > now.getTime() - CRON_HEALTHY_WINDOW_MS,
    },
    counts: {
      liveSubscriptions,
      liveByProvider,
      stalePendingCharges: stalePending,
      pendingChargesTotal: pendingTotal,
      webhookFailed24h:    whFailed,
      webhookReceived24h:  whReceived,
      paidUnapplied:       unapplied,
    },
  };
}
