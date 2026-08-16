/** V2 DB 제약과 rollback 가능한 최소 쓰기 흐름을 실제 PostgreSQL에서 검증한다. */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const createdRunIds = [];

try {
  await runSmoke();
} finally {
  await prisma.$disconnect();
}

async function runSmoke() {
  const project = await prisma.tbPjProject.findFirst({
    select: { prjct_id: true },
    orderBy: { creat_dt: "asc" },
  });
  if (!project) {
    console.log("SPEC_SYNC_DB_SMOKE_SKIPPED_NO_PROJECT");
    return;
  }

  await expectRollback("valid CRUD", async (tx) => {
    const runId = await createRun(tx, project.prjct_id);
    await tx.tbSpSyncItem.create({
      data: baseItem(runId),
    });
    throw new Error("EXPECTED_SMOKE_ROLLBACK");
  });

  await expectConstraint(
    "tb_sp_sync_item_result_axis_ck",
    project.prjct_id,
    (runId) => ({
      ...baseItem(runId),
      finding_ty_code: "IMPLEMENTATION",
      result_code: "GAP_CANDIDATE",
    }),
  );
  await expectConstraint(
    "tb_sp_sync_item_target_field_ck",
    project.prjct_id,
    (runId) => ({
      ...baseItem(runId),
      result_code: "MISMATCH",
      item_sttus_code: "PENDING",
      target_ref_ty_code: "SCREEN",
      target_ref_id: randomUUID(),
      target_field_nm: "func_dc",
    }),
  );
  await expectConstraint(
    "tb_sp_sync_item_proposal_result_ck",
    project.prjct_id,
    (runId) => ({
      ...baseItem(runId),
      before_value_cn: "기존 설계",
      before_hash: "1".repeat(64),
      proposed_value_cn: "MATCH에 붙은 잘못된 수정안",
    }),
  );
  await expectConstraint(
    "tb_sp_sync_item_decision_state_ck",
    project.prjct_id,
    (runId) => ({
      ...baseItem(runId),
      decision_code: "APPLY",
    }),
  );

  const leaked = await prisma.tbSpSyncRun.count({
    where: { sync_run_id: { in: createdRunIds } },
  });
  if (leaked !== 0) throw new Error(`rollback 뒤 smoke run ${leaked}건이 남았습니다.`);
  console.log("SPEC_SYNC_DB_SMOKE_OK");
}

async function createRun(tx, projectId) {
  const runId = randomUUID();
  createdRunIds.push(runId);
  await tx.tbSpSyncRun.create({
    data: {
      sync_run_id: runId,
      prjct_id: projectId,
      unit_work_display_id: "UW-99999",
      unit_work_nm: "SPEC_SYNC_DB_SMOKE",
      sync_mode_code: "CHECK",
      sync_sttus_code: "RUNNING",
      design_snapshot_data: {},
      design_snapshot_hash: "0".repeat(64),
    },
  });
  return runId;
}

function baseItem(runId) {
  return {
    sync_run_id: runId,
    finding_ty_code: "IMPLEMENTATION",
    result_code: "MATCH",
    importance_code: "DETAIL",
    target_ref_ty_code: "UNIT_WORK",
    target_ref_id: randomUUID(),
    target_field_nm: "unit_work_dc",
    reason_cn: "DB smoke test",
    source_evidence_data: [],
    confidence_code: "HIGH",
    item_sttus_code: "INFORMATIONAL",
  };
}

async function expectRollback(label, action) {
  try {
    await prisma.$transaction(action);
    throw new Error(`${label}: rollback 신호가 발생하지 않았습니다.`);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "EXPECTED_SMOKE_ROLLBACK") {
      throw error;
    }
  }
}

async function expectConstraint(constraint, projectId, itemFactory) {
  try {
    await prisma.$transaction(async (tx) => {
      const runId = await createRun(tx, projectId);
      await tx.tbSpSyncItem.create({ data: itemFactory(runId) });
    });
    throw new Error(`${constraint}: 잘못된 행이 저장되었습니다.`);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes(constraint)) {
      throw error;
    }
  }
}
