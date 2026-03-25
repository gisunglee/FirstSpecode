/**
 * GET /api/projects/[id]/settings/history — 설정 변경이력 조회 (FID-00082)
 *
 * 역할:
 *   - 프로젝트 설정 변경 이력 반환 (최신순)
 *   - 변경자 이메일 JOIN
 *   - OWNER/ADMIN만 접근 가능
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

  // OWNER/ADMIN 권한 확인
  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  if (!["OWNER", "ADMIN"].includes(membership.role_code)) {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const histories = await prisma.tbPjSettingsHistory.findMany({
      where: { prjct_id: projectId },
      include: {
        member: { select: { email_addr: true } },
      },
      orderBy: { chg_dt: "desc" },
    });

    const items = histories.map((h) => ({
      changedAt:     h.chg_dt,
      changerEmail:  h.member.email_addr ?? "-",
      itemName:      h.chg_item_nm,
      beforeValue:   h.bfr_val_cn ?? null,
      afterValue:    h.aftr_val_cn ?? null,
    }));

    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/settings/history] DB 오류:`, err);
    return apiError("DB_ERROR", "변경이력 조회에 실패했습니다.", 500);
  }
}
