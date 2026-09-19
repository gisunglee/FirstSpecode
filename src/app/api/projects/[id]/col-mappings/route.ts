/**
 * GET  /api/projects/[id]/col-mappings — 컬럼 매핑 목록 조회
 * POST /api/projects/[id]/col-mappings — 컬럼 매핑 그룹 단위 저장 (REPLACE / APPEND)
 *
 * GET Query: refType (필수), refId (필수), grpId (선택)
 *   - grpId 있음: 해당 그룹의 매핑만 반환 (매핑 관리 팝업의 그룹별 그리드용)
 *   - grpId 없음: ref 전체 매핑 반환, 각 항목에 grpId/grpNm 포함 (상세 화면 요약용)
 * POST Body: { refType, refId, grpId? | grpNm?, mode?, items: [{ colId, ioSeCode?, uiTyCode?, usePurpsCn?, colDc? }] }
 *   - 그룹 지정: grpId(기존 그룹) 또는 grpNm(이름으로 찾고, 없으면 새로 만듦) 중 하나
 *   - mode = REPLACE(기본, 웹 UI): 그 그룹의 매핑을 items로 전체 교체 — 다른 그룹은 건드리지 않음
 *   - mode = APPEND(MCP 전용): 기존 매핑은 그대로 두고, 그 그룹에 아직 없는 컬럼만 뒤에 추가.
 *     이미 매핑된 컬럼은 무시하고 skippedColIds로 알려준다.
 *     AI가 사람이 넣은 매핑을 덮어쓰거나 지울 수 없게 하기 위한 비파괴 모드.
 *
 * 권한: 대상 엔티티(기능 등)의 수정 권한과 동일 — OWNER/ADMIN·PM/PL·가장 가까운 담당자만.
 *   담당자가 아니면 requireSpecContentWrite가 이유(FORBIDDEN_NOT_ASSIGNEE 등)를 그대로 반환한다.
 *
 * refType: 'FUNCTION' | 'AREA' | 'SCREEN'
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { requireSpecContentWrite } from "@/lib/specContentWritePolicy";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import {
  isProjectEntityRefType,
  projectEntityBelongsToProject,
} from "@/lib/projectEntityScope";

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
  if (!isProjectEntityRefType(refType)) {
    return apiError("VALIDATION_ERROR", "지원하지 않는 refType입니다.", 400);
  }

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    if (!await projectEntityBelongsToProject(projectId, refType, refId)) {
      return apiError("NOT_FOUND", "대상을 찾을 수 없습니다.", 404);
    }
    if (grpId) {
      const group = await prisma.tbDsColMappingGroup.findFirst({
        where: { grp_id: grpId, ref_ty_code: refType, ref_id: refId },
        select: { grp_id: true },
      });
      if (!group) return apiError("NOT_FOUND", "매핑 그룹을 찾을 수 없습니다.", 404);
    }

    const mappings = await prisma.tbDsColMapping.findMany({
      where:   { ref_ty_code: refType, ref_id: refId, ...(grpId ? { grp_id: grpId } : {}) },
      orderBy: { sort_ordr: "asc" },
      include: { group: { select: { grp_nm: true } } },
    });

    // col_id 목록으로 컬럼+테이블 정보 별도 조회 (TbDsColMapping에 relation 없음)
    const colIds = mappings.map((m) => m.col_id).filter(Boolean) as string[];
    const columns = colIds.length > 0
      ? await prisma.tbDsDbTableColumn.findMany({
          where:   { col_id: { in: colIds }, table: { prjct_id: projectId } },
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

// ─── POST: 컬럼 매핑 저장 (REPLACE 전체 교체 / APPEND 추가만) ───────────────

/** 저장 모드 — REPLACE는 웹 UI 기본값, APPEND는 MCP가 쓰는 비파괴 모드 */
const SAVE_MODES = ["REPLACE", "APPEND"] as const;
type SaveMode = (typeof SAVE_MODES)[number];

