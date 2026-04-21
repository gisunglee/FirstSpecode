/**
 * dbTableRevision — DB 테이블/컬럼 변경 이력(Revision) 유틸
 *
 * 역할:
 *   - captureTableSnapshot(): 현재 테이블+컬럼 상태를 순수 객체로 스냅샷
 *   - buildRevisionDiff():   before/after 스냅샷에서 added/modified/removed 컬럼 추출
 *   - buildChgSummary():     diff 에서 "컬럼 3개 추가, 1개 수정" 같은 요약 문자열 생성
 *   - recordRevision():      tb_ds_db_table_revision 에 이력 1건 기록 (트랜잭션 내부에서 호출)
 *
 * 설계 의도:
 *   - 저장 API 트랜잭션 안에서 before 스냅샷 → 변경 적용 → after 스냅샷 → recordRevision 순으로 호출
 *   - 한 요청 = 한 revision (여러 컬럼 변경을 묶음) — 수정 빈도 높은 특성 대응
 *   - AI/사람 구분 없음. chg_mber_id 에 시킨 사람의 mber_id 가 기록됨
 */

import type { Prisma, PrismaClient } from "@prisma/client";

// ── 타입 ─────────────────────────────────────────────────────────────────────

export type TableSnapshotFields = {
  tbl_physcl_nm: string;
  tbl_lgcl_nm:   string | null;
  tbl_dc:        string | null;
};

export type ColumnSnapshotFields = {
  col_id:        string;
  col_physcl_nm: string;
  col_lgcl_nm:   string | null;
  data_ty_nm:    string | null;
  col_dc:        string | null;
  ref_grp_code:  string | null;
  sort_ordr:     number;
};

export type TableSnapshot = {
  table:   TableSnapshotFields;
  columns: ColumnSnapshotFields[];
};

// 컬럼 비교 결과
export type ColumnModification = {
  col_id: string;
  col_physcl_nm: string;                             // 식별 편의를 위해 현재(after) 물리명 보존
  before: Partial<ColumnSnapshotFields>;             // 변경된 필드만
  after:  Partial<ColumnSnapshotFields>;
};

export type RevisionDiff = {
  // 테이블 자체 변경 (변경된 필드가 없으면 null)
  table: { before: Partial<TableSnapshotFields>; after: Partial<TableSnapshotFields> } | null;
  columns: {
    added:    ColumnSnapshotFields[];
    modified: ColumnModification[];
    removed:  ColumnSnapshotFields[];
  };
};

// Prisma TransactionClient — tx 와 prisma 모두 허용
type DbClient = PrismaClient | Prisma.TransactionClient;

// ── 스냅샷 캡처 ───────────────────────────────────────────────────────────────

/**
 * 특정 테이블의 현재 상태(테이블 + 컬럼) 전체를 스냅샷한다.
 * 저장 전/후 두 번 호출하여 diff 계산에 사용.
 */
export async function captureTableSnapshot(
  db: DbClient,
  tblId: string
): Promise<TableSnapshot | null> {
  const row = await db.tbDsDbTable.findUnique({
    where: { tbl_id: tblId },
    select: {
      tbl_physcl_nm: true,
      tbl_lgcl_nm:   true,
      tbl_dc:        true,
      columns: {
        orderBy: { sort_ordr: "asc" },
        select: {
          col_id:        true,
          col_physcl_nm: true,
          col_lgcl_nm:   true,
          data_ty_nm:    true,
          col_dc:        true,
          ref_grp_code:  true,
          sort_ordr:     true,
        },
      },
    },
  });
  if (!row) return null;

  return {
    table: {
      tbl_physcl_nm: row.tbl_physcl_nm,
      tbl_lgcl_nm:   row.tbl_lgcl_nm,
      tbl_dc:        row.tbl_dc,
    },
    columns: row.columns,
  };
}

// ── Diff 계산 ─────────────────────────────────────────────────────────────────

// 테이블/컬럼의 비교 대상 필드 목록 — 필드 추가 시 여기만 고치면 됨
const TABLE_FIELDS: Array<keyof TableSnapshotFields> = [
  "tbl_physcl_nm", "tbl_lgcl_nm", "tbl_dc",
];

const COLUMN_FIELDS: Array<keyof Omit<ColumnSnapshotFields, "col_id">> = [
  "col_physcl_nm", "col_lgcl_nm", "data_ty_nm", "col_dc", "ref_grp_code", "sort_ordr",
];

/**
 * before/after 스냅샷에서 변경 항목만 추출.
 * before 가 null 이면 CREATE (전체가 added), after 가 null 이면 DELETE.
 */
