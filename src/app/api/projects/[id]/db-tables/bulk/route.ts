/**
 * POST /api/projects/[id]/db-tables/bulk — DDL 일괄 등록
 *
 * 역할:
 *   - FE 에서 `@/lib/ddlParser` 로 파싱·사용자 편집을 마친 여러 테이블을 받아 한 번에 생성
 *   - 테이블 단위 트랜잭션 (테이블 + 컬럼 + CREATE 이력을 한 덩어리로)
 *   - 테이블 간에는 독립 — 한 건 실패가 다른 건을 막지 않음 (부분 성공 허용)
 *   - 물리명 중복은 skip 으로 응답 (덮어쓰기 미지원 — 기획안 1차 범위)
 *
 * 권한:
 *   db.table.write (기존 POST 와 동일)
 *
 * Body:
 *   {
 *     tables: [
 *       {
 *         tblPhysclNm: "tb_xxx",
 *         tblLgclNm:   "회원",
 *         tblDc?:       "회원 정보 저장 테이블",
 *         columns: [
 *           { colPhysclNm, colLgclNm?, dataTyNm?, colDc? }
 *         ]
 *       }
 *     ]
 *   }
 *
 * Response:
 *   {
 *     data: {
 *       created: [{ tblPhysclNm, tblId }],
 *       skipped: [{ tblPhysclNm, reason }],   // 중복 등
 *       failed:  [{ tblPhysclNm, reason }],   // 예외
 *     }
 *   }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { captureTableSnapshot, recordRevision } from "@/lib/dbTableRevision";

type RouteParams = { params: Promise<{ id: string }> };

type BulkColumnInput = {
  colPhysclNm: string;
  colLgclNm?:  string;
  dataTyNm?:   string;
  colDc?:      string;
};

type BulkTableInput = {
  tblPhysclNm: string;
  tblLgclNm?:  string;
  tblDc?:      string;
  columns?:    BulkColumnInput[];
};

type CreatedItem = { tblPhysclNm: string; tblId: string };
type SkippedItem = { tblPhysclNm: string; reason: string };
type FailedItem  = { tblPhysclNm: string; reason: string };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "db.table.write");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { tables } = (body ?? {}) as { tables?: BulkTableInput[] };
  if (!Array.isArray(tables) || tables.length === 0) {
    return apiError("VALIDATION_ERROR", "등록할 테이블이 없습니다.", 400);
  }

  // 최대 100개 제한 — 너무 큰 요청은 서버·DB 부하를 유발하므로 방어
  if (tables.length > 100) {
    return apiError("VALIDATION_ERROR", "한 번에 최대 100개까지 등록할 수 있습니다.", 400);
  }

  const created: CreatedItem[] = [];
  const skipped: SkippedItem[] = [];
  const failed:  FailedItem[]  = [];

  // 기존 테이블 물리명 집합 (중복 skip 판정용)
  // FE에서도 1차 체크하지만 경쟁 조건 대비 서버 재검증
  const existing = await prisma.tbDsDbTable.findMany({
    where:  { prjct_id: projectId },
    select: { tbl_physcl_nm: true },
  });
  const existingSet = new Set(existing.map((t) => t.tbl_physcl_nm.toLowerCase()));

  // 배치 내 중복(같은 요청에 같은 물리명 여러 번) 방지용 — 첫 번째만 등록하고 이후는 skip
  const batchSeen = new Set<string>();

  for (const t of tables) {
    const physNm = t.tblPhysclNm?.trim();
    if (!physNm) {
      failed.push({ tblPhysclNm: "(이름 없음)", reason: "물리 테이블명이 비어있습니다." });
      continue;
    }
    const physLower = physNm.toLowerCase();

    if (existingSet.has(physLower)) {
      skipped.push({ tblPhysclNm: physNm, reason: "이미 등록된 테이블" });
      continue;
    }
    if (batchSeen.has(physLower)) {
      skipped.push({ tblPhysclNm: physNm, reason: "요청 내 중복 (첫 번째만 등록)" });
      continue;
    }
    batchSeen.add(physLower);

    // 테이블 단위 트랜잭션 — 이 안에서 컬럼·이력까지 묶는다
    try {
      const tblId = await prisma.$transaction(async (tx) => {
        const row = await tx.tbDsDbTable.create({
          data: {
            prjct_id:      projectId,
            tbl_physcl_nm: physNm,
            tbl_lgcl_nm:   t.tblLgclNm?.trim() || null,
            tbl_dc:        t.tblDc?.trim()     || null,
          },
        });

        // 컬럼 일괄 생성 — sort_ordr 는 배열 순서(1-based)
        const cols = t.columns ?? [];
        for (let i = 0; i < cols.length; i++) {
          const c = cols[i]!;
          const colPhysNm = c.colPhysclNm?.trim();
          if (!colPhysNm) continue;  // 물리명 빠진 컬럼은 조용히 건너뜀 (상위 파싱 품질 책임)
          await tx.tbDsDbTableColumn.create({
            data: {
              tbl_id:        row.tbl_id,
              col_physcl_nm: colPhysNm,
              col_lgcl_nm:   c.colLgclNm?.trim() || null,
              data_ty_nm:    c.dataTyNm?.trim()  || null,
              col_dc:        c.colDc?.trim()     || null,
              sort_ordr:     i + 1,
            },
          });
        }

        // CREATE 이력 1건 — 단건 POST 와 동일 구조
        const after = await captureTableSnapshot(tx, row.tbl_id);
        await recordRevision(tx, {
          projectId,
          tblId:       row.tbl_id,
          chgTypeCode: "CREATE",
          before:      null,
          after,
          chgMberId:   gate.mberId,
        });

        return row.tbl_id;
      });

      created.push({ tblPhysclNm: physNm, tblId });
      // 뒤이어 같은 물리명이 들어오지 않도록 existingSet 에도 추가
      existingSet.add(physLower);
    } catch (err) {
      console.error(`[POST /db-tables/bulk] ${physNm} 생성 실패:`, err);
      failed.push({
        tblPhysclNm: physNm,
        reason: err instanceof Error ? err.message : "알 수 없는 오류",
      });
    }
  }

  return apiSuccess({ created, skipped, failed }, 200);
}
