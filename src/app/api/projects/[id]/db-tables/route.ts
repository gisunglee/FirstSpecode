/**
 * GET  /api/projects/[id]/db-tables — DB 테이블 목록 (컬럼 수 포함)
 * POST /api/projects/[id]/db-tables — DB 테이블 생성
 *
 * 권한:
 *   - GET:  content.read (모든 멤버 — VIEWER 포함)
 *   - POST: db.table.write (OWNER/ADMIN 또는 DBA/DEV 직무)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { captureTableSnapshot, recordRevision } from "@/lib/dbTableRevision";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    const tables = await prisma.tbDsDbTable.findMany({
      where: { prjct_id: projectId },
      include: { _count: { select: { columns: true } } },
      orderBy: { tbl_physcl_nm: "asc" },
    });

    // 담당자 mberId → 이름 배치 조회 (N+1 방지)
    const assigneeIds = [
      ...new Set(tables.map((t) => t.asign_mber_id).filter((v): v is string => !!v)),
    ];
    const assigneeMembers = assigneeIds.length > 0
      ? await prisma.tbCmMember.findMany({
          where:  { mber_id: { in: assigneeIds } },
          // email_addr를 fallback으로 — mber_nm 미설정 계정도 식별 가능
          select: { mber_id: true, mber_nm: true, email_addr: true },
        })
      : [];
    const assigneeMap = new Map(
      assigneeMembers.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null])
    );

    return apiSuccess(
      tables.map((t) => ({
        tblId:            t.tbl_id,
        tblPhysclNm:      t.tbl_physcl_nm,
        tblLgclNm:        t.tbl_lgcl_nm  ?? "",
        tblDc:            t.tbl_dc       ?? "",
        creatDt:          t.creat_dt.toISOString(),
        mdfcnDt:          t.mdfcn_dt?.toISOString() ?? null,
        // 담당자 — 미지정/퇴장 멤버면 null
        assignMemberId:   t.asign_mber_id ?? null,
        assignMemberName: t.asign_mber_id ? (assigneeMap.get(t.asign_mber_id) ?? null) : null,
        columnCount:      t._count.columns,
      }))
    );
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/db-tables] DB 오류:`, err);
    return apiError("DB_ERROR", "DB 테이블 목록 조회에 실패했습니다.", 500);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "db.table.write");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { tblPhysclNm, tblLgclNm, tblDc, assignMemberId } = body as {
    tblPhysclNm?:    string;
    tblLgclNm?:      string;
    tblDc?:          string;
    assignMemberId?: string;
  };

  if (!tblPhysclNm?.trim()) {
    return apiError("VALIDATION_ERROR", "물리 테이블명은 필수입니다.", 400);
  }

  try {
    // 트랜잭션: 테이블 생성 + CREATE 이력 1건 기록
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.tbDsDbTable.create({
        data: {
          prjct_id:      projectId,
          tbl_physcl_nm: tblPhysclNm.trim(),
          tbl_lgcl_nm:   tblLgclNm?.trim() || null,
          tbl_dc:        tblDc?.trim()     || null,
          asign_mber_id: assignMemberId?.trim() || null,
        },
      });

      // 생성 직후 스냅샷 (컬럼 없음)
      const after = await captureTableSnapshot(tx, row.tbl_id);
      await recordRevision(tx, {
        projectId,
        tblId:       row.tbl_id,
        chgTypeCode: "CREATE",
        before:      null,
        after,
        chgMberId:   gate.mberId,
      });

      return row;
    });

    return apiSuccess({ tblId: created.tbl_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/db-tables] DB 오류:`, err);
    return apiError("DB_ERROR", "DB 테이블 생성에 실패했습니다.", 500);
  }
}
