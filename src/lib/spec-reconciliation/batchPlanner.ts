/**
 * 대형 UW를 하나의 receipt 안에서 의미 단위 AI 배치로 계획한다.
 *
 * 전체 원문을 한 프롬프트에 넣지 않는다. 서버가 크기·연결지도를 먼저 계산하고,
 * 연결되지 않은 파일만 가벼운 AI router에 맡긴다. 실제 분석 태스크는 배치에 필요한
 * source evidence와 설계 원문만 받는다.
 */

import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashOf } from "@/lib/impl-request/diff/normalizer";
import {
  BATCH_LIMITS,
  type AnalysisScope,
  type BatchScope,
  type BatchTargetRef,
  type EvidenceFile,
  type FileAssignment,
} from "./batchContracts";
import {
  buildBatchDefinitions,
  chunkTargets,
  dedupeTargets,
  fitsTargetBudget,
  makeScope,
  selectEvidenceParts,
} from "./batchPartitioner";

type DbClient = Prisma.TransactionClient | typeof prisma;

type QueueBatchAnalysisInput = {
  receiptId: string;
  projectId: string;
  memberId: string;
  scope?: AnalysisScope;
  replaceExisting?: boolean;
};

type PlanningState = {
  runId: string;
  receiptId: string;
  projectId: string;
  memberId: string;
  instruction: string | null;
  files: EvidenceFile[];
  scopes: BatchScope[];
  assignments: FileAssignment[];
};

export class BatchPlanningError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

