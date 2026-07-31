/**
 * POST .../items/[itemId]/apply — 승인된 기능 설명을 안전하게 적용한다. (FID-00213)
 *
 * 현재 스펙 hash가 후보 생성 시점의 before_hash와 같을 때만 전체 필드를 교체한다.
 * 적용, 설계 변경 이력, 항목 결정, 마지막 항목의 baseline 전진은 한 트랜잭션이다.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";
import { applySpecItem } from "@/lib/spec-reconciliation/applySpecItem";
import {
  markReceiptStaleBaseline,
  StaleBaselineConflict,
} from "@/lib/spec-reconciliation/closeReceipt";

type RouteParams = {
  params: Promise<{ id: string; receiptId: string; itemId: string }>;
};

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, receiptId, itemId } = await params;
  const gate = await requirePermission(request, projectId, "specReconcile.apply");
  if (gate instanceof Response) return gate;

  let rawBody: unknown = {};
  try {
    const text = await request.text();
    rawBody = text ? JSON.parse(text) : {};
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }
  const body = rawBody && typeof rawBody === "object"
    ? rawBody as { useMergePreview?: unknown; reason?: unknown }
    : {};

  try {
    const result = await prisma.$transaction((tx) =>
      applySpecItem(tx, {
        projectId,
        receiptId,
        itemId,
        memberId: gate.mberId,
        useMergePreview: body.useMergePreview === true,
        decisionReason: typeof body.reason === "string" ? body.reason : undefined,
      }),
    );

    if (result.kind === "NOT_FOUND") {
      return apiError("NOT_FOUND", "적용 가능한 스펙 변경 항목을 찾을 수 없습니다.", 404);
    }
    if (result.kind === "TARGET_NOT_FOUND") {
      return apiError("TARGET_NOT_FOUND", "대상 설계가 삭제됐거나 다른 프로젝트에 있습니다.", 404);
    }
    if (result.kind === "UNSUPPORTED_TARGET") {
      return apiError("UNSUPPORTED_TARGET", "자동 적용이 허용되지 않은 설계 필드입니다.", 400);
    }
    if (result.kind === "STALE_BASELINE") {
      return apiError(
        "STALE_BASELINE",
        "다른 접수가 source baseline을 먼저 갱신했습니다. 최신 기준으로 다시 분석해 주세요.",
        409,
      );
    }
    if (result.kind === "STALE_SPEC") {
      return apiError(
        "STALE_SPEC",
        "후보 생성 뒤 현재 스펙의 같은 구간이 변경되어 적용하지 않았습니다.",
        409,
        { conflicts: result.conflicts },
      );
    }
    if (result.kind === "MERGE_AVAILABLE") {
      return apiError(
        "MERGE_AVAILABLE",
        "현재 스펙의 다른 구간도 변경됐습니다. 3-way 병합 결과를 확인한 뒤 적용해 주세요.",
        409,
        {
          mergedValue: result.mergedValue,
          currentHash: result.currentHash,
        },
      );
    }

    return apiSuccess({
      itemId,
      status: "APPLIED",
      designChangeId: result.designChangeId,
      receiptClosed: result.receiptClosed,
    });
  } catch (error) {
    if (error instanceof StaleBaselineConflict) {
      await markReceiptStaleBaseline(error.receiptId);
      return apiError(
        "STALE_BASELINE",
        "다른 접수가 source baseline을 먼저 갱신했습니다. 스펙 변경은 적용하지 않았습니다.",
        409,
      );
    }
    console.error(
      `[POST /api/projects/${projectId}/spec-reconciliations/${receiptId}/items/${itemId}/apply] 오류:`,
      error,
    );
    return apiError("DB_ERROR", "스펙 변경을 적용하지 못했습니다.", 500);
  }
}
