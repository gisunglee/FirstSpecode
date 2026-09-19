/**
 * GET /api/projects/[id]/design-studio/related-codes?unitWorkId=...
 *
 * Loads the common-code relationships for every function under one unit work.
 * This is a studio-only batching endpoint: the inspector fetches once, caches the
 * response, and then follows document scrolling without issuing per-function calls.
 */

import { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";

type RouteParams = { params: Promise<{ id: string }> };

type CodeSource = {
  mappingId: string;
  mappingGroupName: string;
  tableId: string;
  tableName: string;
  tableLogicalName: string;
  columnId: string;
  columnName: string;
  columnLogicalName: string;
  ioType: string;
  purpose: string;
};

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(request, projectId, "code.read");
  if (gate instanceof Response) return gate;

  const unitWorkId = request.nextUrl.searchParams.get("unitWorkId")?.trim();
  if (!unitWorkId) {
    return apiError("VALIDATION_ERROR", "unitWorkId 파라미터가 필요합니다.", 400);
  }

  try {
    const unitWork = await prisma.tbDsUnitWork.findFirst({
      where: { unit_work_id: unitWorkId, prjct_id: projectId },
      select: {
        unit_work_id: true,
        screens: {
          orderBy: { sort_ordr: "asc" },
          select: {
            scrn_id: true,
            areas: {
              orderBy: { sort_ordr: "asc" },
              select: {
                area_id: true,
                functions: {
                  orderBy: { sort_ordr: "asc" },
                  select: {
                    func_id: true,
                    func_display_id: true,
                    func_nm: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!unitWork) return apiError("NOT_FOUND", "단위업무를 찾을 수 없습니다.", 404);

    const functions = unitWork.screens.flatMap((screen) =>
      screen.areas.flatMap((area) =>
        area.functions.map((fn) => ({
          functionId: fn.func_id,
          displayId: fn.func_display_id,
          name: fn.func_nm,
          areaId: area.area_id,
          screenId: screen.scrn_id,
        })),
      ),
    );
    const functionIds = functions.map((fn) => fn.functionId);

    const mappings = functionIds.length === 0
      ? []
      : await prisma.tbDsColMapping.findMany({
          where: { ref_ty_code: "FUNCTION", ref_id: { in: functionIds } },
          orderBy: [{ ref_id: "asc" }, { sort_ordr: "asc" }],
          include: { group: { select: { grp_nm: true } } },
        });

    const columnIds = [...new Set(
      mappings.map((mapping) => mapping.col_id).filter((id): id is string => Boolean(id)),
    )];
    const columns = columnIds.length === 0
      ? []
      : await prisma.tbDsDbTableColumn.findMany({
          where: { col_id: { in: columnIds }, table: { prjct_id: projectId } },
          select: {
            col_id: true,
            col_physcl_nm: true,
            col_lgcl_nm: true,
            ref_grp_code: true,
            table: {
              select: {
                tbl_id: true,
                tbl_physcl_nm: true,
                tbl_lgcl_nm: true,
              },
            },
          },
        });
    const columnById = new Map(columns.map((column) => [column.col_id, column]));

    const referencedGroupCodes = [...new Set(
      columns
        .map((column) => column.ref_grp_code?.trim())
        .filter((code): code is string => Boolean(code)),
    )];
    const storedGroups = referencedGroupCodes.length === 0
      ? []
      : await prisma.tbCmCodeGroup.findMany({
          where: { prjct_id: projectId, grp_code: { in: referencedGroupCodes } },
          include: { codes: { orderBy: [{ sort_ordr: "asc" }, { creat_dt: "asc" }] } },
        });
    const storedGroupByCode = new Map(storedGroups.map((group) => [group.grp_code, group]));

    const mappingCountByFunction = new Map<string, number>();
    const relationByFunction = new Map<string, Map<string, CodeSource[]>>();
    const tableUsageById = new Map<string, {
      tableId: string;
      tableName: string;
      tableLogicalName: string;
      functionIds: Set<string>;
    }>();

    for (const mapping of mappings) {
      mappingCountByFunction.set(
        mapping.ref_id,
        (mappingCountByFunction.get(mapping.ref_id) ?? 0) + 1,
      );

      if (!mapping.col_id) continue;
      const column = columnById.get(mapping.col_id);
      if (!column) continue;

      const tableId = column.table.tbl_id;
      const tableUsage = tableUsageById.get(tableId) ?? {
        tableId,
        tableName: column.table.tbl_physcl_nm,
        tableLogicalName: column.table.tbl_lgcl_nm ?? "",
        functionIds: new Set<string>(),
      };
      tableUsage.functionIds.add(mapping.ref_id);
      tableUsageById.set(tableId, tableUsage);

      const groupCode = column.ref_grp_code?.trim();
      if (!groupCode) continue;

      if (!relationByFunction.has(mapping.ref_id)) {
        relationByFunction.set(mapping.ref_id, new Map());
      }
      const functionGroups = relationByFunction.get(mapping.ref_id)!;
      if (!functionGroups.has(groupCode)) functionGroups.set(groupCode, []);
      functionGroups.get(groupCode)!.push({
        mappingId: mapping.mapping_id,
        mappingGroupName: mapping.group.grp_nm,
        tableId: column.table.tbl_id,
        tableName: column.table.tbl_physcl_nm,
        tableLogicalName: column.table.tbl_lgcl_nm ?? "",
        columnId: column.col_id,
        columnName: column.col_physcl_nm,
        columnLogicalName: column.col_lgcl_nm ?? "",
        ioType: mapping.io_se_code ?? "",
        purpose: mapping.use_purps_cn ?? "",
      });
    }

    const codeGroups = referencedGroupCodes.map((groupCode) => {
      const group = storedGroupByCode.get(groupCode);
      return {
        groupCode,
        groupName: group?.grp_code_nm ?? "",
        description: group?.grp_code_dc ?? "",
        useYn: group?.use_yn ?? "N",
        exists: Boolean(group),
        codes: (group?.codes ?? []).map((code) => ({
          codeId: code.cm_code_id,
          code: code.cm_code,
          name: code.code_nm,
          description: code.code_dc ?? "",
          useYn: code.use_yn,
        })),
      };
    });

    const functionRelations = functions.map((fn) => ({
      ...fn,
      mappingCount: mappingCountByFunction.get(fn.functionId) ?? 0,
      codeGroups: [...(relationByFunction.get(fn.functionId)?.entries() ?? [])].map(
        ([groupCode, sources]) => ({ groupCode, sources }),
      ),
    }));
    const dbTables = [...tableUsageById.values()]
      .map((table) => ({
        tableId: table.tableId,
        tableName: table.tableName,
        tableLogicalName: table.tableLogicalName,
        functionIds: [...table.functionIds],
      }))
      .sort((left, right) => left.tableName.localeCompare(right.tableName));

    return apiSuccess({
      unitWorkId,
      loadedAt: new Date().toISOString(),
      summary: {
        functionCount: functions.length,
        mappedFunctionCount: functionRelations.filter((fn) => fn.mappingCount > 0).length,
        mappingCount: mappings.length,
        codeGroupCount: referencedGroupCodes.length,
        tableCount: dbTables.length,
      },
      codeGroups,
      dbTables,
      functions: functionRelations,
    });
  } catch (error) {
    console.error(`[GET /api/projects/${projectId}/design-studio/related-codes]`, error);
    return apiError("DB_ERROR", "관련 공통코드 조회에 실패했습니다.", 500);
  }
}
