/**
 * GET    /api/projects/[id]/test-specs/[specId]/rounds/[roundId] — 회차 상세 + 모든 결과
 * PUT    /api/projects/[id]/test-specs/[specId]/rounds/[roundId] — 회차 메타 + 결과 일괄 저장
 * DELETE /api/projects/[id]/test-specs/[specId]/rounds/[roundId] — 회차 삭제 (결과·결함 CASCADE)
 *
 * PUT body:
 *   회차 메타 (envirCode, bldVrsnNm, testMemberId, sttusCode, endDt?)
 *   results: [{ resultId, resultCode, remarkCn, testDt?, defects?: [{ defectCn }] }]
 *
 * 결함 정책 (Phase 4 의 첫걸음):
 *   - PUT 의 results.defects 가 비어있지 않은 경우, 기존 결함 모두 DELETE 후 신규 INSERT
 *     (사용자가 결함 텍스트 자유롭게 편집하는 단순 UX. 추적 ID 는 자동 채번 DF-NNNNN.)
 *   - 회차 종료(sttus=DONE) 시 명세서 상태 자동 전이:
 *       모든 결과 PASS/NA → PASSED, FAIL/BLOCKED 1개라도 → FAILED
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { getIdPrefix } from "@/lib/idPrefix";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";

type RouteParams = { params: Promise<{ id: string; specId: string; roundId: string }> };

// ─── GET: 회차 상세 + 모든 결과 (+ 케이스 정보 조인) ────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, specId, roundId } = await params;
  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    const round = await prisma.tbQaTestRound.findUnique({
      where: { round_id: roundId },
      include: {
        results: {
          include: {
            testCase: true,
            defects:  { orderBy: { creat_dt: "asc" } },
          },
        },
      },
    });
    if (!round || round.prjct_id !== projectId || round.test_spec_id !== specId) {
      return apiError("NOT_FOUND", "회차를 찾을 수 없습니다.", 404);
    }

    return apiSuccess({
      roundId:     round.round_id,
      roundNo:     round.round_no,
      envirCode:   round.envir_code,
      bldVrsnNm:   round.bld_vrsn_nm,
      bgngDt:      round.bgng_dt,
      endDt:       round.end_dt,
      sttusCode:   round.sttus_code,
      // 결과는 case_no 순으로 정렬해 보여주기 (사용자가 명세 순서대로 입력)
      results: round.results
        .sort((a, b) =>
          (a.testCase.ctgry_code).localeCompare(b.testCase.ctgry_code) ||
          (a.testCase.case_no - b.testCase.case_no)
        )
        .map((r) => ({
          resultId:       r.result_id,
          testCaseId:     r.test_case_id,
          caseNo:         r.testCase.case_no,
          ctgryCode:      r.testCase.ctgry_code,
          grpNm:          r.testCase.grp_nm,   // 구분(그룹명) — FUNCTIONAL 만 사용
          scenarioCn:     r.testCase.scenario_cn,
          expectedCn:     r.testCase.expected_cn,
          applicableYn:   r.testCase.applicable_yn,
          resultCode:     r.result_code,
          remarkCn:       r.remark_cn,
          testMemberId:   r.test_mber_id,
          testDt:         r.test_dt,
          defects: r.defects.map((d) => ({
            defectId:        d.defect_id,
            defectDisplayId: d.defect_display_id,
            defectCn:        d.defect_cn,
            sttusCode:       d.sttus_code,
          })),
        })),
    });
  } catch (err) {
    console.error(`[GET round detail] DB 오류:`, err);
    return apiError("DB_ERROR", "조회에 실패했습니다.", 500);
  }
}

// ─── PUT: 회차 메타 + 결과 일괄 저장 ────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, specId, roundId } = await params;
  const gate = await requirePermission(request, projectId, "content.update");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }
  const { envirCode, bldVrsnNm, testMemberId, sttusCode, endDt, results } = body as {
    envirCode?:    string;
    bldVrsnNm?:    string;
    testMemberId?: string;
    sttusCode?:    string;        // IN_PROGRESS | DONE
    endDt?:        string | null;
    results?: Array<{
      resultId:   string;
      resultCode: "PASS" | "FAIL" | "BLOCKED" | "NA";
      remarkCn?:  string | null;
      testDt?:    string | null;
      defects?:   Array<{ defectCn: string }>;
    }>;
  };

  // 한도 검증 — 결과 비고 + 결함 본문
  if (results) {
    const checks: Array<[Parameters<typeof apiTextLimitGuard>[0][number][0], unknown]> = [];
    for (const r of results) {
      checks.push(["description", r.remarkCn]);
      for (const d of r.defects ?? []) {
        checks.push(["description", d.defectCn]);
      }
    }
    if (checks.length > 0) {
      const limitErr = apiTextLimitGuard(checks);
      if (limitErr) return limitErr;
    }
  }

  try {
    const round = await prisma.tbQaTestRound.findUnique({ where: { round_id: roundId } });
    if (!round || round.prjct_id !== projectId || round.test_spec_id !== specId) {
      return apiError("NOT_FOUND", "회차를 찾을 수 없습니다.", 404);
    }

    // 결함 표시 ID 자동 채번을 위한 prefix 미리 조회
    const defectPrefix = await getIdPrefix(projectId, "DEFECT");

    await prisma.$transaction(async (tx) => {
      // 1) 회차 메타 업데이트
      await tx.tbQaTestRound.update({
        where: { round_id: roundId },
        data: {
          envir_code:   envirCode      || round.envir_code,
          bld_vrsn_nm:  bldVrsnNm !== undefined ? (bldVrsnNm?.trim() || null) : round.bld_vrsn_nm,
          sttus_code:   sttusCode      || round.sttus_code,
          end_dt:       sttusCode === "DONE" ? new Date() : (endDt ? new Date(endDt) : round.end_dt),
        },
      });

      // 2) 각 결과 UPDATE + 결함 재구성
      for (const r of results ?? []) {
        await tx.tbQaTestResult.update({
          where: { result_id: r.resultId },
          data: {
            result_code:  r.resultCode,
            remark_cn:    r.remarkCn?.trim() || null,
            test_mber_id: testMemberId || null,
            test_dt:      r.testDt ? new Date(r.testDt) : new Date(),
            mdfcn_dt:     new Date(),
          },
        });

        // 결함 — 기존 모두 삭제 후 신규 INSERT (단순 UX)
        // FAIL/BLOCKED 가 아니면서 결함이 있으면 의도가 모호하므로 그대로 저장 (사용자 자유)
        await tx.tbQaDefect.deleteMany({ where: { result_id: r.resultId } });
        const defects = r.defects?.filter((d) => d.defectCn.trim()) ?? [];
        if (defects.length > 0) {
          // 결함 표시 ID 채번 — 프로젝트 내 마지막 DF-NNNNN + 1 부터
          const lastDefect = await tx.tbQaDefect.findFirst({
            where:   { prjct_id: projectId },
            orderBy: { defect_display_id: "desc" },
            select:  { defect_display_id: true },
          });
          let nextSeq = lastDefect
            ? (parseInt(lastDefect.defect_display_id.replace(/\D/g, "")) || 0) + 1
            : 1;
          for (const d of defects) {
            await tx.tbQaDefect.create({
              data: {
                prjct_id:           projectId,
                result_id:          r.resultId,
                defect_display_id:  `${defectPrefix}-${String(nextSeq).padStart(5, "0")}`,
                defect_cn:          d.defectCn.trim(),
                sttus_code:         "OPEN",
              },
            });
            nextSeq++;
          }
        }
      }

      // 3) 회차 종료(DONE) 시 명세서 상태 자동 전이
      if (sttusCode === "DONE") {
        const counts = await tx.tbQaTestResult.groupBy({
          by: ["result_code"],
          where: { round_id: roundId },
          _count: { result_code: true },
        });
        const failBlocked = counts
          .filter((c) => c.result_code === "FAIL" || c.result_code === "BLOCKED")
          .reduce((s, c) => s + c._count.result_code, 0);
        await tx.tbQaTestSpec.update({
          where: { test_spec_id: specId },
          data: {
            sttus_code: failBlocked > 0 ? "FAILED" : "PASSED",
            mdfcn_dt:   new Date(),
          },
        });
      }
    });

    return apiSuccess({ ok: true });
  } catch (err) {
    console.error(`[PUT round] DB 오류:`, err);
    return apiError("DB_ERROR", "저장에 실패했습니다.", 500);
  }
}

// ─── DELETE: 회차 삭제 ─────────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, specId, roundId } = await params;
  const gate = await requirePermission(request, projectId, "content.delete");
  if (gate instanceof Response) return gate;

  try {
    const round = await prisma.tbQaTestRound.findUnique({ where: { round_id: roundId } });
    if (!round || round.prjct_id !== projectId || round.test_spec_id !== specId) {
      return apiError("NOT_FOUND", "회차를 찾을 수 없습니다.", 404);
    }
    await prisma.tbQaTestRound.delete({ where: { round_id: roundId } });
    return apiSuccess({ ok: true });
  } catch (err) {
    console.error(`[DELETE round] DB 오류:`, err);
    return apiError("DB_ERROR", "삭제에 실패했습니다.", 500);
  }
}
