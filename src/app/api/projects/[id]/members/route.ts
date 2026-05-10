/**
 * GET /api/projects/[id]/members — 멤버 목록 조회 (FID-00072)
 *
 * 역할:
 *   - ACTIVE 멤버 전체 목록 반환 (역할 + 직무)
 *   - myRole, myMemberId, ownerCount 포함 (드롭다운 비활성화·본인 판별용)
 *   - hasWork: tb_ds_screen/tb_ds_function 구현 후 활성화 예정 (현재 false)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { fetchProjectMembers } from "@/lib/exports/members-data";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
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
    // 데이터 조회+가공 로직은 service 로 분리 — export 라우트와 동일 결과 보장
    const members = await fetchProjectMembers({ projectId });

    // OWNER 수 카운트 (마지막 OWNER 비활성화 판별용)
    const ownerCount = members.filter((m) => m.role === "OWNER").length;

    return apiSuccess({
      members,
      totalCount:   members.length,
      myRole:       myMembership.role_code,
      myJob:        myMembership.job_title_code,
      myMemberId:   auth.mberId,
      ownerCount,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/members] DB 오류:`, err);
    return apiError("DB_ERROR", "멤버 목록 조회에 실패했습니다.", 500);
  }
}
