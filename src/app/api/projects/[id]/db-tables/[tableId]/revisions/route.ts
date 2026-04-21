/**
 * GET /api/projects/[id]/db-tables/[tableId]/revisions — DB 테이블 변경 이력 목록
 *
 * 쿼리:
 *   - page      (기본 1)
 *   - pageSize  (기본 20, 최대 100)
 *
 * 응답:
 *   {
 *     items: [{ revId, revNo, chgTypeCode, chgSummary, chgMemberName, chgDt }],
 *     totalCount, page, pageSize
 *   }
 *
 * 변경자 표시는 **이름만** (AI/사람 구분 없음 — 사용자 결정사항)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; tableId: string }> };

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE     = 100;

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, tableId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  // 테이블이 이 프로젝트 소속인지 확인 (삭제된 테이블의 이력 조회는 허용 안 함)
  const table = await prisma.tbDsDbTable.findUnique({
    where:  { tbl_id: tableId },
    select: { prjct_id: true },
  });
  if (!table || table.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "테이블을 찾을 수 없습니다.", 404);
  }

  // 페이지네이션 파싱
  const url       = new URL(request.url);
  const page      = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const rawSize   = parseInt(url.searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE;
  const pageSize  = Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize));
  const skip      = (page - 1) * pageSize;

  try {
    const [rows, totalCount] = await Promise.all([
      prisma.tbDsDbTableRevision.findMany({
        where:   { tbl_id: tableId },
        orderBy: { chg_dt: "desc" },
        skip,
        take: pageSize,
        select: {
          rev_id:        true,
          rev_no:        true,
          chg_type_code: true,
          chg_summary:   true,
          chg_mber_id:   true,
          chg_dt:        true,
        },
      }),
      prisma.tbDsDbTableRevision.count({ where: { tbl_id: tableId } }),
    ]);

    // 변경자 이름 일괄 조회 (N+1 방지) — chg_mber_id 는 nullable
    const memberIds = [...new Set(
      rows.map((r) => r.chg_mber_id).filter((id): id is string => id !== null)
    )];
    const members = memberIds.length > 0
      ? await prisma.tbCmMember.findMany({
          where:  { mber_id: { in: memberIds } },
          select: { mber_id: true, mber_nm: true },
        })
      : [];
    const memberMap: Record<string, string> = Object.fromEntries(
      members.map((m) => [m.mber_id, m.mber_nm ?? "알 수 없음"])
    );

    return apiSuccess({
      items: rows.map((r) => ({
        revId:         r.rev_id,
        revNo:         r.rev_no,
        chgTypeCode:   r.chg_type_code,
        chgSummary:    r.chg_summary ?? "",
        chgMemberName: r.chg_mber_id ? (memberMap[r.chg_mber_id] ?? "알 수 없음") : "알 수 없음",
        chgDt:         r.chg_dt.toISOString(),
      })),
      totalCount,
      page,
      pageSize,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/db-tables/${tableId}/revisions] DB 오류:`, err);
    return apiError("DB_ERROR", "변경 이력 조회에 실패했습니다.", 500);
  }
}
