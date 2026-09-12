/**
 * POST /api/projects/[id]/test-specs/[specId]/cases — 테스트 케이스 추가·수정 (삭제 없음)
 *
 * 역할:
 *   - 명세서의 케이스를 "보낸 것만" 추가하거나 고친다. 보내지 않은 기존 케이스는 그대로 둔다.
 *
 * 왜 PUT /test-specs/[specId] 를 쓰지 않고 별도 라우트인가:
 *   상위 PUT 은 "요청에 없는 기존 case 는 DELETE" 정책이다. 웹 화면은 항상 전체
 *   케이스를 들고 있으므로 그 동작이 맞지만, MCP(AI)는 일부만 보내는 일이 흔하다.
 *   같은 라우트를 쓰면 AI 가 케이스 몇 개만 보냈을 때 나머지가 통째로 지워진다.
 *   MCP 는 어떤 엔티티도 삭제할 수 없다는 것이 register-tools.ts 의 명시된 정책이므로
 *   (delete_* 도구 일괄 제거), 삭제가 일어날 수 없는 경로를 따로 둔다.
 *
 * Body:
 *   - cases: Array<{
 *       testCaseId?      기존 케이스 ID — 있으면 UPDATE, 없으면 INSERT
 *       caseNo?          일련번호 — 생략 시 **카테고리별** 최대값 + 1 부터 자동 부여
 *                        (웹 화면이 CHECKLIST/FUNCTIONAL 각각 1번부터 매기므로 기준을 맞춘다)
 *       ctgryCode        CHECKLIST | FUNCTIONAL
 *       grpNm?           구분(그룹명) — FUNCTIONAL 만 사용
 *       scenarioCn       테스트 내용 (필수)
 *       expectedCn       예상 결과 (필수)
 *       preconditionCn? / testDataCn? / testAccountCn? / remarkCn?
 *       priortCode?      HIGH | MEDIUM | LOW (기본 MEDIUM)
 *       applicableYn?    Y | N (기본 Y)
 *       aiGenYn?         Y | N (기본 N)
 *     }>
 *
 * 진행중 회차 연동:
 *   케이스를 추가하면 진행중(IN_PROGRESS) 회차에 그 케이스의 결과행을 함께 연다.
 *   회차는 생성 시점의 케이스에 대해서만 결과행을 만들기 때문에, 이 처리가 없으면
 *   나중에 추가한 케이스는 결과 입력 화면에 나타나지 않아 합부를 기록할 수 없다.
 *   완료(DONE)된 회차는 확정 기록이므로 건드리지 않는다. (lib/qa/roundResultSync.ts)
 *
 * 응답: { testSpecId, createdCount, updatedCount, totalCaseCount, openRoundResultsAdded }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";
import { syncInProgressRoundResults } from "@/lib/qa/roundResultSync";

type RouteParams = { params: Promise<{ id: string; specId: string }> };

// 한 번에 밀어 넣을 수 있는 케이스 수 상한.
// AI 가 실수로 수백 건을 생성하는 사고를 막고, 트랜잭션 시간도 제한한다.
// 정책상 한 화면의 FUNCTIONAL 은 8건 내외이고 공통 점검은 20건 안팎이므로
// 100 이면 명세서 하나를 한 번에 채우기에 충분하다.
const MAX_CASES_PER_REQUEST = 100;

const VALID_CTGRY    = ["CHECKLIST", "FUNCTIONAL"];
const VALID_PRIORITY = ["HIGH", "MEDIUM", "LOW"];

type IncomingCase = {
  testCaseId?:     string;
  caseNo?:         number;
  ctgryCode?:      string;
  grpNm?:          string | null;
  scenarioCn?:     string;
  expectedCn?:     string;
  preconditionCn?: string | null;
  testDataCn?:     string | null;
  testAccountCn?:  string | null;
  priortCode?:     string;
  applicableYn?:   string;
  remarkCn?:       string | null;
  aiGenYn?:        string;
};

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, specId } = await params;
  const gate = await requirePermission(request, projectId, "content.update");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { cases } = (body ?? {}) as { cases?: IncomingCase[] };

  if (!Array.isArray(cases) || cases.length === 0) {
    return apiError("VALIDATION_ERROR", "cases 배열에 1건 이상을 담아 주세요.", 400);
  }
  if (cases.length > MAX_CASES_PER_REQUEST) {
    return apiError(
      "VALIDATION_ERROR",
      `한 번에 등록할 수 있는 케이스는 ${MAX_CASES_PER_REQUEST}건까지입니다. 나눠서 보내주세요.`,
      400,
    );
  }

  // 필수값·허용값 검증 — 어느 행이 잘못됐는지 알려줘야 AI 가 고칠 수 있다
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const at = `cases[${i}]`;
    if (!c.scenarioCn?.trim()) {
      return apiError("VALIDATION_ERROR", `${at}: 테스트 내용(scenarioCn)은 필수입니다.`, 400);
    }
    if (!c.expectedCn?.trim()) {
      return apiError("VALIDATION_ERROR", `${at}: 예상 결과(expectedCn)는 필수입니다.`, 400);
    }
    if (!c.ctgryCode || !VALID_CTGRY.includes(c.ctgryCode)) {
      return apiError("VALIDATION_ERROR", `${at}: ctgryCode 는 CHECKLIST 또는 FUNCTIONAL 이어야 합니다.`, 400);
    }
    if (c.priortCode && !VALID_PRIORITY.includes(c.priortCode)) {
      return apiError("VALIDATION_ERROR", `${at}: priortCode 는 HIGH | MEDIUM | LOW 중 하나여야 합니다.`, 400);
    }
  }

  const limitChecks: Array<[Parameters<typeof apiTextLimitGuard>[0][number][0], unknown]> = [];
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
    // 명세서 존재 + 프로젝트 소속 확인 (보안 — 타 프로젝트 명세서에 쓰기 차단)
    const spec = await prisma.tbQaTestSpec.findUnique({
      where:  { test_spec_id: specId },
      select: { prjct_id: true },
    });
    if (!spec || spec.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "테스트 명세서를 찾을 수 없습니다.", 404);
    }

    // 수정 대상으로 지목된 케이스가 정말 이 명세서의 것인지 확인.
    // 다른 명세서의 케이스 ID 를 보내 남의 데이터를 덮어쓰는 것을 막는다.
    const updateIds = cases.map((c) => c.testCaseId).filter(Boolean) as string[];
    if (updateIds.length > 0) {
      const owned = await prisma.tbQaTestCase.findMany({
        where:  { test_case_id: { in: updateIds }, test_spec_id: specId },
        select: { test_case_id: true },
      });
      if (owned.length !== updateIds.length) {
        return apiError("NOT_FOUND", "이 명세서에 속하지 않는 테스트 케이스 ID 가 포함되어 있습니다.", 404);
      }
    }

    // 신규 케이스의 case_no 자동 부여 기준 — **카테고리별** 현재 최대값.
    // 웹 화면이 CHECKLIST/FUNCTIONAL 각각 1번부터 번호를 매기므로(상세 페이지의
    // addCase·importFromMaster 동작), 여기서 전체 기준으로 매기면 같은 명세서 안에
    // 번호 체계가 두 가지로 섞인다.
    const existingCases = await prisma.tbQaTestCase.findMany({
      where:  { test_spec_id: specId },
      select: { ctgry_code: true, case_no: true },
    });
    const nextNoByCtgry = new Map<string, number>();
    for (const ctgry of VALID_CTGRY) {
      const nums = existingCases.filter((c) => c.ctgry_code === ctgry).map((c) => c.case_no);
      nextNoByCtgry.set(ctgry, (nums.length === 0 ? 0 : Math.max(...nums)) + 1);
    }

    let createdCount = 0;
    let updatedCount = 0;
    let filledResultCount = 0;

    await prisma.$transaction(async (tx) => {
      for (const c of cases) {
        const caseData = {
          ctgry_code:      c.ctgryCode!,
          // 구분은 FUNCTIONAL 전용 — CHECKLIST 에 값이 와도 NULL 로 정규화한다
          // (마스터에서 가져온 공통 점검과 표기가 섞이지 않도록)
          grp_nm:          c.ctgryCode === "FUNCTIONAL" ? (c.grpNm?.trim() || null) : null,
          scenario_cn:     c.scenarioCn!.trim(),
          expected_cn:     c.expectedCn!.trim(),
          precondition_cn: c.preconditionCn?.trim() || null,
          test_data_cn:    c.testDataCn?.trim() || null,
          test_account_cn: c.testAccountCn?.trim() || null,
          priort_code:     c.priortCode || "MEDIUM",
          applicable_yn:   c.applicableYn === "N" ? "N" : "Y",
          remark_cn:       c.remarkCn?.trim() || null,
          ai_gen_yn:       c.aiGenYn === "Y" ? "Y" : "N",
        };

        if (c.testCaseId) {
          await tx.tbQaTestCase.update({
            where: { test_case_id: c.testCaseId },
            data: {
              ...caseData,
              // 번호는 보낸 경우에만 변경 — 생략 시 기존 순번 유지
              case_no:  typeof c.caseNo === "number" ? c.caseNo : undefined,
              mdfcn_dt: new Date(),
            },
          });
          updatedCount++;
        } else {
          // 번호를 명시하지 않았으면 해당 카테고리의 다음 번호를 부여
          let caseNo: number;
          if (typeof c.caseNo === "number") {
            caseNo = c.caseNo;
          } else {
            caseNo = nextNoByCtgry.get(c.ctgryCode!) ?? 1;
            nextNoByCtgry.set(c.ctgryCode!, caseNo + 1);
          }
          await tx.tbQaTestCase.create({
            data: {
              prjct_id:     projectId,
              test_spec_id: specId,
              case_no:      caseNo,
              ...caseData,
            },
          });
          createdCount++;
        }
      }

      // 케이스가 바뀌었으므로 명세서 수정일시 갱신
      await tx.tbQaTestSpec.update({
        where: { test_spec_id: specId },
        data:  { mdfcn_dt: new Date() },
      });

      // 진행중 회차가 있으면 새 케이스의 결과행을 채워 준다.
      // 이게 없으면 추가한 케이스가 결과 입력 화면에 나타나지 않는다.
      filledResultCount = await syncInProgressRoundResults(tx, {
        projectId,
        testSpecId: specId,
      });
    });

    const totalCaseCount = await prisma.tbQaTestCase.count({ where: { test_spec_id: specId } });

    return apiSuccess({
      testSpecId: specId,
      createdCount,
      updatedCount,
      totalCaseCount,
      // 진행중 회차에 결과행을 몇 건 열어 줬는지 — AI 가 사용자에게 보고할 수 있도록 명시
      openRoundResultsAdded: filledResultCount,
    });
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/test-specs/${specId}/cases] DB 오류:`, err);
    return apiError("DB_ERROR", "테스트 케이스 저장에 실패했습니다.", 500);
  }
}
