/**
 * POST /api/projects/[id]/impl-receipts
 *
 * HTTP MCP와 웹 클라이언트가 Type A/B receipt를 같은 계약으로 제출하는 API다.
 * PROVIDER_VERIFIED 승격은 provider 검증 전용 경로만 가능하므로 일반 호출에서는 차단한다.
 */

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";
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

type RouteParams = { params: Promise<{ id: string }> };

const envelopeSchema = z.object({
  originType: z.enum(["IMPLEMENTATION", "MAINTENANCE"]),
  aiTaskId: z.string().trim().min(1).max(36).optional(),
  receipt: receiptSubmissionSchema,
});

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(
    request,
    projectId,
    "specReconcile.submit",
  );
  if (gate instanceof Response) return gate;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }
  const parsed = envelopeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(
      "VALIDATION_ERROR",
      "구현 변경 접수 형식이 올바르지 않습니다.",
      400,
      { issues: parsed.error.issues },
    );
  }
  const { originType, aiTaskId } = parsed.data;
  if (originType === "IMPLEMENTATION" && !aiTaskId) {
    return apiError(
      "VALIDATION_ERROR",
      "IMPLEMENTATION 접수에는 aiTaskId가 필요합니다.",
      400,
    );
  }
  if (parsed.data.receipt.evidenceTrust === "PROVIDER_VERIFIED") {
    return apiError(
      "EVIDENCE_TRUST_ESCALATION",
      "provider 검증 전용 경로를 거치지 않고 PROVIDER_VERIFIED로 제출할 수 없습니다.",
      403,
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      let implementationSnapshots:
        | Array<{
            refTable: string;
            refId: string;
            contentHash: string;
            rawContent: string;
          }>
        | undefined;

      if (originType === "IMPLEMENTATION") {
        const task = await tx.tbAiTask.findFirst({
          where: {
            ai_task_id: aiTaskId!,
            prjct_id: projectId,
            task_ty_code: "IMPLEMENT",
          },
          select: {
            req_mber_id: true,
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
            "프로젝트의 IMPLEMENT 태스크를 찾을 수 없습니다.",
            404,
          );
        }
        const canSubmitForOthers =
          gate.role === "OWNER" ||
          gate.role === "ADMIN" ||
          gate.job === "PM" ||
          gate.job === "PL";
        if (task.req_mber_id !== gate.mberId && !canSubmitForOthers) {
          throw new ReceiptSubmissionError(
            "FORBIDDEN_TASK_OWNER",
            "본인이 요청한 구현 태스크만 제출할 수 있습니다.",
            403,
          );
        }
        implementationSnapshots = task.implSnapshots.map((snapshot) => ({
          refTable: snapshot.ref_tbl_nm,
          refId: snapshot.ref_id,
          contentHash: snapshot.content_hash.trim(),
          rawContent: snapshot.raw_cn,
        }));
      }

      const evidenceVerify =
        parsed.data.receipt.evidenceTrust === "LOCAL_AGENT_ATTESTED"
          ? parsed.data.receipt.headStable
            ? "ATTESTED"
            : "PENDING"
          : "PENDING";
      const submission: ReceiptSubmission = {
        ...parsed.data.receipt,
        evidenceVerify,
      };
      return createReconciliationReceipt(tx, submission, {
        projectId,
        memberId: gate.mberId,
        originType,
        aiTaskId: aiTaskId ?? null,
        allowBaselineCreate: originType === "IMPLEMENTATION",
        implementationSnapshots,
      });
    });

    const batchAnalysis =
      parsed.data.receipt.proposals.length === 0 &&
      parsed.data.receipt.analysisScope?.autoBatch
      ? await queueReconciliationBatchAnalysis({
          receiptId: result.receiptId,
          projectId,
          memberId: gate.mberId,
          scope: parsed.data.receipt.analysisScope,
        })
      : null;
    return apiSuccess(
      {
        ...result,
        batchAnalysis,
        reviewUrl:
          `/projects/${projectId}/spec-reconciliations/${result.receiptId}`,
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
      return apiError("RECEIPT_ALREADY_EXISTS", "동일한 접수가 이미 있습니다.", 409);
    }
    console.error(`[POST /api/projects/${projectId}/impl-receipts] 오류:`, error);
    return apiError("DB_ERROR", "구현 변경 접수 저장에 실패했습니다.", 500);
  }
}
