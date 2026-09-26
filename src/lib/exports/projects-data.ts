/**
 * exports/projects-data.ts — 내 프로젝트 목록 데이터 조립 (서버 공용)
 */

import { prisma } from "@/lib/prisma";
import { ACTIVE_PROJECT_RELATION_WHERE } from "@/lib/projectGuard";
import { SEAT_ROLES } from "@/lib/billing/seats";

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
  /** 결제 잠금(lock_yn='Y') — 목록에 자물쇠 배지, 소유자에게 "활성화" 버튼 */
  locked:       boolean;
  /** 내가 소유자(owner_mber_id)인가 — "활성화" 버튼 노출 판정 */
  isOwner:      boolean;
  /**
   * 편집 멤버(OWNER/ADMIN/MEMBER, ACTIVE) 수 — 내 소유 프로젝트만 채우고 남의 것은 null.
   * 열린 프로젝트 교체 다이얼로그가 "이 프로젝트를 닫으면 누구의 편집이 막히는지" 경고에 쓴다.
   */
  editorCount:  number | null;
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
          lock_yn:       true,
          owner_mber_id: true,
        },
      },
    },
    orderBy: { join_dt: "desc" },
  });

  // 소유 프로젝트의 편집 멤버 수 — 프로젝트마다 세지 않고 groupBy 한 번으로 끝낸다
  const ownedIds = memberships
    .filter((m) => m.project.owner_mber_id === mberId)
    .map((m) => m.project.prjct_id);
  const editorCounts = new Map<string, number>();
  if (ownedIds.length > 0) {
    const grouped = await prisma.tbPjProjectMember.groupBy({
      by:     ["prjct_id"],
      where:  { prjct_id: { in: ownedIds }, mber_sttus_code: "ACTIVE", role_code: { in: [...SEAT_ROLES] } },
      _count: { _all: true },
    });
    for (const g of grouped) editorCounts.set(g.prjct_id, g._count._all);
  }

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
      locked:       m.project.lock_yn === "Y",
      isOwner:      m.project.owner_mber_id === mberId,
      editorCount:  m.project.owner_mber_id === mberId ? editorCounts.get(m.project.prjct_id) ?? 0 : null,
    }));
}
