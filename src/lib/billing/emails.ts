/**
 * billing/emails — 결제 관련 이메일 5종 (정책 §1-10)
 *
 *   ① 결제 완료 영수증        sendPaymentReceiptEmail
 *   ② 결제 7일 전 사전 안내   sendUpcomingChargeEmail   (카드사 가이드라인 — 정책 §1-9)
 *   ③ 결제 실패               sendPaymentFailedEmail    (N회차, 다음 재시도일)
 *   ④ 해지 확인               sendCancelConfirmedEmail  (기간 말 날짜)
 *   ⑤ 강등·잠금 안내          sendDowngradedEmail
 *
 * 발송 인프라는 src/lib/auth.ts 의 nodemailer 패턴을 그대로 따른다
 * (SMTP_HOST 미설정이면 콘솔 출력). auth.ts 를 건드리지 않고 여기서 별도 transporter 를 만든다.
 *
 * 실패 정책: 메일 실패가 결제·강등 처리를 되돌리면 안 된다. 모든 함수는 throw 하지 않고
 * console.error 만 남긴다. 호출자는 트랜잭션 커밋 뒤에 호출한다.
 */

import nodemailer from "nodemailer";
import { BILLING_PATH } from "./constants";
import { formatKstDate, formatWon } from "./pricing";

// ─── 공통 발송 ───────────────────────────────────────────────────────────────

function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

/** 공통 레이아웃 — 인증 메일과 같은 톤(폰트·브랜드색). 본문만 갈아 끼운다 */
function layout(title: string, bodyHtml: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color:#222;">
      <h2 style="color: #4a56d4; margin-bottom: 8px;">${title}</h2>
      ${bodyHtml}
      <p style="margin-top:28px; font-size:12px; color:#888;">
        구독·결제 내역은 <a href="${appUrl()}${BILLING_PATH}" style="color:#4a56d4;">설정 &gt; 구독·결제</a> 에서 언제든 확인할 수 있습니다.
      </p>
    </div>`;
}

/** 표 한 줄 */
function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 10px 6px 0; color:#666; white-space:nowrap;">${label}</td>
    <td style="padding:6px 0; font-weight:600;">${value}</td>
  </tr>`;
}

function table(rows: string[]): string {
  return `<table style="border-collapse:collapse; margin:12px 0; font-size:14px;">${rows.join("")}</table>`;
}

async function sendBillingMail(to: string, subject: string, html: string): Promise<void> {
  try {
    if (!process.env.SMTP_HOST) {
      // 개발 환경 — 링크·본문 요약만 콘솔로
      console.log(`\n\x1b[33m[DEV] 결제 메일 → ${to}\x1b[0m\n\x1b[36m${subject}\x1b[0m`);
      return;
    }
    const transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_PORT === "465",
      auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? "noreply@specode.dev",
      to,
      subject,
      html,
    });
  } catch (err) {
    // 결제 처리 자체는 이미 끝났다 — 메일 실패는 로그만
    console.error(`[billing/emails] 발송 실패 to=${to} subject=${subject}:`, err);
  }
}

// ─── ① 결제 완료 영수증 ──────────────────────────────────────────────────────

export type ReceiptEmailInput = {
  to:          string;
  productName: string;
  /** INITIAL | RECURRING | SEAT_ADD 에 따라 제목 문구가 달라진다 */
  kind:        "INITIAL" | "RECURRING" | "SEAT_ADD";
  amount:      number;
  seatCnt:     number;
  periodStart: Date | null;
  periodEnd:   Date | null;
  cardLabel:   string | null;
  receiptUrl:  string | null;
  nextBillAt:  Date | null;
};

