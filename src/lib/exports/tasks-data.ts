/**
 * exports/tasks-data.ts — 과업 목록 데이터 조립 (서버 공용)
 *
 * 역할:
 *   - DB(과업·요구사항·멤버) 에서 과업 목록 화면이 필요로 하는 가공된 행 배열을 반환.
 *   - 두 곳에서 동일한 결과가 필요하기 때문에 함수로 분리:
 *       1) GET    /api/projects/[id]/tasks                 — 화면 목록 조회
 *       2) GET    /api/projects/[id]/tasks/export          — 엑셀 다운로드
 *     두 경로가 같은 service 를 호출하면 화면과 엑셀의 결과가 자동으로 일치한다.
 *
 * 책임 분리:
 *   - 본 모듈 : DB → 화면 행 객체 매핑 (HTTP/권한 무관, 인증 컨텍스트 무관)
 *   - 라우트  : 권한 체크·요청 파싱·HTTP 응답
 *   - 엑셀   : TaskListItem 의 필드를 셀 값으로 매핑 (lib/exports/excel/entities/tasks.ts)
 *
 * 비고:
 *   GET /api/projects/[id]/tasks 에서 "me" → mberId 변환은 라우트가 처리한다.
 *   service 는 mberId(또는 undefined) 만 받고 인증을 다시 풀지 않는다.
 */

import { prisma } from "@/lib/prisma";

// ─── 화면 행 타입 ────────────────────────────────────────────────────────────
// GET /api/projects/[id]/tasks 응답의 tasks 배열 원소와 동일 구조.
// 필드를 변경하면 화면(page.tsx)·엑셀(entities/tasks.ts) 양쪽이 같이 바뀐다.

export type TaskPrioritySummary = { high: number; medium: number; low: number };

export type TaskListItem = {
  taskId:           string;
  displayId:        string;
  name:             string;
  category:         string;
  rfpPageNo:        string;
  outputInfo:       string;
  /** 미지정/퇴장 멤버는 null — 화면에서 "-" 처리 */
  assignMemberId:   string | null;
  assignMemberName: string | null;
  requirementCount: number;
  prioritySummary:  TaskPrioritySummary;
  sortOrder:        number;
};

// ─── 조회 함수 ───────────────────────────────────────────────────────────────

/**
 * fetchProjectTasks — 프로젝트의 과업 목록 + 우선순위 집계 + 담당자명 조회
 *
 *   - assigneeFilter: 특정 mberId 로 필터. undefined 면 전체.
 *     ("me" → mberId 변환은 호출자(라우트) 책임 — service 는 인증 무관)
 *   - 정렬: task_display_id asc, creat_dt desc — 화면 목록 GET 과 동일
 *
 *   요구사항 우선순위 집계(prioritySummary)와 담당자 이름은 N+1 회피를 위해
 *   각각 include / 일괄 in 조회로 묶어서 가져온다.
 */
export async function fetchProjectTasks(opts: {
  projectId:       string;
  assigneeFilter?: string;
}): Promise<TaskListItem[]> {
  const { projectId, assigneeFilter } = opts;

  const tasks = await prisma.tbRqTask.findMany({
    where: {
      prjct_id: projectId,
      ...(assigneeFilter ? { asign_mber_id: assigneeFilter } : {}),
    },
    include: {
      requirements: {
        select: { req_id: true, priort_code: true },
      },
    },
    orderBy: [
      { task_display_id: "asc" },
      { creat_dt: "desc" },
    ],
  });

  // 담당자 mberId → 이름 일괄 조회 (N+1 방지)
  const assigneeIds = [
    ...new Set(tasks.map((t) => t.asign_mber_id).filter((v): v is string => !!v)),
  ];
  const assigneeMembers = assigneeIds.length > 0
    ? await prisma.tbCmMember.findMany({
        where:  { mber_id: { in: assigneeIds } },
        // email 을 fallback 으로 — mber_nm 미설정 계정도 식별 가능
        select: { mber_id: true, mber_nm: true, email_addr: true },
      })
    : [];
  const assigneeMap = new Map(
    assigneeMembers.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]),
  );

  return tasks.map((t) => {
    const reqs   = t.requirements;
    const high   = reqs.filter((r) => r.priort_code === "HIGH").length;
    const medium = reqs.filter((r) => r.priort_code === "MEDIUM").length;
    const low    = reqs.filter((r) => r.priort_code === "LOW").length;

    return {
      taskId:           t.task_id,
      displayId:        t.task_display_id,
      name:             t.task_nm,
      category:         t.ctgry_code,
      rfpPageNo:        t.rfp_page_no ?? "",
      outputInfo:       t.output_info_cn ?? "",
      assignMemberId:   t.asign_mber_id ?? null,
      assignMemberName: t.asign_mber_id ? (assigneeMap.get(t.asign_mber_id) ?? null) : null,
      requirementCount: reqs.length,
      prioritySummary:  { high, medium, low },
      sortOrder:        t.sort_ordr,
    };
  });
}
