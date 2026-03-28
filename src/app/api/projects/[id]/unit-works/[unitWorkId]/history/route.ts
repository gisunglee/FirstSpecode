/**
 * GET /api/projects/[id]/unit-works/[unitWorkId]/history — 단위업무 설명 변경 이력 조회
 *
 * tb_pj_settings_history에서 해당 프로젝트의 "단위업무 설명" 이력을 최신순으로 반환
 * unitWorkId 기준 필터 없이 프로젝트 전체 단위업무 설명 이력이 저장되므로
 * chg_item_nm = "단위업무 설명" AND prjct_id로 필터링
 *
 * Query:
 *   limit  — 조회 건수 (기본 20, 최대 100)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; unitWorkId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, unitWorkId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  // limit 파라미터 (기본 20)
  const url   = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20") || 20, 100);

  try {
    // 단위업무가 이 프로젝트에 속하는지 확인
    const uw = await prisma.tbDsUnitWork.findUnique({
      where:  { unit_work_id: unitWorkId },
      select: { prjct_id: true, unit_work_nm: true },
    });
    if (!uw || uw.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "단위업무를 찾을 수 없습니다.", 404);
    }

    // 이력 조회 — 변경자 정보 함께 조회
    const histories = await prisma.tbPjSettingsHistory.findMany({
      where:   { prjct_id: projectId, chg_item_nm: "단위업무 설명" },
      orderBy: { chg_dt: "desc" },
      take:    limit,
      include: {
        member: { select: { mber_nm: true } },
      },
    });

    return apiSuccess({
      unitWorkName: uw.unit_work_nm,
      items: histories.map((h) => ({
        histId:     h.hist_id,
        changedBy:  h.member.mber_nm,
        changedAt:  h.chg_dt.toISOString(),
        beforeVal:  h.bfr_val_cn ?? "",
        afterVal:   h.aftr_val_cn ?? "",
      })),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/unit-works/${unitWorkId}/history] DB 오류:`, err);
    return apiError("DB_ERROR", "이력 조회에 실패했습니다.", 500);
  }
}
