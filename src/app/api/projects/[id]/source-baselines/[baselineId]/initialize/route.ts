/**
 * 최초 baseline 보정.
 *
 * 아직 receipt가 한 번도 확정되지 않은 version 0 기준선만 다시 승인할 수 있다.
 * 운영 중 기준점을 건너뛰는 임의 수정 경로로 악용되지 않도록 조건을 좁힌다.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";
import { isValidCheckpoint } from "@/lib/spec-reconciliation/contracts";

type RouteParams = {
  params: Promise<{ id: string; baselineId: string }>;
};

const requestSchema = z.object({
  checkpointType: z.enum(["GIT_COMMIT", "SOURCE_MANIFEST"]),
  checkpoint: z.string().trim().min(7).max(128),
  historyAudit: z.enum([
    "NOT_AUDITED",
    "VERIFIED_FROM_POINT",
    "FULLY_AUDITED",
  ]),
  approvalReason: z.string().trim().min(1).max(4_000),
});

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, baselineId } = await params;
  const gate = await requirePermission(
    request,
    projectId,
    "specReconcile.review",
  );
  if (gate instanceof Response) return gate;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }
  const parsed = requestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", "초기화 정보가 올바르지 않습니다.", 400);
  }
  const body = parsed.data;
  if (!isValidCheckpoint(body.checkpointType, body.checkpoint)) {
    return apiError("VALIDATION_ERROR", "checkpoint 형식이 올바르지 않습니다.", 400);
  }

  const updated = await prisma.tbSpSourceBaseline.updateMany({
    where: {
      baseline_id: baselineId,
      prjct_id: projectId,
      checkpoint_version_no: 0,
      last_receipt_id: null,
    },
    data: {
      checkpoint_ty_code: body.checkpointType,
      last_reconciled_commit_sha:
        body.checkpointType === "GIT_COMMIT" ? body.checkpoint : null,
      last_reconciled_manifest_hash:
        body.checkpointType === "SOURCE_MANIFEST" ? body.checkpoint : null,
      history_audit_code: body.historyAudit,
      reconciled_mber_id: gate.mberId,
      reconciled_dt: new Date(),
      checkpoint_metadata_data: {
        reinitialized: true,
        approvalReason: body.approvalReason,
      },
      mdfcn_dt: new Date(),
    },
  });
  if (updated.count !== 1) {
    return apiError(
      "BASELINE_ALREADY_IN_USE",
      "receipt가 사용한 baseline은 초기화할 수 없습니다.",
      409,
    );
  }
  return apiSuccess({ baselineId, initialized: true });
}

