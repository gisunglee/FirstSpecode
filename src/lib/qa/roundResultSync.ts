/**
 * roundResultSync.ts — 진행중 회차에 신규 케이스의 결과 행을 채워 넣는다
 *
 * 왜 필요한가:
 *   회차를 만들 때(POST /rounds) 그 시점의 케이스 전체에 대해 result 행을 NA 로
 *   미리 만들어 둔다. 결과 입력 화면은 그 행들을 UPDATE 하는 구조라, **회차가 시작된
 *   뒤에 추가된 케이스는 result 행이 없어 화면에 아예 나타나지 않는다.**
 *   테스터가 그 케이스의 합부를 기록할 방법이 없어진다.
 *
 *   전에는 케이스를 사람이 웹에서 한 번에 다 적고 회차를 시작하는 흐름이라 잘 드러나지
 *   않았지만, MCP(AI)로 명세를 보강하기 시작하면 "1차 돌려보고 빠진 케이스를 추가" 가
 *   일상이 되므로 반드시 메워야 한다.
 *
 * 정책 — 진행중(IN_PROGRESS) 회차에만 채운다:
 *   완료(DONE)된 회차는 "그때 그 범위로 이런 결과가 나왔다" 는 확정 기록이다.
 *   나중에 추가된 케이스를 소급해 끼워 넣으면 이미 보고한 회차의 모집단이 바뀐다.
 *   완료 회차에 없는 케이스는 다음 회차에서 다루는 것이 맞다.
 *
 * 호출 위치 — 케이스가 늘어나는 모든 경로에서 같은 트랜잭션 안에 호출한다:
 *   - PUT  /test-specs/[specId]            (웹 화면 일괄 저장)
 *   - POST /test-specs/[specId]/cases      (MCP 케이스 추가·수정)
 *   - POST /test-specs/[specId]/cases/import-checks (MCP 공통 점검 가져오기)
 */

import type { Prisma } from "@prisma/client";

/**
 * 진행중 회차 × 결과행 없는 케이스 조합에 NA 결과행을 만든다.
 *
 * @returns 생성된 결과행 수 (0이면 채울 것이 없었다는 뜻)
 */
export async function syncInProgressRoundResults(
  tx: Prisma.TransactionClient,
  args: { projectId: string; testSpecId: string },
): Promise<number> {
  const { projectId, testSpecId } = args;

  const openRounds = await tx.tbQaTestRound.findMany({
    where:  { test_spec_id: testSpecId, sttus_code: "IN_PROGRESS" },
    select: { round_id: true },
  });
  if (openRounds.length === 0) return 0;

  const cases = await tx.tbQaTestCase.findMany({
    where:  { test_spec_id: testSpecId },
    select: { test_case_id: true },
  });
  if (cases.length === 0) return 0;

  // 이미 존재하는 (회차, 케이스) 조합 — 중복 INSERT 를 피한다.
  // unique(round_id, test_case_id) 제약이 있어 중복 시 트랜잭션 전체가 실패하므로
  // skipDuplicates 에만 기대지 않고 미리 걸러낸다.
  const existing = await tx.tbQaTestResult.findMany({
    where:  { round_id: { in: openRounds.map((r) => r.round_id) } },
    select: { round_id: true, test_case_id: true },
  });
  const existingKeys = new Set(existing.map((e) => `${e.round_id}:${e.test_case_id}`));

  const toCreate = [];
  for (const round of openRounds) {
    for (const c of cases) {
      if (existingKeys.has(`${round.round_id}:${c.test_case_id}`)) continue;
      toCreate.push({
        prjct_id:     projectId,
        round_id:     round.round_id,
        test_case_id: c.test_case_id,
        // 아직 판정하지 않은 상태 — 테스터가 화면에서 PASS/FAIL 로 바꾼다
        result_code:  "NA",
      });
    }
  }
  if (toCreate.length === 0) return 0;

  await tx.tbQaTestResult.createMany({ data: toCreate });
  return toCreate.length;
}
