/** 로컬 에이전트의 분석 결과 제출과 실행 취소를 담당한다. */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  designSnapshotSchema,
  syncResultSubmissionSchema,
} from "./contracts";
import { SpecSyncError } from "./errors";
import { buildItemData } from "./itemFactory";
import {
  normalizeRepositoryPath,
  validateSyncResult,
} from "./resultValidator";

export async function submitSyncResult(input: {
  projectId: string;
  runId: string;
  memberId: string;
  rawResult: unknown;
}) {
  const submission = syncResultSubmissionSchema.parse(input.rawResult);
  const run = await prisma.tbSpSyncRun.findFirst({
    where: { sync_run_id: input.runId, prjct_id: input.projectId },
  });
  if (!run) {
    throw new SpecSyncError("NOT_FOUND", "동기화 실행을 찾을 수 없습니다.", 404);
  }
  if (run.req_mber_id !== input.memberId) {
    throw new SpecSyncError(
      "FORBIDDEN_RUN_OWNERSHIP",
      "동기화를 시작한 사용자만 분석 결과를 제출할 수 있습니다.",
      403,
    );
  }
  assertRunOpen(run.sync_sttus_code);

  if (submission.resultStatus === "FAILED") {
    return updateOpenRun(input, {
      sync_sttus_code: "FAILED",
      failure_cn: submission.errorMessage,
      compl_dt: new Date(),
      mdfcn_dt: new Date(),
    });
  }

  if (submission.resultStatus === "NEEDS_INPUT") {
    for (const file of submission.sourceScope.files) {
      normalizeRepositoryPath(file.path);
    }
    return updateOpenRun(input, {
      sync_sttus_code: "NEEDS_INPUT",
      source_scope_data: submission.sourceScope as Prisma.InputJsonValue,
      failure_cn: null,
      mdfcn_dt: new Date(),
    });
  }

  if (submission.analysis.mode !== run.sync_mode_code) {
    throw new SpecSyncError(
      "MODE_MISMATCH",
      "실행 모드와 분석 결과 모드가 일치하지 않습니다.",
      400,
    );
  }
  const snapshot = designSnapshotSchema.parse(run.design_snapshot_data);
  let validated: ReturnType<typeof validateSyncResult>;
  try {
    validated = validateSyncResult(submission.analysis, snapshot);
  } catch (error) {
    throw new SpecSyncError(
      "INVALID_ANALYSIS_RESULT",
      error instanceof Error ? error.message : "분석 결과가 올바르지 않습니다.",
      400,
    );
  }
  const itemData = buildItemData(
    run.sync_run_id,
    validated.analysis,
    validated.proposals,
    snapshot,
  );
  const pendingCount = itemData.filter(
    (item) => item.item_sttus_code === "PENDING",
  ).length;
  const evaluatedTargetCount =
    validated.analysis.implementation.evaluatedTargets.length;
  const implementationIssueCount =
    validated.analysis.implementation.issues.length;
  const coverageIssueCount = validated.analysis.designCoverage.issues.length;
  const normalTargetCount = evaluatedTargetCount - implementationIssueCount;
  const completed = pendingCount === 0;
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ sync_sttus_code: string }>>(
      Prisma.sql`
        SELECT sync_sttus_code
        FROM tb_sp_sync_run
        WHERE sync_run_id = ${run.sync_run_id} AND prjct_id = ${input.projectId}
        FOR UPDATE
      `,
    );
    if (
      locked.length !== 1 ||
      !["RUNNING", "NEEDS_INPUT"].includes(locked[0].sync_sttus_code)
    ) {
      throw concurrentResultError();
    }

    const existingItems = await tx.tbSpSyncItem.count({
      where: { sync_run_id: run.sync_run_id },
    });
    if (existingItems > 0) {
      throw new SpecSyncError(
        "RESULT_ALREADY_SUBMITTED",
        "이 실행에는 이미 분석 항목이 저장되어 있습니다.",
        409,
      );
    }

    if (itemData.length > 0) {
      await tx.tbSpSyncItem.createMany({ data: itemData });
    }
    return tx.tbSpSyncRun.update({
      where: { sync_run_id: run.sync_run_id },
      data: {
        sync_sttus_code: completed ? "COMPLETED" : "NEEDS_REVIEW",
        source_scope_data:
          validated.analysis.sourceScope as Prisma.InputJsonValue,
        analysis_summary_data: {
          implementation: validated.analysis.implementation.summary,
          designCoverage: validated.analysis.designCoverage.summary,
          evaluatedTargetCount,
          normalTargetCount,
          issueCount: itemData.length,
          implementationIssueCount,
          coverageIssueCount,
          pendingCount,
        },
        implementation_verdict_code:
          validated.analysis.implementation.verdict,
        design_coverage_verdict_code:
          validated.analysis.designCoverage.verdict,
        analyzed_dt: now,
        compl_dt: completed ? now : null,
        failure_cn: null,
        mdfcn_dt: now,
      },
      select: runStatusSelect,
    });
  });
}

export async function cancelSyncRun(input: {
  projectId: string;
  runId: string;
  memberId: string;
}) {
  const result = await prisma.tbSpSyncRun.updateMany({
    where: {
      sync_run_id: input.runId,
      prjct_id: input.projectId,
      req_mber_id: input.memberId,
      sync_sttus_code: { in: ["RUNNING", "NEEDS_INPUT"] },
    },
    data: {
      sync_sttus_code: "CANCELLED",
      compl_dt: new Date(),
      mdfcn_dt: new Date(),
    },
  });
  if (result.count === 0) {
    throw new SpecSyncError(
      "INVALID_RUN_STATE",
      "본인이 시작한 진행 중 실행만 취소할 수 있습니다.",
      409,
    );
  }
  return { syncRunId: input.runId, status: "CANCELLED" as const };
}

async function updateOpenRun(
  input: { projectId: string; runId: string; memberId: string },
  data: Prisma.TbSpSyncRunUpdateManyMutationInput,
) {
  const updated = await prisma.tbSpSyncRun.updateMany({
    where: {
      sync_run_id: input.runId,
      prjct_id: input.projectId,
      req_mber_id: input.memberId,
      sync_sttus_code: { in: ["RUNNING", "NEEDS_INPUT"] },
    },
    data,
  });
  if (updated.count !== 1) throw concurrentResultError();
  return prisma.tbSpSyncRun.findUniqueOrThrow({
    where: { sync_run_id: input.runId },
    select: runStatusSelect,
  });
}

function assertRunOpen(status: string) {
  if (!["RUNNING", "NEEDS_INPUT"].includes(status)) {
    throw new SpecSyncError(
      "INVALID_RUN_STATE",
      "이미 결과가 확정되었거나 종료된 실행입니다.",
      409,
    );
  }
}

function concurrentResultError() {
  return new SpecSyncError(
    "INVALID_RUN_STATE",
    "다른 요청이 먼저 실행 결과를 확정했습니다.",
    409,
  );
}

const runStatusSelect = {
  sync_run_id: true,
  sync_sttus_code: true,
  implementation_verdict_code: true,
  design_coverage_verdict_code: true,
  analyzed_dt: true,
  compl_dt: true,
} as const;
