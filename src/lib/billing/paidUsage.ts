/**
 * billing/paidUsage — 환불 판정용 "유료 기능 사용 여부" 3플래그 (정책 §1-7)
 *
 * 환불 = 결제 후 7일 이내 + 유료 기능 미사용이면 전액. "사용 시작" 판정은 결제 이후 다음 중
 * 하나라도 발생했는지로 한다 (셋 다 DB 로그로 확인 가능):
 *   ① 두 번째 소유 프로젝트 생성
 *   ② 6번째 이상 편집 멤버 초대(합류)
 *   ③ 첨부파일 업로드
 *
 * 플래그를 컬럼에 저장하지 않는다 — 최초 결제 시각(첫 PAID 결제의 apprv_dt) 이후의
 * 프로젝트 creat_dt · 멤버 join_dt · 첨부 creat_dt 로 매번 계산한다(정책 §3 2단계 원칙).
 * 관리자 회원 상세에서 계산값만 보여 주고, 환불 실행은 v1 에서 토스 콘솔 수동이다.
 *
 * 기준 시각: 현재(또는 마지막) 구독의 첫 INITIAL 결제. 재구독하면 새 INITIAL 이 기준이 된다.
 */

import { prisma } from "@/lib/prisma";
import { FREE_LIMITS } from "@/lib/planLimits";
import { PAYMENT_STATUS, PAYMENT_TYPE, SPECODE_PRODUCT } from "./constants";
import { SEAT_ROLES } from "./seats";

export type PaidFeatureUsage = {
  /** 판정 기준 시각 — 없으면 결제 이력 없음 (플래그 전부 false) */
  firstPaidAt:        string | null;
  /** ① 결제 후 프로젝트를 만들어 소유 프로젝트가 2개 이상이 됨 */
  secondProjectCreated: boolean;
  /** ② 결제 후 합류한 편집 멤버로 어떤 프로젝트든 편집 멤버가 6명 이상이 됨 */
  sixthEditorJoined:    boolean;
  /** ③ 결제 후 소유 프로젝트에 첨부파일 업로드 */
  fileUploaded:         boolean;
  /** 셋 중 하나라도 true */
  used:                 boolean;
};

export async function getPaidFeatureUsage(mberId: string): Promise<PaidFeatureUsage> {
  const none: PaidFeatureUsage = {
    firstPaidAt: null, secondProjectCreated: false, sixthEditorJoined: false, fileUploaded: false, used: false,
  };

  // 기준 시각 — 가장 최근 구독 시작(INITIAL PAID) 의 승인 시각
  const initial = await prisma.tbBlPayment.findFirst({
    where: {
      mber_id:          mberId,
      pymnt_ty_code:    PAYMENT_TYPE.INITIAL,
      pymnt_sttus_code: PAYMENT_STATUS.PAID,
      subscription:     { prdct_code: SPECODE_PRODUCT },
    },
    orderBy: { apprv_dt: "desc" },
    select:  { apprv_dt: true, creat_dt: true },
  });
  if (!initial) return none;
  const since = initial.apprv_dt ?? initial.creat_dt;

  // 소유 활성 프로젝트 — 생성 시각과 편집 멤버(합류 시각) 를 한 번에
  const owned = await prisma.tbPjProject.findMany({
    where:  { owner_mber_id: mberId, del_yn: "N" },
    select: {
      prjct_id: true,
      creat_dt: true,
      members: {
        where:  { mber_sttus_code: "ACTIVE", role_code: { in: [...SEAT_ROLES] } },
        select: { join_dt: true },
      },
    },
  });

  // ① 결제 후 생성된 프로젝트가 있고, 그 결과 소유 프로젝트가 2개 이상
  const secondProjectCreated =
    owned.length >= FREE_LIMITS.ownedProjects + 1 && owned.some((p) => p.creat_dt > since);

  // ② 어떤 프로젝트든 편집 멤버 6명 이상이면서 그중 결제 후 합류한 사람이 있음
  const sixthEditorJoined = owned.some(
    (p) => p.members.length > FREE_LIMITS.membersPerProject && p.members.some((m) => m.join_dt > since),
  );

  // ③ 결제 후 소유 프로젝트에 올라간 첨부파일
  const uploaded = owned.length === 0
    ? 0
    : await prisma.tbCmAttachFile.count({
        where: { prjct_id: { in: owned.map((p) => p.prjct_id) }, creat_dt: { gt: since } },
      });

  const flags = { secondProjectCreated, sixthEditorJoined, fileUploaded: uploaded > 0 };
  return {
    firstPaidAt: since.toISOString(),
    ...flags,
    used: flags.secondProjectCreated || flags.sixthEditorJoined || flags.fileUploaded,
  };
}
