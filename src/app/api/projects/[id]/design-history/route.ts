/**
 * GET /api/projects/[id]/design-history — 설계 내용 변경 이력 조회
 *
 * 역할:
 *   - tb_ds_design_change에서 특정 엔티티의 설명 이력 조회
 *   - SettingsHistoryDialog와 동일한 응답 포맷 반환
 *   - snapshot_data.before / snapshot_data.after → beforeVal / afterVal 매핑
 *
 * Query:
 *   refTblNm — 대상 테이블명 (필수, e.g. "tb_ds_function")
 *   refId    — 대상 레코드 ID (필수, e.g. functionId)
 *   itemName — chg_rsn_cn 필터 (필수, e.g. "기능 설명")
 *   limit    — 최대 건수 (기본 50, 최대 200)
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

  const url      = new URL(request.url);
  const refTblNm = url.searchParams.get("refTblNm");
  const refId    = url.searchParams.get("refId");
  const itemName = url.searchParams.get("itemName");
  const limit    = Math.min(parseInt(url.searchParams.get("limit") ?? "50") || 50, 200);

  if (!refTblNm?.trim() || !refId?.trim() || !itemName?.trim()) {
    return apiError("VALIDATION_ERROR", "refTblNm, refId, itemName 파라미터가 필요합니다.", 400);
  }

  try {
    const changes = await prisma.tbDsDesignChange.findMany({
      where: {
        prjct_id:   projectId,
        ref_tbl_nm: refTblNm,
        ref_id:     refId,
        chg_rsn_cn: itemName,
      },
      orderBy: { chg_dt: "desc" },
      take:    limit,
    });

    // 변경자 이름 배치 조회
    const memberIds = [...new Set(changes.map((c) => c.chg_mber_id).filter(Boolean))] as string[];
    const members = memberIds.length
      ? await prisma.tbCmMember.findMany({
          where:  { mber_id: { in: memberIds } },
          select: { mber_id: true, mber_nm: true },
        })
      : [];
    const memberMap = Object.fromEntries(members.map((m) => [m.mber_id, m.mber_nm ?? "알 수 없음"]));

    const items = changes.map((c, idx) => {
      // snapshot_data는 { before: string | null, after: string | null } 구조
      const snap = c.snapshot_data as { before?: string | null; after?: string | null } | null;
      return {
        histId:    c.chg_id,
        version:   changes.length - idx,   // 최신 = 가장 높은 번호
        changedBy: c.chg_mber_id ? (memberMap[c.chg_mber_id] ?? "알 수 없음") : "알 수 없음",
        changedAt: c.chg_dt.toISOString(),
        afterVal:  snap?.after  ?? "",
        beforeVal: snap?.before ?? "",
      };
    });

    return apiSuccess({ items });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/design-history] DB 오류:`, err);
    return apiError("DB_ERROR", "이력 조회에 실패했습니다.", 500);
  }
}