type MappingItemInput = {
  colId:       string;
  ioSeCode?:   string | null;
  uiTyCode?:   string | null;
  usePurpsCn?: string | null;
  colDc?:      string | null;
};

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { refType, refId, grpId, grpNm, mode: rawMode, items } = body as {
    refType?: string;
    refId?:   string;
    grpId?:   string;
    grpNm?:   string;
    mode?:    string;
    items?:   MappingItemInput[];
  };

  if (!refType || !refId) {
    return apiError("VALIDATION_ERROR", "refType, refId 가 필요합니다.", 400);
  }
  if (!isProjectEntityRefType(refType)) {
    return apiError("VALIDATION_ERROR", "지원하지 않는 refType입니다.", 400);
  }
  // 그룹은 ID 또는 이름 중 정확히 하나로 지정 — 둘 다 오면 어느 쪽이 의도인지 알 수 없으므로 거부
  const trimmedGrpNm = grpNm?.trim() ?? "";
  if (!grpId && !trimmedGrpNm) {
    return apiError("VALIDATION_ERROR", "grpId 또는 grpNm 중 하나가 필요합니다.", 400);
  }
  if (grpId && trimmedGrpNm) {
    return apiError("VALIDATION_ERROR", "grpId와 grpNm은 동시에 지정할 수 없습니다.", 400);
  }
  // mode 생략 시 REPLACE — 기존 웹 UI 호출이 그대로 동작해야 함
  const mode = (rawMode ?? "REPLACE") as SaveMode;
  if (!SAVE_MODES.includes(mode)) {
    return apiError("VALIDATION_ERROR", "mode는 REPLACE 또는 APPEND 여야 합니다.", 400);
  }
  if (!Array.isArray(items)) {
    return apiError("VALIDATION_ERROR", "items 배열이 필요합니다.", 400);
  }

  // 권한: 대상 엔티티의 수정 권한과 동일하게 판정 — OWNER/ADMIN·PM/PL·가장 가까운 담당자만.
  // 담당자가 아니면 "이 기능의 담당자가 아닙니다 ..." 같은 사유가 그대로 403으로 나간다.
  // (인증·멤버십 확인도 이 안에서 수행되므로 requireAuth를 따로 부르지 않는다)
  const gate = await requireSpecContentWrite(request, projectId, refType, refId, "UPDATE");
  if (gate instanceof Response) return gate;

  try {
    if (!await projectEntityBelongsToProject(projectId, refType, refId)) {
      return apiError("NOT_FOUND", "대상을 찾을 수 없습니다.", 404);
    }

    const colIds = [...new Set(items.map((item) => item.colId).filter(Boolean))];
    if (colIds.length !== items.length) {
      return apiError("VALIDATION_ERROR", "컬럼 ID가 비어 있거나 중복되었습니다.", 400);
    }
    // 다른 프로젝트의 컬럼을 끌어다 매핑하는 것을 차단
    const projectColumnCount = await prisma.tbDsDbTableColumn.count({
      where: { col_id: { in: colIds }, table: { prjct_id: projectId } },
    });
    if (projectColumnCount !== colIds.length) {
      return apiError("VALIDATION_ERROR", "현재 프로젝트에 속하지 않는 컬럼이 포함되어 있습니다.", 400);
    }

    // 그룹 확정과 매핑 저장을 한 트랜잭션으로 묶는다.
    // APPEND에서 "기존 조회 → 삽입" 사이에 다른 저장이 끼어들어 매핑이 유실되는 것을 막기 위함.
    const result = await prisma.$transaction(async (tx) => {
      // ── 그룹 확정: grpId면 존재 확인, grpNm이면 같은 이름을 찾고 없으면 생성 ──
      let targetGrpId: string;
      let groupCreated = false;
      if (grpId) {
        const group = await tx.tbDsColMappingGroup.findFirst({
          where: { grp_id: grpId, ref_ty_code: refType, ref_id: refId },
          select: { grp_id: true },
        });
        if (!group) return { notFound: true as const };
        targetGrpId = group.grp_id;
      } else {
        const existing = await tx.tbDsColMappingGroup.findFirst({
          where: { ref_ty_code: refType, ref_id: refId, grp_nm: trimmedGrpNm },
          select: { grp_id: true },
        });
        if (existing) {
          targetGrpId = existing.grp_id;
        } else {
          // 같은 ref 안에서 가장 큰 sort_ordr 다음 순번으로 추가 (col-mapping-groups POST와 동일 규칙)
          const last = await tx.tbDsColMappingGroup.findFirst({
            where:   { ref_ty_code: refType, ref_id: refId },
            orderBy: { sort_ordr: "desc" },
            select:  { sort_ordr: true },
          });
          const created = await tx.tbDsColMappingGroup.create({
            data: {
              ref_ty_code: refType,
              ref_id:      refId,
              grp_nm:      trimmedGrpNm,
              sort_ordr:   (last?.sort_ordr ?? 0) + 1,
            },
            select: { grp_id: true },
          });
          targetGrpId = created.grp_id;
          groupCreated = true;
        }
      }

      // ── 저장할 항목과 시작 순번 결정 ──
      let toInsert: MappingItemInput[];
      let sortStart: number;
      let skippedColIds: string[] = [];

      if (mode === "REPLACE") {
        // 같은 그룹의 매핑만 삭제 후 재삽입 — 다른 그룹은 건드리지 않음
        await tx.tbDsColMapping.deleteMany({
          where: { ref_ty_code: refType, ref_id: refId, grp_id: targetGrpId },
        });
        toInsert  = items;
        sortStart = 0;
      } else {
        // APPEND: 이 그룹에 이미 매핑된 컬럼은 건너뛰고(기존 값 유지), 새 컬럼만 뒤에 붙인다
        const existingRows = await tx.tbDsColMapping.findMany({
          where:  { ref_ty_code: refType, ref_id: refId, grp_id: targetGrpId },
          select: { col_id: true, sort_ordr: true },
        });
        const existingColIds = new Set(existingRows.map((r) => r.col_id));
        skippedColIds = items.map((i) => i.colId).filter((c) => existingColIds.has(c));
        toInsert  = items.filter((i) => !existingColIds.has(i.colId));
        sortStart = existingRows.reduce((max, r) => Math.max(max, r.sort_ordr ?? 0), 0);
      }

      for (const [idx, item] of toInsert.entries()) {
        await tx.tbDsColMapping.create({
          data: {
            ref_ty_code:  refType,
            ref_id:       refId,
            grp_id:       targetGrpId,
            col_id:       item.colId,
            io_se_code:   item.ioSeCode?.trim()   || null,
            ui_ty_code:   item.uiTyCode?.trim()   || null,
            use_purps_cn: item.usePurpsCn?.trim() || null,
            col_dc:       item.colDc?.trim()       || null,
            sort_ordr:    sortStart + idx + 1,
          },
        });
      }

      // 설계 변경 이력 — mode까지 남겨서 "통째로 바꿨는지 / 추가만 했는지" 추적할 수 있게 함
      await tx.tbDsDesignChange.create({
        data: {
          prjct_id:      projectId,
          ref_tbl_nm:    "tb_ds_col_mapping",
          ref_id:        refId,
          chg_type_code: "UPDATE",
          chg_rsn_cn:    `${refType} 컬럼 매핑 저장 (${mode})`,
          snapshot_data: {
            refType,
            refId,
            grpId:        targetGrpId,
            mode,
            mappingCount: toInsert.length,
            skippedCount: skippedColIds.length,
            savedAt:      new Date().toISOString(),
          },
          chg_mber_id: gate.mberId,
        },
      });

      return {
        notFound:     false as const,
        grpId:        targetGrpId,
        groupCreated,
        saved:        toInsert.length,
        skippedColIds,
      };
    });

    if (result.notFound) {
      return apiError("NOT_FOUND", "매핑 그룹을 찾을 수 없습니다.", 404);
    }

    return apiSuccess({
      refType,
      refId,
      grpId:        result.grpId,
      groupCreated: result.groupCreated,
      mode,
      saved:        result.saved,
      // APPEND에서 이미 매핑돼 있어 건너뛴 컬럼 — 호출자(MCP)가 사용자에게 알릴 수 있게 반환
      skippedColIds: result.skippedColIds,
    });
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/col-mappings] DB 오류:`, err);
    return apiError("DB_ERROR", "컬럼 매핑 저장에 실패했습니다.", 500);
  }
}

