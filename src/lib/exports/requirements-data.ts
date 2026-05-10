/**
 * exports/requirements-data.ts — 요구사항 목록 데이터 조립 (서버 공용)
 *
 * 역할:
 *   - DB(요구사항·과업·멤버) 에서 요구사항 목록 화면이 필요로 하는 가공된 행을 반환.
 *   - 두 곳에서 동일한 결과가 필요하기 때문에 함수로 분리:
 *       1) GET /api/projects/[id]/requirements         — 화면 목록 조회
 *       2) GET /api/projects/[id]/requirements/export  — 엑셀 다운로드
 *     두 경로가 같은 service 를 호출하면 화면과 엑셀의 결과가 자동으로 일치한다.
 */

import { prisma } from "@/lib/prisma";

// ─── 화면 행 타입 ────────────────────────────────────────────────────────────
// GET /api/projects/[id]/requirements 응답의 items 배열 원소와 동일 구조.

export type RequirementListItem = {
  requirementId:    string;
  displayId:        string;
  name:             string;
  priority:         string;
  source:           string;
  taskId:           string | null;
  taskName:         string;
  assignMemberId:   string | null;
  assignMemberName: string | null;
  unitWorkCount:    number;
  sortOrder:        number;
};

// ─── 조회 함수 ───────────────────────────────────────────────────────────────

/**
 * fetchProjectRequirements — 요구사항 목록 + 과업명 + 담당자명 + 단위업무 수 조회
 *
 *   - assigneeFilter: 특정 mberId 로 필터. undefined 면 전체.
 *     ("me" → mberId 변환은 호출자(라우트) 책임)
 *   - 정렬: 과업 정렬순서 → 요구사항 정렬순서 (화면 GET 과 동일)
 */
export async function fetchProjectRequirements(opts: {
  projectId:       string;
  assigneeFilter?: string;
}): Promise<RequirementListItem[]> {
  const { projectId, assigneeFilter } = opts;

  const requirements = await prisma.tbRqRequirement.findMany({
    where: {
      prjct_id: projectId,
      ...(assigneeFilter ? { asign_mber_id: assigneeFilter } : {}),
    },
    include: {
      task:   { select: { task_id: true, task_nm: true } },
      _count: { select: { unitWorks: true } },
    },
    orderBy: [
      { task: { sort_ordr: "asc" } },
      { sort_ordr: "asc" },
    ],
  });

  // 담당자 mberId → 이름 일괄 조회 (N+1 방지)
  const assigneeIds = [
    ...new Set(requirements.map((r) => r.asign_mber_id).filter((v): v is string => !!v)),
  ];
  const assigneeMembers = assigneeIds.length > 0
    ? await prisma.tbCmMember.findMany({
        where:  { mber_id: { in: assigneeIds } },
        select: { mber_id: true, mber_nm: true, email_addr: true },
      })
    : [];
  const assigneeMap = new Map(
    assigneeMembers.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]),
  );

  return requirements.map((r) => ({
    requirementId:    r.req_id,
    displayId:        r.req_display_id,
    name:             r.req_nm,
    priority:         r.priort_code,
    source:           r.src_code,
    taskId:           r.task_id ?? null,
    taskName:         r.task?.task_nm ?? "미분류",
    assignMemberId:   r.asign_mber_id ?? null,
    assignMemberName: r.asign_mber_id ? (assigneeMap.get(r.asign_mber_id) ?? null) : null,
    unitWorkCount:    r._count.unitWorks,
    sortOrder:        r.sort_ordr,
  }));
}
