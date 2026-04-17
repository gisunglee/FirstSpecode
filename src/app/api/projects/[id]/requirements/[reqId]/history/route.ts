/**
 * GET /api/projects/[id]/requirements/[reqId]/history — 이력 목록 조회 (FID-00118)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; reqId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, reqId } = await params;

  // 프로젝트 멤버 확인
  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  // 요구사항 프로젝트 소속 확인
  const requirement = await prisma.tbRqRequirement.findUnique({
    where:  { req_id: reqId },
    select: { prjct_id: true },
  });
  if (!requirement || requirement.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "요구사항을 찾을 수 없습니다.", 404);
  }

  try {
    const histories = await prisma.tbRqRequirementHistory.findMany({
      where:   { req_id: reqId },
      orderBy: { creat_dt: "desc" },
    });

    // 변경자 이메일 일괄 조회 (중복 없이)
    const memberIds = [...new Set(histories.map((h) => h.chg_mber_id).filter(Boolean))] as string[];
    const members = await prisma.tbCmMember.findMany({
      where:  { mber_id: { in: memberIds } },
      select: { mber_id: true, email_addr: true },
    });
    const emailMap = new Map(members.map((m) => [m.mber_id, m.email_addr ?? ""]));

    const items = histories.map((h) => ({
      historyId:     h.req_hist_id,
      versionNo:     h.vrsn_no,
      comment:       h.vrsn_coment_cn ?? "",
      changedAt:     h.creat_dt.toISOString(),
      changerEmail:  h.chg_mber_id ? (emailMap.get(h.chg_mber_id) ?? "") : "",
    }));

    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/requirements/${reqId}/history] DB 오류:`, err);
    return apiError("DB_ERROR", "이력 조회에 실패했습니다.", 500);
  }
}
