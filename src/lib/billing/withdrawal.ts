/**
 * billing/withdrawal — 청약철회(전액 환불) 가능 판정 (정책 §1-7)
 *
 * 규칙 (2026-09-26 확정):
 *   - 대상은 **계정의 첫 구독 시작 결제** 1건 — 승인된 INITIAL 결제 중 가장 이른 것. 계정당 1회.
 *   - 승인 시각 + 7일 이내.
 *   - 아직 환불(전액·일부)되지 않았을 것.
 *   - 유료 기능 사용 여부는 보지 않는다. FREE 가 편집자 1명이라 협업(유료 핵심 가치)을 결제 전에
 *     시험할 수 없으므로 "사용했으면 환불 불가"는 체험 수단이 없는 셈이 된다. 무조건 환불이
 *     법적으로도 운영상으로도 단순하다. 악용 비용은 1인당 9,900원·7일이고 계정당 1회로 막힌다.
 *   - 정기 결제·좌석 추가·재구독 결제는 대상이 아니다(필요하면 운영 보정 유형으로 환불).
 *
 * 컬럼에 저장하지 않고 결제 이력에서 매번 계산한다. 관리자 회원 상세·구독 상세의 표시와
 * 환불 기록(adminRecordRefund)이 같은 함수를 쓰므로 화면과 서버 판정이 어긋나지 않는다.
 *
 * 탈퇴 후 같은 이메일로 재가입하면 새 mber_id 라 다시 1회가 생긴다(정책 §1-6). 그 비용은 감수한다.
 */

import { prisma } from "@/lib/prisma";
import { PRICING } from "@/app/intro/_components/siteInfo";
import { PAYMENT_STATUS, PAYMENT_TYPE, SPECODE_PRODUCT } from "./constants";
import { addDays } from "./pricing";

/** 청약철회 가능 기간(일) — 요금제 페이지·약관 표기와 같은 상수를 쓴다 */
export const WITHDRAWAL_WINDOW_DAYS = PRICING.refundWindowDays;

export type WithdrawalReason = "NO_PAYMENT" | "WINDOW_PASSED" | "ALREADY_REFUNDED";

export type WithdrawalEligibility = {
  /** 청약철회 대상 결제 — 계정의 첫 구독 시작 결제. 승인된 INITIAL 결제가 없으면 null */
  firstPaymentId: string | null;
  /** 그 결제의 승인 시각 */
  firstPaidAt:    string | null;
  /** 승인 + 7일 — 이때까지 요청하면 전액 환불 */
  deadline:       string | null;
  /** 지금 기록하면 서버 검사를 통과하는가 */
  eligible:       boolean;
  /** 불가 사유 — 가능하면 null */
  reason:         WithdrawalReason | null;
};

export async function getWithdrawalEligibility(mberId: string, now = new Date()): Promise<WithdrawalEligibility> {
  // 첫 구독 시작 결제 — 거절(FAILED)은 빼고 승인된 것 중 가장 이른 것.
  // 환불되면 원 결제 상태가 REFUNDED 로 바뀌므로 PAID 만 찾으면 "두 번째 INITIAL 이 첫 결제"로
  // 보이는 구멍이 생긴다 → 상태로 거르지 않고 FAILED 만 제외한다.
  const first = await prisma.tbBlPayment.findFirst({
    where: {
      mber_id:          mberId,
      pymnt_ty_code:    PAYMENT_TYPE.INITIAL,
      pymnt_sttus_code: { not: PAYMENT_STATUS.FAILED },
      subscription:     { prdct_code: SPECODE_PRODUCT },
    },
    orderBy: [{ apprv_dt: "asc" }, { creat_dt: "asc" }],
    select:  { pymnt_id: true, apprv_dt: true, creat_dt: true, pymnt_sttus_code: true },
  });
  if (!first) {
    return { firstPaymentId: null, firstPaidAt: null, deadline: null, eligible: false, reason: "NO_PAYMENT" };
  }

  const approvedAt      = first.apprv_dt ?? first.creat_dt;
  const deadline        = addDays(approvedAt, WITHDRAWAL_WINDOW_DAYS);
  const alreadyRefunded = first.pymnt_sttus_code !== PAYMENT_STATUS.PAID;
  const windowPassed    = now.getTime() > deadline.getTime();

  return {
    firstPaymentId: first.pymnt_id,
    firstPaidAt:    approvedAt.toISOString(),
    deadline:       deadline.toISOString(),
    eligible:       !alreadyRefunded && !windowPassed,
    reason:         alreadyRefunded ? "ALREADY_REFUNDED" : windowPassed ? "WINDOW_PASSED" : null,
  };
}
