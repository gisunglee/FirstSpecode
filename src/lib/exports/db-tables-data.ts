/**
 * exports/db-tables-data.ts — DB 테이블 목록 데이터 조립 (서버 공용)
 */

import { prisma } from "@/lib/prisma";
import { getTableListInsights } from "@/lib/dbTableUsage";

export type DbTableListItem = {
  tblId:            string;
  tblPhysclNm:      string;
  tblLgclNm:        string;
  tblDc:            string;
  creatDt:          string;
  mdfcnDt:          string | null;
  assignMemberId:   string | null;
  assignMemberName: string | null;
  columnCount:      number;
  functionCount:    number;
  usedColCount:     number;
  ioProfile:        string;
  lastUsedDt:       string | null;
};

/**
 * fetchProjectDbTables — DB 테이블 목록 + 컬럼 수 + 담당자 + 매핑 인사이트
 */
export async function fetchProjectDbTables(opts: {
  projectId:       string;
  assigneeFilter?: string;
}): Promise<DbTableListItem[]> {
  const { projectId, assigneeFilter } = opts;

  const tables = await prisma.tbDsDbTable.findMany({
    where: {
      prjct_id: projectId,
      ...(assigneeFilter ? { asign_mber_id: assigneeFilter } : {}),
    },
    include: { _count: { select: { columns: true } } },
    orderBy: { tbl_physcl_nm: "asc" },
  });

  // 담당자 이름 일괄 조회
  const assigneeIds = [
    ...new Set(tables.map((t) => t.asign_mber_id).filter((v): v is string => !!v)),
  ];
  const assigneeMembers = assigneeIds.length > 0
    ? await prisma.tbCmMember.findMany({
        where:  { mber_id: { in: assigneeIds } },
        select: { mber_id: true, mber_nm: true, email_addr: true },
      })
    : [];
  const assigneeMap = new Map(
    assigneeMembers.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]),
  );

  // 매핑 인사이트 — 프로젝트 전체 일괄 집계
  const insightsMap = await getTableListInsights(projectId);

  return tables.map((t) => {
    const ins = insightsMap.get(t.tbl_id);
    return {
      tblId:            t.tbl_id,
      tblPhysclNm:      t.tbl_physcl_nm,
      tblLgclNm:        t.tbl_lgcl_nm  ?? "",
      tblDc:            t.tbl_dc       ?? "",
      creatDt:          t.creat_dt.toISOString(),
      mdfcnDt:          t.mdfcn_dt?.toISOString() ?? null,
      assignMemberId:   t.asign_mber_id ?? null,
      assignMemberName: t.asign_mber_id ? (assigneeMap.get(t.asign_mber_id) ?? null) : null,
      columnCount:      t._count.columns,
      functionCount:    ins?.functionCount ?? 0,
      usedColCount:     ins?.usedColCount  ?? 0,
      ioProfile:        ins?.ioProfile     ?? "NONE",
      lastUsedDt:       ins?.lastUsedDt    ?? null,
    };
  });
}
