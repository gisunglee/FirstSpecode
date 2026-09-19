/**
 * PATCH /api/admin/users/[id]/plan — 회원 플랜·만료일 수동 변경 (시스템 관리자 전용)
 *
 * 용도:
 *   - 결제 연동 전 얼리 고객에게 BASIC 을 열어 주거나, ENTERPRISE(수동 부여 전용)를 주는 경로
 *   - 결제 실패 등으로 FREE 가 된 회원을 운영자가 임시로 되돌리는 경로
 *
 * Body: { plan: "FREE" | "BASIC" | "PRO" | "ENTERPRISE", expiresAt: "YYYY-MM-DD" | null, reason: string }
 *   - FREE 는 expiresAt 을 받지 않는다 (무료에 만료 개념 없음 → null 로 저장)
 *   - 유료 플랜의 expiresAt 이 null 이면 무기한 (resolveEffectivePlan 규칙과 동일)
 *   - expiresAt 은 "그 날까지 유효" 로 해석 → KST 23:59:59 로 저장
 *
 * 보안·감사:
 *   - requireSystemAdmin (로그인 세션만, MCP 키 거부)
 *   - 플랜 변경 + 감사 기록을 한 트랜잭션으로. memo 에 전후 값 스냅샷
 *   - 자기 자신도 변경 가능 (플랫폼 운영자 계정이므로 차단 이유 없음). 감사 로그로 추적
 *
 * 2단계(결제 연동) 이후 주의:
 *   - 활성 구독이 있는 회원은 구독이 플랜의 원천이다. 그때는 이 API 가 구독 상태와 어긋나지
 *     않도록 "활성 구독 있음 → 409" 검사를 여기 추가한다 (정책 문서 §3 2단계 참조).
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { PLAN_CODES, resolveEffectivePlan } from "@/lib/permissions";

type RouteParams = { params: Promise<{ id: string }> };

// 감사 memo 최대 길이 — tb_sys_admin_audit.memo 컬럼 여유 안에서 사유를 자른다
const REASON_MAX_LENGTH = 500;

const bodySchema = z.object({
  plan: z.enum(PLAN_CODES),
  // 날짜만 받는다(YYYY-MM-DD). 시각은 서버가 KST 하루 끝으로 고정
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "만료일은 YYYY-MM-DD 형식이어야 합니다.").nullable(),
  reason: z.string().trim().min(1, "사유를 입력해 주세요.").max(REASON_MAX_LENGTH, "사유가 너무 깁니다."),
});

/** "YYYY-MM-DD" → 그 날 KST 23:59:59 (그 날까지 유효) */
function endOfDayKst(date: string): Date {
  return new Date(`${date}T23:59:59+09:00`);
}

/** 감사 memo 용 표기 — "BASIC(~2026-12-31)" / "BASIC(무기한)" / "FREE" */
function describePlan(plan: string, expiresAt: Date | null): string {
  if (plan === "FREE") return "FREE";
  if (!expiresAt) return `${plan}(무기한)`;
  // KST 기준 날짜로 표기 — 저장값은 UTC 지만 운영자가 입력한 날짜와 같게 보이도록
  const kst = new Date(expiresAt.getTime() + 9 * 60 * 60 * 1000);
  return `${plan}(~${kst.toISOString().slice(0, 10)})`;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { id: targetMberId } = await params;
  if (!targetMberId) {
    return apiError("VALIDATION_ERROR", "대상 사용자 ID 가 필요합니다.", 400);
  }

  const parsed = await parseJsonBody(request, bodySchema);
  if (parsed instanceof Response) return parsed;
  const { plan, reason } = parsed.data;

  // FREE 는 만료일을 무시하고 null. 유료는 입력값 그대로(없으면 무기한)
  const expiresAt = plan === "FREE" || !parsed.data.expiresAt ? null : endOfDayKst(parsed.data.expiresAt);

  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return apiError("VALIDATION_ERROR", "만료일이 올바르지 않습니다.", 400);
  }
  // 이미 지난 날짜로 유료 플랜을 주면 즉시 FREE 로 판정돼 아무 효과가 없다 → 입력 실수로 보고 거부
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    return apiError("VALIDATION_ERROR", "만료일은 오늘 이후여야 합니다.", 400);
  }

  const target = await prisma.tbCmMember.findUnique({
    where:  { mber_id: targetMberId },
    select: { mber_id: true, email_addr: true, mber_nm: true, plan_code: true, plan_expire_dt: true, mber_sttus_code: true },
  });
  if (!target) {
    return apiError("NOT_FOUND", "대상 사용자를 찾을 수 없습니다.", 404);
  }
  if (target.mber_sttus_code === "WITHDRAWN") {
    return apiError("ACCOUNT_INACTIVE", "탈퇴한 회원의 플랜은 변경할 수 없습니다.", 409);
  }

  // 같은 값이면 no-op (멱등)
  const sameExpiry =
    (target.plan_expire_dt?.getTime() ?? null) === (expiresAt?.getTime() ?? null);
  if (target.plan_code === plan && sameExpiry) {
    return apiSuccess({ mberId: target.mber_id, plan, planExpiresAt: expiresAt?.toISOString() ?? null, changed: false });
  }

  // 감사 memo — 전후 값 + 대상 스냅샷 (대상자가 탈퇴해도 해석 가능)
  const targetSnapshot = target.email_addr ?? target.mber_nm ?? target.mber_id;
  const before = describePlan(target.plan_code, target.plan_expire_dt);
  const after  = describePlan(plan, expiresAt);
  const memo   = `[대상: ${targetSnapshot}] ${before} → ${after} ${reason}`;
  const now    = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.tbCmMember.update({
      where: { mber_id: targetMberId },
      data:  { plan_code: plan, plan_expire_dt: expiresAt, mdfcn_dt: now },
    });
    await tx.tbSysAdminAudit.create({
      data: {
        admin_mber_id: gate.mberId,
        action_type:   "USER_PLAN_CHANGE",
        target_type:   "USER",
        target_id:     targetMberId,
        memo,
        ip_addr:       gate.ipAddr?.slice(0, 45)     ?? null,
        user_agent:    gate.userAgent?.slice(0, 255) ?? null,
      },
    });
  });

  return apiSuccess({
    mberId:        target.mber_id,
    plan,
    effectivePlan: resolveEffectivePlan(plan, expiresAt),
    planExpiresAt: expiresAt?.toISOString() ?? null,
    changed:       true,
  });
}
