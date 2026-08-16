/**
 * V2에서 자동 반영할 수 있는 네 설명 필드의 유일한 레지스트리.
 *
 * 적용 트랜잭션은 대상 행을 먼저 잠그고, 프로젝트와 실행 UW 계층을 다시 확인한다.
 * 다형 target ID만 믿고 다른 UW의 설계를 갱신하지 않는다.
 */

import { Prisma } from "@prisma/client";
import {
  TARGET_FIELDS,
  type SyncTargetField,
  type SyncTargetType,
} from "./contracts";

export type LockedTarget = {
  targetType: SyncTargetType;
  targetId: string;
  targetField: SyncTargetField;
  refTable: string;
  displayId: string;
  name: string;
  value: string;
  unitWorkId: string;
};

export async function lockTarget(
  tx: Prisma.TransactionClient,
  input: {
    projectId: string;
    unitWorkId: string;
    targetType: SyncTargetType;
    targetId: string;
    targetField: SyncTargetField;
  },
): Promise<LockedTarget | null> {
  if (TARGET_FIELDS[input.targetType] !== input.targetField) return null;

  const locked = await lockTargetRow(tx, input);
  if (!locked) return null;

  const target = await readTarget(tx, input);
  if (!target || target.unitWorkId !== input.unitWorkId) return null;
  return target;
}

export async function updateLockedTarget(
  tx: Prisma.TransactionClient,
  target: LockedTarget,
  value: string,
  memberId: string,
) {
  const nullableValue = value === "" ? null : value;
  const audit = { mdfcn_mber_id: memberId, mdfcn_dt: new Date() };

  switch (target.targetType) {
    case "UNIT_WORK":
      await tx.tbDsUnitWork.update({
        where: { unit_work_id: target.targetId },
        data: { unit_work_dc: nullableValue, ...audit },
      });
      return;
    case "SCREEN":
      await tx.tbDsScreen.update({
        where: { scrn_id: target.targetId },
        data: { scrn_dc: nullableValue, ...audit },
      });
      return;
    case "AREA":
      await tx.tbDsArea.update({
        where: { area_id: target.targetId },
        data: { area_dc: nullableValue, ...audit },
      });
      return;
    case "FUNCTION":
      await tx.tbDsFunction.update({
        where: { func_id: target.targetId },
        data: { func_dc: nullableValue, ...audit },
      });
  }
}

async function lockTargetRow(
  tx: Prisma.TransactionClient,
  input: {
    projectId: string;
    unitWorkId: string;
    targetType: SyncTargetType;
    targetId: string;
  },
) {
  let rows: Array<{ id: string }>;
  switch (input.targetType) {
    case "UNIT_WORK":
      rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT uw.unit_work_id AS id
        FROM tb_ds_unit_work uw
        WHERE uw.unit_work_id = ${input.targetId}
          AND uw.unit_work_id = ${input.unitWorkId}
          AND uw.prjct_id = ${input.projectId}
        FOR UPDATE OF uw
      `);
      break;
    case "SCREEN":
      rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT scrn.scrn_id AS id
        FROM tb_ds_screen scrn
        JOIN tb_ds_unit_work uw ON uw.unit_work_id = scrn.unit_work_id
        WHERE scrn.scrn_id = ${input.targetId}
          AND scrn.prjct_id = ${input.projectId}
          AND uw.prjct_id = ${input.projectId}
          AND uw.unit_work_id = ${input.unitWorkId}
        FOR UPDATE OF scrn, uw
      `);
      break;
    case "AREA":
      rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT area.area_id AS id
        FROM tb_ds_area area
        JOIN tb_ds_screen scrn ON scrn.scrn_id = area.scrn_id
        JOIN tb_ds_unit_work uw ON uw.unit_work_id = scrn.unit_work_id
        WHERE area.area_id = ${input.targetId}
          AND area.prjct_id = ${input.projectId}
          AND scrn.prjct_id = ${input.projectId}
          AND uw.prjct_id = ${input.projectId}
          AND uw.unit_work_id = ${input.unitWorkId}
        FOR UPDATE OF area, scrn, uw
      `);
      break;
    case "FUNCTION":
      rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT func.func_id AS id
        FROM tb_ds_function func
        JOIN tb_ds_area area ON area.area_id = func.area_id
        JOIN tb_ds_screen scrn ON scrn.scrn_id = area.scrn_id
        JOIN tb_ds_unit_work uw ON uw.unit_work_id = scrn.unit_work_id
        WHERE func.func_id = ${input.targetId}
          AND func.prjct_id = ${input.projectId}
          AND area.prjct_id = ${input.projectId}
          AND scrn.prjct_id = ${input.projectId}
          AND uw.prjct_id = ${input.projectId}
          AND uw.unit_work_id = ${input.unitWorkId}
        FOR UPDATE OF func, area, scrn, uw
      `);
      break;
  }
  return rows.length === 1;
}

async function readTarget(
  tx: Prisma.TransactionClient,
  input: {
    projectId: string;
    targetType: SyncTargetType;
    targetId: string;
    targetField: SyncTargetField;
  },
): Promise<LockedTarget | null> {
  if (input.targetType === "UNIT_WORK") {
    const row = await tx.tbDsUnitWork.findFirst({
      where: { unit_work_id: input.targetId, prjct_id: input.projectId },
      select: {
        unit_work_id: true,
        unit_work_display_id: true,
        unit_work_nm: true,
        unit_work_dc: true,
      },
    });
    return row
      ? {
          ...input,
          refTable: "tb_ds_unit_work",
          displayId: row.unit_work_display_id,
          name: row.unit_work_nm,
          value: row.unit_work_dc ?? "",
          unitWorkId: row.unit_work_id,
        }
      : null;
  }

  if (input.targetType === "SCREEN") {
    const row = await tx.tbDsScreen.findFirst({
      where: { scrn_id: input.targetId, prjct_id: input.projectId },
      select: {
        scrn_id: true,
        scrn_display_id: true,
        scrn_nm: true,
        scrn_dc: true,
        unit_work_id: true,
      },
    });
    return row?.unit_work_id
      ? {
          ...input,
          refTable: "tb_ds_screen",
          displayId: row.scrn_display_id,
          name: row.scrn_nm,
          value: row.scrn_dc ?? "",
          unitWorkId: row.unit_work_id,
        }
      : null;
  }

  if (input.targetType === "AREA") {
    const row = await tx.tbDsArea.findFirst({
      where: { area_id: input.targetId, prjct_id: input.projectId },
      select: {
        area_id: true,
        area_display_id: true,
        area_nm: true,
        area_dc: true,
        screen: { select: { unit_work_id: true } },
      },
    });
    return row?.screen?.unit_work_id
      ? {
          ...input,
          refTable: "tb_ds_area",
          displayId: row.area_display_id,
          name: row.area_nm,
          value: row.area_dc ?? "",
          unitWorkId: row.screen.unit_work_id,
        }
      : null;
  }

  const row = await tx.tbDsFunction.findFirst({
    where: { func_id: input.targetId, prjct_id: input.projectId },
    select: {
      func_id: true,
      func_display_id: true,
      func_nm: true,
      func_dc: true,
      area: { select: { screen: { select: { unit_work_id: true } } } },
    },
  });
  const unitWorkId = row?.area?.screen?.unit_work_id;
  return row && unitWorkId
    ? {
        ...input,
        refTable: "tb_ds_function",
        displayId: row.func_display_id,
        name: row.func_nm,
        value: row.func_dc ?? "",
        unitWorkId,
      }
    : null;
}
