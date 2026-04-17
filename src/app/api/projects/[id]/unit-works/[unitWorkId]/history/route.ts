/**
 * GET /api/projects/[id]/unit-works/[unitWorkId]/history — 단위업무 설명 변경 이력 조회
 *
 * tb_ds_design_change에서 ref_tbl_nm="tb_ds_unit_work", ref_id=unitWorkId,
 * chg_rsn_cn="단위업무 설명" 조건으로 이력을 최신순 조회
 * snapshot_data.before / snapshot_data.after 로 이전/이후 값 반환
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
  const auth = await requireAuth(request);
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

    // 이력 조회 — tb_ds_design_change에서 해당 단위업무의 설명 변경 이력만
    const changes = await prisma.tbDsDesignChange.findMany({
      where: {
        prjct_id:   projectId,
        ref_tbl_nm: "tb_ds_unit_work",
        ref_id:     unitWorkId,
        chg_rsn_cn: "단위업무 설명",
      },
      orderBy: { chg_dt: "desc" },
      take:    limit,
    });

    // 변경자 이름 일괄 조회 (N+1 방지)
    const memberIds = [...new Set(changes.map((c) => c.chg_mber_id))];
    const members   = await prisma.tbMbMember.findMany({
      where:  { mber_id: { in: memberIds } },
      select: { mber_id: true, mber_nm: true },
    });
    const memberMap = Object.fromEntries(members.map((m) => [m.mber_id, m.mber_nm]));

    return apiSuccess({
      unitWorkName: uw.unit_work_nm,
      items: changes.map((c) => {
        const snap = c.snapshot_data as { before?: string | null; after?: string | null } | null;
        return {
          histId:    c.chg_id,
          changedBy: memberMap[c.chg_mber_id] ?? "알 수 없음",
          changedAt: c.chg_dt.toISOString(),
          beforeVal: snap?.before ?? "",
          afterVal:  snap?.after  ?? "",
        };
      }),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/unit-works/${unitWorkId}/history] DB 오류:`, err);
    return apiError("DB_ERROR", "이력 조회에 실패했습니다.", 500);
  }
}
