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

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { id: targetMberId } = await params;
  if (!targetMberId) {
    return apiError("VALIDATION_ERROR", "사용자 ID 가 필요합니다.", 400);
  }

  try {
    const member = await prisma.tbCmMember.findUnique({
      where: { mber_id: targetMberId },
      select: {
        mber_id:           true,
        email_addr:        true,
        mber_nm:           true,
        profl_img_url:     true,
        plan_code:         true,
        plan_expire_dt:    true,
        mber_sttus_code:   true,
        sys_role_code:     true,
        join_dt:           true,
        mdfcn_dt:          true,
        wthdrw_dt:         true,
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
      planExpiresAt:  member.plan_expire_dt?.toISOString() ?? null,
      status:         member.mber_sttus_code,
      isSystemAdmin:  member.sys_role_code === "SUPER_ADMIN",
      joinedAt:       member.join_dt.toISOString(),
      modifiedAt:     member.mdfcn_dt?.toISOString() ?? null,
      withdrawnAt:    member.wthdrw_dt?.toISOString() ?? null,
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
