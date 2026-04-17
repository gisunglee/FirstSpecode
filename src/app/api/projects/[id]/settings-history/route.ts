/**
 * GET /api/projects/[id]/settings-history?itemName=xxx — 설정 변경 이력 목록 조회
 *
 * tb_pj_settings_history에서 프로젝트 + 항목명 기준으로 이력을 최신순 조회.
 * SettingsHistoryDialog 공통 컴포넌트에서 사용.
 *
 * Query:
 *   itemName — chg_item_nm 필터 (필수)
 *   limit    — 최대 건수 (기본 50)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  const url      = new URL(request.url);
  const itemName = url.searchParams.get("itemName");
  const limit    = Math.min(parseInt(url.searchParams.get("limit") ?? "50") || 50, 200);

  if (!itemName?.trim()) {
    return apiError("VALIDATION_ERROR", "itemName 파라미터가 필요합니다.", 400);
  }

  try {
    const histories = await prisma.tbPjSettingsHistory.findMany({
      where:   { prjct_id: projectId, chg_item_nm: itemName },
      orderBy: { chg_dt: "desc" },
      take:    limit,
      include: { member: { select: { mber_nm: true } } },
    });

    return apiSuccess({
      items: histories.map((h, idx) => ({
        histId:    h.hist_id,
        version:   histories.length - idx,   // 최신 = 가장 높은 번호
        changedBy: h.member.mber_nm ?? "알 수 없음",
        changedAt: h.chg_dt.toISOString(),
        afterVal:  h.aftr_val_cn ?? "",
        beforeVal: h.bfr_val_cn  ?? "",
      })),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/settings-history] DB 오류:`, err);
    return apiError("DB_ERROR", "이력 조회에 실패했습니다.", 500);
  }
}