export async function sendPaymentReceiptEmail(i: ReceiptEmailInput): Promise<void> {
  const kindLabel =
    i.kind === "INITIAL"  ? "구독이 시작되었습니다" :
    i.kind === "SEAT_ADD" ? "좌석 추가 결제가 완료되었습니다" :
                            "정기 결제가 완료되었습니다";
  const seatLabel = i.kind === "SEAT_ADD" ? `${i.seatCnt}좌석 추가 (일할 계산)` : `${i.seatCnt}좌석`;
  const period = i.periodStart && i.periodEnd
    ? `${formatKstDate(i.periodStart)} ~ ${formatKstDate(i.periodEnd)}`
    : "-";
  const rows = [
    row("상품", i.productName),
    row("결제 금액", `${formatWon(i.amount)} (부가세 포함)`),
    row("좌석", seatLabel),
    row("이용 기간", period),
  ];
  if (i.cardLabel)  rows.push(row("결제 수단", i.cardLabel));
  if (i.nextBillAt) rows.push(row("다음 결제일", formatKstDate(i.nextBillAt)));
  const receipt = i.receiptUrl
    ? `<p><a href="${absolute(i.receiptUrl)}" style="color:#4a56d4;">영수증 보기</a></p>`
    : "";
  await sendBillingMail(
    i.to,
    `[SPECODE] ${kindLabel} — ${formatWon(i.amount)}`,
    layout(kindLabel, `${table(rows)}${receipt}`),
  );
}

// ─── ② 결제 예정 사전 안내 ───────────────────────────────────────────────────

export type UpcomingChargeEmailInput = {
  to:          string;
  productName: string;
  amount:      number;
  seatCnt:     number;
  billAt:      Date;
  cardLabel:   string | null;
};

export async function sendUpcomingChargeEmail(i: UpcomingChargeEmailInput): Promise<void> {
  const rows = [
    row("상품", i.productName),
    row("결제 예정일", formatKstDate(i.billAt)),
    row("결제 예정 금액", `${formatWon(i.amount)} (${i.seatCnt}좌석 × 단가, 부가세 포함)`),
  ];
  if (i.cardLabel) rows.push(row("결제 수단", i.cardLabel));
  await sendBillingMail(
    i.to,
    `[SPECODE] ${formatKstDate(i.billAt)} 정기 결제 예정 안내`,
    layout(
      "정기 결제 예정 안내",
      `<p>아래 일정으로 정기 결제가 진행됩니다. 좌석 수를 조정하거나 해지하려면 결제일 전에 설정에서 변경해 주세요.</p>${table(rows)}`,
    ),
  );
}

// ─── ③ 결제 실패 ─────────────────────────────────────────────────────────────

export type PaymentFailedEmailInput = {
  to:          string;
  productName: string;
  amount:      number;
  /** 이번이 몇 번째 실패인지 (1 = 첫 실패) */
  attemptNo:   number;
  /** 다음 재시도 예정일. null = 재시도 없음(강등 메일이 별도로 간다) */
  nextRetryAt: Date | null;
  reason:      string | null;
};

export async function sendPaymentFailedEmail(i: PaymentFailedEmailInput): Promise<void> {
  const rows = [
    row("상품", i.productName),
    row("결제 금액", formatWon(i.amount)),
    row("실패 회차", `${i.attemptNo}회차`),
  ];
  if (i.reason)      rows.push(row("사유", i.reason));
  if (i.nextRetryAt) rows.push(row("다음 재시도", formatKstDate(i.nextRetryAt)));
  await sendBillingMail(
    i.to,
    `[SPECODE] 정기 결제 실패 (${i.attemptNo}회차) — 결제 수단을 확인해 주세요`,
    layout(
      "정기 결제에 실패했습니다",
      `<p>카드 한도·유효기간 등으로 결제가 거절되었습니다. 재시도가 끝나기 전까지는 정상적으로 이용할 수 있습니다.</p>
       ${table(rows)}
       <p><a href="${appUrl()}${BILLING_PATH}" style="display:inline-block; margin-top:8px; padding:10px 18px; background:#4a56d4; color:#fff; border-radius:6px; text-decoration:none; font-weight:600;">결제 수단 변경</a></p>
       <p style="font-size:13px; color:#666;">결제 수단을 바꾸면 즉시 다시 결제를 시도합니다.</p>`,
    ),
  );
}

