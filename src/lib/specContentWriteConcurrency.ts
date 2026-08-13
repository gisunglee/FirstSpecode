import type { Prisma } from "@prisma/client";
import type { SpecResourceType } from "@/lib/specContentPolicyCore";
import { SPEC_CREATOR_EDIT_WINDOW_MS } from "@/lib/specContentPolicyCore";
import type { SpecWriteContext } from "@/lib/specContentWritePolicy";

type CreatorWindowRow = {
  creat_mber_id: string | null;
  mdfcn_mber_id: string | null;
  creat_dt: Date;
};

export class CreatorWindowConflictError extends Error {
  constructor() {
    super("CREATOR_WINDOW_CONFLICT");
    this.name = "CreatorWindowConflictError";
  }
}

async function lockResourceRow(
  tx: Prisma.TransactionClient,
  resourceType: SpecResourceType,
  resourceId: string
): Promise<CreatorWindowRow | null> {
  let rows: CreatorWindowRow[];
  switch (resourceType) {
    case "TASK":
      rows = await tx.$queryRaw`SELECT creat_mber_id, mdfcn_mber_id, creat_dt FROM tb_rq_task WHERE task_id = ${resourceId} FOR UPDATE`;
      break;
    case "REQUIREMENT":
      rows = await tx.$queryRaw`SELECT creat_mber_id, mdfcn_mber_id, creat_dt FROM tb_rq_requirement WHERE req_id = ${resourceId} FOR UPDATE`;
      break;
    case "USER_STORY":
      rows = await tx.$queryRaw`SELECT creat_mber_id, mdfcn_mber_id, creat_dt FROM tb_rq_user_story WHERE story_id = ${resourceId} FOR UPDATE`;
      break;
    case "UNIT_WORK":
      rows = await tx.$queryRaw`SELECT creat_mber_id, mdfcn_mber_id, creat_dt FROM tb_ds_unit_work WHERE unit_work_id = ${resourceId} FOR UPDATE`;
      break;
    case "SCREEN":
      rows = await tx.$queryRaw`SELECT creat_mber_id, mdfcn_mber_id, creat_dt FROM tb_ds_screen WHERE scrn_id = ${resourceId} FOR UPDATE`;
      break;
    case "AREA":
      rows = await tx.$queryRaw`SELECT creat_mber_id, mdfcn_mber_id, creat_dt FROM tb_ds_area WHERE area_id = ${resourceId} FOR UPDATE`;
      break;
    case "FUNCTION":
      rows = await tx.$queryRaw`SELECT creat_mber_id, mdfcn_mber_id, creat_dt FROM tb_ds_function WHERE func_id = ${resourceId} FOR UPDATE`;
      break;
  }
  return rows[0] ?? null;
}

/** 생성자 보정 권한일 때만 행을 잠그고 시간·최종 수정자를 트랜잭션 안에서 재검증한다. */
export async function lockAndAssertCreatorWindow(
  tx: Prisma.TransactionClient,
  resourceType: SpecResourceType,
  resourceId: string,
  gate: SpecWriteContext,
  now = new Date()
): Promise<void> {
  if (gate.grant !== "CREATOR_WINDOW") return;

  const row = await lockResourceRow(tx, resourceType, resourceId);
  const active = row
    && row.creat_mber_id === gate.mberId
    && (!row.mdfcn_mber_id || row.mdfcn_mber_id === gate.mberId)
    && row.creat_dt.getTime() + SPEC_CREATOR_EDIT_WINDOW_MS > now.getTime();

  if (!active) throw new CreatorWindowConflictError();
}

export function isCreatorWindowConflict(error: unknown): error is CreatorWindowConflictError {
  return error instanceof CreatorWindowConflictError;
}
