/**
 * GET /api/projects/[id]/members/leave-check — 탈퇴 분기 조건 확인 (FID-00085)
 *
 * 역할:
 *   - 탈퇴 확인 POPUP 표시 시 분기 조건 반환
 *   - myRole, memberCount, hasData, transferableMembers
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  // 내 멤버십 확인
  const myMembership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!myMembership || myMembership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    // 전체 ACTIVE 멤버 조회 (본인 포함)
    const activeMembers = await prisma.tbPjProjectMember.findMany({
      where: { prjct_id: projectId, mber_sttus_code: "ACTIVE" },
      include: {
        member: { select: { mber_nm: true, email_addr: true } },
      },
    });

    const memberCount = activeMembers.length;

    // 양도 가능 멤버 = ACTIVE 멤버 중 본인 제외
    const transferableMembers = activeMembers
      .filter((m) => m.mber_id !== auth.mberId)
      .map((m) => ({
        memberId: m.mber_id,
        name:     m.member.mber_nm ?? null,
        email:    m.member.email_addr ?? "",
        role:     m.role_code,
      }));

    // hasData: 하위 데이터 존재 여부
    // tb_rq_task, tb_ds_unit_work 등은 미구현 — 현재는 false로 고정
    // TODO: 관련 테이블 구현 후 실제 쿼리로 교체
    const hasData = false;

    return apiSuccess({
      myRole:              myMembership.role_code,
      memberCount,
      hasData,
      transferableMembers,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/members/leave-check] DB 오류:`, err);
    return apiError("DB_ERROR", "조건 확인 중 오류가 발생했습니다.", 500);
  }
}