// ─── ④ 해지 확인 ─────────────────────────────────────────────────────────────

export type CancelConfirmedEmailInput = {
  to:          string;
  productName: string;
  periodEnd:   Date;
};

export async function sendCancelConfirmedEmail(i: CancelConfirmedEmailInput): Promise<void> {
  await sendBillingMail(
    i.to,
    `[SPECODE] 구독 해지 예약 확인 — ${formatKstDate(i.periodEnd)}까지 이용 가능`,
    layout(
      "구독 해지가 예약되었습니다",
      `<p>${i.productName} 구독 해지가 예약되었습니다. 이미 결제한 기간이 끝나는
       <strong>${formatKstDate(i.periodEnd)}</strong>까지는 그대로 이용할 수 있고, 그 이후 추가 결제는 없습니다.</p>
       <p>그 전에 마음이 바뀌면 설정에서 <strong>해지 취소</strong>를 누르면 됩니다.</p>
       <p style="font-size:13px; color:#666;">해지가 확정되면 소유한 프로젝트는 읽기 전용으로 잠깁니다. 데이터는 삭제되지 않으며,
       멤버 5명 이하인 프로젝트는 "활성화" 버튼으로 FREE 플랜에서 계속 편집할 수 있습니다.</p>`,
    ),
  );
}

// ─── ⑤ 강등·잠금 안내 ────────────────────────────────────────────────────────

export type DowngradedEmailInput = {
  to:           string;
  productName:  string;
  /** CANCELED = 해지 확정, EXPIRED = 결제 실패 소진 */
  reason:       "CANCELED" | "EXPIRED";
  lockedCount:  number;
  /** 프로젝트가 1개뿐이라 자동 해제됐으면 그 이름 */
  autoUnlockedProjectName: string | null;
};

export async function sendDowngradedEmail(i: DowngradedEmailInput): Promise<void> {
  const why = i.reason === "CANCELED"
    ? "요청하신 해지가 확정되어"
    : "정기 결제가 재시도까지 모두 실패하여";
  const lockLine = i.lockedCount > 0
    ? `<p>소유한 프로젝트 <strong>${i.lockedCount}개</strong>가 읽기 전용으로 잠겼습니다. 조회와 MCP 읽기는 계속 되고,
       편집·생성·초대·업로드만 막힙니다. <strong>데이터는 삭제되지 않습니다.</strong></p>`
    : "";
  const autoLine = i.autoUnlockedProjectName
    ? `<p>프로젝트 <strong>${i.autoUnlockedProjectName}</strong>는 멤버 5명 이하라 FREE 플랜으로 바로 활성화되었습니다.</p>`
    : "";
  await sendBillingMail(
    i.to,
    `[SPECODE] FREE 플랜으로 전환되었습니다`,
    layout(
      "FREE 플랜으로 전환되었습니다",
      `<p>${why} ${i.productName} 구독이 종료되고 FREE 플랜으로 전환되었습니다.</p>
       ${lockLine}${autoLine}
       <p>프로젝트 목록에서 멤버 5명 이하인 프로젝트는 <strong>활성화</strong> 버튼으로 바로 풀 수 있고,
       다시 결제하면 모든 프로젝트가 즉시 해제됩니다.</p>
       <p><a href="${appUrl()}${BILLING_PATH}" style="display:inline-block; margin-top:8px; padding:10px 18px; background:#4a56d4; color:#fff; border-radius:6px; text-decoration:none; font-weight:600;">구독 다시 시작</a></p>`,
    ),
  );
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

/** 상대 경로 영수증 URL(Mock) 은 앱 URL 을 붙여 절대 경로로 */
function absolute(url: string): string {
  return url.startsWith("/") ? `${appUrl()}${url}` : url;
}
