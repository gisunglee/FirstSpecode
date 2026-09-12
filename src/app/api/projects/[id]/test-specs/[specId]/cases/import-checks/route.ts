/**
 * POST /api/projects/[id]/test-specs/[specId]/cases/import-checks
 *   — 공통 점검 마스터를 CHECKLIST 케이스로 복사
 *
 * 역할:
 *   - 선택한 마스터 항목(check_id)의 문장을 **그대로** 케이스로 복사한다.
 *   - 웹 화면의 "공통 점검 가져오기" 와 같은 결과를 서버에서 수행하는 경로.
 *
 * 왜 별도 라우트인가 (그냥 cases 로 넣지 않고):
 *   AI 가 공통 점검 문장을 직접 써 넣으면 화면마다 표현이 미묘하게 달라진다.
 *   체크 ID 만 받아 서버가 마스터 원문을 복사하면, 문장이 바뀔 여지가 구조적으로
 *   사라진다. "CHECKLIST 는 창작 금지" 규칙을 지시문이 아니라 코드로 강제하는 것.
 *
 * Body:
 *   - checkIds:   string[]  가져올 마스터 항목 (필수, 1건 이상)
 *   - naCheckIds? string[]  그중 "해당없음(applicable_yn=N)" 으로 표시할 항목
 *                           (예: 검색 기능이 없는 화면의 검색 점검)
 *                           checkIds 에 포함된 것만 인정한다.
 *
 * 중복 처리:
 *   이미 같은 시나리오 문장이 이 명세서에 있으면 건너뛴다 (웹 화면과 동일 동작).
 *
 * 응답: { testSpecId, importedCount, skippedCount, naCount, totalCaseCount }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { syncInProgressRoundResults } from "@/lib/qa/roundResultSync";

type RouteParams = { params: Promise<{ id: string; specId: string }> };

// 공통 점검 마스터는 시스템 15건 + 프로젝트 전용을 합쳐도 수십 건 규모다.
// 한 번에 그 이상을 요청하는 것은 정상 사용이 아니다.
const MAX_IMPORT_PER_REQUEST = 200;

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, specId } = await params;
  const gate = await requirePermission(request, projectId, "content.update");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { checkIds, naCheckIds } = (body ?? {}) as {
    checkIds?:   string[];
    naCheckIds?: string[];
  };

  if (!Array.isArray(checkIds) || checkIds.length === 0) {
    return apiError("VALIDATION_ERROR", "가져올 공통 점검 항목(checkIds)을 1건 이상 지정해 주세요.", 400);
  }
  if (checkIds.length > MAX_IMPORT_PER_REQUEST) {
    return apiError(
      "VALIDATION_ERROR",
      `한 번에 가져올 수 있는 항목은 ${MAX_IMPORT_PER_REQUEST}건까지입니다.`,
      400,
    );
  }

  const naSet = new Set(Array.isArray(naCheckIds) ? naCheckIds : []);

  try {
    // 명세서 존재 + 프로젝트 소속 확인
    const spec = await prisma.tbQaTestSpec.findUnique({
      where:  { test_spec_id: specId },
      select: { prjct_id: true },
    });
    if (!spec || spec.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "테스트 명세서를 찾을 수 없습니다.", 404);
    }

    // 마스터 조회 — 시스템 공통(NULL) + 이 프로젝트 전용만.
    // 타 프로젝트의 전용 체크리스트가 새어 들어오지 않도록 범위를 좁힌다.
    const masters = await prisma.tbQaCheckMaster.findMany({
      where: {
        check_id: { in: checkIds },
        use_yn:   "Y",
        OR: [{ prjct_id: null }, { prjct_id: projectId }],
      },
      orderBy: [{ ctgry_code: "asc" }, { sort_ordr: "asc" }],
    });

    if (masters.length === 0) {
      return apiError("NOT_FOUND", "가져올 수 있는 공통 점검 항목이 없습니다. checkIds 를 확인해 주세요.", 404);
    }

    // 이미 들어 있는 시나리오 문장 — 중복 추가 방지 (웹 화면과 같은 기준)
    const existingCases = await prisma.tbQaTestCase.findMany({
      where:  { test_spec_id: specId },
      select: { scenario_cn: true, case_no: true, ctgry_code: true },
    });
    const existingScenarios = new Set(existingCases.map((c) => c.scenario_cn.trim()));
    // case_no 는 **카테고리별**로 1부터 매긴다 — 웹 화면(importFromMaster)과 같은 기준.
    // 여기서 만드는 건 전부 CHECKLIST 이므로 CHECKLIST 최대값 다음부터 이어 붙인다.
    const checklistNos = existingCases
      .filter((c) => c.ctgry_code === "CHECKLIST")
      .map((c) => c.case_no);
    let nextCaseNo = (checklistNos.length === 0 ? 0 : Math.max(...checklistNos)) + 1;

    // createMany 입력 — 마스터 원문을 그대로 옮긴 CHECKLIST 케이스들
    const toCreate: Array<{
      prjct_id:      string;
      test_spec_id:  string;
      case_no:       number;
      ctgry_code:    string;
      scenario_cn:   string;
      expected_cn:   string;
      priort_code:   string;
      applicable_yn: string;
      ai_gen_yn:     string;
    }> = [];
    let skippedCount = 0;
    let naCount      = 0;

    for (const m of masters) {
      const scenario = m.scenario_cn.trim();
      if (existingScenarios.has(scenario)) {
        skippedCount++;
        continue;
      }
      existingScenarios.add(scenario);   // 요청 안에 같은 문장이 중복돼도 1건만

      const isNa = naSet.has(m.check_id);
      if (isNa) naCount++;

      toCreate.push({
        prjct_id:      projectId,
        test_spec_id:  specId,
        case_no:       nextCaseNo++,
        ctgry_code:    "CHECKLIST",
        // 구분(grp_nm)은 CHECKLIST 에서 항상 NULL — 스키마 주석의 정책
        scenario_cn:   m.scenario_cn,
        expected_cn:   m.expected_cn ?? "",
        priort_code:   "MEDIUM",
        applicable_yn: isNa ? "N" : "Y",
        // 마스터 원문 복사는 AI 창작이 아니므로 항상 N.
        // 이 값이 Y 인 케이스는 "AI 가 문장을 만든 것" 으로만 의미를 고정한다.
        ai_gen_yn:     "N",
      });
    }

    if (toCreate.length === 0) {
      return apiSuccess({
        testSpecId:     specId,
        importedCount:  0,
        skippedCount,
        naCount:        0,
        totalCaseCount: existingCases.length,
        message:        "선택한 항목은 이미 모두 추가되어 있습니다.",
      });
    }

    let filledResultCount = 0;
    await prisma.$transaction(async (tx) => {
      await tx.tbQaTestCase.createMany({ data: toCreate });
      await tx.tbQaTestSpec.update({
        where: { test_spec_id: specId },
        data:  { mdfcn_dt: new Date() },
      });
      // 진행중 회차가 있으면 새 케이스의 결과행도 함께 연다 —
      // 없으면 가져온 점검 항목이 결과 입력 화면에 나타나지 않는다.
      filledResultCount = await syncInProgressRoundResults(tx, {
        projectId,
        testSpecId: specId,
      });
    });

    const totalCaseCount = await prisma.tbQaTestCase.count({ where: { test_spec_id: specId } });

    return apiSuccess({
      testSpecId:    specId,
      importedCount: toCreate.length,
      skippedCount,
      naCount,
      totalCaseCount,
      openRoundResultsAdded: filledResultCount,
    });
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/test-specs/${specId}/cases/import-checks] DB 오류:`, err);
    return apiError("DB_ERROR", "공통 점검 가져오기에 실패했습니다.", 500);
  }
}
