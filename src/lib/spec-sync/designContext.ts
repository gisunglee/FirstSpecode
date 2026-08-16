/**
 * 선택한 UW의 현재 의미 설계를 하나의 동기화 snapshot으로 만든다.
 *
 * 감사 컬럼은 제외하고, 비교에 필요한 요구사항·스토리·인수기준·화면·영역·기능과
 * 구조화된 API/DB 참조만 포함한다.
 */

import { prisma } from "@/lib/prisma";
import {
  designSnapshotSchema,
  type DesignSnapshot,
} from "./contracts";
import { extractApiRefs, hierarchy, loadDbRefs } from "./designReferences";
import { hashCanonicalValue } from "./hash";

export class DesignSnapshotError extends Error {
  constructor(
    public readonly code: "UNIT_WORK_NOT_FOUND" | "EMPTY_DESIGN",
    message: string,
  ) {
    super(message);
  }
}

export async function loadDesignSnapshot(input: {
  projectId: string;
  unitWorkRef: string;
}): Promise<{ snapshot: DesignSnapshot; hash: string }> {
  const unitWork = await prisma.tbDsUnitWork.findFirst({
    where: {
      prjct_id: input.projectId,
      OR: [
        { unit_work_id: input.unitWorkRef },
        { unit_work_display_id: input.unitWorkRef },
      ],
    },
    select: {
      unit_work_id: true,
      unit_work_display_id: true,
      unit_work_nm: true,
      unit_work_dc: true,
      req_id: true,
      requirement: {
        select: {
          req_id: true,
          prjct_id: true,
          req_display_id: true,
          req_nm: true,
          orgnl_cn: true,
          curncy_cn: true,
          analy_cn: true,
          spec_cn: true,
          userStories: {
            orderBy: { sort_ordr: "asc" },
            select: {
              story_id: true,
              story_display_id: true,
              story_nm: true,
              persona_cn: true,
              scenario_cn: true,
              acceptanceCriteria: {
                orderBy: { sort_ordr: "asc" },
                select: {
                  ac_id: true,
                  given_cn: true,
                  when_cn: true,
                  then_cn: true,
                },
              },
            },
          },
        },
      },
      screens: {
        where: { prjct_id: input.projectId },
        orderBy: { sort_ordr: "asc" },
        select: {
          scrn_id: true,
          scrn_display_id: true,
          scrn_nm: true,
          scrn_dc: true,
          scrn_ty_code: true,
          url_path: true,
          ctgry_l_nm: true,
          ctgry_m_nm: true,
          ctgry_s_nm: true,
          areas: {
            where: { prjct_id: input.projectId },
            orderBy: { sort_ordr: "asc" },
            select: {
              area_id: true,
              area_display_id: true,
              area_nm: true,
              area_dc: true,
              area_ty_code: true,
              display_form_code: true,
              functions: {
                where: { prjct_id: input.projectId },
                orderBy: { sort_ordr: "asc" },
                select: {
                  func_id: true,
                  func_display_id: true,
                  func_nm: true,
                  func_dc: true,
                  func_ty_code: true,
                  priort_code: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!unitWork) {
    throw new DesignSnapshotError(
      "UNIT_WORK_NOT_FOUND",
      "프로젝트에서 지정한 단위업무를 찾을 수 없습니다.",
    );
  }

  const targets: DesignSnapshot["targets"] = [
    {
      targetType: "UNIT_WORK",
      targetId: unitWork.unit_work_id,
      targetField: "unit_work_dc",
      displayId: unitWork.unit_work_display_id,
      name: unitWork.unit_work_nm,
      value: unitWork.unit_work_dc ?? "",
      attributes: { requirementId: unitWork.req_id },
      hierarchy: hierarchy(unitWork.unit_work_id),
    },
  ];

  for (const screen of unitWork.screens) {
    targets.push({
      targetType: "SCREEN",
      targetId: screen.scrn_id,
      targetField: "scrn_dc",
      displayId: screen.scrn_display_id,
      name: screen.scrn_nm,
      value: screen.scrn_dc ?? "",
      attributes: {
        urlPath: screen.url_path,
        screenType: screen.scrn_ty_code,
        categoryLarge: screen.ctgry_l_nm,
        categoryMedium: screen.ctgry_m_nm,
        categorySmall: screen.ctgry_s_nm,
      },
      hierarchy: hierarchy(unitWork.unit_work_id, screen.scrn_id),
    });
    for (const area of screen.areas) {
      targets.push({
        targetType: "AREA",
        targetId: area.area_id,
        targetField: "area_dc",
        displayId: area.area_display_id,
        name: area.area_nm,
        value: area.area_dc ?? "",
        attributes: {
          areaType: area.area_ty_code,
          displayForm: area.display_form_code,
        },
        hierarchy: hierarchy(
          unitWork.unit_work_id,
          screen.scrn_id,
          area.area_id,
        ),
      });
      for (const fn of area.functions) {
        targets.push({
          targetType: "FUNCTION",
          targetId: fn.func_id,
          targetField: "func_dc",
          displayId: fn.func_display_id,
          name: fn.func_nm,
          value: fn.func_dc ?? "",
          attributes: {
            functionType: fn.func_ty_code,
            priority: fn.priort_code,
          },
          hierarchy: hierarchy(
            unitWork.unit_work_id,
            screen.scrn_id,
            area.area_id,
            fn.func_id,
          ),
        });
      }
    }
  }

  if (targets.length === 0) {
    throw new DesignSnapshotError(
      "EMPTY_DESIGN",
      "동기화할 설계 대상이 없습니다.",
    );
  }

  const requirement =
    unitWork.requirement?.prjct_id === input.projectId
      ? unitWork.requirement
      : null;
  const userStories = requirement?.userStories ?? [];
  const acceptanceCriteria = userStories.flatMap((story) =>
    story.acceptanceCriteria.map((criterion) =>
      [
        criterion.given_cn ? `Given: ${criterion.given_cn}` : "",
        criterion.when_cn ? `When: ${criterion.when_cn}` : "",
        criterion.then_cn ? `Then: ${criterion.then_cn}` : "",
      ]
        .filter(Boolean)
        .join(" / "),
    ),
  );
  const functionIds = targets
    .filter((target) => target.targetType === "FUNCTION")
    .map((target) => target.targetId);
  const dbRefs = await loadDbRefs(input.projectId, functionIds);

  const snapshot = designSnapshotSchema.parse({
    projectId: input.projectId,
    unitWork: {
      id: unitWork.unit_work_id,
      displayId: unitWork.unit_work_display_id,
      name: unitWork.unit_work_nm,
    },
    requirements: requirement
      ? [
          {
            id: requirement.req_id,
            displayId: requirement.req_display_id,
            name: requirement.req_nm,
            original: requirement.orgnl_cn,
            currency: requirement.curncy_cn,
            analysis: requirement.analy_cn,
            specification: requirement.spec_cn,
          },
        ]
      : [],
    userStories: userStories.map((story) => ({
      id: story.story_id,
      displayId: story.story_display_id,
      name: story.story_nm,
      persona: story.persona_cn,
      scenario: story.scenario_cn,
    })),
    acceptanceCriteria,
    apiRefs: extractApiRefs(targets),
    dbRefs,
    targets,
  });

  return { snapshot, hash: hashCanonicalValue(snapshot) };
}
