/**
 * POST /api/worker/spec-reconciliations/maintenance
 *
 * 구현 완료 후 개발자가 직접 수정한 소스(Type B)를 독립 receipt로 제출한다.
 * baseline은 자동 생성하지 않으며 저장된 마지막 정합성 확정점과 정확히 같아야 한다.
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
import { requireWorkerAuth } from "../../_lib/auth";

export async function POST(request: NextRequest) {
  const auth = await requireWorkerAuth(request);
  if (auth instanceof Response) return auth;
  if (auth.role === "VIEWER") {
    return apiError(
      "FORBIDDEN",
      "VIEWER는 구현 변경을 제출할 수 없습니다.",
      403,
    );
  }

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
      "후속 변경 접수 형식이 올바르지 않습니다.",
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
    const submission: ReceiptSubmission = {
      ...parsed.data,
      evidenceTrust: "LOCAL_AGENT_ATTESTED",
      evidenceVerify: parsed.data.headStable ? "ATTESTED" : "PENDING",
    };
    const result = await prisma.$transaction((tx) =>
      createReconciliationReceipt(tx, submission, {
        projectId: auth.prjctId,
        memberId: auth.mberId,
        originType: "MAINTENANCE",
        allowBaselineCreate: false,
      }),
    );
    const batchAnalysis =
      submission.proposals.length === 0 && submission.analysisScope?.autoBatch
      ? await queueReconciliationBatchAnalysis({
          receiptId: result.receiptId,
          projectId: auth.prjctId,
          memberId: auth.mberId,
          scope: submission.analysisScope,
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
        "동일한 후속 변경 접수가 이미 제출됐습니다.",
        409,
      );
    }
    console.error("[POST /api/worker/spec-reconciliations/maintenance] 오류:", error);
    return apiError("DB_ERROR", "후속 변경 접수 저장에 실패했습니다.", 500);
  }
}
