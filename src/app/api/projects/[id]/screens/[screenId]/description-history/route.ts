/**
 * GET /api/projects/[id]/screens/[screenId]/description-history
 *   — 화면 설명 변경 이력 목록 (최신순)
 *
 * Query:
 *   limit — 조회 건수 (기본 50, 최대 200)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; screenId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, screenId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  const url   = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50") || 50, 200);

  try {
    // 화면이 이 프로젝트에 속하는지 확인
    const screen = await prisma.tbDsScreen.findUnique({
      where:  { scrn_id: screenId },
      select: { prjct_id: true, scrn_nm: true },
    });
    if (!screen || screen.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "화면을 찾을 수 없습니다.", 404);
    }

    // raw SQL — Prisma client가 새 테이블을 아직 인식하지 못할 경우를 대비
    const rows = await prisma.$queryRaw<Array<{
      hist_id:     string;
      bfr_dc:      string | null;
      aftr_dc:     string | null;
      chg_mber_id: string;
      creat_dt:    Date;
      mber_nm:     string | null;
    }>>`
      SELECT h.hist_id, h.bfr_dc, h.aftr_dc, h.chg_mber_id, h.creat_dt, m.mber_nm
      FROM   tb_ds_screen_desc_history h
      LEFT   JOIN tb_cm_member m ON m.mber_id = h.chg_mber_id
      WHERE  h.scrn_id  = ${screenId}
        AND  h.prjct_id = ${projectId}
      ORDER  BY h.creat_dt DESC
      LIMIT  ${limit}
    `;

    return apiSuccess({
      screenName: screen.scrn_nm,
      items: rows.map((r) => ({
        histId:    r.hist_id,
        changedBy: r.mber_nm ?? "알 수 없음",
        changedAt: r.creat_dt.toISOString(),
        beforeVal: r.bfr_dc ?? "",
        afterVal:  r.aftr_dc ?? "",
      })),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/screens/${screenId}/description-history] DB 오류:`, err);
    return apiError("DB_ERROR", "이력 조회에 실패했습니다.", 500);
  }
}
