/**
 * PATCH /api/admin/users/[id]/access — 사용자 접근 상태 긴급 조치.
 *
 * 데이터는 삭제하지 않는다. 상태 변경 또는 세션/토큰/키 폐기만 수행하며,
 * 모든 성공 조치는 감사 로그와 같은 트랜잭션에 기록한다.
 * 시스템 관리자 역할 자체는 전용 system-role API에서만 변경한다.
 *
 * MCP 미노출: /api/admin/** 는 로그인 세션 전용이며 MCP 키를 명시적으로 거부한다.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import type { AuditActionType } from "@/lib/audit";
import { canChangeSuspension } from "@/lib/memberLifecyclePolicy";

const ACCESS_ACTIONS = [
  "SUSPEND",
  "UNSUSPEND",
  "UNLOCK",
  "FORCE_LOGOUT",
  "REVOKE_MCP_KEYS",
] as const;

type AccessAction = (typeof ACCESS_ACTIONS)[number];
type RouteParams = { params: Promise<{ id: string }> };

function isAccessAction(value: unknown): value is AccessAction {
  return typeof value === "string" &&
    (ACCESS_ACTIONS as readonly string[]).includes(value);
}

const AUDIT_ACTION_BY_ACCESS_ACTION: Record<AccessAction, AuditActionType> = {
  SUSPEND: "USER_SUSPEND",
  UNSUSPEND: "USER_UNSUSPEND",
  UNLOCK: "USER_UNLOCK",
  FORCE_LOGOUT: "USER_FORCE_LOGOUT",
  REVOKE_MCP_KEYS: "USER_MCP_KEYS_REVOKE",
};

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { id: targetMberId } = await params;
  if (!targetMberId) {
    return apiError("VALIDATION_ERROR", "대상 사용자 ID가 필요합니다.", 400);
  }
  if (targetMberId === gate.mberId) {
    return apiError(
      "FORBIDDEN_SELF_MODIFY",
      "자기 자신의 접근 상태는 이 화면에서 변경할 수 없습니다.",
      403,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { action, reason } = (body ?? {}) as Record<string, unknown>;
  if (!isAccessAction(action)) {
    return apiError("VALIDATION_ERROR", "지원하지 않는 접근 조치입니다.", 400);
  }
  if (typeof reason !== "string" || !reason.trim()) {
    return apiError("VALIDATION_ERROR", "조치 사유를 입력해 주세요.", 400);
  }

  const now = new Date();
  const normalizedReason = reason.trim().slice(0, 500);

  try {
    const target = await prisma.tbCmMember.findUnique({
      where: { mber_id: targetMberId },
      select: {
        mber_id: true,
        email_addr: true,
        mber_nm: true,
        mber_sttus_code: true,
        sys_role_code: true,
        accountLocks: {
          where: {
            lock_sttus_code: { in: ["LOCKED", "UNLOCK_PENDING"] },
            lock_expiry_dt: { gt: now },
          },
          select: { lock_id: true },
          take: 1,
        },
      },
    });

    if (!target) {
      return apiError("NOT_FOUND", "대상 사용자를 찾을 수 없습니다.", 404);
    }

    if ((action === "SUSPEND" || action === "UNSUSPEND") && !canChangeSuspension(target.sys_role_code)) {
      return apiError(
        "SYSTEM_ADMIN_STATUS_CHANGE_BLOCKED",
        "시스템 관리자 역할을 먼저 해임한 뒤 계정 상태를 변경해 주세요.",
        409,
      );
    }
    if (action === "SUSPEND" && target.mber_sttus_code !== "ACTIVE") {
      return apiError("INVALID_ACCOUNT_STATUS", "활성 계정만 정지할 수 있습니다.", 409);
    }
    if (action === "UNSUSPEND" && target.mber_sttus_code !== "SUSPENDED") {
      return apiError("INVALID_ACCOUNT_STATUS", "정지 상태의 계정만 해제할 수 있습니다.", 409);
    }
    if (action === "UNLOCK" && target.accountLocks.length === 0) {
      return apiError("ACCOUNT_NOT_LOCKED", "현재 잠긴 계정이 아닙니다.", 409);
    }

    const snapshot = target.email_addr ?? target.mber_nm ?? target.mber_id;
    const memo = `[대상: ${snapshot}] ${normalizedReason}`;

    const result = await prisma.$transaction(async (tx) => {
      let affectedCount = 0;

      if (action === "SUSPEND") {
        await tx.tbCmMember.update({
          where: { mber_id: targetMberId },
          data: { mber_sttus_code: "SUSPENDED", mdfcn_dt: now },
        });
        const [tokens, sessions, keys, supportSessions] = await Promise.all([
          tx.tbCmRefreshToken.updateMany({
            where: { mber_id: targetMberId, revoked_dt: null },
            data: { revoked_dt: now },
          }),
          tx.tbCmMemberSession.updateMany({
            where: { mber_id: targetMberId, invald_dt: null },
            data: { invald_dt: now },
          }),
          tx.tbCmMcpKey.updateMany({
            where: { mber_id: targetMberId, revoke_dt: null },
            data: { revoke_dt: now },
          }),
          tx.tbSysAdminSupportSession.updateMany({
            where: { admin_mber_id: targetMberId, ended_dt: null },
            data: { ended_dt: now },
          }),
        ]);
        affectedCount = 1 + tokens.count + sessions.count + keys.count + supportSessions.count;
      } else if (action === "UNSUSPEND") {
        await tx.tbCmMember.update({
          where: { mber_id: targetMberId },
          data: { mber_sttus_code: "ACTIVE", mdfcn_dt: now },
        });
        affectedCount = 1;
      } else if (action === "UNLOCK") {
        const locks = await tx.tbCmAccountLock.updateMany({
          where: {
            mber_id: targetMberId,
            lock_sttus_code: { in: ["LOCKED", "UNLOCK_PENDING"] },
            lock_expiry_dt: { gt: now },
          },
          data: {
            lock_sttus_code: "UNLOCKED",
            unlocked_dt: now,
            unlock_token_val: null,
            unlock_token_expiry_dt: null,
          },
        });
        affectedCount = locks.count;
      } else if (action === "FORCE_LOGOUT") {
        const [tokens, sessions, supportSessions] = await Promise.all([
          tx.tbCmRefreshToken.updateMany({
            where: { mber_id: targetMberId, revoked_dt: null },
            data: { revoked_dt: now },
          }),
          tx.tbCmMemberSession.updateMany({
            where: { mber_id: targetMberId, invald_dt: null },
            data: { invald_dt: now },
          }),
          tx.tbSysAdminSupportSession.updateMany({
            where: { admin_mber_id: targetMberId, ended_dt: null },
            data: { ended_dt: now },
          }),
        ]);
        affectedCount = tokens.count + sessions.count + supportSessions.count;
      } else {
        const keys = await tx.tbCmMcpKey.updateMany({
          where: { mber_id: targetMberId, revoke_dt: null },
          data: { revoke_dt: now },
        });
        affectedCount = keys.count;
      }

      await tx.tbSysAdminAudit.create({
        data: {
          admin_mber_id: gate.mberId,
          action_type: AUDIT_ACTION_BY_ACCESS_ACTION[action],
          target_type: "USER",
          target_id: targetMberId,
          memo: `${memo} [처리 건수: ${affectedCount}]`,
          ip_addr: gate.ipAddr?.slice(0, 45) ?? null,
          user_agent: gate.userAgent?.slice(0, 255) ?? null,
        },
      });

      return { affectedCount };
    });

    return apiSuccess({
      mberId: targetMberId,
      action,
      affectedCount: result.affectedCount,
    });
  } catch (error) {
    console.error("[PATCH /api/admin/users/[id]/access] 오류:", error);
    return apiError("DB_ERROR", "사용자 접근 상태 변경에 실패했습니다.", 500);
  }
}
