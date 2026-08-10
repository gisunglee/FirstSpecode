import { prisma } from "@/lib/prisma";
import type { SpecResourcePolicyFacts, SpecResourceType } from "@/lib/specContentPolicyCore";

export async function findSpecResourcePolicyFacts(
  resourceType: SpecResourceType,
  resourceId: string
): Promise<SpecResourcePolicyFacts | null> {
  switch (resourceType) {
    case "TASK": {
      const row = await prisma.tbRqTask.findUnique({
        where: { task_id: resourceId },
        select: {
          prjct_id: true,
          creat_mber_id: true,
          mdfcn_mber_id: true,
          creat_dt: true,
          asign_mber_id: true,
        },
      });
      return row && {
        projectId: row.prjct_id,
        resourceName: "과업",
        creatorId: row.creat_mber_id,
        modifierId: row.mdfcn_mber_id,
        createdAt: row.creat_dt,
        assigneeChain: [row.asign_mber_id],
      };
    }
    case "REQUIREMENT": {
      const row = await prisma.tbRqRequirement.findUnique({
        where: { req_id: resourceId },
        select: {
          prjct_id: true,
          creat_mber_id: true,
          mdfcn_mber_id: true,
          creat_dt: true,
          asign_mber_id: true,
          task: { select: { asign_mber_id: true } },
        },
      });
      return row && {
        projectId: row.prjct_id,
        resourceName: "요구사항",
        creatorId: row.creat_mber_id,
        modifierId: row.mdfcn_mber_id,
        createdAt: row.creat_dt,
        assigneeChain: [row.asign_mber_id, row.task?.asign_mber_id ?? null],
      };
    }
    case "USER_STORY": {
      const row = await prisma.tbRqUserStory.findUnique({
        where: { story_id: resourceId },
        select: {
          creat_mber_id: true,
          mdfcn_mber_id: true,
          creat_dt: true,
          requirement: {
            select: {
              prjct_id: true,
              asign_mber_id: true,
              task: { select: { asign_mber_id: true } },
            },
          },
        },
      });
      return row && {
        projectId: row.requirement.prjct_id,
        resourceName: "사용자스토리",
        creatorId: row.creat_mber_id,
        modifierId: row.mdfcn_mber_id,
        createdAt: row.creat_dt,
        assigneeChain: [
          row.requirement.asign_mber_id,
          row.requirement.task?.asign_mber_id ?? null,
        ],
      };
    }
    case "UNIT_WORK": {
      const row = await prisma.tbDsUnitWork.findUnique({
        where: { unit_work_id: resourceId },
        select: {
          prjct_id: true,
          creat_mber_id: true,
          mdfcn_mber_id: true,
          creat_dt: true,
          asign_mber_id: true,
          requirement: {
            select: {
              asign_mber_id: true,
              task: { select: { asign_mber_id: true } },
            },
          },
        },
      });
      return row && {
        projectId: row.prjct_id,
        resourceName: "단위업무",
        creatorId: row.creat_mber_id,
        modifierId: row.mdfcn_mber_id,
        createdAt: row.creat_dt,
        assigneeChain: [
          row.asign_mber_id,
          row.requirement.asign_mber_id,
          row.requirement.task?.asign_mber_id ?? null,
        ],
      };
    }
    case "SCREEN": {
      const row = await prisma.tbDsScreen.findUnique({
        where: { scrn_id: resourceId },
        select: {
          prjct_id: true,
          creat_mber_id: true,
          mdfcn_mber_id: true,
          creat_dt: true,
          asign_mber_id: true,
          unitWork: {
            select: {
              asign_mber_id: true,
              requirement: {
                select: {
                  asign_mber_id: true,
                  task: { select: { asign_mber_id: true } },
                },
              },
            },
          },
        },
      });
      return row && {
        projectId: row.prjct_id,
        resourceName: "화면",
        creatorId: row.creat_mber_id,
        modifierId: row.mdfcn_mber_id,
        createdAt: row.creat_dt,
        assigneeChain: [
          row.asign_mber_id,
          row.unitWork?.asign_mber_id ?? null,
          row.unitWork?.requirement.asign_mber_id ?? null,
          row.unitWork?.requirement.task?.asign_mber_id ?? null,
        ],
      };
    }
    case "AREA": {
      const row = await prisma.tbDsArea.findUnique({
        where: { area_id: resourceId },
        select: {
          prjct_id: true,
          creat_mber_id: true,
          mdfcn_mber_id: true,
          creat_dt: true,
          screen: {
            select: {
              asign_mber_id: true,
              unitWork: {
                select: {
                  asign_mber_id: true,
                  requirement: {
                    select: {
                      asign_mber_id: true,
                      task: { select: { asign_mber_id: true } },
                    },
                  },
                },
              },
            },
          },
        },
      });
      return row && {
        projectId: row.prjct_id,
        resourceName: "영역",
        creatorId: row.creat_mber_id,
        modifierId: row.mdfcn_mber_id,
        createdAt: row.creat_dt,
        assigneeChain: [
          row.screen?.asign_mber_id ?? null,
          row.screen?.unitWork?.asign_mber_id ?? null,
          row.screen?.unitWork?.requirement.asign_mber_id ?? null,
          row.screen?.unitWork?.requirement.task?.asign_mber_id ?? null,
        ],
      };
    }
    case "FUNCTION": {
      const row = await prisma.tbDsFunction.findUnique({
        where: { func_id: resourceId },
        select: {
          prjct_id: true,
          creat_mber_id: true,
          mdfcn_mber_id: true,
          creat_dt: true,
          asign_mber_id: true,
          area: {
            select: {
              screen: {
                select: {
                  asign_mber_id: true,
                  unitWork: {
                    select: {
                      asign_mber_id: true,
                      requirement: {
                        select: {
                          asign_mber_id: true,
                          task: { select: { asign_mber_id: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      return row && {
        projectId: row.prjct_id,
        resourceName: "기능",
        creatorId: row.creat_mber_id,
        modifierId: row.mdfcn_mber_id,
        createdAt: row.creat_dt,
        assigneeChain: [
          row.asign_mber_id,
          row.area?.screen?.asign_mber_id ?? null,
          row.area?.screen?.unitWork?.asign_mber_id ?? null,
          row.area?.screen?.unitWork?.requirement.asign_mber_id ?? null,
          row.area?.screen?.unitWork?.requirement.task?.asign_mber_id ?? null,
        ],
      };
    }
  }
}


