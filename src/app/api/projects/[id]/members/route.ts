/**
 * GET /api/projects/[id]/members — 멤버 목록 조회 (FID-00072)
 *
 * 역할:
 *   - ACTIVE 멤버 전체 목록 반환
 *   - myRole, ownerCount 포함 (드롭다운 비활성화 판별용)
 *   - hasWork: tb_ds_screen/tb_ds_function 구현 후 활성화 예정 (현재 false)
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

  // 접근 권한 확인 — 모든 ACTIVE 멤버 조회 가능
  const myMembership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!myMembership || myMembership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const memberships = await prisma.tbPjProjectMember.findMany({
      where: { prjct_id: projectId, mber_sttus_code: "ACTIVE" },
      include: {
        member: { select: { mber_id: true, mber_nm: true, email_addr: true } },
      },
      orderBy: [
        // OWNER 먼저, 그 다음 가입일 순
        { role_code: "asc" },
        { join_dt: "asc" },
      ],
    });

    // OWNER 수 카운트 (마지막 OWNER 비활성화 판별용)
    const ownerCount = memberships.filter((m) => m.role_code === "OWNER").length;

    const members = memberships.map((m) => ({
      memberId:       m.mber_id,
      name:           m.member.mber_nm ?? null,
      email:          m.member.email_addr ?? "",
      role:           m.role_code,
      joinedAt:       m.join_dt,
      lastAccessedAt: m.last_acces_dt ?? null,
      // TODO: tb_ds_screen/tb_ds_function 구현 후 실제 담당 여부로 교체
      hasWork: false,
    }));

    return apiSuccess({
      members,
      totalCount: members.length,
      myRole:     myMembership.role_code,
      ownerCount,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/members] DB 오류:`, err);
    return apiError("DB_ERROR", "멤버 목록 조회에 실패했습니다.", 500);
  }
}
