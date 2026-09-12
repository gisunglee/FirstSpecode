/**
 * GET    /api/projects/[id]/test-specs/[specId] — 테스트 명세서 상세 (cases + 회차 요약 포함)
 * PUT    /api/projects/[id]/test-specs/[specId] — 명세서 메타 + cases 일괄 저장
 * DELETE /api/projects/[id]/test-specs/[specId] — 명세서 삭제 (cases·rounds·results CASCADE)
 *
 * PUT body:
 *   - testSpecNm:     string
 *   - testSpecDc?:    string
 *   - sttusCode?:     "DRAFT" | "IN_PROGRESS" | "PASSED" | "FAILED"
 *   - asignMemberId?: string
 *   - unitWorkIds?:   string[]   연결할 단위업무 (선택)
 *   - screenIds?:     string[]   연결할 화면 (선택)
 *                      ※ 단위업무·화면 합산 최소 1개 필요
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
import { syncInProgressRoundResults } from "@/lib/qa/roundResultSync";

type RouteParams = { params: Promise<{ id: string; specId: string }> };

// 진척률을 0~100 정수로 강제 (잘못된 입력은 0)
function clampProgress(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  const n = Math.round(v);
  if (n < 0)   return 0;
  if (n > 100) return 100;
  return n;
}

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
        screenLinks: {
          include: { screen: { select: { scrn_display_id: true, scrn_nm: true } } },
          orderBy: { sort_ordr: "asc" },
        },
        cases: { orderBy: [{ case_no: "asc" }, { sort_ordr: "asc" }] },
        // 회차 요약 — 본문(결과)은 빼고 헤더만. "지금 몇 차가 돌고 있나" 를
        // 케이스를 고치기 전에 알 수 있어야 한다(특히 MCP 로 케이스를 추가할 때).
        rounds: {
          orderBy: { round_no: "asc" },
          select: {
            round_id:    true,
            round_no:    true,
            envir_code:  true,
            bld_vrsn_nm: true,
            sttus_code:  true,
            bgng_dt:     true,
            end_dt:      true,
            _count:      { select: { results: true } },
          },
        },
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
      prgrsRt:       spec.prgrs_rt,
      unitWorks:     spec.uwLinks.map((u) => ({
                       unitWorkId: u.unit_work_id,
                       displayId:  u.unitWork?.unit_work_display_id ?? null,
                       name:       u.unitWork?.unit_work_nm ?? null,
                     })),
      screens:       spec.screenLinks.map((sl) => ({
                       screenId:  sl.scrn_id,
                       displayId: sl.screen?.scrn_display_id ?? null,
                       name:      sl.screen?.scrn_nm ?? null,
                     })),
      cases:         spec.cases.map((c) => ({
                       testCaseId:     c.test_case_id,
                       caseNo:         c.case_no,
                       ctgryCode:      c.ctgry_code,
                       grpNm:          c.grp_nm,
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
      // 회차 목록 — round_no 오름차순. 마지막 항목이 최신 회차다.
      rounds:        spec.rounds.map((r, i, arr) => ({
                       roundId:     r.round_id,
                       roundNo:     r.round_no,
                       envirCode:   r.envir_code,
                       bldVrsnNm:   r.bld_vrsn_nm,
                       sttusCode:   r.sttus_code,
                       bgngDt:      r.bgng_dt,
                       endDt:       r.end_dt,
                       resultCount: r._count.results,
                       // 오름차순 정렬이므로 마지막 항목이 최신 회차.
                       // 호출부(특히 AI)가 순서를 따로 해석하지 않아도 되게 명시한다.
                       isLatest:    i === arr.length - 1,
                     })),
      // 진행중(IN_PROGRESS) 회차 번호들 — 케이스를 추가하면 즉시 영향받는 회차
      openRoundNos:  spec.rounds.filter((r) => r.sttus_code === "IN_PROGRESS").map((r) => r.round_no),
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

  const { testSpecNm, testSpecDc, sttusCode, asignMemberId, prgrsRt, unitWorkIds, screenIds, cases } = body as {
    testSpecNm?:    string;
    testSpecDc?:    string;
    sttusCode?:     string;
    asignMemberId?: string;
    prgrsRt?:       number;
    unitWorkIds?:   string[];
    screenIds?:     string[];
    cases?: Array<{
      testCaseId?:     string;
      caseNo:          number;
      ctgryCode:       string;
      grpNm?:          string | null;   // 구분(그룹명) — FUNCTIONAL 만 사용
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
  const uwList     = Array.isArray(unitWorkIds) ? unitWorkIds : [];
  const screenList = Array.isArray(screenIds)   ? screenIds   : [];
  if (uwList.length === 0 && screenList.length === 0) {
    return apiError("VALIDATION_ERROR", "연결할 단위업무 또는 화면을 1개 이상 선택해 주세요.", 400);
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
    limitChecks.push(["name",        c.grpNm]);
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

    // UW/화면 모두 프로젝트 소속인지 확인
    if (uwList.length > 0) {
      const uws = await prisma.tbDsUnitWork.findMany({
        where: { unit_work_id: { in: uwList }, prjct_id: projectId },
        select: { unit_work_id: true },
      });
      if (uws.length !== uwList.length) {
        return apiError("NOT_FOUND", "선택한 단위업무 중 존재하지 않는 항목이 있습니다.", 404);
      }
    }
    if (screenList.length > 0) {
      const scrs = await prisma.tbDsScreen.findMany({
        where: { scrn_id: { in: screenList }, prjct_id: projectId },
        select: { scrn_id: true },
      });
      if (scrs.length !== screenList.length) {
        return apiError("NOT_FOUND", "선택한 화면 중 존재하지 않는 항목이 있습니다.", 404);
      }
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
          // 진척률 — 미전송 시 변경 없음, 전송된 경우 0~100 으로 강제
          prgrs_rt:       typeof prgrsRt === "number" ? clampProgress(prgrsRt) : undefined,
          mdfcn_dt:       new Date(),
        },
      });

      // 2) uwLinks / screenLinks 재구성 — 기존 모두 삭제 후 입력값 재삽입
      //    (매핑 변경량이 작아 단순 처리 — diff 계산 비용보다 단순 재삽입이 명확)
      await tx.tbQaTestSpecUw.deleteMany({ where: { test_spec_id: specId } });
      if (uwList.length > 0) {
        await tx.tbQaTestSpecUw.createMany({
          data: uwList.map((uwId, i) => ({
            test_spec_id: specId,
            unit_work_id: uwId,
            sort_ordr:    i,
          })),
        });
      }
      await tx.tbQaTestSpecScreen.deleteMany({ where: { test_spec_id: specId } });
      if (screenList.length > 0) {
        await tx.tbQaTestSpecScreen.createMany({
          data: screenList.map((scrId, i) => ({
            test_spec_id: specId,
            scrn_id:      scrId,
            sort_ordr:    i,
          })),
        });
      }

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
          grp_nm:           c.grpNm?.trim() || null,
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

      // 4) 진행중 회차에 새 케이스의 결과행을 열어 준다.
      //    회차 생성 시점에만 결과행을 만들기 때문에, 회차를 시작한 뒤 여기서 추가한
      //    케이스는 결과 입력 화면에 나타나지 않는다(합부를 기록할 방법이 없어진다).
      //    완료된 회차는 확정 기록이라 건드리지 않는다 — 헬퍼가 IN_PROGRESS 만 채운다.
      await syncInProgressRoundResults(tx, { projectId, testSpecId: specId });
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
