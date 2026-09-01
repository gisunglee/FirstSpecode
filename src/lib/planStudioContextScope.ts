import { prisma } from "@/lib/prisma";

export type PlanStudioContextInput = {
  ctxtTyCode: string;
  refId: string;
};

/**
 * 기획실 산출물 컨텍스트가 URL의 프로젝트 안에서만 연결되는지 확인한다.
 * 현재 지원하는 컨텍스트는 요구사항(REQ)과 다른 산출물(ARTF)뿐이다.
 */
export async function planStudioContextsBelongToProject(
  projectId: string,
  contexts: readonly PlanStudioContextInput[],
): Promise<boolean> {
  if (contexts.length === 0) return true;

  const keys = contexts.map((context) => `${context.ctxtTyCode}:${context.refId}`);
  if (
    contexts.some((context) =>
      !["REQ", "ARTF"].includes(context.ctxtTyCode) || !context.refId.trim()
    ) ||
    new Set(keys).size !== keys.length
  ) {
    return false;
  }

  const requirementIds = [...new Set(
    contexts.filter((context) => context.ctxtTyCode === "REQ").map((context) => context.refId),
  )];
  const artifactIds = [...new Set(
    contexts.filter((context) => context.ctxtTyCode === "ARTF").map((context) => context.refId),
  )];

  const [requirementCount, artifactCount] = await Promise.all([
    requirementIds.length === 0
      ? 0
      : prisma.tbRqRequirement.count({
          where: { req_id: { in: requirementIds }, prjct_id: projectId },
        }),
    artifactIds.length === 0
      ? 0
      : prisma.tbDsPlanStudioArtf.count({
          where: {
            artf_id: { in: artifactIds },
            planStudio: { prjct_id: projectId },
          },
        }),
  ]);

  return requirementCount === requirementIds.length && artifactCount === artifactIds.length;
}
