/** 테스트 케이스의 부분 수정과 회차에서 참조하는 명세의 보존 규칙. */
import type { Prisma } from "@prisma/client";
import { z } from "zod";

export const testCaseInput = z.object({
  testCaseId: z.string().min(1).optional(),
  caseNo: z.number().int().positive().optional(),
  ctgryCode: z.enum(["CHECKLIST", "FUNCTIONAL"]),
  scenarioCn: z.string().trim().min(1),
  expectedCn: z.string().trim().min(1),
  grpNm: z.string().nullable().optional(),
  preconditionCn: z.string().nullable().optional(),
  testDataCn: z.string().nullable().optional(),
  testAccountCn: z.string().nullable().optional(),
  remarkCn: z.string().nullable().optional(),
  priortCode: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
  applicableYn: z.enum(["Y", "N"]).optional(),
  aiGenYn: z.enum(["Y", "N"]).optional(),
});

export type TestCaseInput = z.infer<typeof testCaseInput>;

// 미전송은 유지하고 null/빈 문자열은 명시적인 비우기로 처리한다.
export function caseWriteData(c: TestCaseInput) {
  const updating = !!c.testCaseId;
  const text = (value: string | null | undefined) =>
    updating && value === undefined ? undefined : value?.trim() || null;
  return {
    ctgry_code: c.ctgryCode,
    scenario_cn: c.scenarioCn,
    expected_cn: c.expectedCn,
    grp_nm: c.ctgryCode === "FUNCTIONAL" ? text(c.grpNm) : null,
    precondition_cn: text(c.preconditionCn),
    test_data_cn: text(c.testDataCn),
    test_account_cn: text(c.testAccountCn),
    remark_cn: text(c.remarkCn),
    priort_code: c.priortCode ?? (updating ? undefined : "MEDIUM"),
    applicable_yn: c.applicableYn ?? (updating ? undefined : "Y"),
    ai_gen_yn: c.aiGenYn ?? (updating ? undefined : "N"),
  };
}

export class CaseWriteError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

/** 같은 트랜잭션 안에서 소유권·이력 보존을 먼저 검사한다. */
export async function guardCaseWrites(
  tx: Prisma.TransactionClient,
  specId: string,
  cases: TestCaseInput[],
  replaceAll = false,
) {
  const existing = await tx.tbQaTestCase.findMany({
    where: { test_spec_id: specId },
    include: { _count: { select: { results: true } } },
  });
  const byId = new Map(existing.map(c => [c.test_case_id, c]));
  const ids = cases.flatMap(c => c.testCaseId ? [c.testCaseId] : []);
  if (new Set(ids).size !== ids.length || ids.some(id => !byId.has(id))) {
    throw new CaseWriteError("NOT_FOUND", "중복되거나 이 명세서에 속하지 않는 케이스 ID가 있습니다.", 404);
  }
  for (const c of cases) {
    if (!c.testCaseId) continue;
    const before = byId.get(c.testCaseId)!;
    if (!before._count.results) continue;
    const data = { ...caseWriteData(c), case_no: c.caseNo };
    const changed = Object.entries(data).some(([key, value]) =>
      value !== undefined && value !== before[key as keyof typeof before]);
    if (changed) {
      throw new CaseWriteError("CASE_HAS_RESULTS", "회차에서 사용한 케이스는 변경할 수 없습니다. 기존 명세를 보존하고 케이스를 복제하거나 새 명세서를 만들어 주세요.", 409);
    }
  }
  if (replaceAll && existing.some(c => c._count.results > 0 && !ids.includes(c.test_case_id))) {
    throw new CaseWriteError("CASE_HAS_RESULTS", "회차에서 사용한 케이스는 삭제할 수 없습니다. 과거 판정 기록을 보존해야 합니다.", 409);
  }
}
