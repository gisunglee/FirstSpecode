/**
 * plan-studio/display-id — PB-NNNNN 형식 표시 ID 채번
 *
 * 역할:
 *   - 프로젝트 내 plan_studio_display_id 최대값 기준으로 다음 번호 생성
 *   - 형식: PB-00001 (5자리 zero-padding)
 */

import { prisma } from "@/lib/prisma";

/**
 * 다음 PB-NNNNN 표시 ID 생성
 * @param projectId 프로젝트 UUID
 */
export async function nextDisplayId(projectId: string): Promise<string> {
  const last = await prisma.tbDsPlanStudio.findFirst({
    where: {
      prjct_id: projectId,
      plan_studio_display_id: { startsWith: "PB-" },
    },
    orderBy: { plan_studio_display_id: "desc" },
    select: { plan_studio_display_id: true },
  });

  let nextNum = 1;
  if (last?.plan_studio_display_id) {
    const parsed = parseInt(last.plan_studio_display_id.substring(3), 10);
    if (!isNaN(parsed)) nextNum = parsed + 1;
  }

  return `PB-${String(nextNum).padStart(5, "0")}`;
}