export function buildRevisionDiff(
  before: TableSnapshot | null,
  after:  TableSnapshot | null
): RevisionDiff {
  // CREATE — before 없음
  if (!before && after) {
    return {
      table: null,
      columns: { added: [...after.columns], modified: [], removed: [] },
    };
  }
  // DELETE — after 없음
  if (before && !after) {
    return {
      table: null,
      columns: { added: [], modified: [], removed: [...before.columns] },
    };
  }
  if (!before || !after) {
    return { table: null, columns: { added: [], modified: [], removed: [] } };
  }

  // ── 테이블 자체 변경 필드 추출 ──
  const tBefore: Partial<TableSnapshotFields> = {};
  const tAfter:  Partial<TableSnapshotFields> = {};
  for (const f of TABLE_FIELDS) {
    if (before.table[f] !== after.table[f]) {
      tBefore[f] = before.table[f] as never;
      tAfter[f]  = after.table[f]  as never;
    }
  }
  const tableDiff = Object.keys(tAfter).length > 0
    ? { before: tBefore, after: tAfter }
    : null;

  // ── 컬럼 비교 ──
  const beforeMap = new Map(before.columns.map((c) => [c.col_id, c]));
  const afterMap  = new Map(after.columns.map((c) => [c.col_id, c]));

  const added:    ColumnSnapshotFields[] = [];
  const removed:  ColumnSnapshotFields[] = [];
  const modified: ColumnModification[]   = [];

  for (const [id, aCol] of afterMap) {
    const bCol = beforeMap.get(id);
    if (!bCol) {
      added.push(aCol);
      continue;
    }
    // 변경된 필드만 기록
    const bPartial: Partial<ColumnSnapshotFields> = {};
    const aPartial: Partial<ColumnSnapshotFields> = {};
    for (const f of COLUMN_FIELDS) {
      if (bCol[f] !== aCol[f]) {
        (bPartial as Record<string, unknown>)[f] = bCol[f];
        (aPartial as Record<string, unknown>)[f] = aCol[f];
      }
    }
    if (Object.keys(aPartial).length > 0) {
      modified.push({
        col_id:        id,
        col_physcl_nm: aCol.col_physcl_nm,
        before:        bPartial,
        after:         aPartial,
      });
    }
  }
  for (const [id, bCol] of beforeMap) {
    if (!afterMap.has(id)) removed.push(bCol);
  }

  return { table: tableDiff, columns: { added, modified, removed } };
}

// ── 요약 문자열 ───────────────────────────────────────────────────────────────

/**
 * diff 에서 "테이블 정보 수정, 컬럼 3개 추가, 1개 수정" 같은 요약 생성.
 * 변경 없으면 빈 문자열.
 */
export function buildChgSummary(diff: RevisionDiff): string {
  const parts: string[] = [];
  if (diff.table) parts.push("테이블 정보 수정");
  const { added, modified, removed } = diff.columns;
  if (added.length)    parts.push(`컬럼 ${added.length}개 추가`);
  if (modified.length) parts.push(`컬럼 ${modified.length}개 수정`);
  if (removed.length)  parts.push(`컬럼 ${removed.length}개 삭제`);
  return parts.join(", ");
}

// ── diff 존재 여부 ────────────────────────────────────────────────────────────

export function hasAnyChange(diff: RevisionDiff): boolean {
  if (diff.table) return true;
  return diff.columns.added.length > 0
      || diff.columns.modified.length > 0
      || diff.columns.removed.length > 0;
}

// ── 이력 기록 ─────────────────────────────────────────────────────────────────

export type RecordRevisionArgs = {
  projectId:   string;
  tblId:       string;
  chgTypeCode: "CREATE" | "UPDATE" | "DELETE";
  before:      TableSnapshot | null;
  after:       TableSnapshot | null;
  chgMberId:   string | null;
};

/**
 * tb_ds_db_table_revision 에 이력 1건 기록.
 * 반환: 기록 성공 시 revId, 변경 없음이면 null (UPDATE 인데 실제 변경 없으면 skip)
 *
 * 호출 규칙:
 *   - 저장 트랜잭션 내부에서 호출할 것 (db = tx)
 *   - CREATE: before=null, after=생성 직후 스냅샷
 *   - UPDATE: before=변경 전, after=변경 후
 *   - DELETE: before=삭제 직전, after=null
 */
export async function recordRevision(
  db: DbClient,
  args: RecordRevisionArgs
): Promise<string | null> {
  const diff    = buildRevisionDiff(args.before, args.after);
  const summary = buildChgSummary(diff);

  // UPDATE 인데 실제 변경이 없으면 이력 남기지 않음 (불필요한 row 방지)
  if (args.chgTypeCode === "UPDATE" && !hasAnyChange(diff)) {
    return null;
  }

  // 해당 테이블의 마지막 rev_no + 1
  const last = await db.tbDsDbTableRevision.findFirst({
    where:   { tbl_id: args.tblId },
    orderBy: { rev_no: "desc" },
    select:  { rev_no: true },
  });
  const revNo = (last?.rev_no ?? 0) + 1;

  const created = await db.tbDsDbTableRevision.create({
    data: {
      prjct_id:      args.projectId,
      tbl_id:        args.tblId,
      rev_no:        revNo,
      chg_type_code: args.chgTypeCode,
      chg_summary:   summary || null,
      snapshot_data: diff as unknown as Prisma.InputJsonValue,
      chg_mber_id:   args.chgMberId,
    },
    select: { rev_id: true },
  });
  return created.rev_id;
}
