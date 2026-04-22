/**
 * GET    /api/projects/[id]/db-tables/[tableId] — DB 테이블 상세 (테이블 정보 + 컬럼 목록)
 * PUT    /api/projects/[id]/db-tables/[tableId] — DB 테이블 수정 + 컬럼 전체 교체
 * DELETE /api/projects/[id]/db-tables/[tableId] — DB 테이블 삭제 (컬럼 cascade)
 *
 * PUT body:
 *   { tblPhysclNm, tblLgclNm, tblDc,
 *     columns: [{ colId?, colPhysclNm, colLgclNm, dataTyNm, colDc, sortOrdr }] }
 *   - colId 있으면 update, 없으면 insert
 *   - 전달되지 않은 기존 컬럼은 삭제
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { captureTableSnapshot, recordRevision } from "@/lib/dbTableRevision";

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

  const { tblPhysclNm, tblLgclNm, tblDc, columns, assignMemberId } = body as {
    tblPhysclNm?:    string;
    tblLgclNm?:      string;
    tblDc?:          string;
    columns?:        ColumnInput[];
    assignMemberId?: string;
  };

  if (!tblPhysclNm?.trim()) {
    return apiError("VALIDATION_ERROR", "물리 테이블명은 필수입니다.", 400);
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
          tbl_physcl_nm: tblPhysclNm.trim(),
          tbl_lgcl_nm:   tblLgclNm !== undefined ? (tblLgclNm?.trim() || null) : existing.tbl_lgcl_nm,
          tbl_dc:        tblDc !== undefined ? (tblDc?.trim() || null) : existing.tbl_dc,
          asign_mber_id: nextAssignee,
          mdfcn_mber_id: gate.mberId,
          mdfcn_dt:      new Date(),
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

      // 전달되지 않은 기존 컬럼 삭제
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

  const gate = await requirePermission(request, projectId, "db.table.write");
  if (gate instanceof Response) return gate;

  try {
    const existing = await prisma.tbDsDbTable.findUnique({ where: { tbl_id: tableId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "테이블을 찾을 수 없습니다.", 404);
    }

    // 트랜잭션: 삭제 직전 스냅샷 → DELETE 이력 기록 → 컬럼/테이블 삭제
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

      // 컬럼 먼저 삭제 후 테이블 삭제 (cascade 미설정 대비)
      await tx.tbDsDbTableColumn.deleteMany({ where: { tbl_id: tableId } });
      await tx.tbDsDbTable.delete({ where: { tbl_id: tableId } });
    });

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/db-tables/${tableId}] DB 오류:`, err);
    return apiError("DB_ERROR", "DB 테이블 삭제에 실패했습니다.", 500);
  }
}
