/**
 * GET /api/admin/users/[id] — 단일 사용자 상세 정보 (시스템 관리자 전용)
 *
 * 상세 페이지에 필요한 정보:
 *   - 기본 정보 (이메일·이름·상태·플랜)
 *   - 시스템 역할
 *   - 참여 프로젝트 목록 (역할 포함)
 *   - 최근 로그인 시도 요약 (추후 확장)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { resolveEffectivePlan } from "@/lib/permissions";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { id: targetMberId } = await params;
  if (!targetMberId) {
    return apiError("VALIDATION_ERROR", "사용자 ID 가 필요합니다.", 400);
  }

  try {
    const now = new Date();
    const member = await prisma.tbCmMember.findUnique({
      where: { mber_id: targetMberId },
      select: {
        mber_id:           true,
        email_addr:        true,
        mber_nm:           true,
        profl_img_url:     true,
        pswd_hash:         true,
        plan_code:         true,
        plan_expire_dt:    true,
        mber_sttus_code:   true,
        sys_role_code:     true,
        join_dt:           true,
        mdfcn_dt:          true,
        wthdrw_dt:         true,
        socialAccounts: {
          select: { provdr_code: true },
        },
        accountLocks: {
          where: {
            lock_sttus_code: { in: ["LOCKED", "UNLOCK_PENDING"] },
            lock_expiry_dt: { gt: now },
          },
          select: {
            lock_sttus_code: true,
            lock_rsn_cn: true,
            fail_cnt: true,
            lock_expiry_dt: true,
          },
          orderBy: { creat_dt: "desc" },
          take: 1,
        },
        loginAttempts: {
          select: {
            succes_yn: true,
            fail_rsn_cn: true,
            attempt_ip_addr: true,
            creat_dt: true,
          },
          orderBy: { creat_dt: "desc" },
          take: 1,
        },
        _count: {
          select: {
            memberSessions: { where: { invald_dt: null } },
            refreshTokens: {
              where: { revoked_dt: null, expiry_dt: { gt: now } },
            },
            mcpKeys: { where: { revoke_dt: null } },
            supportSessions: {
              where: { ended_dt: null, expires_dt: { gt: now } },
            },
          },
        },
        projectMembers: {
          where: { mber_sttus_code: "ACTIVE" },
          select: {
            role_code:      true,
            job_title_code: true,
            join_dt:        true,
            project: {
              select: {
                prjct_id: true,
                prjct_nm: true,
              },
            },
          },
          orderBy: { join_dt: "desc" },
        },
      },
    });

    if (!member) {
      return apiError("NOT_FOUND", "사용자를 찾을 수 없습니다.", 404);
    }

    return apiSuccess({
      mberId:         member.mber_id,
      email:          member.email_addr,
      name:           member.mber_nm,
      profileImage:   member.profl_img_url,
      plan:           member.plan_code,
      effectivePlan:  resolveEffectivePlan(member.plan_code, member.plan_expire_dt),
      planExpiresAt:  member.plan_expire_dt?.toISOString() ?? null,
      status:         member.mber_sttus_code,
      isSystemAdmin:  member.sys_role_code === "SUPER_ADMIN",
      joinedAt:       member.join_dt.toISOString(),
      modifiedAt:     member.mdfcn_dt?.toISOString() ?? null,
      withdrawnAt:    member.wthdrw_dt?.toISOString() ?? null,
      authMethods: {
        hasPassword: member.pswd_hash !== null,
        socialProviders: member.socialAccounts.map((account) =>
          account.provdr_code.toLowerCase()
        ),
      },
      security: {
        activeLock: member.accountLocks[0]
          ? {
              status: member.accountLocks[0].lock_sttus_code,
              reason: member.accountLocks[0].lock_rsn_cn,
              failCount: member.accountLocks[0].fail_cnt,
              expiresAt: member.accountLocks[0].lock_expiry_dt?.toISOString() ?? null,
            }
          : null,
        activeSessionCount: member._count.memberSessions,
        activeRefreshTokenCount: member._count.refreshTokens,
        activeMcpKeyCount: member._count.mcpKeys,
        activeSupportSessionCount: member._count.supportSessions,
        lastLoginAttempt: member.loginAttempts[0]
          ? {
              success: member.loginAttempts[0].succes_yn === "Y",
              failureReason: member.loginAttempts[0].fail_rsn_cn,
              ipAddress: member.loginAttempts[0].attempt_ip_addr,
              attemptedAt: member.loginAttempts[0].creat_dt.toISOString(),
            }
          : null,
      },
      projects: member.projectMembers.map((pm) => ({
        projectId: pm.project.prjct_id,
        name:      pm.project.prjct_nm,
        role:      pm.role_code,
        job:       pm.job_title_code,
        joinedAt:  pm.join_dt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[GET /api/admin/users/[id]] DB 오류:", err);
    return apiError("DB_ERROR", "사용자 상세 조회에 실패했습니다.", 500);
  }
}
