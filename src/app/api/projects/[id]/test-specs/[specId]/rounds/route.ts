/**
 * GET  /api/projects/[id]/test-specs/[specId]/rounds — 회차 목록 (간략)
 * POST /api/projects/[id]/test-specs/[specId]/rounds — 새 회차 생성
 *
 * POST body:
 *   - envirCode?:    "DEV" | "STG" | "PROD"           (기본 DEV)
 *   - bldVrsnNm?:    string                            (빌드/커밋 버전)
 *   - testMemberId?: string                            (1차 테스터 — 회차 헤더에 1명)
 *
 * round_no 는 명세서 안에서 1부터 자동 증가 (마지막 + 1).
 * 회차 생성 시 PENDING(미실행), 적용 제외 케이스는 NA로 결과를 생성한다.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; specId: string }> };

// ─── GET: 회차 목록 ─────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, specId } = await params;
  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    // spec 의 프로젝트 소유 확인
    const spec = await prisma.tbQaTestSpec.findUnique({ where: { test_spec_id: specId } });
    if (!spec || spec.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "테스트 명세서를 찾을 수 없습니다.", 404);
    }

    const rounds = await prisma.tbQaTestRound.findMany({
      where:   { test_spec_id: specId },
      include: { _count: { select: { results: true } } },
      orderBy: { round_no: "asc" },
    });

    // 합부 카운트는 별도 그룹 쿼리 — 회차당 PASS/FAIL/BLOCKED/NA 집계
    // (Prisma groupBy 사용)
    const summary = await prisma.tbQaTestResult.groupBy({
      by: ["round_id", "result_code"],
      where: { round_id: { in: rounds.map((r) => r.round_id) } },
      _count: { result_code: true },
    });
    const summaryMap = new Map<string, Record<string, number>>();
    for (const s of summary) {
      if (!summaryMap.has(s.round_id)) summaryMap.set(s.round_id, {});
      summaryMap.get(s.round_id)![s.result_code] = s._count.result_code;
    }

    const items = rounds.map((r) => ({
      roundId:     r.round_id,
      roundNo:     r.round_no,
      envirCode:   r.envir_code,
      bldVrsnNm:   r.bld_vrsn_nm,
      bgngDt:      r.bgng_dt,
      endDt:       r.end_dt,
      sttusCode:   r.sttus_code,
      totalCount:  r._count.results,
      summary:     summaryMap.get(r.round_id) ?? {},
      createdAt:   r.creat_dt,
    }));

    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2034") {
      return apiError("CONFLICT", "다른 사용자가 테스트를 변경했습니다. 새로고침 후 다시 시도해 주세요.", 409);
    }
    console.error(`[GET rounds] DB 오류:`, err);
    return apiError("DB_ERROR", "회차 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 새 회차 생성 + 미실행/해당없음 결과 자동 INSERT ──────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, specId } = await params;
  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }
  const { envirCode, bldVrsnNm, testMemberId } = body as {
    envirCode?:    string;
    bldVrsnNm?:    string;
    testMemberId?: string;
  };

  try {
    const spec = await prisma.tbQaTestSpec.findUnique({ where: { test_spec_id: specId } });
    if (!spec || spec.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "테스트 명세서를 찾을 수 없습니다.", 404);
    }

    // 마지막 회차 + 1
    const last = await prisma.tbQaTestRound.findFirst({
      where:   { test_spec_id: specId },
      orderBy: { round_no: "desc" },
      select:  { round_no: true },
    });
    const nextNo = (last?.round_no ?? 0) + 1;

    const round = await prisma.$transaction(async (tx) => {
      // 회차 범위는 트랜잭션 안에서 확정해 케이스 수정/추가와 충돌을 감지한다.
      const cases = await tx.tbQaTestCase.findMany({
        where: { test_spec_id: specId },
        select: { test_case_id: true, applicable_yn: true },
      });
      const r = await tx.tbQaTestRound.create({
        data: {
          prjct_id:     projectId,
          test_spec_id: specId,
          round_no:     nextNo,
          envir_code:   envirCode || "DEV",
          bld_vrsn_nm:  bldVrsnNm?.trim() || null,
          bgng_dt:      new Date(),
          sttus_code:   "IN_PROGRESS",
        },
      });
      // 케이스가 있으면 결과 row 생성 — 미실행과 해당없음을 구분한다.
      if (cases.length > 0) {
        await tx.tbQaTestResult.createMany({
          data: cases.map((c) => ({
            prjct_id:     projectId,
            round_id:     r.round_id,
            test_case_id: c.test_case_id,
            result_code:  c.applicable_yn === "N" ? "NA" : "PENDING",
            test_mber_id: testMemberId || null,
          })),
        });
      }
      // 명세서 상태 — DRAFT 였으면 IN_PROGRESS 로 전환
      if (spec.sttus_code === "DRAFT") {
        await tx.tbQaTestSpec.update({
          where: { test_spec_id: specId },
          data:  { sttus_code: "IN_PROGRESS", mdfcn_dt: new Date() },
        });
      }
      return r;
    }, { isolationLevel: "Serializable" });

    return apiSuccess({
      roundId: round.round_id,
      roundNo: round.round_no,
    }, 201);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2034") {
      return apiError("CONFLICT", "다른 사용자가 테스트를 변경했습니다. 새로고침 후 다시 시도해 주세요.", 409);
    }
    console.error(`[POST rounds] DB 오류:`, err);
    return apiError("DB_ERROR", "회차 생성에 실패했습니다.", 500);
  }
}
