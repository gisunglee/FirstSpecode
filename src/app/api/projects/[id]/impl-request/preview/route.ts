/**
 * POST /api/projects/[id]/impl-request/preview — 1단계: 변경 현황 조회
 *
 * 역할:
 *   - 진입점(단위업무/화면/영역/기능) 기준으로 4계층 수집
 *   - 각 계층의 변경 모드/변동률/스냅샷 유무 반환
 *   - ImplRequestPopup의 "설계서 변경 현황" 표시에 사용
 */

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/requireAuth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { collectLayers } from "@/lib/impl-request/collector";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const { id: projectId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  let body: { entryType: string; entryId: string };
  try { body = await request.json(); } catch { return apiError("VALIDATION_ERROR", "올바른 JSON이 아닙니다.", 400); }

  if (!body.entryType || !body.entryId) {
    return apiError("VALIDATION_ERROR", "entryType과 entryId는 필수입니다.", 400);
  }

  try {
    const layers = await collectLayers(body.entryType, body.entryId, undefined, projectId);

    return apiSuccess({
      layers: layers.map((l) => ({
        type: l.type,
        id: l.id,
        displayId: l.displayId,
        name: l.name,
        mode: l.hasSnapshot ? l.mode : "신규",
        lineRatio: l.lineRatio,
        hasSnapshot: l.hasSnapshot,
      })),
    });
  } catch (err) {
    console.error("[POST /impl-request/preview]", err);
    return apiError("DB_ERROR", "변경 현황 조회에 실패했습니다.", 500);
  }
}
