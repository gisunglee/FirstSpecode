/**
 * 자동 적용 가능한 SPECODE 설계 필드의 단일 레지스트리.
 *
 * 다형 참조를 route마다 switch로 다시 구현하면 조회·hash 검증·이력 저장 대상이
 * 어긋날 수 있다. 여기서 프로젝트 소유권, 계층 경로, 현재 값, 갱신을 함께 정의한다.
 */

import { Prisma } from "@prisma/client";
import {
  TARGET_FIELDS,
  type ReconcileTargetField,
  type ReconcileTargetType,
} from "./contracts";

export type TargetHierarchyNode = {
  id: string;
  displayId: string;
  name: string;
};

export type TargetSnapshot = {
  targetType: ReconcileTargetType;
  targetId: string;
  targetField: ReconcileTargetField;
  refTable: string;
  displayId: string;
  name: string;
  value: string;
  hierarchy: {
    unitWork?: TargetHierarchyNode | null;
    screen?: TargetHierarchyNode | null;
    area?: TargetHierarchyNode | null;
    function?: TargetHierarchyNode | null;
  };
};

export async function getTargetSnapshot(
  tx: Prisma.TransactionClient,
  projectId: string,
  targetType: ReconcileTargetType,
  targetId: string,
  targetField: ReconcileTargetField,
): Promise<TargetSnapshot | null> {
  if (TARGET_FIELDS[targetType] !== targetField) return null;

  if (targetType === "UNIT_WORK") {
    const unitWork = await tx.tbDsUnitWork.findFirst({
      where: { unit_work_id: targetId, prjct_id: projectId },
      select: {
        unit_work_id: true,
        unit_work_display_id: true,
        unit_work_nm: true,
        unit_work_dc: true,
      },
    });
    if (!unitWork) return null;
    const node = {
      id: unitWork.unit_work_id,
      displayId: unitWork.unit_work_display_id,
      name: unitWork.unit_work_nm,
    };
    return {
      targetType,
      targetId,
      targetField,
      refTable: "tb_ds_unit_work",
      displayId: node.displayId,
      name: node.name,
      value: unitWork.unit_work_dc ?? "",
      hierarchy: { unitWork: node },
    };
  }

  if (targetType === "SCREEN") {
    const screen = await tx.tbDsScreen.findFirst({
      where: { scrn_id: targetId, prjct_id: projectId },
      select: {
        scrn_id: true,
        scrn_display_id: true,
        scrn_nm: true,
        scrn_dc: true,
        unitWork: {
          select: {
            unit_work_id: true,
            unit_work_display_id: true,
            unit_work_nm: true,
          },
        },
      },
    });
    if (!screen) return null;
    const node = {
      id: screen.scrn_id,
      displayId: screen.scrn_display_id,
      name: screen.scrn_nm,
    };
    return {
      targetType,
      targetId,
      targetField,
      refTable: "tb_ds_screen",
      displayId: node.displayId,
      name: node.name,
      value: screen.scrn_dc ?? "",
      hierarchy: {
        unitWork: screen.unitWork
          ? {
              id: screen.unitWork.unit_work_id,
              displayId: screen.unitWork.unit_work_display_id,
              name: screen.unitWork.unit_work_nm,
            }
          : null,
        screen: node,
      },
    };
  }

  if (targetType === "AREA") {
    const area = await tx.tbDsArea.findFirst({
      where: { area_id: targetId, prjct_id: projectId },
      select: {
        area_id: true,
        area_display_id: true,
        area_nm: true,
        area_dc: true,
        screen: {
          select: {
            scrn_id: true,
            scrn_display_id: true,
            scrn_nm: true,
            unitWork: {
              select: {
                unit_work_id: true,
                unit_work_display_id: true,
                unit_work_nm: true,
              },
            },
          },
        },
      },
    });
    if (!area) return null;
    const node = {
      id: area.area_id,
      displayId: area.area_display_id,
      name: area.area_nm,
    };
    const screen = area.screen;
    return {
      targetType,
      targetId,
      targetField,
      refTable: "tb_ds_area",
      displayId: node.displayId,
      name: node.name,
      value: area.area_dc ?? "",
      hierarchy: {
        unitWork: screen?.unitWork
          ? {
              id: screen.unitWork.unit_work_id,
              displayId: screen.unitWork.unit_work_display_id,
              name: screen.unitWork.unit_work_nm,
            }
          : null,
        screen: screen
          ? {
              id: screen.scrn_id,
              displayId: screen.scrn_display_id,
              name: screen.scrn_nm,
            }
          : null,
        area: node,
      },
    };
  }

  const fn = await tx.tbDsFunction.findFirst({
    where: { func_id: targetId, prjct_id: projectId },
    select: {
      func_id: true,
      func_display_id: true,
      func_nm: true,
      func_dc: true,
      area: {
        select: {
          area_id: true,
          area_display_id: true,
          area_nm: true,
          screen: {
            select: {
              scrn_id: true,
              scrn_display_id: true,
              scrn_nm: true,
              unitWork: {
                select: {
                  unit_work_id: true,
                  unit_work_display_id: true,
                  unit_work_nm: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!fn) return null;
  const area = fn.area;
  const screen = area?.screen;
  const node = {
    id: fn.func_id,
    displayId: fn.func_display_id,
    name: fn.func_nm,
  };
  return {
    targetType,
    targetId,
    targetField,
    refTable: "tb_ds_function",
    displayId: node.displayId,
    name: node.name,
    value: fn.func_dc ?? "",
    hierarchy: {
      unitWork: screen?.unitWork
        ? {
            id: screen.unitWork.unit_work_id,
            displayId: screen.unitWork.unit_work_display_id,
            name: screen.unitWork.unit_work_nm,
          }
        : null,
      screen: screen
        ? {
            id: screen.scrn_id,
            displayId: screen.scrn_display_id,
            name: screen.scrn_nm,
          }
        : null,
      area: area
        ? {
            id: area.area_id,
            displayId: area.area_display_id,
            name: area.area_nm,
          }
        : null,
      function: node,
    },
  };
}

export async function updateTargetValue(
  tx: Prisma.TransactionClient,
  snapshot: TargetSnapshot,
  value: string,
) {
  const nullableValue = value || null;
  const mdfcn_dt = new Date();

  switch (snapshot.targetType) {
    case "UNIT_WORK":
      await tx.tbDsUnitWork.update({
        where: { unit_work_id: snapshot.targetId },
        data: { unit_work_dc: nullableValue, mdfcn_dt },
      });
      return;
    case "SCREEN":
      await tx.tbDsScreen.update({
        where: { scrn_id: snapshot.targetId },
        data: { scrn_dc: nullableValue, mdfcn_dt },
      });
      return;
    case "AREA":
      await tx.tbDsArea.update({
        where: { area_id: snapshot.targetId },
        data: { area_dc: nullableValue, mdfcn_dt },
      });
      return;
    case "FUNCTION":
      await tx.tbDsFunction.update({
        where: { func_id: snapshot.targetId },
        data: { func_dc: nullableValue, mdfcn_dt },
      });
  }
}

