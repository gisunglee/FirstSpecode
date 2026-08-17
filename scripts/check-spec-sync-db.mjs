import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const expectV2 = process.argv.includes("--expect-v2");
const tables = [
  "tb_sp_source_repository",
  "tb_sp_source_baseline",
  "tb_sp_impl_receipt",
  "tb_sp_reconcile_batch",
  "tb_sp_reconcile_item",
  "tb_sp_spec_source_link",
  "tb_sp_sync_run",
  "tb_sp_sync_item",
];

try {
  const status = [];
  for (const table of tables) {
    const relation = await prisma.$queryRawUnsafe(
      `SELECT to_regclass('public.${table}')::text AS name`,
    );
    const exists = Boolean(relation[0]?.name);
    const count = exists
      ? Number((await prisma.$queryRawUnsafe(
          `SELECT count(*)::int AS count FROM public.${table}`,
        ))[0]?.count ?? 0)
      : 0;
    status.push({ table, exists, count });
  }
  console.log(JSON.stringify(status, null, 2));

  const legacyTasks = await prisma.$queryRawUnsafe(`
    SELECT ref_ty_code, task_sttus_code, count(*)::int AS count
    FROM public.tb_ai_task
    WHERE ref_ty_code IN (
      'SPEC_RECONCILIATION',
      'SPEC_RECONCILIATION_ROUTER',
      'SPEC_RECONCILIATION_BATCH'
    )
    GROUP BY ref_ty_code, task_sttus_code
    ORDER BY ref_ty_code, task_sttus_code
  `);
  console.log(JSON.stringify({ legacyTasks }, null, 2));

  const legacyConfigs = await prisma.$queryRawUnsafe(`
    SELECT 'project' AS scope, config_key, count(*)::int AS count
    FROM public.tb_pj_project_config
    WHERE config_key IN (
      'SPEC_RECONCILE_GATE_POLICY',
      'SPEC_RECONCILE_DIFF_RETENTION_DAYS',
      'SPEC_RECONCILE_BLOCK_RISKS'
    )
    GROUP BY config_key
    UNION ALL
    SELECT 'system' AS scope, config_key, count(*)::int AS count
    FROM public.tb_sys_config_template
    WHERE config_key IN (
      'SPEC_RECONCILE_GATE_POLICY',
      'SPEC_RECONCILE_DIFF_RETENTION_DAYS',
      'SPEC_RECONCILE_BLOCK_RISKS'
    )
    GROUP BY config_key
    ORDER BY scope, config_key
  `);
  console.log(JSON.stringify({ legacyConfigs }, null, 2));

  if (expectV2) {
    const oldTables = status.slice(0, 6);
    const newTables = status.slice(6);
    if (oldTables.some((table) => table.exists)) {
      throw new Error("V1 전용 테이블이 남아 있습니다.");
    }
    if (newTables.some((table) => !table.exists)) {
      throw new Error("V2 동기화 테이블이 생성되지 않았습니다.");
    }
    if (legacyTasks.length > 0 || legacyConfigs.length > 0) {
      throw new Error("V1 전용 작업 또는 설정 데이터가 남아 있습니다.");
    }

    const constraints = await prisma.$queryRawUnsafe(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid IN (
        'public.tb_ds_col_mapping'::regclass,
        'public.tb_sp_sync_run'::regclass,
        'public.tb_sp_sync_item'::regclass
      )
      ORDER BY conname
    `);
    const names = new Set(constraints.map((row) => row.conname));
    for (const required of [
      "tb_ds_col_mapping_grp_id_fkey",
      "tb_sp_sync_run_prjct_fk",
      "tb_sp_sync_run_unit_work_fk",
      "tb_sp_sync_run_mode_ck",
      "tb_sp_sync_run_sttus_ck",
      "tb_sp_sync_run_snapshot_hash_ck",
      "tb_sp_sync_item_run_fk",
      "tb_sp_sync_item_design_change_fk",
      "tb_sp_sync_item_result_axis_ck",
      "tb_sp_sync_item_axis_target_ck",
      "tb_sp_sync_item_evidence_ck",
      "tb_sp_sync_item_target_field_ck",
      "tb_sp_sync_item_before_hash_ck",
      "tb_sp_sync_item_proposal_result_ck",
      "tb_sp_sync_item_decision_state_ck",
    ]) {
      if (!names.has(required)) throw new Error(`DB 제약조건 누락: ${required}`);
    }
    console.log("SPEC_SYNC_DB_V2_OK");
  }
} finally {
  await prisma.$disconnect();
}
