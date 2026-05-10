/**
 * exports/members-data.ts — 멤버 목록 데이터 조립 (서버 공용)
 */

import { prisma } from "@/lib/prisma";

export type MemberListItem = {
  memberId:       string;
  name:           string | null;
  email:          string;
  role:           string;
  job:            string;
  joinedAt:       Date;
  lastAccessedAt: Date | null;
  hasWork:        boolean;
};

/**
 * fetchProjectMembers — ACTIVE 멤버 전체 목록 (역할 + 직무 + 가입일)
 *   정렬: OWNER 먼저, 같은 역할 내에서는 가입일 오름차순
 */
export async function fetchProjectMembers(opts: {
  projectId: string;
}): Promise<MemberListItem[]> {
  const { projectId } = opts;

  const memberships = await prisma.tbPjProjectMember.findMany({
    where: { prjct_id: projectId, mber_sttus_code: "ACTIVE" },
    include: {
      member: { select: { mber_id: true, mber_nm: true, email_addr: true } },
    },
    orderBy: [
      { role_code: "asc" },
      { join_dt:   "asc" },
    ],
  });

  return memberships.map((m) => ({
    memberId:       m.mber_id,
    name:           m.member.mber_nm ?? null,
    email:          m.member.email_addr ?? "",
    role:           m.role_code,
    job:            m.job_title_code,
    joinedAt:       m.join_dt,
    lastAccessedAt: m.last_acces_dt ?? null,
    // TODO: tb_ds_screen/tb_ds_function 구현 후 실제 담당 여부로 교체
    hasWork: false,
  }));
}