export async function queueReconciliationBatchAnalysis(
  input: QueueBatchAnalysisInput,
) {
  const receipt = await prisma.tbSpImplReceipt.findFirst({
    where: { receipt_id: input.receiptId, prjct_id: input.projectId },
    select: {
      receipt_id: true,
      prjct_id: true,
      receipt_sttus_code: true,
      review_sttus_code: true,
      source_evidence_data: true,
      selected_target_data: true,
      analysis_scope_data: true,
      submit_mber_id: true,
      ai_task_id: true,
      items: { select: { item_sttus_code: true } },
      batches: {
        where: { batch_sttus_code: { not: "SUPERSEDED" } },
        orderBy: { batch_no: "asc" },
        select: {
          batch_id: true,
          batch_sttus_code: true,
          ai_task_id: true,
        },
      },
      aiTask: {
        select: {
          implSnapshots: {
            select: {
              ref_tbl_nm: true,
              ref_id: true,
              content_hash: true,
              raw_cn: true,
            },
          },
        },
      },
    },
  });
  if (!receipt || !["NEEDS_REVIEW", "DRAFT"].includes(receipt.receipt_sttus_code)) {
    throw new BatchPlanningError(
      "RECEIPT_NOT_ANALYZABLE",
      "배치 분석 가능한 receipt를 찾을 수 없습니다.",
      404,
    );
  }
  if (
    receipt.items.some(
      (item) => !["PENDING", "STALE_SPEC", "BATCH_CONFLICT"].includes(item.item_sttus_code),
    )
  ) {
    throw new BatchPlanningError(
      "DECISION_ALREADY_STARTED",
      "사람의 결정이 시작된 receipt는 전체 배치 분석으로 덮어쓸 수 없습니다.",
    );
  }
  if (receipt.batches.length > 0 && !input.replaceExisting) {
    return {
      receiptId: receipt.receipt_id,
      idempotent: true,
      batches: receipt.batches.map((batch) => ({
        batchId: batch.batch_id,
        status: batch.batch_sttus_code,
        taskId: batch.ai_task_id,
      })),
    };
  }
  if (receipt.items.length > 0 && !input.replaceExisting) {
    throw new BatchPlanningError(
      "RECEIPT_ITEMS_EXIST",
      "기존 후보를 자동 비교 결과로 교체하려면 replaceExisting=true가 필요합니다.",
    );
  }

  const storedScope = asRecord(receipt.analysis_scope_data);
  const scope: AnalysisScope = {
    unitWorkRef:
      input.scope?.unitWorkRef ?? stringValue(storedScope?.unitWorkRef) ?? undefined,
    changedPaths:
      input.scope?.changedPaths ?? stringArray(storedScope?.changedPaths),
    includeProjectIndex:
      input.scope?.includeProjectIndex ?? booleanValue(storedScope?.includeProjectIndex),
    instruction:
      input.scope?.instruction ?? stringValue(storedScope?.instruction) ?? undefined,
    autoBatch: input.scope?.autoBatch ?? true,
  };
  const files = extractEvidenceFiles(
    receipt.source_evidence_data,
    scope.changedPaths ?? [],
  );
  if (files.length === 0) {
    throw new BatchPlanningError(
      "SOURCE_EVIDENCE_REQUIRED",
      "배치 분석할 변경 파일 경로가 source evidence에 없습니다.",
      400,
    );
  }
  if (files.length > BATCH_LIMITS.maxChangedPaths) {
    throw new BatchPlanningError(
      "BATCH_PATH_LIMIT_EXCEEDED",
      `변경 파일이 ${BATCH_LIMITS.maxChangedPaths}개를 초과했습니다. 증거 패키지를 나눠 제출해 주세요.`,
      413,
    );
  }

  const snapshotOverrides = new Map(
    (receipt.aiTask?.implSnapshots ?? []).map((snapshot) => [
      snapshotKey(snapshot.ref_tbl_nm, snapshot.ref_id),
      {
        description: snapshot.raw_cn,
        descriptionHash: snapshot.content_hash.trim(),
      },
    ]),
  );
  const scopes = await loadBatchScopes(
    prisma,
    input.projectId,
    scope.unitWorkRef ?? null,
    snapshotOverrides,
  );
  const links = await prisma.tbSpSpecSourceLink.findMany({
    where: {
      prjct_id: input.projectId,
      source_path: { in: files.map((file) => file.path) },
      use_yn: "Y",
    },
    select: {
      source_path: true,
      target_ref_ty_code: true,
      target_ref_id: true,
      confidence_code: true,
    },
    take: 10_000,
  });
  const targetToScopes = buildTargetToScopes(scopes);
  const linksByPath = new Map<string, typeof links>();
  for (const link of links) {
    const current = linksByPath.get(link.source_path) ?? [];
    current.push(link);
    linksByPath.set(link.source_path, current);
  }
  const assignments: FileAssignment[] = [];
  const unresolved: EvidenceFile[] = [];
  for (const file of files) {
    const scopeKeys = Array.from(new Set(
      (linksByPath.get(file.path) ?? [])
        .filter((link) => ["HIGH", "CONFIRMED"].includes(link.confidence_code))
        .flatMap((link) =>
          targetToScopes.get(`${link.target_ref_ty_code}:${link.target_ref_id}`) ?? [],
        ),
    ));
    if (scopeKeys.length > 0) {
      assignments.push({
        path: file.path,
        scopeKeys,
        shared: scopeKeys.length > 1,
        confidence: "HIGH",
        reason: "확정된 스펙-소스 연결지도",
      });
    } else {
      unresolved.push(file);
    }
  }

  if (unresolved.length > 0 && scopes.length === 1) {
    assignments.push(...unresolved.map((file) => ({
      path: file.path,
      scopeKeys: [scopes[0].key],
      shared: false,
      confidence: "MEDIUM" as const,
      reason: "선택 범위에 분석 scope가 하나뿐임",
    })));
    unresolved.length = 0;
  }

  const state: PlanningState = {
    runId: randomUUID(),
    receiptId: receipt.receipt_id,
    projectId: receipt.prjct_id,
    memberId: input.memberId || receipt.submit_mber_id || "",
    instruction: scope.instruction ?? null,
    files,
    scopes,
    assignments,
  };
  if (!state.memberId) {
    throw new BatchPlanningError(
      "ANALYSIS_OWNER_REQUIRED",
      "배치 AI 태스크 소유자를 확인할 수 없습니다.",
      412,
    );
  }

  return prisma.$transaction(async (tx) => {
    await lockReceiptForPlanning(tx, receipt.receipt_id);
    const [activeBatches, currentItems] = await Promise.all([
      tx.tbSpReconcileBatch.findMany({
        where: {
          receipt_id: receipt.receipt_id,
          batch_sttus_code: { not: "SUPERSEDED" },
        },
        orderBy: { batch_no: "asc" },
        select: {
          batch_id: true,
          batch_sttus_code: true,
          ai_task_id: true,
        },
      }),
      tx.tbSpReconcileItem.findMany({
        where: { receipt_id: receipt.receipt_id },
        select: { item_sttus_code: true },
      }),
    ]);
    if (currentItems.some((item) =>
      !["PENDING", "STALE_SPEC", "BATCH_CONFLICT"].includes(
        item.item_sttus_code,
      ),
    )) {
      throw new BatchPlanningError(
        "DECISION_ALREADY_STARTED",
        "사람의 결정이 시작된 receipt는 전체 배치 분석으로 덮어쓸 수 없습니다.",
      );
    }
    if (activeBatches.length > 0 && !input.replaceExisting) {
      return {
        receiptId: receipt.receipt_id,
        idempotent: true,
        batches: activeBatches.map((batch) => ({
          batchId: batch.batch_id,
          status: batch.batch_sttus_code,
          taskId: batch.ai_task_id,
        })),
      };
    }
    if (currentItems.length > 0 && !input.replaceExisting) {
      throw new BatchPlanningError(
        "RECEIPT_ITEMS_EXIST",
        "기존 후보를 자동 비교 결과로 교체하려면 replaceExisting=true가 필요합니다.",
      );
    }
    if (input.replaceExisting && activeBatches.length > 0) {
      const taskIds = activeBatches
        .map((batch) => batch.ai_task_id)
        .filter((value): value is string => Boolean(value));
      if (taskIds.length > 0) {
        await tx.tbAiTask.updateMany({
          where: {
            ai_task_id: { in: taskIds },
            task_sttus_code: { in: ["PENDING", "IN_PROGRESS"] },
          },
          data: { task_sttus_code: "CANCELLED", compl_dt: new Date() },
        });
      }
      await tx.tbSpReconcileBatch.updateMany({
        where: {
          receipt_id: receipt.receipt_id,
          batch_sttus_code: { not: "SUPERSEDED" },
        },
        data: {
          batch_sttus_code: "SUPERSEDED",
          compl_dt: new Date(),
          mdfcn_dt: new Date(),
        },
      });
    }
    await tx.tbSpImplReceipt.update({
      where: { receipt_id: receipt.receipt_id },
      data: {
        review_sttus_code: "ANALYZING",
        analysis_scope_data: scope as Prisma.InputJsonValue,
        mdfcn_dt: new Date(),
      },
    });

    if (
      unresolved.length > 0 &&
      scopes.length > 1 &&
      (scope.includeProjectIndex || snapshotOverrides.size > 0)
    ) {
      const router = await createRouterTask(tx, state, unresolved);
      return {
        receiptId: receipt.receipt_id,
        idempotent: false,
        routingRequired: true,
        batches: [router],
      };
    }
    const batches = await createAnalysisBatches(tx, state, assignments);
    return {
      receiptId: receipt.receipt_id,
      idempotent: false,
      routingRequired: false,
      batches,
    };
  });
}

