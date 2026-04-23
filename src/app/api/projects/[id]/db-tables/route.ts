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
import { getTableListInsights } from "@/lib/dbTableUsage";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  // 담당자 필터 — "me"는 로그인 사용자, 그 외 값은 해당 mberId로 필터
  // 다른 4개 엔티티(단위업무/과업/요구사항/화면)와 동일한 패턴
  const url        = new URL(request.url);
  const assignedTo = url.searchParams.get("assignedTo") ?? undefined;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  // assignedTo="me" → 로그인 사용자 mberId로 치환
  const assigneeFilter = assignedTo === "me" ? gate.mberId : (assignedTo || undefined);

  try {
    const tables = await prisma.tbDsDbTable.findMany({
      where: {
        prjct_id: projectId,
        ...(assigneeFilter ? { asign_mber_id: assigneeFilter } : {}),
      },
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

    // 테이블별 매핑 인사이트 배치 집계 (Phase 2)
    //   · functionCount: distinct 기능 수
    //   · usedColCount:  매핑된 적 있는 컬럼 수 → 커버리지 계산용
    //   · ioProfile:     READ_HEAVY / WRITE_HEAVY / MIXED / NONE
    // 프로젝트 전체를 한 번에 집계 (N+1 없음). 매핑 없는 테이블은 기본값 처리.
    const insightsMap = await getTableListInsights(projectId);

    return apiSuccess(
      tables.map((t) => {
        const ins = insightsMap.get(t.tbl_id);
        return {
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
          // 매핑 인사이트 (클라이언트에서 배지·필터·정렬에 사용)
          functionCount:    ins?.functionCount ?? 0,
          usedColCount:     ins?.usedColCount  ?? 0,
          ioProfile:        ins?.ioProfile     ?? "NONE",
          // Phase 3 — 마지막 사용일 (ISO). 매핑이 없는 테이블은 null.
          lastUsedDt:       ins?.lastUsedDt    ?? null,
        };
      })
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
