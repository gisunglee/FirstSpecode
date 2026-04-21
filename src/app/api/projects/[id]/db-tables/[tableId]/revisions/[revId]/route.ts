/**
 * GET /api/projects/[id]/db-tables/[tableId]/revisions/[revId] — 변경 이력 단건 (Diff 뷰어용)
 *
 * 응답:
 *   {
 *     revId, revNo, chgTypeCode, chgSummary,
 *     chgMemberName, chgDt,
 *     snapshot: { table: {...}|null, columns: { added, modified, removed } },
 *     prevRevId: string | null,   // 이전 리비전 (없으면 null)
 *     nextRevId: string | null    // 다음 리비전 (없으면 null)
 *   }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; tableId: string; revId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, tableId, revId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    const rev = await prisma.tbDsDbTableRevision.findUnique({
      where: { rev_id: revId },
    });
    if (!rev || rev.tbl_id !== tableId || rev.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "이력을 찾을 수 없습니다.", 404);
    }

    // 이전/다음 리비전 (rev_no 기준) — 페이지 간 이동 편의
    const [prev, next] = await Promise.all([
      prisma.tbDsDbTableRevision.findFirst({
        where:   { tbl_id: tableId, rev_no: { lt: rev.rev_no } },
        orderBy: { rev_no: "desc" },
        select:  { rev_id: true },
      }),
      prisma.tbDsDbTableRevision.findFirst({
        where:   { tbl_id: tableId, rev_no: { gt: rev.rev_no } },
        orderBy: { rev_no: "asc" },
        select:  { rev_id: true },
      }),
    ]);

    // 변경자 이름
    let chgMemberName = "알 수 없음";
    if (rev.chg_mber_id) {
      const m = await prisma.tbCmMember.findUnique({
        where:  { mber_id: rev.chg_mber_id },
        select: { mber_nm: true },
      });
      chgMemberName = m?.mber_nm ?? "알 수 없음";
    }

    return apiSuccess({
      revId:         rev.rev_id,
      revNo:         rev.rev_no,
      chgTypeCode:   rev.chg_type_code,
      chgSummary:    rev.chg_summary ?? "",
      chgMemberName,
      chgDt:         rev.chg_dt.toISOString(),
      snapshot:      rev.snapshot_data,   // { table, columns: { added, modified, removed } }
      prevRevId:     prev?.rev_id ?? null,
      nextRevId:     next?.rev_id ?? null,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/db-tables/${tableId}/revisions/${revId}] DB 오류:`, err);
    return apiError("DB_ERROR", "이력 상세 조회에 실패했습니다.", 500);
  }
}
