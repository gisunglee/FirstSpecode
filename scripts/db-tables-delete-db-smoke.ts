/**
 * db-tables-delete-db-smoke — DB 테이블 삭제(단건/일괄) 기능 스모크 테스트
 *
 * auth-cookie-db-smoke.ts 와 동일 관례: 운영 DB 위에 임시 스키마를 만들어
 * (production 데이터는 전혀 건드리지 않고) 그 안에서 실제 라우트 핸들러를
 * 직접 호출해 검증한 뒤 스키마를 삭제한다.
 *
 * 검증 대상:
 *   1. DELETE [tableId] — 매트릭스 권한(OWNER) 통과 시 삭제 + 매핑 cascade
 *   2. DELETE [tableId] — 매트릭스 미통과 + 담당자 아님 → 403
 *   3. DELETE [tableId] — 매트릭스 미통과 + 담당자 본인 → 허용 (담당자 예외)
 *   4. PUT [tableId] — 컬럼 제거 시 그 컬럼의 col_mapping도 함께 정리되는지
 *   5. DELETE bulk — 여러 테이블을 한 번에, 허용/거부가 섞여도 부분 성공하는지
 *   6. GET usage — 매핑된 테이블의 사용처(함수명)가 제대로 조회되는지
 *   7. PATCH [tableId] — 상태만 데디케이트로 변경, 컬럼은 전혀 건드리지 않는지
 *   8. PATCH [tableId] — 삭제와 동일 권한 게이트(매트릭스 또는 담당자)를 쓰는지
 *   9. POST db-tables — 신규 등록 시 고른 상태가 (컬럼 0개인 경우에도) 실제로 저장되는지
 *  10. PATCH [tableId] — DEPRECATED 외 값은 거부(신규/기존 재분류는 PUT 전용)하는지
 *  11. PUT — 컬럼 상태: 신규 컬럼은 서버가 NEW 자동 부여, 기존 컬럼 데디케이트 토글이 다른 필드를 안 건드리는지
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DIRECT_URL or DATABASE_URL is required");

const workspaceRoot = process.cwd();
const schemaName = `specode_db_tables_delete_test_${Date.now()}`;
if (!/^specode_db_tables_delete_test_[0-9]+$/.test(schemaName)) {
  throw new Error("Unsafe temporary schema name");
}

const testUrl = new URL(databaseUrl);
testUrl.searchParams.set("schema", schemaName);

const admin = new PrismaClient({ datasourceUrl: databaseUrl });
const testDb = new PrismaClient({ datasourceUrl: testUrl.toString() });
const prismaCli = path.join(workspaceRoot, "node_modules", "prisma", "build", "index.js");
const appOrigin = "http://localhost:3000";

function pushTemporarySchema(): void {
  const result = spawnSync(
    process.execPath,
    [prismaCli, "db", "push", "--schema", "prisma/schema.prisma", "--skip-generate"],
    {
      cwd: workspaceRoot,
      env: { ...process.env, DATABASE_URL: testUrl.toString(), DIRECT_URL: testUrl.toString() },
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  if (result.status !== 0) {
    throw new Error([result.error?.message, result.stdout, result.stderr].filter(Boolean).join("\n").trim());
  }
}

function req(
  pathname: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  token: string,
  body?: Record<string, unknown>,
): NextRequest {
  return new NextRequest(`${appOrigin}${pathname}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function main(): Promise<void> {
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
    pushTemporarySchema();

    process.env.DATABASE_URL = testUrl.toString();
    process.env.DIRECT_URL = testUrl.toString();
    process.env.APP_URL = appOrigin;
    process.env.JWT_SECRET = "db-tables-delete-smoke-test-secret-with-sufficient-length";

    const { signAccessToken } = await import("../src/lib/auth");
    const routeTable = await import("../src/app/api/projects/[id]/db-tables/[tableId]/route");
    const routeUsage = await import("../src/app/api/projects/[id]/db-tables/[tableId]/usage/route");
    const routeBulk  = await import("../src/app/api/projects/[id]/db-tables/bulk/route");
    const routeList  = await import("../src/app/api/projects/[id]/db-tables/route");

    // ── 시드: 프로젝트 + 멤버 2명 (OWNER / 권한 없는 MEMBER) ──────────────
    const project = await testDb.tbPjProject.create({ data: { prjct_nm: "스모크 테스트" } });

    const owner = await testDb.tbCmMember.create({
      data: { email_addr: "owner@smoke.invalid", mber_sttus_code: "ACTIVE" },
    });
    const dev = await testDb.tbCmMember.create({
      data: { email_addr: "dev@smoke.invalid", mber_sttus_code: "ACTIVE" },
    });
    await testDb.tbPjProjectMember.create({
      data: { prjct_id: project.prjct_id, mber_id: owner.mber_id, role_code: "OWNER", job_title_code: "ETC" },
    });
    await testDb.tbPjProjectMember.create({
      data: { prjct_id: project.prjct_id, mber_id: dev.mber_id, role_code: "MEMBER", job_title_code: "ETC" },
    });

    const ownerToken = signAccessToken({ mberId: owner.mber_id, email: owner.email_addr!, sesnId: "smoke-owner" });
    const devToken   = signAccessToken({ mberId: dev.mber_id,   email: dev.email_addr!,   sesnId: "smoke-dev" });

    // ── 화면 > 영역 > 기능 (사용처 이름 조회 테스트용) ─────────────────────
    const screen = await testDb.tbDsScreen.create({
      data: { prjct_id: project.prjct_id, scrn_display_id: "S001", scrn_nm: "테스트 화면" },
    });
    const area = await testDb.tbDsArea.create({
      data: { prjct_id: project.prjct_id, scrn_id: screen.scrn_id, area_display_id: "A001", area_nm: "테스트 영역" },
    });
    const func = await testDb.tbDsFunction.create({
      data: { prjct_id: project.prjct_id, area_id: area.area_id, func_display_id: "F001", func_nm: "테스트 기능" },
    });

    // ── 테이블 1: 매핑 없음 → OWNER가 단건 삭제 (기본 happy path) ─────────
    const tableUnused = await testDb.tbDsDbTable.create({
      data: { prjct_id: project.prjct_id, tbl_physcl_nm: "tb_smoke_unused" },
    });
    await testDb.tbDsDbTableColumn.createMany({
      data: [
        { tbl_id: tableUnused.tbl_id, col_physcl_nm: "id" },
        { tbl_id: tableUnused.tbl_id, col_physcl_nm: "nm" },
      ],
    });

    // ── 테이블 2: 컬럼이 기능에 매핑됨 → 사용처 조회 + 삭제 시 매핑 cascade 검증 ──
    const tableMapped = await testDb.tbDsDbTable.create({
      data: { prjct_id: project.prjct_id, tbl_physcl_nm: "tb_smoke_mapped" },
    });
    const mappedCol = await testDb.tbDsDbTableColumn.create({
      data: { tbl_id: tableMapped.tbl_id, col_physcl_nm: "mapped_col" },
    });
    const mappingGroup = await testDb.tbDsColMappingGroup.create({
      data: { ref_ty_code: "FUNCTION", ref_id: func.func_id, grp_nm: "조회 그룹" },
    });
    await testDb.tbDsColMapping.create({
      data: {
        ref_ty_code: "FUNCTION", ref_id: func.func_id, grp_id: mappingGroup.grp_id,
        col_id: mappedCol.col_id, io_se_code: "OUTPUT",
      },
    });

    // ── 테이블 3: dev 담당 → dev가 단건 삭제 (담당자 예외로 허용되어야 함) ──
    const tableAssignedToDev = await testDb.tbDsDbTable.create({
      data: { prjct_id: project.prjct_id, tbl_physcl_nm: "tb_smoke_assigned", asign_mber_id: dev.mber_id },
    });

    // ── 테이블 4: 아무도 담당 아님 → dev가 삭제 시도 시 거부되어야 함 ──────
    const tableNotAssigned = await testDb.tbDsDbTable.create({
      data: { prjct_id: project.prjct_id, tbl_physcl_nm: "tb_smoke_not_assigned" },
    });

    // ── 테이블 5: PUT 으로 컬럼 하나를 제거 — 그 컬럼의 매핑도 같이 지워지는지 ──
    const tableForPut = await testDb.tbDsDbTable.create({
      data: { prjct_id: project.prjct_id, tbl_physcl_nm: "tb_smoke_put" },
    });
    const keepCol = await testDb.tbDsDbTableColumn.create({
      data: { tbl_id: tableForPut.tbl_id, col_physcl_nm: "keep_col" },
    });
    const dropCol = await testDb.tbDsDbTableColumn.create({
      data: { tbl_id: tableForPut.tbl_id, col_physcl_nm: "drop_col" },
    });
    const putMappingGroup = await testDb.tbDsColMappingGroup.create({
      data: { ref_ty_code: "FUNCTION", ref_id: func.func_id, grp_nm: "저장 그룹" },
    });
    await testDb.tbDsColMapping.create({
      data: {
        ref_ty_code: "FUNCTION", ref_id: func.func_id, grp_id: putMappingGroup.grp_id,
        col_id: dropCol.col_id, io_se_code: "INPUT",
      },
    });

    // ═══ 1. GET usage — 매핑된 테이블의 사용처가 기능명으로 조회되는지 ═══
    const usageRes = await routeUsage.GET(
      req(`/api/projects/${project.prjct_id}/db-tables/${tableMapped.tbl_id}/usage`, "GET", ownerToken),
      { params: Promise.resolve({ id: project.prjct_id, tableId: tableMapped.tbl_id }) },
    );
    assert.equal(usageRes.status, 200);
    const usageBody = await usageRes.json();
    assert.equal(usageBody.data.summary.functionCount, 1);
    assert.equal(usageBody.data.usedBy[0].refName, "테스트 기능");
    console.log("  [OK] GET usage — 매핑된 기능명 정상 조회");

    // ═══ 2. DELETE [tableId] — dev(권한 없음, 담당자 아님) → 403 ═══
    const deniedRes = await routeTable.DELETE(
      req(`/api/projects/${project.prjct_id}/db-tables/${tableNotAssigned.tbl_id}`, "DELETE", devToken),
      { params: Promise.resolve({ id: project.prjct_id, tableId: tableNotAssigned.tbl_id }) },
    );
    assert.equal(deniedRes.status, 403);
    assert.equal(
      await testDb.tbDsDbTable.count({ where: { tbl_id: tableNotAssigned.tbl_id } }),
      1,
      "권한 없는 삭제는 실제로 지워지면 안 됨",
    );
    console.log("  [OK] DELETE 단건 — 권한/담당자 아닌 사용자는 403");

    // ═══ 3. DELETE [tableId] — dev(담당자 본인) → 허용 ═══
    const assigneeDeleteRes = await routeTable.DELETE(
      req(`/api/projects/${project.prjct_id}/db-tables/${tableAssignedToDev.tbl_id}`, "DELETE", devToken),
      { params: Promise.resolve({ id: project.prjct_id, tableId: tableAssignedToDev.tbl_id }) },
    );
    assert.equal(assigneeDeleteRes.status, 200);
    assert.equal(
      await testDb.tbDsDbTable.count({ where: { tbl_id: tableAssignedToDev.tbl_id } }),
      0,
    );
    console.log("  [OK] DELETE 단건 — 담당자 본인은 매트릭스 권한 없어도 삭제 허용");

    // ═══ 4. DELETE [tableId] — owner, 매핑 있는 테이블 → 매핑도 같이 사라짐 ═══
    const mappedDeleteRes = await routeTable.DELETE(
      req(`/api/projects/${project.prjct_id}/db-tables/${tableMapped.tbl_id}`, "DELETE", ownerToken),
      { params: Promise.resolve({ id: project.prjct_id, tableId: tableMapped.tbl_id }) },
    );
    assert.equal(mappedDeleteRes.status, 200);
    assert.equal(await testDb.tbDsDbTable.count({ where: { tbl_id: tableMapped.tbl_id } }), 0);
    assert.equal(
      await testDb.tbDsColMapping.count({ where: { col_id: mappedCol.col_id } }),
      0,
      "테이블 삭제 시 그 컬럼을 가리키던 매핑도 같이 지워져야 함 (유령 행 방지)",
    );
    console.log("  [OK] DELETE 단건 — 삭제 시 col_mapping cascade 정리됨");

    // ═══ 5. PUT [tableId] — 컬럼 제거 시 그 컬럼의 매핑도 정리되는지 ═══
    const putRes = await routeTable.PUT(
      req(`/api/projects/${project.prjct_id}/db-tables/${tableForPut.tbl_id}`, "PUT", ownerToken, {
        tblPhysclNm: "tb_smoke_put",
        columns: [{ colId: keepCol.col_id, colPhysclNm: "keep_col" }], // dropCol 은 목록에서 빠짐 = 삭제 의도
      }),
      { params: Promise.resolve({ id: project.prjct_id, tableId: tableForPut.tbl_id }) },
    );
    assert.equal(putRes.status, 200);
    assert.equal(
      await testDb.tbDsDbTableColumn.count({ where: { col_id: dropCol.col_id } }),
      0,
    );
    assert.equal(
      await testDb.tbDsColMapping.count({ where: { col_id: dropCol.col_id } }),
      0,
      "PUT으로 컬럼을 지울 때도 그 컬럼의 매핑이 유령 행으로 남으면 안 됨",
    );
    console.log("  [OK] PUT — 컬럼 개별 삭제 시에도 col_mapping cascade 정리됨");

    // ═══ 6. DELETE bulk — owner가 [unused(허용), notAssigned는 이미 없음] ═══
    // notAssigned 는 2번 케이스에서 지워지지 않았으므로 그대로 존재 — 여기서 owner 권한으로 같이 삭제
    const bulkRes = await routeBulk.DELETE(
      req(`/api/projects/${project.prjct_id}/db-tables/bulk`, "DELETE", ownerToken, {
        tableIds: [tableUnused.tbl_id, tableNotAssigned.tbl_id],
      }),
      { params: Promise.resolve({ id: project.prjct_id }) },
    );
    assert.equal(bulkRes.status, 200);
    const bulkBody = await bulkRes.json();
    assert.equal(bulkBody.data.deleted.length, 2);
    assert.equal(bulkBody.data.failed.length, 0);
    assert.equal(
      await testDb.tbDsDbTable.count({
        where: { tbl_id: { in: [tableUnused.tbl_id, tableNotAssigned.tbl_id] } },
      }),
      0,
    );
    console.log("  [OK] DELETE bulk — OWNER 는 여러 테이블 한 번에 정상 삭제");

    // ═══ 7. DELETE bulk — dev가 [담당(허용) + 권한없는 나머지(거부)] 섞어서 요청 → 부분 성공 ═══
    const tableDevOwns = await testDb.tbDsDbTable.create({
      data: { prjct_id: project.prjct_id, tbl_physcl_nm: "tb_smoke_dev_owns", asign_mber_id: dev.mber_id },
    });
    const tableDevNoAccess = await testDb.tbDsDbTable.create({
      data: { prjct_id: project.prjct_id, tbl_physcl_nm: "tb_smoke_dev_no_access" },
    });
    const partialRes = await routeBulk.DELETE(
      req(`/api/projects/${project.prjct_id}/db-tables/bulk`, "DELETE", devToken, {
        tableIds: [tableDevOwns.tbl_id, tableDevNoAccess.tbl_id],
      }),
      { params: Promise.resolve({ id: project.prjct_id }) },
    );
    assert.equal(partialRes.status, 200);
    const partialBody = await partialRes.json();
    assert.equal(partialBody.data.deleted.length, 1);
    assert.equal(partialBody.data.deleted[0].tblId, tableDevOwns.tbl_id);
    assert.equal(partialBody.data.failed.length, 1);
    assert.equal(partialBody.data.failed[0].tblId, tableDevNoAccess.tbl_id);
    assert.equal(await testDb.tbDsDbTable.count({ where: { tbl_id: tableDevOwns.tbl_id } }), 0);
    assert.equal(await testDb.tbDsDbTable.count({ where: { tbl_id: tableDevNoAccess.tbl_id } }), 1);
    console.log("  [OK] DELETE bulk — 담당 테이블만 삭제되고 권한 없는 테이블은 부분 실패로 보고됨");

    // ═══ 8. PATCH [tableId] — 상태만 데디케이트로 변경, 컬럼은 그대로 ═══
    const tableForPatch = await testDb.tbDsDbTable.create({
      data: { prjct_id: project.prjct_id, tbl_physcl_nm: "tb_smoke_patch" },
    });
    const patchCol = await testDb.tbDsDbTableColumn.create({
      data: { tbl_id: tableForPatch.tbl_id, col_physcl_nm: "untouched_col" },
    });

    // dev(권한 없음, 담당자 아님)가 시도하면 삭제와 동일하게 403
    const patchDeniedRes = await routeTable.PATCH(
      req(`/api/projects/${project.prjct_id}/db-tables/${tableForPatch.tbl_id}`, "PATCH", devToken, {
        tblSttusCode: "DEPRECATED",
      }),
      { params: Promise.resolve({ id: project.prjct_id, tableId: tableForPatch.tbl_id }) },
    );
    assert.equal(patchDeniedRes.status, 403);
    assert.equal(
      (await testDb.tbDsDbTable.findUniqueOrThrow({ where: { tbl_id: tableForPatch.tbl_id } })).tbl_sttus_code,
      "EXISTING",
      "권한 없는 상태 변경은 실제로 반영되면 안 됨",
    );
    console.log("  [OK] PATCH — 삭제와 동일 권한 게이트 사용 (권한 없는 사용자는 403)");

    // owner가 데디케이트로 변경 — 컬럼/매핑은 전혀 건드리지 않아야 함
    const patchRes = await routeTable.PATCH(
      req(`/api/projects/${project.prjct_id}/db-tables/${tableForPatch.tbl_id}`, "PATCH", ownerToken, {
        tblSttusCode: "DEPRECATED",
      }),
      { params: Promise.resolve({ id: project.prjct_id, tableId: tableForPatch.tbl_id }) },
    );
    assert.equal(patchRes.status, 200);
    const patched = await testDb.tbDsDbTable.findUniqueOrThrow({ where: { tbl_id: tableForPatch.tbl_id } });
    assert.equal(patched.tbl_sttus_code, "DEPRECATED");
    assert.equal(
      await testDb.tbDsDbTableColumn.count({ where: { col_id: patchCol.col_id } }),
      1,
      "PATCH는 상태 필드 하나만 바꿔야 함 — 컬럼이 지워지면 안 됨",
    );
    // 이력에도 남는지 (같은 recordRevision 경로 재사용 확인)
    const patchRevisionCount = await testDb.tbDsDbTableRevision.count({
      where: { tbl_id: tableForPatch.tbl_id, chg_type_code: "UPDATE" },
    });
    assert.ok(patchRevisionCount >= 1, "상태 변경도 리비전 이력에 남아야 함");
    console.log("  [OK] PATCH — 상태만 바뀌고 컬럼은 그대로, 리비전 이력도 기록됨");

    // ═══ 9. POST db-tables — 컬럼 0개로 등록해도 고른 상태가 저장되는지 ═══
    // (신규 등록 폼에서 컬럼 없이 저장하면 상태 선택이 조용히 사라지던 버그 회귀 방지)
    const createRes = await routeList.POST(
      req(`/api/projects/${project.prjct_id}/db-tables`, "POST", ownerToken, {
        tblPhysclNm: "tb_smoke_new_no_cols",
        tblSttusCode: "NEW",
      }),
      { params: Promise.resolve({ id: project.prjct_id }) },
    );
    assert.equal(createRes.status, 201);
    const createBody = await createRes.json();
    const created = await testDb.tbDsDbTable.findUniqueOrThrow({ where: { tbl_id: createBody.data.tblId } });
    assert.equal(created.tbl_sttus_code, "NEW", "컬럼 0개로 등록해도 고른 상태가 그대로 저장돼야 함");
    console.log("  [OK] POST db-tables — 컬럼 없이 등록해도 상태 선택이 유실되지 않음");

    // ═══ 10. PATCH [tableId] — DEPRECATED 외 값은 거부 (신규/기존 재분류는 PUT 전용) ═══
    const patchRejectNewRes = await routeTable.PATCH(
      req(`/api/projects/${project.prjct_id}/db-tables/${created.tbl_id}`, "PATCH", ownerToken, {
        tblSttusCode: "NEW",
      }),
      { params: Promise.resolve({ id: project.prjct_id, tableId: created.tbl_id }) },
    );
    assert.equal(patchRejectNewRes.status, 400, "PATCH는 DEPRECATED 외 값을 거부해야 함 (재분류는 PUT 전용)");
    console.log("  [OK] PATCH — DEPRECATED 외 상태값은 거부됨 (신규/기존 재분류는 PUT으로만)");

    // ═══ 11. PUT — 컬럼 상태(신규/데디케이트) ═══
    const tableForColStatus = await testDb.tbDsDbTable.create({
      data: { prjct_id: project.prjct_id, tbl_physcl_nm: "tb_smoke_col_status" },
    });
    const existingCol = await testDb.tbDsDbTableColumn.create({
      data: { tbl_id: tableForColStatus.tbl_id, col_physcl_nm: "old_col" },
    });

    // 11-a. 신규 컬럼(colId 없음)은 클라이언트가 뭘 보내든 서버가 무조건 NEW로 부여
    const addColRes = await routeTable.PUT(
      req(`/api/projects/${project.prjct_id}/db-tables/${tableForColStatus.tbl_id}`, "PUT", ownerToken, {
        tblPhysclNm: "tb_smoke_col_status",
        columns: [
          { colId: existingCol.col_id, colPhysclNm: "old_col" },
          { colPhysclNm: "brand_new_col", colSttusCode: "DEPRECATED" }, // 무시되고 NEW로 강제되어야 함
        ],
      }),
      { params: Promise.resolve({ id: project.prjct_id, tableId: tableForColStatus.tbl_id }) },
    );
    assert.equal(addColRes.status, 200);
    const colsAfterAdd = await testDb.tbDsDbTableColumn.findMany({
      where: { tbl_id: tableForColStatus.tbl_id },
      orderBy: { sort_ordr: "asc" },
    });
    const newCol = colsAfterAdd.find((c) => c.col_physcl_nm === "brand_new_col");
    assert.equal(newCol?.col_sttus_code, "NEW", "신규 컬럼은 클라이언트 값과 무관하게 NEW로 강제되어야 함");
    const oldColAfter = colsAfterAdd.find((c) => c.col_id === existingCol.col_id);
    assert.equal(oldColAfter?.col_sttus_code, "EXISTING", "colSttusCode를 안 보낸 기존 컬럼은 그대로 유지되어야 함");
    console.log("  [OK] PUT — 신규 컬럼은 NEW 자동 부여, 값 안 보낸 기존 컬럼은 그대로");

    // 11-b. 기존 컬럼을 데디케이트로 토글 — 다른 필드는 그대로여야 함
    const deprecateColRes = await routeTable.PUT(
      req(`/api/projects/${project.prjct_id}/db-tables/${tableForColStatus.tbl_id}`, "PUT", ownerToken, {
        tblPhysclNm: "tb_smoke_col_status",
        columns: [
          { colId: existingCol.col_id, colPhysclNm: "old_col", colSttusCode: "DEPRECATED" },
          { colId: newCol!.col_id, colPhysclNm: "brand_new_col" },
        ],
      }),
      { params: Promise.resolve({ id: project.prjct_id, tableId: tableForColStatus.tbl_id }) },
    );
    assert.equal(deprecateColRes.status, 200);
    const oldColFinal = await testDb.tbDsDbTableColumn.findUniqueOrThrow({ where: { col_id: existingCol.col_id } });
    assert.equal(oldColFinal.col_sttus_code, "DEPRECATED");
    assert.equal(oldColFinal.col_physcl_nm, "old_col", "상태 토글이 다른 필드를 건드리면 안 됨");
    console.log("  [OK] PUT — 기존 컬럼 데디케이트 토글 정상 반영, 다른 필드 영향 없음");

    console.log("DB_TABLES_DELETE_DB_SMOKE_OK");
  } finally {
    await Promise.allSettled([testDb.$disconnect()]);
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await admin.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
