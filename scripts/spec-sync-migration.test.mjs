/** V2 전환 SQL이 새 테이블 생성과 V1 제거 계약을 빠뜨리지 않았는지 정적으로 검증한다. */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../prisma/sql/2026-08-17_create_spec_sync_v2.sql", import.meta.url),
  "utf8",
);
const schema = await readFile(
  new URL("../prisma/schema.prisma", import.meta.url),
  "utf8",
);

const V1_TABLES = [
  "tb_sp_source_repository",
  "tb_sp_source_baseline",
  "tb_sp_impl_receipt",
  "tb_sp_reconcile_batch",
  "tb_sp_reconcile_item",
  "tb_sp_spec_source_link",
];

test("V2 전환 SQL은 단일 transaction으로 두 테이블을 만든다", () => {
  assert.match(migration, /^\s*(?:--[^\n]*\n|\s)*BEGIN;/i);
  assert.match(migration, /COMMIT;\s*$/i);
  assert.equal(count(migration, /CREATE TABLE public\.tb_sp_sync_run\b/g), 1);
  assert.equal(count(migration, /CREATE TABLE public\.tb_sp_sync_item\b/g), 1);
});

test("V1 테이블·작업·설정을 빠짐없이 제거한다", () => {
  for (const table of V1_TABLES) {
    assert.match(migration, new RegExp(`DROP TABLE IF EXISTS public\\.${table}`));
    assert.doesNotMatch(migration, new RegExp(`CREATE TABLE[^;]+${table}`, "i"));
  }
  assert.match(migration, /DELETE FROM public\.tb_ai_task/);
  assert.match(migration, /DELETE FROM public\.tb_pj_project_config/);
  assert.match(migration, /DELETE FROM public\.tb_sys_config_template/);
  for (const key of [
    "SPEC_RECONCILE_GATE_POLICY",
    "SPEC_RECONCILE_DIFF_RETENTION_DAYS",
    "SPEC_RECONCILE_BLOCK_RISKS",
  ]) {
    assert.ok(count(migration, new RegExp(key, "g")) >= 2, `${key} 삭제 누락`);
  }
});

test("DB 제약과 Prisma 모델 이름이 V2 계약과 일치한다", () => {
  for (const constraint of [
    "tb_sp_sync_run_mode_ck",
    "tb_sp_sync_run_sttus_ck",
    "tb_sp_sync_run_snapshot_hash_ck",
    "tb_sp_sync_item_result_axis_ck",
    "tb_sp_sync_item_target_shape_ck",
    "tb_sp_sync_item_axis_target_ck",
    "tb_sp_sync_item_evidence_ck",
    "tb_sp_sync_item_target_field_ck",
    "tb_sp_sync_item_before_hash_ck",
    "tb_sp_sync_item_proposal_result_ck",
    "tb_sp_sync_item_decision_state_ck",
  ]) {
    assert.match(migration, new RegExp(`CONSTRAINT ${constraint}\\b`));
  }
  assert.match(schema, /model TbSpSyncRun[\s\S]*?@@map\("tb_sp_sync_run"\)/);
  assert.match(schema, /model TbSpSyncItem[\s\S]*?@@map\("tb_sp_sync_item"\)/);
  for (const table of V1_TABLES) {
    assert.doesNotMatch(schema, new RegExp(`@@map\\("${table}"\\)`));
  }
});

function count(value, pattern) {
  return [...value.matchAll(pattern)].length;
}
