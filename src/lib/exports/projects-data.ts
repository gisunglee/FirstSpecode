/**
 * exports/projects-data.ts — 내 프로젝트 목록 데이터 조립 (서버 공용)
 */

import { prisma } from "@/lib/prisma";
import { ACTIVE_PROJECT_RELATION_WHERE } from "@/lib/projectGuard";

export type ProjectListItem = {
  projectId:    string;
  name:         string;
  // 프로젝트 약어/이니셜 — 목록·GNB 셀렉터·문서 출력에서 부제/파일명으로 사용.
  // 기존 데이터(약어 미설정)는 null 로 응답되며, UI 는 null 일 때 표시 생략.
  abbreviation: string | null;
  clientName:   string | null;
  startDate:    Date | null;
  endDate:      Date | null;
  myRole:       string;
};

/**
 * fetchMyProjects — 본인이 ACTIVE 멤버로 참여 중인 프로젝트 목록.
 *
 *   - allowedPrjctId : MCP 키 scope. 있으면 그 프로젝트만 가시
 *   - 정렬: 최근 수정일(없으면 생성일) 내림차순
 */
export async function fetchMyProjects(opts: {
  mberId:           string;
  allowedPrjctId?:  string | null;
}): Promise<ProjectListItem[]> {
  const { mberId, allowedPrjctId } = opts;

  const memberships = await prisma.tbPjProjectMember.findMany({
    where: {
      mber_id:         mberId,
      mber_sttus_code: "ACTIVE",
      ...(allowedPrjctId ? { prjct_id: allowedPrjctId } : {}),
      project: ACTIVE_PROJECT_RELATION_WHERE,
    },
    include: {
      project: {
        select: {
          prjct_id:   true,
          prjct_nm:   true,
          prjct_abrv: true,
          client_nm:  true,
          bgng_de:    true,
          end_de:     true,
          mdfcn_dt:   true,
          creat_dt:   true,
        },
      },
    },
    orderBy: { join_dt: "desc" },
  });

  return memberships
    .sort((a, b) => {
      const aTime = (a.project.mdfcn_dt ?? a.project.creat_dt).getTime();
      const bTime = (b.project.mdfcn_dt ?? b.project.creat_dt).getTime();
      return bTime - aTime;
    })
    .map((m) => ({
      projectId:    m.project.prjct_id,
      name:         m.project.prjct_nm,
      abbreviation: m.project.prjct_abrv ?? null,
      clientName:   m.project.client_nm  ?? null,
      startDate:    m.project.bgng_de    ?? null,
      endDate:      m.project.end_de     ?? null,
      myRole:       m.role_code,
    }));
}
