/**
 * GET    /api/projects/[id]/db-tables/[tableId] — DB 테이블 상세 (테이블 정보 + 컬럼 목록)
 * PUT    /api/projects/[id]/db-tables/[tableId] — DB 테이블 수정 + 컬럼 전체 교체
 * PATCH  /api/projects/[id]/db-tables/[tableId] — 상태(신규/기존/데디케이트)만 경량 변경 (컬럼 안 건드림)
 * DELETE /api/projects/[id]/db-tables/[tableId] — DB 테이블 삭제 (컬럼 cascade)
 *
 * PUT body:
 *   { tblPhysclNm, tblLgclNm, tblDc, tblSttusCode?, confirmColumnRemoval?,
 *     columns: [{ colId?, colPhysclNm, colLgclNm, dataTyNm, colDc, sortOrdr }] }
 *   - colId 있으면 update, 없으면 insert
 *   - 전달되지 않은 기존 컬럼은 삭제 대상
 *   - 삭제 대상 컬럼에 컬럼 매핑(tb_ds_col_mapping)이 걸려있으면, confirmColumnRemoval 이
 *     true 가 아닌 한 실제로 지우지 않고 { needsConfirmation: true, impact } 를 반환한다
 *     (아무 것도 커밋되지 않음 — 클라이언트가 영향도를 보여주고 재확인 후 true 로 재요청)
 *
 * PATCH body:
 *   { tblSttusCode: "NEW" | "EXISTING" | "DEPRECATED" }
 *   - 컬럼은 전혀 건드리지 않는 경량 엔드포인트. 목록 화면의 상태 배지 클릭(순환 토글),
 *     삭제 확인창의 "상태만 변경"(데디케이트) 액션 전용.
 *   - 목표 상태에 따라 권한을 다르게 매긴다 (PUT 없이 컬럼 전체를 안 건드리고 상태만
 *     바꾸는 짧은 경로이므로, 위험도가 다른 두 케이스를 하나의 게이트로 뭉치지 않는다):
 *       · DEPRECATED로 전환      → db.table.delete 와 동일 게이트(담당자 예외 포함).
 *         "이제 안 쓴다"는 선언은 삭제만큼 신중해야 하므로 삭제와 동급 권한 요구.
 *       · NEW/EXISTING으로 전환  → db.table.write. 스키마가 새 것인지 기존 것인지
 *         재분류하는 건 삭제만큼 위험하지 않은 일상적 작업이라 더 가벼운 권한으로 충분.
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
        colId:        c.col_id,
        colPhysclNm:  c.col_physcl_nm,
        colLgclNm:    c.col_lgcl_nm   ?? "",
        dataTyNm:     c.data_ty_nm    ?? "",
        colDc:        c.col_dc        ?? "",
        refGrpCode:   c.ref_grp_code  ?? "",
        colSttusCode: c.col_sttus_code,
        sortOrdr:     c.sort_ordr,
        mdfcnDt:      c.mdfcn_dt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/db-tables/${tableId}] DB 오류:`, err);
    return apiError("DB_ERROR", "DB 테이블 조회에 실패했습니다.", 500);
  }
}

// ── PUT ───────────────────────────────────────────────────────────────────────

type ColumnInput = {
  colId?:        string;
  colPhysclNm:   string;
  colLgclNm?:    string;
  dataTyNm?:     string;
  colDc?:        string;
  refGrpCode?:   string;
  // 기존 컬럼(colId 있음)은 NEW/EXISTING/DEPRECATED 셋 다 자유롭게 지정 가능(배지 클릭 순환).
  // 신규 컬럼(colId 없음)은 클라이언트가 뭘 보내든 무시하고 서버가 무조건 NEW로 강제한다
  // (컬럼 추가 시점의 기본값일 뿐 — 아래 upsert 참고)
  colSttusCode?: string;
  sortOrdr?:     number;
};

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, tableId } = await params;

  const gate = await requirePermission(request, projectId, "db.table.write");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { tblPhysclNm, tblLgclNm, tblDc, columns, assignMemberId, tblSttusCode, confirmColumnRemoval } = body as {
    tblPhysclNm?:   string;
    tblLgclNm?:     string;
    tblDc?:         string;
    columns?:       ColumnInput[];
    assignMemberId?: string;
    tblSttusCode?:  string;
    confirmColumnRemoval?: boolean;
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

    // 제거될 컬럼 목록 — 트랜잭션 시작 전에 먼저 계산해 매핑 영향도를 확인한다.
    // (실제 삭제는 트랜잭션 안에서 이 목록을 그대로 재사용 — 아래 참고)
    const removedCols = await prisma.tbDsDbTableColumn.findMany({
      where: {
        tbl_id: tableId,
        ...(incomingIds.length > 0 ? { col_id: { notIn: incomingIds } } : {}),
      },
      select: { col_id: true },
    });
    const removedColIds = removedCols.map((c) => c.col_id);

    // 제거될 컬럼에 다른 기능/영역/화면이 매핑으로 쓰고 있으면, 확인 없이 조용히
    // 지우지 않는다 — 사용자가 영향도를 보고 confirmColumnRemoval=true 로 재요청해야
    // 실제 삭제가 진행된다. 여기서 걸리면 아무 것도 커밋하지 않고 즉시 반환.
    if (removedColIds.length > 0 && !confirmColumnRemoval) {
      const impactedMappings = await prisma.tbDsColMapping.findMany({
        where:  { col_id: { in: removedColIds } },
        select: { ref_ty_code: true, ref_id: true },
      });
      const funcIds = new Set<string>();
      const areaIds = new Set<string>();
      const scrnIds = new Set<string>();
      for (const m of impactedMappings) {
        if      (m.ref_ty_code === "FUNCTION") funcIds.add(m.ref_id);
        else if (m.ref_ty_code === "AREA")     areaIds.add(m.ref_id);
        else if (m.ref_ty_code === "SCREEN")   scrnIds.add(m.ref_id);
      }
      const impact = {
        columnCount:   removedColIds.length,
        functionCount: funcIds.size,
        areaCount:     areaIds.size,
        screenCount:   scrnIds.size,
      };
      if (impact.functionCount + impact.areaCount + impact.screenCount > 0) {
        return apiSuccess({ needsConfirmation: true, impact });
      }
    }

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
      // 참조만 하므로, 먼저 지워질 컬럼을 가리키는 매핑을 정리해야 유령 행이 안 남는다.
      // removedColIds 는 트랜잭션 시작 전에 이미 계산 + 영향도 확인까지 끝난 목록 (위 참고).
      await deleteOrphanedColMappings(tx, removedColIds);

      await tx.tbDsDbTableColumn.deleteMany({
        where: { col_id: { in: removedColIds } },
      });

      // 컬럼 upsert (순서 유지, 수정자·수정일시 포함)
      const now = new Date();
      for (let i = 0; i < colList.length; i++) {
        const c = colList[i]!;
        if (c.colId) {
          // 기존 컬럼 — colSttusCode 는 배지 클릭 순환(신규/기존/데디케이트)으로 온 값.
          // 유효하지 않거나 안 보내면 건드리지 않는다 (undefined → Prisma가 필드 자체를 스킵).
          const sttus = c.colSttusCode !== undefined && isDbTableStatusCode(c.colSttusCode)
            ? c.colSttusCode
            : undefined;
          await tx.tbDsDbTableColumn.update({
            where: { col_id: c.colId },
            data: {
              col_physcl_nm:  c.colPhysclNm.trim(),
              col_lgcl_nm:    c.colLgclNm?.trim()   || null,
              data_ty_nm:     c.dataTyNm?.trim()     || null,
              col_dc:         c.colDc?.trim()         || null,
              ref_grp_code:   c.refGrpCode?.trim()    || null,
              ...(sttus !== undefined ? { col_sttus_code: sttus } : {}),
              sort_ordr:      i + 1,
              mdfcn_mber_id:  gate.mberId,
              mdfcn_dt:       now,
            },
          });
        } else {
          // 신규 컬럼 — 사람이 매번 상태를 고를 필요 없이 무조건 NEW (클라이언트 값은 무시)
          await tx.tbDsDbTableColumn.create({
            data: {
              tbl_id:         tableId,
              col_physcl_nm:  c.colPhysclNm.trim(),
              col_lgcl_nm:    c.colLgclNm?.trim()   || null,
              data_ty_nm:     c.dataTyNm?.trim()     || null,
              col_dc:         c.colDc?.trim()         || null,
              ref_grp_code:   c.refGrpCode?.trim()    || null,
              col_sttus_code: "NEW",
              sort_ordr:      i + 1,
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

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { tblSttusCode } = body as { tblSttusCode?: string };
  if (!isDbTableStatusCode(tblSttusCode)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 상태값입니다.", 400);
  }

  // 목표 상태에 따라 권한 게이트를 분기 (파일 상단 PATCH 설명 참고)
  let mberId: string;
  if (tblSttusCode === "DEPRECATED") {
    const gate = await requireDbTableDelete(request, projectId, async () => {
      const t = await prisma.tbDsDbTable.findUnique({
        where:  { tbl_id: tableId },
        select: { asign_mber_id: true, prjct_id: true },
      });
      return t && t.prjct_id === projectId ? t.asign_mber_id : null;
    });
    if (gate instanceof Response) return gate;
    mberId = gate.mberId;
  } else {
    const gate = await requirePermission(request, projectId, "db.table.write");
    if (gate instanceof Response) return gate;
    mberId = gate.mberId;
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
          mdfcn_mber_id:  mberId,
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
        chgMberId:   mberId,
      });
    });

    return apiSuccess({ tblId: tableId, tblSttusCode });
  } catch (err) {
    console.error(`[PATCH /api/projects/${projectId}/db-tables/${tableId}] DB 오류:`, err);
    return apiError("DB_ERROR", "DB 테이블 상태 변경에 실패했습니다.", 500);
  }
}
