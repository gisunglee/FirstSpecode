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

import { z } from "zod";
import { effectiveResultCode } from "@/lib/qa/resultState";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { getIdPrefix } from "@/lib/idPrefix";
import { maxDisplayIdSeq } from "@/lib/nextDisplayId";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";

type RouteParams = { params: Promise<{ id: string; specId: string; roundId: string }> };

class ResultWriteError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}

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
          resultCode:     effectiveResultCode(r, round.sttus_code),
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
    if (err && typeof err === "object" && "code" in err && err.code === "P2034") {
      return apiError("CONFLICT", "다른 사용자가 테스트를 변경했습니다. 새로고침 후 다시 시도해 주세요.", 409);
    }
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
  const parsed = z.object({
    envirCode: z.enum(["DEV", "STG", "PROD"]).optional(),
    bldVrsnNm: z.string().nullable().optional(),
    testMemberId: z.string().nullable().optional(),
    sttusCode: z.enum(["IN_PROGRESS", "DONE"]).optional(),
    endDt: z.string().datetime().nullable().optional(),
    results: z.array(z.object({
      resultId: z.string().min(1),
      resultCode: z.enum(["PASS", "FAIL", "BLOCKED", "NA", "PENDING"]),
      remarkCn: z.string().nullable().optional(),
      testDt: z.string().datetime().nullable().optional(),
      defects: z.array(z.object({ defectCn: z.string() })).optional(),
    })).optional(),
  }).safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", "회차 및 결과 입력값을 확인해 주세요.", 400);
  const hasTestMemberId = "testMemberId" in parsed.data;
  const { envirCode, bldVrsnNm, testMemberId, sttusCode, endDt, results } = parsed.data;

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

    // 결함 표시 ID 자동 채번을 위한 prefix + 최댓값을 트랜잭션 진입 전 한 번만 조회
    // ("PREFIX-숫자" 형식을 벗어난 값은 무시 — maxDisplayIdSeq 참고), 이후 결함 생성마다 로컬에서 +1
    const defectPrefix = await getIdPrefix(projectId, "DEFECT");
    const existingDefects = await prisma.tbQaDefect.findMany({
      where:  { prjct_id: projectId },
      select: { defect_display_id: true },
    });
    let defectSeq = maxDisplayIdSeq(existingDefects.map((d) => d.defect_display_id), defectPrefix);

    await prisma.$transaction(async (tx) => {
      const current = await tx.tbQaTestRound.findUnique({ where: { round_id: roundId } });
      if (!current || current.prjct_id !== projectId || current.test_spec_id !== specId) {
        throw new ResultWriteError("NOT_FOUND", "회차를 찾을 수 없습니다.", 404);
      }
      if (current.sttus_code === "DONE" && (sttusCode !== "IN_PROGRESS" || (results?.length ?? 0) > 0)) {
        throw new ResultWriteError("ROUND_CLOSED", "종료된 회차입니다. 먼저 재오픈해 주세요.");
      }
      const ownedResults = await tx.tbQaTestResult.findMany({ where: { round_id: roundId } });
      const resultIds = (results ?? []).map(r => r.resultId);
      if (new Set(resultIds).size !== resultIds.length || resultIds.some(id => !ownedResults.some(r => r.result_id === id))) {
        throw new ResultWriteError("NOT_FOUND", "이 회차에 속하지 않거나 중복된 결과 ID가 있습니다.", 404);
      }
      // 1) 회차 메타 업데이트
      //    end_dt 규칙:
      //      - DONE 으로 전이 → 지금 시각으로 종료
      //      - IN_PROGRESS 로 복귀(재오픈) → end_dt = null
      //      - 그 외 → 명시 endDt 우선, 없으면 기존값 유지
      await tx.tbQaTestRound.update({
        where: { round_id: roundId },
        data: {
          envir_code:   envirCode      || round.envir_code,
          bld_vrsn_nm:  bldVrsnNm !== undefined ? (bldVrsnNm?.trim() || null) : round.bld_vrsn_nm,
          sttus_code:   sttusCode      || round.sttus_code,
          end_dt:
            sttusCode === "DONE"        ? new Date() :
            sttusCode === "IN_PROGRESS" ? null :
            endDt ? new Date(endDt) : round.end_dt,
        },
      });

      // 2) 각 결과 UPDATE + 결함 재구성
      //    test_dt 규칙:
      //      - 클라이언트가 testDt 필드를 보낸 경우(값/null 모두) → 그대로 반영 (사용자 수정값 우선)
      //      - 보내지 않은 경우 → 기존값 유지 (Prisma 의 undefined = 변경 없음)
      for (const r of results ?? []) {
        await tx.tbQaTestResult.update({
          where: { result_id: r.resultId },
          data: {
            result_code:  r.resultCode,
            remark_cn:    r.remarkCn?.trim() || null,
            // testMemberId 키 누락 시 변경 없음, 명시된 경우만 적용 (빈문자열은 null 로 정규화)
            test_mber_id: hasTestMemberId
                            ? (testMemberId ? testMemberId : null)
                            : undefined,
            test_dt:      "testDt" in r
                            ? (r.testDt ? new Date(r.testDt) : null)
                            : undefined,
            mdfcn_dt:     new Date(),
          },
        });

        // 결함 — 기존 모두 삭제 후 신규 INSERT (단순 UX)
        // FAIL/BLOCKED 가 아니면서 결함이 있으면 의도가 모호하므로 그대로 저장 (사용자 자유)
        await tx.tbQaDefect.deleteMany({ where: { result_id: r.resultId } });
        const defects = r.defects?.filter((d) => d.defectCn.trim()) ?? [];
        if (defects.length > 0) {
          for (const d of defects) {
            defectSeq++;
            await tx.tbQaDefect.create({
              data: {
                prjct_id:           projectId,
                result_id:          r.resultId,
                defect_display_id:  `${defectPrefix}-${String(defectSeq).padStart(5, "0")}`,
                defect_cn:          d.defectCn.trim(),
                sttus_code:         "OPEN",
              },
            });
          }
        }
      }

      // 3) 회차 상태 전이에 따른 명세서 상태 자동 전이
      //    - DONE 으로 종료      → 회차 결과로 PASSED / FAILED 판정
      //    - IN_PROGRESS 로 재오픈 → 회차가 다시 진행중이므로 명세서도 IN_PROGRESS 로 복원
      //      (배지·아이콘이 회차 상태와 안 맞는 시각적 불일치 방지)
      if (sttusCode === "DONE") {
        // 새 미실행 및 과거 미판정 NA는 합격으로 종료할 수 없다.
        const finalResults = await tx.tbQaTestResult.findMany({
          where: { round_id: roundId }, include: { testCase: true },
        });
        if (finalResults.length === 0 || finalResults.some(r => effectiveResultCode(r, "IN_PROGRESS") === "PENDING")) {
          throw new ResultWriteError("UNTESTED_CASES", "미실행 케이스가 남아 있거나 케이스가 없습니다. 판정 후 회차를 종료해 주세요.");
        }
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
      } else if (sttusCode === "IN_PROGRESS") {
        await tx.tbQaTestSpec.update({
          where: { test_spec_id: specId },
          data: {
            sttus_code: "IN_PROGRESS",
            mdfcn_dt:   new Date(),
          },
        });
      }
    }, { isolationLevel: "Serializable" });

    return apiSuccess({ ok: true });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2034") {
      return apiError("CONFLICT", "다른 사용자가 테스트를 변경했습니다. 새로고침 후 다시 시도해 주세요.", 409);
    }
    if (err instanceof ResultWriteError) return apiError(err.code, err.message, err.status);
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
    if (err && typeof err === "object" && "code" in err && err.code === "P2034") {
      return apiError("CONFLICT", "다른 사용자가 테스트를 변경했습니다. 새로고침 후 다시 시도해 주세요.", 409);
    }
    console.error(`[DELETE round] DB 오류:`, err);
    return apiError("DB_ERROR", "삭제에 실패했습니다.", 500);
  }
}
