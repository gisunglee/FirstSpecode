/**
 * GET  /api/projects/[id]/col-mappings — 컬럼 매핑 목록 조회
 * POST /api/projects/[id]/col-mappings — 컬럼 매핑 그룹 단위 교체 저장
 *
 * GET Query: refType (필수), refId (필수), grpId (선택)
 *   - grpId 있음: 해당 그룹의 매핑만 반환 (매핑 관리 팝업의 그룹별 그리드용)
 *   - grpId 없음: ref 전체 매핑 반환, 각 항목에 grpId/grpNm 포함 (상세 화면 요약용)
 * POST Body: { refType, refId, grpId, items: [{ colId, ioSeCode?, uiTyCode?, usePurpsCn?, colDc? }] }
 *   - grpId로 지정된 그룹의 매핑만 교체 — 다른 그룹은 건드리지 않음
 *
 * refType: 'FUNCTION' | 'AREA' | 'SCREEN' | ...  (이후 확장 가능)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 컬럼 매핑 목록 조회 ────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;
  const url     = new URL(request.url);
  const refType = url.searchParams.get("refType");
  const refId   = url.searchParams.get("refId");
  const grpId   = url.searchParams.get("grpId"); // 선택 — 없으면 ref 전체(모든 그룹) 반환

  if (!refType || !refId) {
    return apiError("VALIDATION_ERROR", "refType, refId 파라미터가 필요합니다.", 400);
  }

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const mappings = await prisma.tbDsColMapping.findMany({
      where:   { ref_ty_code: refType, ref_id: refId, ...(grpId ? { grp_id: grpId } : {}) },
      orderBy: { sort_ordr: "asc" },
      include: { group: { select: { grp_nm: true } } },
    });

    // col_id 목록으로 컬럼+테이블 정보 별도 조회 (TbDsColMapping에 relation 없음)
    const colIds = mappings.map((m) => m.col_id).filter(Boolean) as string[];
    const columns = colIds.length > 0
      ? await prisma.tbDsDbTableColumn.findMany({
          where:   { col_id: { in: colIds } },
          include: { table: { select: { tbl_id: true, tbl_physcl_nm: true, tbl_lgcl_nm: true } } },
        })
      : [];
    const colMap = new Map(columns.map((c) => [c.col_id, c]));

    return apiSuccess({
      items: mappings.map((m) => {
        const col = m.col_id ? colMap.get(m.col_id) : undefined;
        return {
          mappingId:      m.mapping_id,
          grpId:          m.grp_id,
          grpNm:          m.group.grp_nm,
          colId:          m.col_id ?? "",
          colName:        col?.col_physcl_nm ?? "",
          colLogicalNm:   col?.col_lgcl_nm ?? "",
          tableId:        col?.table.tbl_id ?? "",
          tableName:      col?.table.tbl_physcl_nm ?? "",
          tableLogicalNm: col?.table.tbl_lgcl_nm ?? "",
          ioSeCode:       m.io_se_code ?? "",
          uiTyCode:       m.ui_ty_code ?? "",
          usePurpsCn:     m.use_purps_cn ?? "",
          colDc:          m.col_dc ?? "",
          refGrpCode:     col?.ref_grp_code ?? "",
          sortOrder:      m.sort_ordr,
        };
      }),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/col-mappings] DB 오류:`, err);
    return apiError("DB_ERROR", "컬럼 매핑 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 컬럼 매핑 전체 교체 저장 ──────────────────────────────────────────
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
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { refType, refId, grpId, items } = body as {
    refType?: string;
    refId?:   string;
    grpId?:   string;
    items?:   {
      colId:       string;
      ioSeCode?:   string;
      uiTyCode?:   string;
      usePurpsCn?: string;
      colDc?:      string;
    }[];
  };

  if (!refType || !refId) {
    return apiError("VALIDATION_ERROR", "refType, refId 가 필요합니다.", 400);
  }
  if (!grpId) {
    return apiError("VALIDATION_ERROR", "grpId 가 필요합니다.", 400);
  }
  if (!Array.isArray(items)) {
    return apiError("VALIDATION_ERROR", "items 배열이 필요합니다.", 400);
  }

  try {
    // 같은 그룹(grpId)의 매핑만 삭제 후 재삽입 — 다른 그룹은 건드리지 않음
    await prisma.$transaction([
      prisma.tbDsColMapping.deleteMany({ where: { ref_ty_code: refType, ref_id: refId, grp_id: grpId } }),
      ...items.map((item, idx) =>
        prisma.tbDsColMapping.create({
          data: {
            ref_ty_code:  refType,
            ref_id:       refId,
            grp_id:       grpId,
            col_id:       item.colId,
            io_se_code:   item.ioSeCode?.trim()   || null,
            ui_ty_code:   item.uiTyCode?.trim()   || null,
            use_purps_cn: item.usePurpsCn?.trim() || null,
            col_dc:       item.colDc?.trim()       || null,
            sort_ordr:    idx + 1,
          },
        })
      ),
      prisma.tbDsDesignChange.create({
        data: {
          prjct_id:      projectId,
          ref_tbl_nm:    "tb_ds_col_mapping",
          ref_id:        refId,
          chg_type_code: "UPDATE",
          chg_rsn_cn:    `${refType} 컬럼 매핑 저장`,
          snapshot_data: {
            refType,
            refId,
            grpId,
            mappingCount: items.length,
            savedAt:      new Date().toISOString(),
          },
          chg_mber_id: auth.mberId,
        },
      }),
    ]);

    return apiSuccess({ refType, refId, grpId, saved: items.length });
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/col-mappings] DB 오류:`, err);
    return apiError("DB_ERROR", "컬럼 매핑 저장에 실패했습니다.", 500);
  }
}
