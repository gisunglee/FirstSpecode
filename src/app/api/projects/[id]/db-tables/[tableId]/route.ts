/**
 * GET    /api/projects/[id]/db-tables/[tableId] — DB 테이블 상세 (테이블 정보 + 컬럼 목록)
 * PUT    /api/projects/[id]/db-tables/[tableId] — DB 테이블 수정 + 컬럼 전체 교체
 * PATCH  /api/projects/[id]/db-tables/[tableId] — 상태(신규/기존/데디케이트)만 경량 변경
 * DELETE /api/projects/[id]/db-tables/[tableId] — DB 테이블 삭제 (컬럼 cascade)
 *
 * PUT body:
 *   { tblPhysclNm, tblLgclNm, tblDc, tblSttusCode?,
 *     columns: [{ colId?, colPhysclNm, colLgclNm, dataTyNm, colDc, sortOrdr }] }
 *   - colId 있으면 update, 없으면 insert
 *   - 전달되지 않은 기존 컬럼은 삭제
 *
 * PATCH body:
 *   { tblSttusCode: "DEPRECATED" }
 *   - 컬럼은 전혀 건드리지 않는 경량 엔드포인트. 삭제 확인창의 "상태만 변경"(데디케이트) 액션 전용.
 *   - 권한도 삭제와 동일(db.table.delete)하게 취급 — "이제 안 쓴다"는 선언은 삭제만큼 신중해야 함.
 *   - DEPRECATED로만 제한한다 — NEW/EXISTING으로 되돌리거나 재분류하는 건 삭제 권한과는
 *     성격이 다른(덜 위험한) 작업이라, 그건 PUT(테이블 상세 편집 폼, db.table.write)으로만 한다.
 *     그렇지 않으면 "삭제 권한 있는 사람 = 상태 마음대로 바꿀 수 있는 사람"이 되어버려
 *     나중에 상태 재분류만 더 넓게 허용하고 싶을 때 이 게이트를 통째로 다시 설계해야 한다.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { requireDbTableDelete } from "@/lib/requireDbTableDelete";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { captureTableSnapshot, recordRevision } from "@/lib/dbTableRevision";
import { deleteOrphanedColMappings } from "@/lib/dbTableUsage";
import { isDbTableStatusCode } from "@/lib/dbTableStatus";

type RouteParams = { params: Promise<{ id: string; tableId: string }> };

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, tableId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    const table = await prisma.tbDsDbTable.findUnique({
      where: { tbl_id: tableId },
      include: {
        columns: { orderBy: { sort_ordr: "asc" } },
      },
    });

    if (!table || table.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "테이블을 찾을 수 없습니다.", 404);
    }

    // 담당자 이름 조회 — 없거나 퇴장 멤버면 null
    const assignee = table.asign_mber_id
      ? await prisma.tbCmMember.findUnique({
          where:  { mber_id: table.asign_mber_id },
          // email_addr를 fallback으로 — mber_nm 미설정 계정도 식별 가능
          select: { mber_nm: true, email_addr: true },
        })
      : null;

    return apiSuccess({
      tblId:            table.tbl_id,
      tblPhysclNm:      table.tbl_physcl_nm,
      tblLgclNm:        table.tbl_lgcl_nm  ?? "",
      tblDc:            table.tbl_dc       ?? "",
      tblSttusCode:     table.tbl_sttus_code,
      creatDt:          table.creat_dt.toISOString(),
      mdfcnDt:          table.mdfcn_dt?.toISOString() ?? null,
      // 담당자 — mber_nm 우선, 없으면 email, 둘 다 없으면 null
      assignMemberId:   table.asign_mber_id ?? null,
      assignMemberName: assignee ? (assignee.mber_nm || assignee.email_addr || null) : null,
      columns: table.columns.map((c) => ({
        colId:       c.col_id,
        colPhysclNm: c.col_physcl_nm,
        colLgclNm:   c.col_lgcl_nm   ?? "",
        dataTyNm:    c.data_ty_nm    ?? "",
        colDc:       c.col_dc        ?? "",
        refGrpCode:  c.ref_grp_code  ?? "",
        sortOrdr:    c.sort_ordr,
        mdfcnDt:     c.mdfcn_dt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/db-tables/${tableId}] DB 오류:`, err);
    return apiError("DB_ERROR", "DB 테이블 조회에 실패했습니다.", 500);
  }
}

// ── PUT ───────────────────────────────────────────────────────────────────────

type ColumnInput = {
  colId?:      string;
  colPhysclNm: string;
  colLgclNm?:  string;
  dataTyNm?:   string;
  colDc?:      string;
  refGrpCode?: string;
  sortOrdr?:   number;
};

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, tableId } = await params;

  const gate = await requirePermission(request, projectId, "db.table.write");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { tblPhysclNm, tblLgclNm, tblDc, columns, assignMemberId, tblSttusCode } = body as {
    tblPhysclNm?:   string;
    tblLgclNm?:     string;
    tblDc?:         string;
    columns?:       ColumnInput[];
    assignMemberId?: string;
    tblSttusCode?:  string;
  };

  if (!tblPhysclNm?.trim()) {
    return apiError("VALIDATION_ERROR", "물리 테이블명은 필수입니다.", 400);
  }
  if (tblSttusCode !== undefined && !isDbTableStatusCode(tblSttusCode)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 상태값입니다.", 400);
  }

  try {
    const existing = await prisma.tbDsDbTable.findUnique({ where: { tbl_id: tableId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "테이블을 찾을 수 없습니다.", 404);
    }

    const colList: ColumnInput[] = columns ?? [];
    const incomingIds = colList.map((c) => c.colId).filter(Boolean) as string[];

    // 담당자 변경 감지 — 값이 실제로 바뀌었을 때만 별도 이력 저장 (no-op 스킵)
    // tb_ds_design_change 재사용 (다른 엔티티와 동일 패턴)
    // ref_tbl_nm="tb_ds_db_table", chg_rsn_cn="담당자"
    const CHG_REASON_ASSIGNEE = "담당자";
    const prevAssignee    = existing.asign_mber_id ?? null;
    const nextAssignee    = assignMemberId !== undefined ? (assignMemberId || null) : prevAssignee;
    const assigneeChanged = assignMemberId !== undefined && prevAssignee !== nextAssignee;

    // 이력 저장 시 이름도 함께 기록 → 멤버 탈퇴 후에도 이력 뷰 보존
    let assigneeNames: { before: string | null; after: string | null } = { before: null, after: null };
    if (assigneeChanged) {
      const ids = [prevAssignee, nextAssignee].filter((v): v is string => !!v);
      const membersForHistory = ids.length > 0
        ? await prisma.tbCmMember.findMany({
            where:  { mber_id: { in: ids } },
            // email_addr를 fallback으로 — mber_nm 미설정 계정도 이력에서 식별 가능
            select: { mber_id: true, mber_nm: true, email_addr: true },
          })
        : [];
      const nameMap = new Map(membersForHistory.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]));
      assigneeNames = {
        before: prevAssignee ? (nameMap.get(prevAssignee) ?? null) : null,
        after:  nextAssignee ? (nameMap.get(nextAssignee) ?? null) : null,
      };
    }

    await prisma.$transaction(async (tx) => {
      // 변경 전 스냅샷 (이력용)
      const before = await captureTableSnapshot(tx, tableId);

      // 테이블 정보 업데이트 (수정자·수정일시 포함)
      await tx.tbDsDbTable.update({
        where: { tbl_id: tableId },
        data: {
          tbl_physcl_nm:  tblPhysclNm.trim(),
          tbl_lgcl_nm:    tblLgclNm !== undefined ? (tblLgclNm?.trim() || null) : existing.tbl_lgcl_nm,
          tbl_dc:         tblDc !== undefined ? (tblDc?.trim() || null) : existing.tbl_dc,
          tbl_sttus_code: tblSttusCode !== undefined ? tblSttusCode : existing.tbl_sttus_code,
          asign_mber_id:  nextAssignee,
          mdfcn_mber_id:  gate.mberId,
          mdfcn_dt:       new Date(),
        },
      });

      // 담당자 변경 이력 — 자동 저장 (값이 실제로 바뀐 경우만)
      if (assigneeChanged) {
        await tx.tbDsDesignChange.create({
          data: {
            prjct_id:      projectId,
            ref_tbl_nm:    "tb_ds_db_table",
            ref_id:        tableId,
            chg_type_code: "UPDATE",
            chg_rsn_cn:    CHG_REASON_ASSIGNEE,
            snapshot_data: {
              before:     prevAssignee,
              after:      nextAssignee,
              beforeName: assigneeNames.before,
              afterName:  assigneeNames.after,
            },
            chg_mber_id: gate.mberId,
          },
        });
      }

      // 전달되지 않은 기존 컬럼 삭제 — tb_ds_col_mapping 은 col_id 를 FK 없이
      // 참조만 하므로, 먼저 지워질 컬럼을 가리키는 매핑을 정리해야 유령 행이 안 남는다
      const removedCols = await tx.tbDsDbTableColumn.findMany({
        where: {
          tbl_id: tableId,
          ...(incomingIds.length > 0 ? { col_id: { notIn: incomingIds } } : {}),
        },
        select: { col_id: true },
      });
      await deleteOrphanedColMappings(tx, removedCols.map((c) => c.col_id));

      await tx.tbDsDbTableColumn.deleteMany({
        where: {
          tbl_id: tableId,
          ...(incomingIds.length > 0 ? { col_id: { notIn: incomingIds } } : {}),
        },
      });

      // 컬럼 upsert (순서 유지, 수정자·수정일시 포함)
      const now = new Date();
      for (let i = 0; i < colList.length; i++) {
        const c = colList[i]!;
        if (c.colId) {
          await tx.tbDsDbTableColumn.update({
            where: { col_id: c.colId },
            data: {
              col_physcl_nm: c.colPhysclNm.trim(),
              col_lgcl_nm:   c.colLgclNm?.trim()   || null,
              data_ty_nm:    c.dataTyNm?.trim()     || null,
              col_dc:        c.colDc?.trim()         || null,
              ref_grp_code:  c.refGrpCode?.trim()    || null,
              sort_ordr:     i + 1,
              mdfcn_mber_id: gate.mberId,
              mdfcn_dt:      now,
            },
          });
        } else {
          await tx.tbDsDbTableColumn.create({
            data: {
              tbl_id:        tableId,
              col_physcl_nm: c.colPhysclNm.trim(),
              col_lgcl_nm:   c.colLgclNm?.trim()   || null,
              data_ty_nm:    c.dataTyNm?.trim()     || null,
              col_dc:        c.colDc?.trim()         || null,
              ref_grp_code:  c.refGrpCode?.trim()    || null,
              sort_ordr:     i + 1,
            },
          });
        }
      }

      // 변경 후 스냅샷 → 이력 기록 (실제 변경 없으면 recordRevision 이 null 반환하고 skip)
      const after = await captureTableSnapshot(tx, tableId);
      await recordRevision(tx, {
        projectId,
        tblId:       tableId,
        chgTypeCode: "UPDATE",
        before,
        after,
        chgMberId:   gate.mberId,
      });
    });

    return apiSuccess({ tblId: tableId });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/db-tables/${tableId}] DB 오류:`, err);
    return apiError("DB_ERROR", "DB 테이블 수정에 실패했습니다.", 500);
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, tableId } = await params;

  // 권한: db.table.delete (OWNER/ADMIN 역할 또는 PM/PL/DBA 직무) 또는 이 테이블의 담당자
  const gate = await requireDbTableDelete(request, projectId, async () => {
    const t = await prisma.tbDsDbTable.findUnique({
      where:  { tbl_id: tableId },
      select: { asign_mber_id: true, prjct_id: true },
    });
    return t && t.prjct_id === projectId ? t.asign_mber_id : null;
  });
  if (gate instanceof Response) return gate;

  try {
    const existing = await prisma.tbDsDbTable.findUnique({ where: { tbl_id: tableId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "테이블을 찾을 수 없습니다.", 404);
    }

    // 트랜잭션: 삭제 직전 스냅샷 → DELETE 이력 기록 → 매핑/컬럼/테이블 삭제
    await prisma.$transaction(async (tx) => {
      const before = await captureTableSnapshot(tx, tableId);

      // 이력 먼저 기록 (테이블 삭제되면 외래키 검증 상 문제 없고, 감사 기록은 선행)
      await recordRevision(tx, {
        projectId,
        tblId:       tableId,
        chgTypeCode: "DELETE",
        before,
        after:       null,
        chgMberId:   gate.mberId,
      });

      // 이 테이블 컬럼들을 가리키는 col_mapping 정리 (FK 없어 방치하면 유령 행으로 남음)
      // → 컬럼 삭제 → 테이블 삭제 순 (cascade 미설정 대비)
      const colIds = (
        await tx.tbDsDbTableColumn.findMany({ where: { tbl_id: tableId }, select: { col_id: true } })
      ).map((c) => c.col_id);
      await deleteOrphanedColMappings(tx, colIds);

      await tx.tbDsDbTableColumn.deleteMany({ where: { tbl_id: tableId } });
      await tx.tbDsDbTable.delete({ where: { tbl_id: tableId } });
    });

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/db-tables/${tableId}] DB 오류:`, err);
    return apiError("DB_ERROR", "DB 테이블 삭제에 실패했습니다.", 500);
  }
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, tableId } = await params;

  // 권한: db.table.delete 와 동일 게이트 재사용 — 삭제 확인창에서 갈라지는 액션이라
  // "완전 삭제"만큼 신중해야 함(담당자 예외도 동일하게 적용)
  const gate = await requireDbTableDelete(request, projectId, async () => {
    const t = await prisma.tbDsDbTable.findUnique({
      where:  { tbl_id: tableId },
      select: { asign_mber_id: true, prjct_id: true },
    });
    return t && t.prjct_id === projectId ? t.asign_mber_id : null;
  });
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { tblSttusCode } = body as { tblSttusCode?: string };
  // DEPRECATED 로만 제한 — NEW/EXISTING 재분류는 db.table.write(PUT)로만 허용
  if (tblSttusCode !== "DEPRECATED") {
    return apiError("VALIDATION_ERROR", "이 엔드포인트는 데디케이트로 변경할 때만 사용합니다.", 400);
  }

  try {
    const existing = await prisma.tbDsDbTable.findUnique({ where: { tbl_id: tableId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "테이블을 찾을 수 없습니다.", 404);
    }

    // PUT과 달리 컬럼은 전혀 건드리지 않는다 — 상태 필드 하나만 바꾸는 경량 트랜잭션
    await prisma.$transaction(async (tx) => {
      const before = await captureTableSnapshot(tx, tableId);

      await tx.tbDsDbTable.update({
        where: { tbl_id: tableId },
        data: {
          tbl_sttus_code: tblSttusCode,
          mdfcn_mber_id:  gate.mberId,
          mdfcn_dt:       new Date(),
        },
      });

      const after = await captureTableSnapshot(tx, tableId);
      await recordRevision(tx, {
        projectId,
        tblId:       tableId,
        chgTypeCode: "UPDATE",
        before,
        after,
        chgMberId:   gate.mberId,
      });
    });

    return apiSuccess({ tblId: tableId, tblSttusCode });
  } catch (err) {
    console.error(`[PATCH /api/projects/${projectId}/db-tables/${tableId}] DB 오류:`, err);
    return apiError("DB_ERROR", "DB 테이블 상태 변경에 실패했습니다.", 500);
  }
}