export async function createAnalysisBatchesFromRouter(
  tx: Prisma.TransactionClient,
  routerBatchId: string,
  assignments: FileAssignment[],
) {
  const receiptLock = await tx.tbSpReconcileBatch.findUnique({
    where: { batch_id: routerBatchId },
    select: { receipt_id: true },
  });
  if (receiptLock) {
    await lockReceiptForPlanning(tx, receiptLock.receipt_id);
  }
  const routerBatch = await tx.tbSpReconcileBatch.findUnique({
    where: { batch_id: routerBatchId },
    select: {
      batch_id: true,
      receipt_id: true,
      prjct_id: true,
      scope_ty_code: true,
      ai_task_id: true,
      routing_data: true,
      batch_sttus_code: true,
      receipt: {
        select: {
          submit_mber_id: true,
          analysis_scope_data: true,
          source_evidence_data: true,
          ai_task_id: true,
          aiTask: {
            select: {
              implSnapshots: {
                select: {
                  ref_tbl_nm: true,
                  ref_id: true,
                  content_hash: true,
                  raw_cn: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (
    !routerBatch ||
    routerBatch.scope_ty_code !== "ROUTER" ||
    routerBatch.batch_sttus_code === "SUPERSEDED"
  ) {
    throw new BatchPlanningError(
      "ROUTER_BATCH_NOT_FOUND",
      "라우팅 배치를 찾을 수 없습니다.",
      404,
    );
  }
  const routing = asRecord(routerBatch.routing_data);
  const unitWorkRef = stringValue(routing?.unitWorkRef);
  const files = extractEvidenceFiles(routerBatch.receipt.source_evidence_data, []);
  const snapshotOverrides = new Map(
    (routerBatch.receipt.aiTask?.implSnapshots ?? []).map((snapshot) => [
      snapshotKey(snapshot.ref_tbl_nm, snapshot.ref_id),
      {
        description: snapshot.raw_cn,
        descriptionHash: snapshot.content_hash.trim(),
      },
    ]),
  );
  const scopes = await loadBatchScopes(
    tx,
    routerBatch.prjct_id,
    unitWorkRef,
    snapshotOverrides,
  );
  const known = parseAssignments(routing?.knownAssignments);
  const normalized = normalizeRouterAssignments(files, scopes, [
    ...known,
    ...assignments,
  ]);
  await tx.tbSpReconcileBatch.update({
    where: { batch_id: routerBatchId },
    data: {
      batch_sttus_code: "COMPLETED",
      analysis_result_data: { assignments: normalized },
      compl_dt: new Date(),
      mdfcn_dt: new Date(),
    },
  });
  const scopeData = asRecord(routerBatch.receipt.analysis_scope_data);
  const state: PlanningState = {
    runId: stringValue(routing?.runId) ?? randomUUID(),
    receiptId: routerBatch.receipt_id,
    projectId: routerBatch.prjct_id,
    memberId: routerBatch.receipt.submit_mber_id ?? "",
    instruction: stringValue(scopeData?.instruction),
    files,
    scopes,
    assignments: normalized,
  };
  if (!state.memberId) {
    throw new BatchPlanningError(
      "ANALYSIS_OWNER_REQUIRED",
      "배치 AI 태스크 소유자를 확인할 수 없습니다.",
      412,
    );
  }
  return createAnalysisBatches(tx, state, normalized, 2, routerBatch.ai_task_id);
}

export async function retryReconciliationBatch(
  tx: Prisma.TransactionClient,
  batchId: string,
  memberId: string,
) {
  await tx.$queryRaw(Prisma.sql`
    SELECT batch_id
    FROM tb_sp_reconcile_batch
    WHERE batch_id = ${batchId}
    FOR UPDATE
  `);
  const batch = await tx.tbSpReconcileBatch.findUnique({
    where: { batch_id: batchId },
    select: {
      batch_id: true,
      receipt_id: true,
      prjct_id: true,
      scope_ty_code: true,
      scope_nm: true,
      source_paths_data: true,
      target_refs_data: true,
      routing_data: true,
      metrics_data: true,
      batch_sttus_code: true,
      retry_cnt: true,
      receipt: { select: { source_evidence_data: true, analysis_scope_data: true } },
    },
  });
  if (!batch || batch.batch_sttus_code !== "FAILED") {
    throw new BatchPlanningError(
      "BATCH_NOT_RETRYABLE",
      "재시도 가능한 배치를 찾을 수 없습니다.",
      409,
    );
  }
  const allFiles = extractEvidenceFiles(batch.receipt.source_evidence_data, []);
  const routing = asRecord(batch.routing_data);
  const files = selectEvidenceParts(
    allFiles,
    routing?.evidenceParts,
    stringArray(batch.source_paths_data),
  );
  const targets = parseTargetRefs(batch.target_refs_data);
  const scopeData = asRecord(batch.receipt.analysis_scope_data);
  const task = await tx.tbAiTask.create({
    data: {
      prjct_id: batch.prjct_id,
      ref_ty_code:
        batch.scope_ty_code === "ROUTER"
          ? "SPEC_RECONCILIATION_ROUTER"
          : "SPEC_RECONCILIATION_BATCH",
      ref_id: batch.batch_id,
      task_ty_code: "CUSTOM",
      req_cn:
        batch.scope_ty_code === "ROUTER"
          ? buildRouterPromptFromStored(batch)
          : buildBatchAnalysisPrompt({
              receiptId: batch.receipt_id,
              batchId: batch.batch_id,
              scopeName: batch.scope_nm,
              files,
              targets,
              instruction: stringValue(scopeData?.instruction),
            }),
      req_snapshot_data: {
        retryOfBatchId: batch.batch_id,
        retryNo: batch.retry_cnt + 1,
      },
      req_mber_id: memberId,
      task_sttus_code: "PENDING",
    },
  });
  await tx.tbSpReconcileBatch.update({
    where: { batch_id: batch.batch_id },
    data: {
      ai_task_id: task.ai_task_id,
      batch_sttus_code: "PENDING",
      analysis_result_data: Prisma.JsonNull,
      summary_cn: null,
      failure_cn: null,
      retry_cnt: { increment: 1 },
      compl_dt: null,
      mdfcn_dt: new Date(),
    },
  });
  await tx.tbSpImplReceipt.update({
    where: { receipt_id: batch.receipt_id },
    data: { review_sttus_code: "ANALYZING", mdfcn_dt: new Date() },
  });
  return { batchId: batch.batch_id, taskId: task.ai_task_id };
}

async function createRouterTask(
  tx: Prisma.TransactionClient,
  state: PlanningState,
  unresolved: EvidenceFile[],
) {
  const batch = await tx.tbSpReconcileBatch.create({
    data: {
      receipt_id: state.receiptId,
      prjct_id: state.projectId,
      batch_no: 1,
      batch_key: `RUN:${state.runId}:ROUTER`,
      scope_ty_code: "ROUTER",
      scope_nm: "변경 파일 영향 범위 라우팅",
      source_paths_data: unresolved.map((file) => file.path),
      target_refs_data: [],
      routing_data: {
        runId: state.runId,
        unitWorkRef: inferUnitWorkRef(state.scopes),
        knownAssignments: state.assignments,
        scopes: compactScopes(state.scopes),
        unresolvedFiles: unresolved.map(compactEvidenceFile),
      },
      metrics_data: {
        changedFileCount: unresolved.length,
        scopeCount: state.scopes.length,
      },
      batch_sttus_code: "PENDING",
    },
  });
  const task = await tx.tbAiTask.create({
    data: {
      prjct_id: state.projectId,
      ref_ty_code: "SPEC_RECONCILIATION_ROUTER",
      ref_id: batch.batch_id,
      task_ty_code: "CUSTOM",
      req_cn: buildRouterPrompt(unresolved, state.scopes),
      req_snapshot_data: {
        receiptId: state.receiptId,
        batchId: batch.batch_id,
        files: unresolved.map(compactEvidenceFile),
        scopes: compactScopes(state.scopes),
      },
      req_mber_id: state.memberId,
      task_sttus_code: "PENDING",
    },
  });
  await tx.tbSpReconcileBatch.update({
    where: { batch_id: batch.batch_id },
    data: { ai_task_id: task.ai_task_id, mdfcn_dt: new Date() },
  });
  return { batchId: batch.batch_id, status: "PENDING", taskId: task.ai_task_id };
}

async function createAnalysisBatches(
  tx: Prisma.TransactionClient,
  state: PlanningState,
  assignments: FileAssignment[],
  startNo = 1,
  parentTaskId?: string | null,
) {
  const definitions = buildBatchDefinitions(state.files, state.scopes, assignments);
  const created = [];
  let batchNo = startNo;
  for (const definition of definitions) {
    const metrics = {
      changedFileCount: definition.files.length,
      targetCount: definition.targets.length,
      diffChars: definition.files.reduce((sum, file) => sum + file.patch.length, 0),
      contextChars: definition.targets.reduce(
        (sum, target) => sum + target.description.length,
        0,
      ),
    };
    const batch = await tx.tbSpReconcileBatch.create({
      data: {
        receipt_id: state.receiptId,
        prjct_id: state.projectId,
        batch_no: batchNo,
        batch_key:
          `RUN:${state.runId}:${definition.scope.key}:${definition.chunkNo}`
            .slice(0, 200),
        scope_ty_code: definition.scope.type,
        scope_ref_id: definition.scope.refId,
        scope_nm: definition.scope.name,
        source_paths_data: definition.files.map((file) => file.path),
        target_refs_data: definition.targets as unknown as Prisma.InputJsonValue,
        routing_data: {
          assignments: assignments.filter((assignment) =>
            definition.files.some((file) => file.path === assignment.path),
          ),
          evidenceParts: definition.files.map((file) => ({
            path: file.path,
            partNo: file.partNo ?? 1,
            partCount: file.partCount ?? 1,
          })),
        },
        metrics_data: metrics,
        batch_sttus_code: "PENDING",
      },
    });
    const task = await tx.tbAiTask.create({
      data: {
        prjct_id: state.projectId,
        ref_ty_code: "SPEC_RECONCILIATION_BATCH",
        ref_id: batch.batch_id,
        task_ty_code: "CUSTOM",
        req_cn: buildBatchAnalysisPrompt({
          receiptId: state.receiptId,
          batchId: batch.batch_id,
          scopeName: definition.scope.name,
          files: definition.files,
          targets: definition.targets,
          instruction: state.instruction,
        }),
        req_snapshot_data: {
          receiptId: state.receiptId,
          batchId: batch.batch_id,
          scope: {
            key: definition.scope.key,
            type: definition.scope.type,
            name: definition.scope.name,
          },
          metrics,
        },
        parent_task_id: parentTaskId ?? null,
        req_mber_id: state.memberId,
        task_sttus_code: "PENDING",
      },
    });
    await tx.tbSpReconcileBatch.update({
      where: { batch_id: batch.batch_id },
      data: { ai_task_id: task.ai_task_id, mdfcn_dt: new Date() },
    });
    created.push({ batchId: batch.batch_id, status: "PENDING", taskId: task.ai_task_id });
    batchNo += 1;
  }
  return created;
}

async function loadBatchScopes(
  db: DbClient,
  projectId: string,
  unitWorkRef: string | null,
  snapshotOverrides: Map<string, { description: string; descriptionHash: string }>,
): Promise<BatchScope[]> {
  const snapshotUnitWorkIds: string[] = [];
  const snapshotScreenIds: string[] = [];
  const snapshotAreaIds: string[] = [];
  const snapshotFunctionIds: string[] = [];
  for (const key of snapshotOverrides.keys()) {
    const separator = key.indexOf(":");
    const type = key.slice(0, separator);
    const id = key.slice(separator + 1);
    if (!id) continue;
    if (type === "UNIT_WORK") snapshotUnitWorkIds.push(id);
    if (type === "SCREEN") snapshotScreenIds.push(id);
    if (type === "AREA") snapshotAreaIds.push(id);
    if (type === "FUNCTION") snapshotFunctionIds.push(id);
  }
  const snapshotFilters: Prisma.TbDsUnitWorkWhereInput[] = [];
  if (snapshotUnitWorkIds.length > 0) {
    snapshotFilters.push({ unit_work_id: { in: snapshotUnitWorkIds } });
  }
  if (snapshotScreenIds.length > 0) {
    snapshotFilters.push({
      screens: { some: { scrn_id: { in: snapshotScreenIds } } },
    });
  }
  if (snapshotAreaIds.length > 0) {
    snapshotFilters.push({
      screens: {
        some: { areas: { some: { area_id: { in: snapshotAreaIds } } } },
      },
    });
  }
  if (snapshotFunctionIds.length > 0) {
    snapshotFilters.push({
      screens: {
        some: {
          areas: {
            some: {
              functions: { some: { func_id: { in: snapshotFunctionIds } } },
            },
          },
        },
      },
    });
  }
  const unitWorks = await db.tbDsUnitWork.findMany({
    where: {
      prjct_id: projectId,
      ...(unitWorkRef
        ? {
            OR: [
              { unit_work_id: unitWorkRef },
              { unit_work_display_id: unitWorkRef },
            ],
          }
        : snapshotFilters.length > 0
          ? { OR: snapshotFilters }
          : {}),
    },
    orderBy: { sort_ordr: "asc" },
    take: unitWorkRef || snapshotFilters.length > 0 ? undefined : 501,
    select: {
      unit_work_id: true,
      unit_work_display_id: true,
      unit_work_nm: true,
      unit_work_dc: true,
      screens: {
        orderBy: { sort_ordr: "asc" },
        select: {
          scrn_id: true,
          scrn_display_id: true,
          scrn_nm: true,
          scrn_dc: true,
          areas: {
            orderBy: { sort_ordr: "asc" },
            select: {
              area_id: true,
              area_display_id: true,
              area_nm: true,
              area_dc: true,
              functions: {
                orderBy: { sort_ordr: "asc" },
                select: {
                  func_id: true,
                  func_display_id: true,
                  func_nm: true,
                  func_dc: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (unitWorkRef && unitWorks.length === 0) {
    throw new BatchPlanningError(
      "UNIT_WORK_NOT_FOUND",
      "배치 분석할 단위업무를 찾을 수 없습니다.",
      404,
    );
  }
  if (!unitWorkRef && snapshotFilters.length === 0 && unitWorks.length > 500) {
    throw new BatchPlanningError(
      "PROJECT_SCOPE_TOO_LARGE",
      "프로젝트에 단위업무가 500개를 초과합니다. UW ID를 지정해 자동 비교 범위를 좁혀 주세요.",
      413,
    );
  }

  const restrictToSnapshots = snapshotOverrides.size > 0;
  const scopes: BatchScope[] = [];
  for (const unitWork of unitWorks) {
    const hierarchyBase = {
      unitWork: {
        id: unitWork.unit_work_id,
        displayId: unitWork.unit_work_display_id,
        name: unitWork.unit_work_nm,
      },
    };
    const unitTarget = makeTarget(
      "UNIT_WORK",
      unitWork.unit_work_id,
      "unit_work_dc",
      unitWork.unit_work_display_id,
      unitWork.unit_work_nm,
      unitWork.unit_work_dc ?? "",
      hierarchyBase,
      snapshotOverrides,
      restrictToSnapshots,
    );
    if (unitWork.screens.length === 0 && unitTarget) {
      scopes.push(makeScope(
        `UNIT_WORK:${unitWork.unit_work_id}`,
        "UNIT_WORK",
        unitWork.unit_work_id,
        unitWork.unit_work_nm || unitWork.unit_work_display_id,
        [unitTarget],
      ));
    }
    for (const screen of unitWork.screens) {
      const screenHierarchy = {
        ...hierarchyBase,
        screen: {
          id: screen.scrn_id,
          displayId: screen.scrn_display_id,
          name: screen.scrn_nm,
        },
      };
      const screenTarget = makeTarget(
        "SCREEN",
        screen.scrn_id,
        "scrn_dc",
        screen.scrn_display_id,
        screen.scrn_nm,
        screen.scrn_dc ?? "",
        screenHierarchy,
        snapshotOverrides,
        restrictToSnapshots,
      );
      const baseTargets = [unitTarget, screenTarget].filter(
        (target): target is BatchTargetRef => Boolean(target),
      );
      const areaGroups: BatchTargetRef[][] = [];
      for (const area of screen.areas) {
        const areaHierarchy = {
          ...screenHierarchy,
          area: {
            id: area.area_id,
            displayId: area.area_display_id,
            name: area.area_nm,
          },
        };
        const areaTarget = makeTarget(
          "AREA",
          area.area_id,
          "area_dc",
          area.area_display_id,
          area.area_nm,
          area.area_dc ?? "",
          areaHierarchy,
          snapshotOverrides,
          restrictToSnapshots,
        );
        const functions = area.functions.map((fn) =>
          makeTarget(
            "FUNCTION",
            fn.func_id,
            "func_dc",
            fn.func_display_id,
            fn.func_nm,
            fn.func_dc ?? "",
            {
              ...areaHierarchy,
              function: {
                id: fn.func_id,
                displayId: fn.func_display_id,
                name: fn.func_nm,
              },
            },
            snapshotOverrides,
            restrictToSnapshots,
          ),
        ).filter((target): target is BatchTargetRef => Boolean(target));
        const areaTargets = [areaTarget, ...functions].filter(
          (target): target is BatchTargetRef => Boolean(target),
        );
        if (areaTargets.length > 0) areaGroups.push(areaTargets);
      }
      const screenTargets = dedupeTargets([
        ...baseTargets,
        ...areaGroups.flat(),
      ]);
      if (screenTargets.length === 0) continue;
      if (fitsTargetBudget(screenTargets)) {
        scopes.push(makeScope(
          `SCREEN:${screen.scrn_id}`,
          "SCREEN",
          screen.scrn_id,
          `${unitWork.unit_work_nm} · ${screen.scrn_nm}`,
          screenTargets,
        ));
        continue;
      }
      for (const areaTargets of areaGroups) {
        const combined = dedupeTargets([...baseTargets, ...areaTargets]);
        for (const [index, chunk] of chunkTargets(combined).entries()) {
          const areaNode = asRecord(areaTargets[0]?.hierarchy.area);
          const areaId = stringValue(areaNode?.id) ?? screen.scrn_id;
          const areaName = stringValue(areaNode?.name) ?? screen.scrn_nm;
          scopes.push(makeScope(
            `AREA:${areaId}:${index + 1}`,
            "AREA",
            areaId,
            `${screen.scrn_nm} · ${areaName}${index > 0 ? ` ${index + 1}` : ""}`,
            chunk,
          ));
        }
      }
      if (areaGroups.length === 0 && baseTargets.length > 0) {
        scopes.push(makeScope(
          `SCREEN:${screen.scrn_id}`,
          "SCREEN",
          screen.scrn_id,
          `${unitWork.unit_work_nm} · ${screen.scrn_nm}`,
          baseTargets,
        ));
      }
    }
  }
  return scopes;
}

function buildRouterPrompt(files: EvidenceFile[], scopes: BatchScope[]) {
  return [
    "SPECODE 정합성 분석을 위한 변경 파일 라우터다.",
    "전체 스펙을 수정하거나 proposal을 만들지 않는다.",
    "파일 경로·심볼·짧은 patch와 설계 scope 목차를 보고 관련 scopeKeys를 고른다.",
    "모든 파일을 정확히 한 번 응답에 포함한다.",
    "여러 scope에 직접 영향을 주면 scopeKeys를 여러 개 넣고 shared=true로 표시한다.",
    "근거가 부족하면 scopeKeys=[]와 confidence=LOW로 두며 억지로 연결하지 않는다.",
    "응답은 설명이나 코드 fence 없이 JSON 한 개만 출력한다.",
    '{"assignments":[{"path":"src/...","scopeKeys":["SCREEN:uuid"],"shared":false,"confidence":"HIGH","reason":"..."}]}',
    "",
    "변경 파일:",
    JSON.stringify(files.map(compactEvidenceFile)),
    "",
    "선택 가능한 scope:",
    JSON.stringify(compactScopes(scopes)),
  ].join("\n");
}

function buildBatchAnalysisPrompt(input: {
  receiptId: string;
  batchId: string;
  scopeName: string;
  files: EvidenceFile[];
  targets: BatchTargetRef[];
  instruction: string | null;
}) {
  return [
    "SPECODE 구현 변경 정합성 배치 분석이다.",
    "이 배치에 제공된 source evidence와 designTargets만 분석한다.",
    "sourceFact(직접 확인 사실), inferredImpact(추론), proposedValue(스펙 제안)를 분리한다.",
    "근거가 없으면 proposal을 만들지 않는다. 단순 리팩터링과 버그를 구현에 맞춰 스펙 변경하지 않는다.",
    "각 proposal.sourceEvidence.files에는 이 배치 sourceEvidence의 실제 path를 1개 이상 넣는다.",
    "targetRefType/targetRefId/targetField/beforeValue/beforeHash는 designTargets 값을 그대로 사용한다.",
    "proposedValue는 변경 후 설명 전체 값이다.",
    "응답은 설명이나 코드 fence 없이 JSON 한 개만 출력한다.",
    '{"summary":"...","analysisVersion":"spec-reconcile/batch-v1","proposals":[{"targetRefType":"FUNCTION","targetRefId":"uuid","targetField":"func_dc","beforeValue":"전체 원문","proposedValue":"변경 후 전체 원문","beforeHash":"64자리 sha256","classification":"SPEC_CHANGE","sourceFact":"확인 사실","inferredImpact":"영향 추론","sourceEvidence":{"files":["src/실제경로"]},"risk":"MEDIUM","confidence":"MEDIUM"}]}',
    "",
    `receiptId: ${input.receiptId}`,
    `batchId: ${input.batchId}`,
    `scope: ${input.scopeName}`,
    `사용자 지시: ${input.instruction ?? "없음"}`,
    "",
    "sourceEvidence:",
    JSON.stringify(input.files.map(analysisEvidenceFile)),
    "",
    "designTargets:",
    JSON.stringify(input.targets),
  ].join("\n");
}

function buildRouterPromptFromStored(batch: {
  source_paths_data: Prisma.JsonValue;
  routing_data: Prisma.JsonValue | null;
}) {
  const routing = asRecord(batch.routing_data);
  const files = Array.isArray(routing?.unresolvedFiles)
    ? routing.unresolvedFiles
    : stringArray(batch.source_paths_data).map((path) => ({ path }));
  const scopes = Array.isArray(routing?.scopes) ? routing.scopes : [];
  return [
    "SPECODE 정합성 분석 변경 파일 라우터 재시도다.",
    "모든 파일을 응답에 포함하고, 근거가 없으면 scopeKeys=[]로 둔다.",
    "응답은 설명이나 코드 fence 없이 JSON 한 개만 출력한다.",
    '{"assignments":[{"path":"src/...","scopeKeys":[],"shared":false,"confidence":"LOW","reason":"..."}]}',
    JSON.stringify({ files, scopes }),
  ].join("\n");
}

function makeTarget(
  targetRefType: BatchTargetRef["targetRefType"],
  targetRefId: string,
  targetField: BatchTargetRef["targetField"],
  displayId: string,
  name: string,
  currentDescription: string,
  hierarchy: Record<string, unknown>,
  snapshotOverrides: Map<string, { description: string; descriptionHash: string }>,
  restrictToSnapshots: boolean,
): BatchTargetRef | null {
  const override = snapshotOverrides.get(
    `${targetRefType}:${targetRefId}`,
  );
  if (restrictToSnapshots && !override) return null;
  const description = override?.description ?? currentDescription;
  return {
    targetRefType,
    targetRefId,
    targetField,
    displayId,
    name,
    description,
    descriptionHash: override?.descriptionHash ?? hashOf(description).hash,
    hierarchy,
  };
}

function snapshotKey(refTable: string, refId: string) {
  const type = {
    tb_ds_unit_work: "UNIT_WORK",
    tb_ds_screen: "SCREEN",
    tb_ds_area: "AREA",
    tb_ds_function: "FUNCTION",
  }[refTable];
  return type ? `${type}:${refId}` : `UNKNOWN:${refId}`;
}

function buildTargetToScopes(scopes: BatchScope[]) {
  const map = new Map<string, string[]>();
  for (const scope of scopes) {
    for (const target of scope.targetRefs) {
      const key = `${target.targetRefType}:${target.targetRefId}`;
      const current = map.get(key) ?? [];
      current.push(scope.key);
      map.set(key, current);
    }
  }
  return map;
}

function normalizeRouterAssignments(
  files: EvidenceFile[],
  scopes: BatchScope[],
  assignments: FileAssignment[],
) {
  const validPaths = new Set(files.map((file) => file.path));
  const validScopes = new Set(scopes.map((scope) => scope.key));
  const byPath = new Map<string, FileAssignment>();
  for (const assignment of assignments) {
    if (!validPaths.has(assignment.path)) continue;
    const scopeKeys = Array.from(new Set(
      assignment.scopeKeys.filter((key) => validScopes.has(key)),
    )).slice(0, BATCH_LIMITS.maxScopesPerFile);
    const previous = byPath.get(assignment.path);
    byPath.set(assignment.path, {
      path: assignment.path,
      scopeKeys: Array.from(new Set([
        ...(previous?.scopeKeys ?? []),
        ...scopeKeys,
      ])),
      shared:
        Boolean(previous?.shared) || assignment.shared || scopeKeys.length > 1,
      confidence:
        previous?.confidence === "HIGH" || assignment.confidence === "HIGH"
          ? "HIGH"
          : previous?.confidence === "MEDIUM" || assignment.confidence === "MEDIUM"
            ? "MEDIUM"
            : "LOW",
      reason: [previous?.reason, assignment.reason].filter(Boolean).join(" / "),
    });
  }
  return files.map((file) => byPath.get(file.path) ?? {
    path: file.path,
    scopeKeys: [],
    shared: false,
    confidence: "LOW" as const,
    reason: "AI router가 연결 범위를 확정하지 못함",
  });
}

export function extractEvidenceFiles(
  evidence: Prisma.JsonValue,
  explicitPaths: string[],
): EvidenceFile[] {
  const found = new Map<string, EvidenceFile>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    const record = asRecord(value);
    if (!record) return;
    const path = stringValue(record.path);
    if (path) {
      const previous = found.get(path);
      const symbols = stringArray(record.symbols);
      const patch =
        stringValue(record.patch) ??
        stringValue(record.diff) ??
        stringValue(record.content) ??
        "";
      found.set(path, {
        path,
        symbols: Array.from(new Set([...(previous?.symbols ?? []), ...symbols])),
        patch: previous?.patch || patch,
        raw: { ...(previous?.raw ?? {}), ...record },
      });
    }
    for (const [key, child] of Object.entries(record)) {
      if (["patch", "diff", "content", "beforeContent", "afterContent"].includes(key)) {
        continue;
      }
      visit(child);
    }
  };
  visit(evidence);
  for (const path of explicitPaths) {
    if (!found.has(path)) {
      found.set(path, { path, symbols: [], patch: "", raw: { path } });
    }
  }
  return Array.from(found.values()).sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function compactEvidenceFile(file: EvidenceFile) {
  return {
    path: file.path,
    symbols: file.symbols,
    patch: file.patch.slice(0, 12_000),
  };
}

function compactScopes(scopes: BatchScope[]) {
  return scopes.map((scope) => ({
    key: scope.key,
    type: scope.type,
    refId: scope.refId,
    name: scope.name,
    targetCount: scope.targetRefs.length,
    targets: scope.targetRefs.map((target) => ({
      targetRefType: target.targetRefType,
      targetRefId: target.targetRefId,
      displayId: target.displayId,
      name: target.name,
    })),
  }));
}

function inferUnitWorkRef(scopes: BatchScope[]) {
  const ids = new Set(
    scopes
      .map((scope) => asRecord(scope.targetRefs[0]?.hierarchy.unitWork))
      .map((unitWork) => stringValue(unitWork?.id))
      .filter((value): value is string => Boolean(value)),
  );
  return ids.size === 1 ? Array.from(ids)[0] : null;
}

function parseAssignments(value: unknown): FileAssignment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const path = stringValue(record?.path);
    if (!path) return [];
    const confidence = stringValue(record?.confidence);
    return [{
      path,
      scopeKeys: stringArray(record?.scopeKeys),
      shared: booleanValue(record?.shared),
      confidence: ["LOW", "MEDIUM", "HIGH"].includes(confidence ?? "")
        ? confidence as "LOW" | "MEDIUM" | "HIGH"
        : "LOW",
      reason: stringValue(record?.reason) ?? "",
    }];
  });
}

function parseTargetRefs(value: Prisma.JsonValue): BatchTargetRef[] {
  if (!Array.isArray(value)) return [];
  return value as unknown as BatchTargetRef[];
}

function analysisEvidenceFile(file: EvidenceFile) {
  return {
    path: file.path,
    symbols: file.symbols,
    partNo: file.partNo ?? 1,
    partCount: file.partCount ?? 1,
    patch: file.patch,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function booleanValue(value: unknown) {
  return value === true;
}

async function lockReceiptForPlanning(
  tx: Prisma.TransactionClient,
  receiptId: string,
) {
  await tx.$queryRaw(Prisma.sql`
    SELECT receipt_id
    FROM tb_sp_impl_receipt
    WHERE receipt_id = ${receiptId}
    FOR UPDATE
  `);
}
