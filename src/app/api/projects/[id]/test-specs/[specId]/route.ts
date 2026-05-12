/**
 * GET    /api/projects/[id]/test-specs/[specId] — 테스트 명세서 상세 (cases 포함)
 * PUT    /api/projects/[id]/test-specs/[specId] — 명세서 메타 + cases 일괄 저장
 * DELETE /api/projects/[id]/test-specs/[specId] — 명세서 삭제 (cases·rounds·results CASCADE)
 *
 * PUT body:
 *   - testSpecNm:     string
 *   - testSpecDc?:    string
 *   - sttusCode?:     "DRAFT" | "IN_PROGRESS" | "PASSED" | "FAILED"
 *   - asignMemberId?: string
 *   - unitWorkIds:    string[]   (UNIT 은 1개, INTEGRATION 은 N개)
 *   - cases:          { testCaseId?, caseNo, ctgryCode, scenarioCn, expectedCn, aiGenYn? }[]
 *
 *   cases 정책:
 *     - testCaseId 있으면 해당 case UPDATE
 *     - 없으면 INSERT
 *     - PUT 에 누락된 기존 case 는 DELETE (= 화면에서 사용자가 지운 것)
 *     단일 트랜잭션으로 처리.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";

type RouteParams = { params: Promise<{ id: string; specId: string }> };

// ─── GET: 상세 조회 ─────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, specId } = await params;
  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    const spec = await prisma.tbQaTestSpec.findFirst({
      where:   { test_spec_id: specId, prjct_id: projectId },
      include: {
        uwLinks: {
          include: { unitWork: { select: { unit_work_display_id: true, unit_work_nm: true } } },
          orderBy: { sort_ordr: "asc" },
        },
        cases: { orderBy: [{ case_no: "asc" }, { sort_ordr: "asc" }] },
      },
    });
    if (!spec) return apiError("NOT_FOUND", "테스트 명세서를 찾을 수 없습니다.", 404);

    return apiSuccess({
      testSpecId:    spec.test_spec_id,
      displayId:     spec.test_spec_display_id,
      testKindCode:  spec.test_kind_code,
      testSpecNm:    spec.test_spec_nm,
      testSpecDc:    spec.test_spec_dc,
      sttusCode:     spec.sttus_code,
      asignMemberId: spec.asign_mber_id,
      unitWorks:     spec.uwLinks.map((u) => ({
                       unitWorkId: u.unit_work_id,
                       displayId:  u.unitWork?.unit_work_display_id ?? null,
                       name:       u.unitWork?.unit_work_nm ?? null,
                     })),
      cases:         spec.cases.map((c) => ({
                       testCaseId:     c.test_case_id,
                       caseNo:         c.case_no,
                       ctgryCode:      c.ctgry_code,
                       scenarioCn:     c.scenario_cn,
                       expectedCn:     c.expected_cn,
                       preconditionCn: c.precondition_cn,
                       testDataCn:     c.test_data_cn,
                       testAccountCn:  c.test_account_cn,
                       priortCode:     c.priort_code,
                       applicableYn:   c.applicable_yn,
                       remarkCn:       c.remark_cn,
                       aiGenYn:        c.ai_gen_yn,
                       sortOrdr:       c.sort_ordr,
                     })),
      createdAt:     spec.creat_dt,
      updatedAt:     spec.mdfcn_dt,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/test-specs/${specId}] DB 오류:`, err);
    return apiError("DB_ERROR", "조회에 실패했습니다.", 500);
  }
}

// ─── PUT: 메타 + cases 일괄 저장 ────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, specId } = await params;
  const gate = await requirePermission(request, projectId, "content.update");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { testSpecNm, testSpecDc, sttusCode, asignMemberId, unitWorkIds, cases } = body as {
    testSpecNm?:    string;
    testSpecDc?:    string;
    sttusCode?:     string;
    asignMemberId?: string;
    unitWorkIds?:   string[];
    cases?: Array<{
      testCaseId?:     string;
      caseNo:          number;
      ctgryCode:       string;
      scenarioCn:      string;
      expectedCn:      string;
      preconditionCn?: string | null;
      testDataCn?:     string | null;
      testAccountCn?:  string | null;
      priortCode?:     string;          // HIGH | MEDIUM | LOW (기본 MEDIUM)
      applicableYn?:   string;          // Y | N (기본 Y)
      remarkCn?:       string | null;
      aiGenYn?:        string;
    }>;
  };

  if (!testSpecNm?.trim()) {
    return apiError("VALIDATION_ERROR", "명세서명을 입력해 주세요.", 400);
  }
  if (!Array.isArray(unitWorkIds) || unitWorkIds.length === 0) {
    return apiError("VALIDATION_ERROR", "연결할 단위업무를 1개 이상 선택해 주세요.", 400);
  }
  if (!Array.isArray(cases)) {
    return apiError("VALIDATION_ERROR", "cases 가 배열이 아닙니다.", 400);
  }

  // 한도 — 명세서 메타 + 모든 case 본문
  const limitChecks: Array<[Parameters<typeof apiTextLimitGuard>[0][number][0], unknown]> = [
    ["name",        testSpecNm],
    ["description", testSpecDc],
  ];
  for (const c of cases) {
    limitChecks.push(["description", c.scenarioCn]);
    limitChecks.push(["description", c.expectedCn]);
    limitChecks.push(["description", c.preconditionCn]);
    limitChecks.push(["description", c.testDataCn]);
    limitChecks.push(["description", c.testAccountCn]);
    limitChecks.push(["description", c.remarkCn]);
  }
  const limitErr = apiTextLimitGuard(limitChecks);
  if (limitErr) return limitErr;

  try {
    // 명세서 존재 + 프로젝트 소속 확인
    const existing = await prisma.tbQaTestSpec.findUnique({
      where:   { test_spec_id: specId },
      select:  { prjct_id: true, test_kind_code: true },
    });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "테스트 명세서를 찾을 수 없습니다.", 404);
    }
    // UNIT 은 단위업무 1개 강제
    if (existing.test_kind_code === "UNIT" && unitWorkIds.length !== 1) {
      return apiError("VALIDATION_ERROR", "단위 테스트는 단위업무 1개에만 연결할 수 있습니다.", 400);
    }

    // unitWorkIds 가 모두 이 프로젝트 소속인지 확인
    const uws = await prisma.tbDsUnitWork.findMany({
      where: { unit_work_id: { in: unitWorkIds }, prjct_id: projectId },
      select: { unit_work_id: true },
    });
    if (uws.length !== unitWorkIds.length) {
      return apiError("NOT_FOUND", "선택한 단위업무 중 존재하지 않는 항목이 있습니다.", 404);
    }

    await prisma.$transaction(async (tx) => {
      // 1) 메타 업데이트
      await tx.tbQaTestSpec.update({
        where: { test_spec_id: specId },
        data: {
          test_spec_nm:   testSpecNm.trim(),
          test_spec_dc:   testSpecDc?.trim() || null,
          sttus_code:     sttusCode || undefined,
          asign_mber_id:  asignMemberId || null,
          mdfcn_dt:       new Date(),
        },
      });

      // 2) uwLinks 재구성 — 기존 모두 삭제 후 입력값 재삽입 (변경량 적어 단순 처리)
      await tx.tbQaTestSpecUw.deleteMany({ where: { test_spec_id: specId } });
      await tx.tbQaTestSpecUw.createMany({
        data: unitWorkIds.map((uwId, i) => ({
          test_spec_id: specId,
          unit_work_id: uwId,
          sort_ordr:    i,
        })),
      });

      // 3) cases — UPSERT + 누락 case DELETE
      const incomingIds = new Set(cases.filter((c) => c.testCaseId).map((c) => c.testCaseId!));
      const existingCases = await tx.tbQaTestCase.findMany({
        where:  { test_spec_id: specId },
        select: { test_case_id: true },
      });
      const toDelete = existingCases
        .filter((c) => !incomingIds.has(c.test_case_id))
        .map((c) => c.test_case_id);
      if (toDelete.length > 0) {
        await tx.tbQaTestCase.deleteMany({ where: { test_case_id: { in: toDelete } } });
      }

      for (const c of cases) {
        const caseData = {
          case_no:          c.caseNo,
          ctgry_code:       c.ctgryCode,
          scenario_cn:      c.scenarioCn,
          expected_cn:      c.expectedCn,
          precondition_cn:  c.preconditionCn?.trim() || null,
          test_data_cn:     c.testDataCn?.trim() || null,
          test_account_cn:  c.testAccountCn?.trim() || null,
          priort_code:      c.priortCode || "MEDIUM",
          applicable_yn:    c.applicableYn === "N" ? "N" : "Y",
          remark_cn:        c.remarkCn?.trim() || null,
          ai_gen_yn:        c.aiGenYn || "N",
        };
        if (c.testCaseId) {
          await tx.tbQaTestCase.update({
            where: { test_case_id: c.testCaseId },
            data:  { ...caseData, mdfcn_dt: new Date() },
          });
        } else {
          await tx.tbQaTestCase.create({
            data: { prjct_id: projectId, test_spec_id: specId, ...caseData },
          });
        }
      }
    });

    return apiSuccess({ testSpecId: specId });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/test-specs/${specId}] DB 오류:`, err);
    return apiError("DB_ERROR", "저장에 실패했습니다.", 500);
  }
}

// ─── DELETE: 명세서 삭제 (cases/rounds/results 모두 CASCADE) ────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, specId } = await params;
  const gate = await requirePermission(request, projectId, "content.delete");
  if (gate instanceof Response) return gate;

  try {
    const existing = await prisma.tbQaTestSpec.findUnique({ where: { test_spec_id: specId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "테스트 명세서를 찾을 수 없습니다.", 404);
    }
    await prisma.tbQaTestSpec.delete({ where: { test_spec_id: specId } });
    return apiSuccess({ ok: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/test-specs/${specId}] DB 오류:`, err);
    return apiError("DB_ERROR", "삭제에 실패했습니다.", 500);
  }
}
