/**
 * POST /api/worker/tasks/[taskId]/implementation-receipt
 *
 * IMPLEMENT 작업자가 요청 당시 4계층 스펙과 실제 구현 편차를 제출한다.
 * task 소유권·IN_PROGRESS 상태를 확인한 뒤 공통 receipt 생성 서비스로 전달한다.
 */

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import {
  receiptSubmissionSchema,
  type ReceiptSubmission,
} from "@/lib/spec-reconciliation/contracts";
import {
  createReconciliationReceipt,
  ReceiptSubmissionError,
} from "@/lib/spec-reconciliation/createReceipt";
import {
  BatchPlanningError,
  queueReconciliationBatchAnalysis,
} from "@/lib/spec-reconciliation/batchPlanner";
import { requireWorkerAuth } from "../../../_lib/auth";

type RouteParams = { params: Promise<{ taskId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireWorkerAuth(request);
  if (auth instanceof Response) return auth;
  const { taskId } = await params;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }
  const parsed = receiptSubmissionSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(
      "VALIDATION_ERROR",
      "구현 변경 접수 형식이 올바르지 않습니다.",
      400,
      { issues: parsed.error.issues },
    );
  }
  if (parsed.data.evidenceTrust !== "LOCAL_AGENT_ATTESTED") {
    return apiError(
      "INVALID_EVIDENCE_TRUST",
      "로컬 워커는 LOCAL_AGENT_ATTESTED 증거만 제출할 수 있습니다.",
      400,
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const task = await tx.tbAiTask.findFirst({
        where: {
          ai_task_id: taskId,
          prjct_id: auth.prjctId,
          req_mber_id: auth.mberId,
          task_ty_code: "IMPLEMENT",
          task_sttus_code: "IN_PROGRESS",
        },
        select: {
          ai_task_id: true,
          implSnapshots: {
            select: {
              ref_tbl_nm: true,
              ref_id: true,
              content_hash: true,
              raw_cn: true,
            },
          },
        },
      });
      if (!task) {
        throw new ReceiptSubmissionError(
          "INVALID_IMPLEMENT_TASK",
          "접수 가능한 본인 소유의 IN_PROGRESS 구현 태스크가 아닙니다.",
        );
      }

      // 워커가 provider 검증 상태를 스스로 올릴 수 없도록 서버가 신뢰 경계를 고정한다.
      const submission: ReceiptSubmission = {
        ...parsed.data,
        evidenceTrust: "LOCAL_AGENT_ATTESTED",
        evidenceVerify: "ATTESTED",
      };
      return createReconciliationReceipt(tx, submission, {
        projectId: auth.prjctId,
        memberId: auth.mberId,
        originType: "IMPLEMENTATION",
        aiTaskId: task.ai_task_id,
        allowBaselineCreate: true,
        implementationSnapshots: task.implSnapshots.map((snapshot) => ({
          refTable: snapshot.ref_tbl_nm,
          refId: snapshot.ref_id,
          contentHash: snapshot.content_hash.trim(),
          rawContent: snapshot.raw_cn,
        })),
      });
    });

    const batchAnalysis =
      parsed.data.proposals.length === 0 && parsed.data.analysisScope?.autoBatch
      ? await queueReconciliationBatchAnalysis({
          receiptId: result.receiptId,
          projectId: auth.prjctId,
          memberId: auth.mberId,
          scope: parsed.data.analysisScope,
        })
      : null;
    return apiSuccess(
      {
        ...result,
        batchAnalysis,
        reviewUrl:
          `/projects/${auth.prjctId}/spec-reconciliations/${result.receiptId}`,
      },
      result.idempotent ? 200 : 201,
    );
  } catch (error) {
    if (error instanceof BatchPlanningError) {
      return apiError(error.code, error.message, error.status);
    }
    if (error instanceof ReceiptSubmissionError) {
      return apiError(error.code, error.message, error.status);
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return apiError(
        "RECEIPT_ALREADY_EXISTS",
        "동일한 구현 변경 접수가 이미 제출됐습니다.",
        409,
      );
    }
    console.error(
      `[POST /api/worker/tasks/${taskId}/implementation-receipt] 오류:`,
      error,
    );
    return apiError("DB_ERROR", "구현 변경 접수 저장에 실패했습니다.", 500);
  }
}
