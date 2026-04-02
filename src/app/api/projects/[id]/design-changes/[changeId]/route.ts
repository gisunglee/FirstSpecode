/**
 * GET /api/projects/[id]/design-changes/[changeId] — 설계 변경 이력 상세
 *
 * 역할:
 *   - tb_ds_design_change 단건 조회 (snapshot_data 포함)
 *   - chg_mber_id → 이메일 JOIN
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; changeId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, changeId } = await params;

  // 프로젝트 멤버 여부 확인
  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const change = await prisma.tbDsDesignChange.findUnique({
      where: { chg_id: changeId },
    });

    if (!change || change.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "변경 이력을 찾을 수 없습니다.", 404);
    }

    // 변경자 이메일 조회
    let chgMberEmail: string | null = null;
    if (change.chg_mber_id) {
      const member = await prisma.tbCmMember.findUnique({
        where:  { mber_id: change.chg_mber_id },
        select: { email_addr: true },
      });
      chgMberEmail = member?.email_addr ?? change.chg_mber_id;
    }

    return apiSuccess({
      chgId:        change.chg_id,
      refTblNm:     change.ref_tbl_nm,
      refId:        change.ref_id,
      chgRsnCn:     change.chg_rsn_cn ?? null,
      snapshotData: change.snapshot_data,
      aiReqYn:      change.ai_req_yn,
      aiTaskId:     change.ai_task_id ?? null,
      chgMberEmail,
      chgDt:        change.chg_dt,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/design-changes/${changeId}] DB 오류:`, err);
    return apiError("DB_ERROR", "변경 이력 상세 조회에 실패했습니다.", 500);
  }
}
