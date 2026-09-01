import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DIRECT_URL or DATABASE_URL is required");

const workspaceRoot = process.cwd();
const schemaName = `specode_project_boundary_test_${Date.now()}`;
if (!/^specode_project_boundary_test_[0-9]+$/.test(schemaName)) {
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
      env: {
        ...process.env,
        DATABASE_URL: testUrl.toString(),
        DIRECT_URL: testUrl.toString(),
      },
      encoding: "utf8",
      timeout: 120_000,
    },
  );

  if (result.status !== 0) {
    throw new Error(
      [result.error?.message, result.stdout, result.stderr]
        .filter(Boolean)
        .join("\n")
        .trim(),
    );
  }
}

function request(
  pathname: string,
  token: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: unknown,
): NextRequest {
  return new NextRequest(`${appOrigin}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function expectStatus(
  label: string,
  responsePromise: Promise<Response>,
  expectedStatus: number,
): Promise<Response> {
  const response = await responsePromise;
  const payload = await response.clone().text();
  assert.equal(
    response.status,
    expectedStatus,
    `${label}: expected ${expectedStatus}, received ${response.status} (${payload})`,
  );
  return response;
}

async function main(): Promise<void> {
  let appPrisma: PrismaClient | null = null;

  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
    pushTemporarySchema();

    process.env.DATABASE_URL = testUrl.toString();
    process.env.DIRECT_URL = testUrl.toString();
    process.env.APP_URL = appOrigin;
    process.env.JWT_SECRET = "project-boundary-smoke-test-secret-with-sufficient-length";

    const ids = {
      ownerA: randomUUID(),
      memberA: randomUUID(),
      ownerB: randomUUID(),
      sessionOwnerA: randomUUID(),
      sessionMemberA: randomUUID(),
      projectA: randomUUID(),
      projectB: randomUUID(),
      taskA: randomUUID(),
      taskB: randomUUID(),
      requirementA: randomUUID(),
      requirementB: randomUUID(),
      unitWorkA: randomUUID(),
      unitWorkB: randomUUID(),
      screenA: randomUUID(),
      screenB: randomUUID(),
      areaA: randomUUID(),
      areaB: randomUUID(),
      functionA: randomUUID(),
      functionB: randomUUID(),
      tableA: randomUUID(),
      tableB: randomUUID(),
      columnA: randomUUID(),
      columnB: randomUUID(),
      groupA: randomUUID(),
      groupB: randomUUID(),
      mappingA: randomUUID(),
      mappingB: randomUUID(),
      progressA: randomUUID(),
      progressB: randomUUID(),
      studioA: randomUUID(),
      studioB: randomUUID(),
      artifactA: randomUUID(),
      artifactB: randomUUID(),
      reviewA: randomUUID(),
      reviewB: randomUUID(),
      commentB: randomUUID(),
    };

    await testDb.tbCmMember.createMany({
      data: [
        { mber_id: ids.ownerA, email_addr: "owner-a@specode.invalid", mber_nm: "Owner A", mber_sttus_code: "ACTIVE" },
        { mber_id: ids.memberA, email_addr: "member-a@specode.invalid", mber_nm: "Member A", mber_sttus_code: "ACTIVE" },
        { mber_id: ids.ownerB, email_addr: "owner-b@specode.invalid", mber_nm: "Owner B", mber_sttus_code: "ACTIVE" },
      ],
    });
    await testDb.tbCmMemberSession.createMany({
      data: [
        { sesn_id: ids.sessionOwnerA, mber_id: ids.ownerA },
        { sesn_id: ids.sessionMemberA, mber_id: ids.memberA },
      ],
    });
    await testDb.tbPjProject.createMany({
      data: [
        { prjct_id: ids.projectA, prjct_nm: "Boundary Project A", creat_mber_id: ids.ownerA },
        { prjct_id: ids.projectB, prjct_nm: "Boundary Project B", creat_mber_id: ids.ownerB },
      ],
    });
    await testDb.tbPjProjectMember.createMany({
      data: [
        { prjct_id: ids.projectA, mber_id: ids.ownerA, role_code: "OWNER", job_title_code: "PM" },
        { prjct_id: ids.projectA, mber_id: ids.memberA, role_code: "MEMBER", job_title_code: "DEV" },
        { prjct_id: ids.projectB, mber_id: ids.ownerB, role_code: "OWNER", job_title_code: "PM" },
      ],
    });

    await testDb.tbRqTask.createMany({
      data: [
        { task_id: ids.taskA, prjct_id: ids.projectA, task_display_id: "SFR-A", task_nm: "Task A" },
        { task_id: ids.taskB, prjct_id: ids.projectB, task_display_id: "SFR-B", task_nm: "Task B" },
      ],
    });
    await testDb.tbRqRequirement.createMany({
      data: [
        { req_id: ids.requirementA, prjct_id: ids.projectA, task_id: ids.taskA, req_display_id: "REQ-A", req_nm: "Requirement A" },
        { req_id: ids.requirementB, prjct_id: ids.projectB, task_id: ids.taskB, req_display_id: "REQ-B", req_nm: "Requirement B" },
      ],
    });
    await testDb.tbDsUnitWork.createMany({
      data: [
        { unit_work_id: ids.unitWorkA, prjct_id: ids.projectA, req_id: ids.requirementA, unit_work_display_id: "UW-A", unit_work_nm: "Unit Work A" },
        { unit_work_id: ids.unitWorkB, prjct_id: ids.projectB, req_id: ids.requirementB, unit_work_display_id: "UW-B", unit_work_nm: "Unit Work B" },
      ],
    });
    await testDb.tbDsScreen.createMany({
      data: [
        { scrn_id: ids.screenA, prjct_id: ids.projectA, unit_work_id: ids.unitWorkA, scrn_display_id: "SCR-A", scrn_nm: "Screen A" },
        { scrn_id: ids.screenB, prjct_id: ids.projectB, unit_work_id: ids.unitWorkB, scrn_display_id: "SCR-B", scrn_nm: "Screen B" },
      ],
    });
    await testDb.tbDsArea.createMany({
      data: [
        { area_id: ids.areaA, prjct_id: ids.projectA, scrn_id: ids.screenA, area_display_id: "AR-A", area_nm: "Area A" },
        { area_id: ids.areaB, prjct_id: ids.projectB, scrn_id: ids.screenB, area_display_id: "AR-B", area_nm: "Area B" },
      ],
    });
    await testDb.tbDsFunction.createMany({
      data: [
        { func_id: ids.functionA, prjct_id: ids.projectA, area_id: ids.areaA, func_display_id: "FN-A", func_nm: "Function A" },
        { func_id: ids.functionB, prjct_id: ids.projectB, area_id: ids.areaB, func_display_id: "FN-B", func_nm: "Function B" },
      ],
    });
    await testDb.tbCmProgress.createMany({
      data: [
        { progrs_id: ids.progressA, prjct_id: ids.projectA, ref_tbl_nm: "tb_ds_function", ref_id: ids.functionA, design_rt: 11, impl_rt: 22 },
        { progrs_id: ids.progressB, prjct_id: ids.projectB, ref_tbl_nm: "tb_ds_function", ref_id: ids.functionB, design_rt: 77, impl_rt: 88 },
      ],
    });
    await testDb.tbDsDbTable.createMany({
      data: [
        { tbl_id: ids.tableA, prjct_id: ids.projectA, tbl_physcl_nm: "TB_A" },
        { tbl_id: ids.tableB, prjct_id: ids.projectB, tbl_physcl_nm: "TB_B" },
      ],
    });
    await testDb.tbDsDbTableColumn.createMany({
      data: [
        { col_id: ids.columnA, tbl_id: ids.tableA, col_physcl_nm: "COL_A" },
        { col_id: ids.columnB, tbl_id: ids.tableB, col_physcl_nm: "COL_B" },
      ],
    });
    await testDb.tbDsColMappingGroup.createMany({
      data: [
        { grp_id: ids.groupA, ref_ty_code: "FUNCTION", ref_id: ids.functionA, grp_nm: "Group A", sort_ordr: 1 },
        { grp_id: ids.groupB, ref_ty_code: "FUNCTION", ref_id: ids.functionB, grp_nm: "Group B", sort_ordr: 1 },
      ],
    });
    await testDb.tbDsColMapping.createMany({
      data: [
        { mapping_id: ids.mappingA, ref_ty_code: "FUNCTION", ref_id: ids.functionA, grp_id: ids.groupA, col_id: ids.columnA, sort_ordr: 1 },
        { mapping_id: ids.mappingB, ref_ty_code: "FUNCTION", ref_id: ids.functionB, grp_id: ids.groupB, col_id: ids.columnB, sort_ordr: 1 },
      ],
    });
    await testDb.tbDsPlanStudio.createMany({
      data: [
        { plan_studio_id: ids.studioA, prjct_id: ids.projectA, plan_studio_display_id: "PS-A", plan_studio_nm: "Studio A" },
        { plan_studio_id: ids.studioB, prjct_id: ids.projectB, plan_studio_display_id: "PS-B", plan_studio_nm: "Studio B" },
      ],
    });
    await testDb.tbDsPlanStudioArtf.createMany({
      data: [
        { artf_id: ids.artifactA, plan_studio_id: ids.studioA, artf_nm: "Artifact A" },
        { artf_id: ids.artifactB, plan_studio_id: ids.studioB, artf_nm: "Artifact B" },
      ],
    });
    await testDb.tb_ds_review_request.createMany({
      data: [
        {
          review_id: ids.reviewA,
          prjct_id: ids.projectA,
          ref_tbl_nm: "direct",
          ref_id: ids.projectA,
          review_title_nm: "Review A",
          review_cn: "Review A content",
          req_mber_id: ids.ownerA,
          revwr_mber_id: ids.ownerA,
        },
        {
          review_id: ids.reviewB,
          prjct_id: ids.projectB,
          ref_tbl_nm: "direct",
          ref_id: ids.projectB,
          review_title_nm: "Review B",
          review_cn: "Review B content",
          req_mber_id: ids.ownerB,
          revwr_mber_id: ids.ownerB,
        },
      ],
    });
    await testDb.tb_ds_review_comment.create({
      data: {
        coment_id: ids.commentB,
        review_id: ids.reviewB,
        coment_cn: "Comment B content",
        write_mber_id: ids.ownerB,
      },
    });

    const [
      authModule,
      implTreeRoute,
      mappingsRoute,
      groupCollectionRoute,
      groupItemRoute,
      progressRoute,
      artifactCollectionRoute,
      artifactItemRoute,
      artifactGenerateRoute,
      reviewCollectionRoute,
      reviewItemRoute,
      commentCollectionRoute,
      commentItemRoute,
      bulkImportRoute,
      prismaModule,
    ] = await Promise.all([
      import("../src/lib/auth"),
      import("../src/app/api/projects/[id]/impl-tree/route"),
      import("../src/app/api/projects/[id]/col-mappings/route"),
      import("../src/app/api/projects/[id]/col-mapping-groups/route"),
      import("../src/app/api/projects/[id]/col-mapping-groups/[groupId]/route"),
      import("../src/app/api/projects/[id]/phase-progress/route"),
      import("../src/app/api/projects/[id]/plan-studios/[planStudioId]/artifacts/route"),
      import("../src/app/api/projects/[id]/plan-studios/[planStudioId]/artifacts/[artfId]/route"),
      import("../src/app/api/projects/[id]/plan-studios/[planStudioId]/artifacts/[artfId]/generate/route"),
      import("../src/app/api/projects/[id]/reviews/route"),
      import("../src/app/api/projects/[id]/reviews/[reviewId]/route"),
      import("../src/app/api/projects/[id]/reviews/[reviewId]/comments/route"),
      import("../src/app/api/projects/[id]/reviews/[reviewId]/comments/[commentId]/route"),
      import("../src/app/api/projects/[id]/planning/bulk-import/route"),
      import("../src/lib/prisma"),
    ]);
    appPrisma = prismaModule.prisma;

    const ownerToken = authModule.signAccessToken({
      mberId: ids.ownerA,
      email: "owner-a@specode.invalid",
      sesnId: ids.sessionOwnerA,
    });
    const memberToken = authModule.signAccessToken({
      mberId: ids.memberA,
      email: "member-a@specode.invalid",
      sesnId: ids.sessionMemberA,
    });

    let positiveChecks = 0;
    let blockedChecks = 0;
    const positive = async (label: string, response: Promise<Response>) => {
      positiveChecks++;
      return expectStatus(label, response, 200);
    };
    const blocked = async (label: string, response: Promise<Response>, status = 404) => {
      blockedChecks++;
      return expectStatus(label, response, status);
    };

    await positive(
      "A implementation tree positive control",
      implTreeRoute.GET(
        request(`/api/projects/${ids.projectA}/impl-tree?refType=FUNCTION&refId=${ids.functionA}`, ownerToken),
        { params: Promise.resolve({ id: ids.projectA }) },
      ),
    );
    await positive(
      "A progress positive control",
      progressRoute.GET(
        request(`/api/projects/${ids.projectA}/phase-progress?refTable=tb_ds_function&refId=${ids.functionA}`, ownerToken),
        { params: Promise.resolve({ id: ids.projectA }) },
      ),
    );
    await positive(
      "A review positive control",
      reviewItemRoute.GET(
        request(`/api/projects/${ids.projectA}/reviews/${ids.reviewA}`, memberToken),
        { params: Promise.resolve({ id: ids.projectA, reviewId: ids.reviewA }) },
      ),
    );

    for (const [refType, refId] of [
      ["UNIT_WORK", ids.unitWorkB],
      ["SCREEN", ids.screenB],
      ["AREA", ids.areaB],
      ["FUNCTION", ids.functionB],
    ] as const) {
      await blocked(
        `B ${refType} implementation tree through project A`,
        implTreeRoute.GET(
          request(`/api/projects/${ids.projectA}/impl-tree?refType=${refType}&refId=${refId}`, ownerToken),
          { params: Promise.resolve({ id: ids.projectA }) },
        ),
      );
    }

    await blocked(
      "B mappings read through project A",
      mappingsRoute.GET(
        request(`/api/projects/${ids.projectA}/col-mappings?refType=FUNCTION&refId=${ids.functionB}`, ownerToken),
        { params: Promise.resolve({ id: ids.projectA }) },
      ),
    );
    await blocked(
      "B mappings replace through project A",
      mappingsRoute.POST(
        request(`/api/projects/${ids.projectA}/col-mappings`, ownerToken, "POST", {
          refType: "FUNCTION",
          refId: ids.functionB,
          grpId: ids.groupB,
          items: [{ colId: ids.columnB }],
        }),
        { params: Promise.resolve({ id: ids.projectA }) },
      ),
    );
    await blocked(
      "B group attached to A target",
      mappingsRoute.GET(
        request(`/api/projects/${ids.projectA}/col-mappings?refType=FUNCTION&refId=${ids.functionA}&grpId=${ids.groupB}`, ownerToken),
        { params: Promise.resolve({ id: ids.projectA }) },
      ),
    );
    await blocked(
      "B column attached to A mapping",
      mappingsRoute.POST(
        request(`/api/projects/${ids.projectA}/col-mappings`, ownerToken, "POST", {
          refType: "FUNCTION",
          refId: ids.functionA,
          grpId: ids.groupA,
          items: [{ colId: ids.columnB }],
        }),
        { params: Promise.resolve({ id: ids.projectA }) },
      ),
      400,
    );
    await blocked(
      "B mapping groups read through project A",
      groupCollectionRoute.GET(
        request(`/api/projects/${ids.projectA}/col-mapping-groups?refType=FUNCTION&refId=${ids.functionB}`, ownerToken),
        { params: Promise.resolve({ id: ids.projectA }) },
      ),
    );
    await blocked(
      "B mapping group create through project A",
      groupCollectionRoute.POST(
        request(`/api/projects/${ids.projectA}/col-mapping-groups`, ownerToken, "POST", {
          refType: "FUNCTION",
          refId: ids.functionB,
          grpNm: "Injected",
        }),
        { params: Promise.resolve({ id: ids.projectA }) },
      ),
    );
    await blocked(
      "B mapping group update through project A",
      groupItemRoute.PUT(
        request(`/api/projects/${ids.projectA}/col-mapping-groups/${ids.groupB}`, ownerToken, "PUT", { grpNm: "Injected" }),
        { params: Promise.resolve({ id: ids.projectA, groupId: ids.groupB }) },
      ),
    );
    await blocked(
      "B mapping group delete through project A",
      groupItemRoute.DELETE(
        request(`/api/projects/${ids.projectA}/col-mapping-groups/${ids.groupB}`, ownerToken, "DELETE"),
        { params: Promise.resolve({ id: ids.projectA, groupId: ids.groupB }) },
      ),
    );

    await blocked(
      "B progress read through project A",
      progressRoute.GET(
        request(`/api/projects/${ids.projectA}/phase-progress?refTable=tb_ds_function&refId=${ids.functionB}`, ownerToken),
        { params: Promise.resolve({ id: ids.projectA }) },
      ),
    );
    await blocked(
      "B progress update through project A",
      progressRoute.PUT(
        request(`/api/projects/${ids.projectA}/phase-progress?refTable=tb_ds_function&refId=${ids.functionB}`, ownerToken, "PUT", { designRt: 1, implRt: 2 }),
        { params: Promise.resolve({ id: ids.projectA }) },
      ),
    );

    await blocked(
      "B artifact read through project A",
      artifactItemRoute.GET(
        request(`/api/projects/${ids.projectA}/plan-studios/${ids.studioB}/artifacts/${ids.artifactB}`, ownerToken),
        { params: Promise.resolve({ id: ids.projectA, planStudioId: ids.studioB, artfId: ids.artifactB }) },
      ),
    );
    await blocked(
      "B artifact update through project A",
      artifactItemRoute.PUT(
        request(`/api/projects/${ids.projectA}/plan-studios/${ids.studioB}/artifacts/${ids.artifactB}`, ownerToken, "PUT", { artfNm: "Injected" }),
        { params: Promise.resolve({ id: ids.projectA, planStudioId: ids.studioB, artfId: ids.artifactB }) },
      ),
    );
    await blocked(
      "B artifact delete through project A",
      artifactItemRoute.DELETE(
        request(`/api/projects/${ids.projectA}/plan-studios/${ids.studioB}/artifacts/${ids.artifactB}`, ownerToken, "DELETE"),
        { params: Promise.resolve({ id: ids.projectA, planStudioId: ids.studioB, artfId: ids.artifactB }) },
      ),
    );
    await blocked(
      "B artifact AI generate through project A",
      artifactGenerateRoute.POST(
        request(`/api/projects/${ids.projectA}/plan-studios/${ids.studioB}/artifacts/${ids.artifactB}/generate`, ownerToken, "POST", {
          artfNm: "Injected",
          artfDivCode: "IA",
          artfFmtCode: "MD",
          artfIdeaCn: "Injected",
          contexts: [],
        }),
        { params: Promise.resolve({ id: ids.projectA, planStudioId: ids.studioB, artfId: ids.artifactB }) },
      ),
    );
    await blocked(
      "B requirement context on A artifact create",
      artifactCollectionRoute.POST(
        request(`/api/projects/${ids.projectA}/plan-studios/${ids.studioA}/artifacts`, ownerToken, "POST", {
          artfNm: "Injected",
          contexts: [{ ctxtTyCode: "REQ", refId: ids.requirementB, sortOrdr: 0 }],
        }),
        { params: Promise.resolve({ id: ids.projectA, planStudioId: ids.studioA }) },
      ),
      400,
    );
    await blocked(
      "B requirement context on A artifact update",
      artifactItemRoute.PUT(
        request(`/api/projects/${ids.projectA}/plan-studios/${ids.studioA}/artifacts/${ids.artifactA}`, ownerToken, "PUT", {
          artfNm: "Artifact A changed",
          contexts: [{ ctxtTyCode: "REQ", refId: ids.requirementB, sortOrdr: 0 }],
        }),
        { params: Promise.resolve({ id: ids.projectA, planStudioId: ids.studioA, artfId: ids.artifactA }) },
      ),
      400,
    );
    await blocked(
      "B requirement context on A artifact AI generate",
      artifactGenerateRoute.POST(
        request(`/api/projects/${ids.projectA}/plan-studios/${ids.studioA}/artifacts/${ids.artifactA}/generate`, ownerToken, "POST", {
          artfNm: "Artifact A changed",
          artfDivCode: "IA",
          artfFmtCode: "MD",
          artfIdeaCn: "Injected",
          contexts: [{ ctxtTyCode: "REQ", refId: ids.requirementB, sortOrdr: 0 }],
        }),
        { params: Promise.resolve({ id: ids.projectA, planStudioId: ids.studioA, artfId: ids.artifactA }) },
      ),
      400,
    );

    await blocked(
      "B reviewer selected for A review",
      reviewCollectionRoute.POST(
        request(`/api/projects/${ids.projectA}/reviews`, ownerToken, "POST", {
          titleNm: "Injected",
          reviewCn: "Injected",
          revwrMemberId: ids.ownerB,
        }),
        { params: Promise.resolve({ id: ids.projectA }) },
      ),
      400,
    );
    await blocked(
      "B review read through project A",
      reviewItemRoute.GET(
        request(`/api/projects/${ids.projectA}/reviews/${ids.reviewB}`, ownerToken),
        { params: Promise.resolve({ id: ids.projectA, reviewId: ids.reviewB }) },
      ),
    );
    await blocked(
      "B review update through project A",
      reviewItemRoute.PUT(
        request(`/api/projects/${ids.projectA}/reviews/${ids.reviewB}`, ownerToken, "PUT", { resultCn: "Injected" }),
        { params: Promise.resolve({ id: ids.projectA, reviewId: ids.reviewB }) },
      ),
    );
    await blocked(
      "B review delete through project A",
      reviewItemRoute.DELETE(
        request(`/api/projects/${ids.projectA}/reviews/${ids.reviewB}`, ownerToken, "DELETE"),
        { params: Promise.resolve({ id: ids.projectA, reviewId: ids.reviewB }) },
      ),
    );
    await blocked(
      "B comments read through project A",
      commentCollectionRoute.GET(
        request(`/api/projects/${ids.projectA}/reviews/${ids.reviewB}/comments`, ownerToken),
        { params: Promise.resolve({ id: ids.projectA, reviewId: ids.reviewB }) },
      ),
    );
    await blocked(
      "B comment create through project A",
      commentCollectionRoute.POST(
        request(`/api/projects/${ids.projectA}/reviews/${ids.reviewB}/comments`, ownerToken, "POST", { content: "Injected" }),
        { params: Promise.resolve({ id: ids.projectA, reviewId: ids.reviewB }) },
      ),
    );
    await blocked(
      "B comment update through project A",
      commentItemRoute.PUT(
        request(`/api/projects/${ids.projectA}/reviews/${ids.reviewB}/comments/${ids.commentB}`, ownerToken, "PUT", { content: "Injected" }),
        { params: Promise.resolve({ id: ids.projectA, reviewId: ids.reviewB, commentId: ids.commentB }) },
      ),
    );
    await blocked(
      "B comment delete through project A",
      commentItemRoute.DELETE(
        request(`/api/projects/${ids.projectA}/reviews/${ids.reviewB}/comments/${ids.commentB}`, ownerToken, "DELETE"),
        { params: Promise.resolve({ id: ids.projectA, reviewId: ids.reviewB, commentId: ids.commentB }) },
      ),
    );

    await blocked(
      "ordinary member cannot update unrelated A review",
      reviewItemRoute.PUT(
        request(`/api/projects/${ids.projectA}/reviews/${ids.reviewA}`, memberToken, "PUT", { resultCn: "Injected" }),
        { params: Promise.resolve({ id: ids.projectA, reviewId: ids.reviewA }) },
      ),
      403,
    );
    await blocked(
      "ordinary member cannot delete unrelated A review",
      reviewItemRoute.DELETE(
        request(`/api/projects/${ids.projectA}/reviews/${ids.reviewA}`, memberToken, "DELETE"),
        { params: Promise.resolve({ id: ids.projectA, reviewId: ids.reviewA }) },
      ),
      403,
    );

    const bulkResponse = await expectStatus(
      "B task bulk update through project A is skipped",
      bulkImportRoute.POST(
        request(`/api/projects/${ids.projectA}/planning/bulk-import`, ownerToken, "POST", {
          tasks: [{ systemId: ids.taskB, name: "Injected", category: "NEW_DEV" }],
        }),
        { params: Promise.resolve({ id: ids.projectA }) },
      ),
      200,
    );
    const bulkPayload = await bulkResponse.json();
    assert.equal(bulkPayload.data?.result?.skipped?.tasks, 1);
    blockedChecks++;

    assert.deepEqual(
      await testDb.tbCmProgress.findUniqueOrThrow({
        where: { ref_tbl_nm_ref_id: { ref_tbl_nm: "tb_ds_function", ref_id: ids.functionB } },
        select: { design_rt: true, impl_rt: true },
      }),
      { design_rt: 77, impl_rt: 88 },
    );
    assert.equal((await testDb.tbDsColMappingGroup.findUniqueOrThrow({ where: { grp_id: ids.groupB } })).grp_nm, "Group B");
    assert.equal((await testDb.tbDsColMapping.findUniqueOrThrow({ where: { mapping_id: ids.mappingA } })).col_id, ids.columnA);
    assert.equal((await testDb.tbDsPlanStudioArtf.findUniqueOrThrow({ where: { artf_id: ids.artifactA } })).artf_nm, "Artifact A");
    assert.equal((await testDb.tbDsPlanStudioArtf.findUniqueOrThrow({ where: { artf_id: ids.artifactB } })).artf_nm, "Artifact B");
    assert.equal(await testDb.tbDsPlanStudioCtxt.count(), 0);
    assert.equal(await testDb.tbAiTask.count(), 0);
    assert.equal((await testDb.tb_ds_review_request.findUniqueOrThrow({ where: { review_id: ids.reviewA } })).result_cn, null);
    assert.equal((await testDb.tb_ds_review_request.findUniqueOrThrow({ where: { review_id: ids.reviewB } })).result_cn, null);
    assert.equal((await testDb.tb_ds_review_comment.findUniqueOrThrow({ where: { coment_id: ids.commentB } })).coment_cn, "Comment B content");
    assert.equal((await testDb.tbRqTask.findUniqueOrThrow({ where: { task_id: ids.taskB } })).task_nm, "Task B");

    console.log(`PROJECT_BOUNDARY_DB_OK positive=${positiveChecks} blocked=${blockedChecks}`);
  } finally {
    await Promise.allSettled([
      appPrisma?.$disconnect(),
      testDb.$disconnect(),
    ]);
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    const [schemaState] = await admin.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_namespace
        WHERE nspname = ${schemaName}
      ) AS "exists"
    `;
    assert.equal(schemaState?.exists, false, "Temporary project-boundary schema was not removed");
    await admin.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
