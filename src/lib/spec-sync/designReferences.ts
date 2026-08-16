/** 설계 snapshot의 계층, API 참조와 DB 컬럼 매핑 근거를 만든다. */

import { prisma } from "@/lib/prisma";
import type { DesignSnapshot } from "./contracts";

export function hierarchy(
  unitWorkId: string,
  screenId: string | null = null,
  areaId: string | null = null,
  functionId: string | null = null,
) {
  return { unitWorkId, screenId, areaId, functionId };
}

export function extractApiRefs(targets: DesignSnapshot["targets"]) {
  const refs = new Map<
    string,
    { method: string; path: string; targetId: string }
  >();
  const pattern = /\b(GET|POST|PUT|PATCH|DELETE)\s+[`'"]?(\/api\/[^\s`'")|]+)/gi;
  for (const target of targets) {
    for (const match of target.value.matchAll(pattern)) {
      const method = match[1].toUpperCase();
      const path = match[2];
      refs.set(`${method}:${path}:${target.targetId}`, {
        method,
        path,
        targetId: target.targetId,
      });
    }
  }
  return [...refs.values()];
}

export async function loadDbRefs(projectId: string, functionIds: string[]) {
  if (functionIds.length === 0) return [];

  const groups = await prisma.tbDsColMappingGroup.findMany({
    where: { ref_ty_code: "FUNCTION", ref_id: { in: functionIds } },
    orderBy: [{ ref_id: "asc" }, { sort_ordr: "asc" }],
    include: { mappings: true },
  });
  const columnIds = Array.from(
    new Set(
      groups.flatMap((group) =>
        group.mappings
          .map((mapping) => mapping.col_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ),
  );
  if (columnIds.length === 0) return [];

  const columns = await prisma.tbDsDbTableColumn.findMany({
    where: { col_id: { in: columnIds }, table: { prjct_id: projectId } },
    include: { table: true },
  });
  const columnById = new Map(columns.map((column) => [column.col_id, column]));

  return groups.flatMap((group) =>
    group.mappings.flatMap((mapping) => {
      if (!mapping.col_id) return [];
      const column = columnById.get(mapping.col_id);
      if (!column) return [];
      return [
        {
          functionId: group.ref_id,
          groupName: group.grp_nm,
          ioType: mapping.io_se_code,
          uiType: mapping.ui_ty_code,
          purpose: mapping.use_purps_cn,
          tablePhysicalName: column.table.tbl_physcl_nm,
          tableLogicalName: column.table.tbl_lgcl_nm,
          columnPhysicalName: column.col_physcl_nm,
          columnLogicalName: column.col_lgcl_nm,
          columnDescription: column.col_dc,
        },
      ];
    }),
  );
}
