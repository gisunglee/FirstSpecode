/**
 * GET /api/projects/[id]/design-changes — 설계 변경 이력 목록
 *
 * 역할:
 *   - tb_ds_design_change 목록 조회 (등록일 DESC)
 *   - chg_mber_id → 이메일 배치 JOIN
 *   - 페이지 멤버 여부만 확인 (VIEWER 이상 접근 가능)
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

  // 프로젝트 멤버 여부 확인
  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    // refTblNm, refId 쿼리 파라미터로 특정 대상 이력만 조회 가능
    const url       = new URL(request.url);
    const refTblNm  = url.searchParams.get("refTblNm") ?? undefined;
    const refId     = url.searchParams.get("refId") ?? undefined;

    const changes = await prisma.tbDsDesignChange.findMany({
      where: {
        prjct_id:   projectId,
        ...(refTblNm ? { ref_tbl_nm: refTblNm } : {}),
        ...(refId    ? { ref_id: refId }         : {}),
      },
      orderBy: { chg_dt: "desc" },
    });

    // chg_mber_id → 이메일 배치 조회
    const memberIds = [
      ...new Set(changes.map((c) => c.chg_mber_id).filter(Boolean)),
    ] as string[];

    const members = memberIds.length
      ? await prisma.tbCmMember.findMany({
          where:  { mber_id: { in: memberIds } },
          select: { mber_id: true, email_addr: true },
        })
      : [];

    const memberMap = Object.fromEntries(
      members.map((m) => [m.mber_id, m.email_addr ?? "-"])
    );

    const items = changes.map((c) => ({
      chgId:        c.chg_id,
      refTblNm:     c.ref_tbl_nm,
      refId:        c.ref_id,
      chgTypeCode:  c.chg_type_code,
      chgRsnCn:     c.chg_rsn_cn ?? null,
      aiReqYn:      c.ai_req_yn,
      aiTaskId:     c.ai_task_id ?? null,
      chgMberEmail: c.chg_mber_id ? (memberMap[c.chg_mber_id] ?? c.chg_mber_id) : null,
      chgDt:        c.chg_dt,
      snapshotData: c.snapshot_data as Record<string, unknown> | null,
    }));

    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/design-changes] DB 오류:`, err);
    return apiError("DB_ERROR", "설계 변경 이력 조회에 실패했습니다.", 500);
  }
}
