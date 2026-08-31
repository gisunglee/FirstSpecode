/**
 * projectEntityScope — 다형 참조(refType/refId)가 URL의 프로젝트에 속하는지 검증한다.
 *
 * 컬럼 매핑과 구현 트리처럼 FK 없이 엔티티 종류와 UUID를 받는 API는 프로젝트
 * 멤버십만 확인해서는 안 된다. 반드시 실제 대상 행의 prjct_id도 함께 확인해야 한다.
 */

import { prisma } from "@/lib/prisma";

export const PROJECT_ENTITY_REF_TYPES = [
  "UNIT_WORK",
  "SCREEN",
  "AREA",
  "FUNCTION",
] as const;

export type ProjectEntityRefType = (typeof PROJECT_ENTITY_REF_TYPES)[number];

export function isProjectEntityRefType(value: string): value is ProjectEntityRefType {
  return (PROJECT_ENTITY_REF_TYPES as readonly string[]).includes(value);
}

/**
 * 대상이 존재하면서 요청 URL의 프로젝트에 소속될 때만 true를 반환한다.
 * 존재 여부와 타 프로젝트 소속 여부를 같은 false로 처리해 정보 노출도 막는다.
 */
export async function projectEntityBelongsToProject(
  projectId: string,
  refType: ProjectEntityRefType,
  refId: string,
): Promise<boolean> {
  switch (refType) {
    case "UNIT_WORK":
      return Boolean(await prisma.tbDsUnitWork.findFirst({
        where: { unit_work_id: refId, prjct_id: projectId },
        select: { unit_work_id: true },
      }));
    case "SCREEN":
      return Boolean(await prisma.tbDsScreen.findFirst({
        where: { scrn_id: refId, prjct_id: projectId },
        select: { scrn_id: true },
      }));
    case "AREA":
      return Boolean(await prisma.tbDsArea.findFirst({
        where: { area_id: refId, prjct_id: projectId },
        select: { area_id: true },
      }));
    case "FUNCTION":
      return Boolean(await prisma.tbDsFunction.findFirst({
        where: { func_id: refId, prjct_id: projectId },
        select: { func_id: true },
      }));
  }
}
