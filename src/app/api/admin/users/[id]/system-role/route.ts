/**
 * PATCH /api/admin/users/[id]/system-role — 시스템 관리자 임명/해임
 *
 * 동작:
 *   - body.role === "SUPER_ADMIN" → 임명 (sys_role_code = 'SUPER_ADMIN')
 *   - body.role === null          → 해임 (sys_role_code = NULL) + 대상자의 모든 활성 지원 세션 종료
 *   - body.reason 필수 (감사 로그의 사유)
 *
 * 보안 규칙:
 *   - 시스템 관리자만 호출 가능 (requireSystemAdmin)
 *   - 자기 자신은 해임 불가 — 마지막 관리자가 실수로 락아웃 되는 걸 방지
 *   - 세션 종료 + sys_role_code 변경 + 감사 기록을 **한 트랜잭션**으로 묶음
 *
 * 감사:
 *   - SYSTEM_ROLE_GRANT / SYSTEM_ROLE_REVOKE
 *   - memo 에 사유 + 스냅샷(대상자 이메일) 기록 — 사용자 삭제되어도 로그 해석 가능
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { id: targetMberId } = await params;

  if (!targetMberId || typeof targetMberId !== "string") {
    return apiError("VALIDATION_ERROR", "대상 사용자 ID 가 필요합니다.", 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { role, reason } = (body ?? {}) as {
    role?:   "SUPER_ADMIN" | null;
    reason?: string;
  };

  // 허용되는 role 값만 수용 (fail-secure)
  if (role !== "SUPER_ADMIN" && role !== null) {
    return apiError(
      "VALIDATION_ERROR",
      "role 은 'SUPER_ADMIN' 또는 null 만 허용됩니다.",
      400
    );
  }

  if (!reason || !reason.trim()) {
    return apiError("VALIDATION_ERROR", "사유(reason)를 입력해 주세요.", 400);
  }

  // 자기 자신 해임 방지 — 락아웃 사고 차단.
  // 임명도 자기 자신은 의미 없지만(이미 관리자여야 이 API 호출 가능) 명확히 차단.
  if (targetMberId === gate.mberId) {
    return apiError(
      "FORBIDDEN_SELF_MODIFY",
      "자기 자신의 시스템 역할은 변경할 수 없습니다. 다른 관리자에게 요청하세요.",
      403
    );
  }

  // 대상자 존재 확인 + 스냅샷용 이메일 조회
  const target = await prisma.tbCmMember.findUnique({
    where:  { mber_id: targetMberId },
    select: {
      mber_id:       true,
      email_addr:    true,
      mber_nm:       true,
      sys_role_code: true,
    },
  });

  if (!target) {
    return apiError("NOT_FOUND", "대상 사용자를 찾을 수 없습니다.", 404);
  }

  // 이미 같은 상태면 no-op 응답 (멱등성)
  const currentIsAdmin = target.sys_role_code === "SUPER_ADMIN";
  const wantIsAdmin    = role === "SUPER_ADMIN";
  if (currentIsAdmin === wantIsAdmin) {
    return apiSuccess({
      mberId:        target.mber_id,
      isSystemAdmin: currentIsAdmin,
      changed:       false,
    });
  }

  // 감사 memo 에 스냅샷 포함 — 나중에 대상자 이메일이 바뀌거나 탈퇴해도 해석 가능
  const targetSnapshot = target.email_addr ?? target.mber_nm ?? target.mber_id;
  const memoWithSnapshot = `[대상: ${targetSnapshot}] ${reason.trim()}`;

  await prisma.$transaction(async (tx) => {
    // ① 역할 변경
    await tx.tbCmMember.update({
      where: { mber_id: targetMberId },
      data:  { sys_role_code: role },
    });

    // ② 해임인 경우: 대상자의 모든 활성 지원 세션 즉시 종료
    //    (해임된 사람이 열어둔 세션으로 계속 고객 프로젝트 접근하는 것 차단)
    if (role === null) {
      await tx.tbSysAdminSupportSession.updateMany({
        where: {
          admin_mber_id: targetMberId,
          ended_dt:      null,
          expires_dt:    { gt: new Date() },
        },
        data: { ended_dt: new Date() },
      });
    }

    // ③ 감사 기록
    await tx.tbSysAdminAudit.create({
      data: {
        admin_mber_id: gate.mberId,
        action_type:   wantIsAdmin ? "SYSTEM_ROLE_GRANT" : "SYSTEM_ROLE_REVOKE",
        target_type:   "USER",
        target_id:     targetMberId,
        memo:          memoWithSnapshot,
        ip_addr:       gate.ipAddr    ?? null,
        user_agent:    gate.userAgent ?? null,
      },
    });
  });

  return apiSuccess({
    mberId:        target.mber_id,
    isSystemAdmin: wantIsAdmin,
    changed:       true,
  });
}
