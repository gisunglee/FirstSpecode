/**
 * 보관기간이 지난 CLOSED receipt의 source patch/content를 정리한다.
 *
 * 경로·hash·checkpoint·판단·변경 이력은 유지한다. 기본 호출은 dry-run이며 OWNER/ADMIN이
 * apply=true로 다시 호출해야 실제 JSON evidence가 축약된다.
 */

import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";

type RouteParams = { params: Promise<{ id: string }> };

const requestSchema = z.object({
  apply: z.boolean().default(false),
  previewToken: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
});

const CONTENT_KEYS = new Set([
  "patch",
  "content",
  "beforeContent",
  "afterContent",
  "rawContent",
  "diff",
]);

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(
    request,
    projectId,
    "specReconcile.override",
  );
  if (gate instanceof Response) return gate;

  let rawBody: unknown = {};
  try {
    const text = await request.text();
    rawBody = text ? JSON.parse(text) : {};
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }
  const parsed = requestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", "evidence 정리 요청이 올바르지 않습니다.", 400);
  }

  const retentionConfig = await prisma.tbPjProjectConfig.findUnique({
    where: {
      prjct_id_config_key: {
        prjct_id: projectId,
        config_key: "SPEC_RECONCILE_DIFF_RETENTION_DAYS",
      },
    },
    select: { config_value: true },
  });
  const configuredDays = Number(retentionConfig?.config_value ?? 90);
  const retentionDays = Number.isFinite(configuredDays)
    ? Math.min(Math.max(Math.trunc(configuredDays), 1), 3_650)
    : 90;
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  const receipts = await prisma.tbSpImplReceipt.findMany({
    where: {
      prjct_id: projectId,
      receipt_sttus_code: "CLOSED",
      close_dt: { lt: cutoff },
    },
    orderBy: [{ close_dt: "asc" }, { receipt_id: "asc" }],
    select: {
      receipt_id: true,
      close_dt: true,
      mdfcn_dt: true,
      source_evidence_data: true,
      evidence_verify_data: true,
      manifest_data: true,
      items: {
        orderBy: { item_id: "asc" },
        select: {
          item_id: true,
          mdfcn_dt: true,
          source_evidence_data: true,
          resolution_evidence_data: true,
        },
      },
      batches: {
        orderBy: { batch_id: "asc" },
        select: {
          batch_id: true,
          mdfcn_dt: true,
          routing_data: true,
          analysis_result_data: true,
        },
      },
    },
  });
  const candidates = receipts
    .map((receipt) => {
      const receiptContentCount =
        countContentFields(receipt.source_evidence_data) +
        countContentFields(receipt.evidence_verify_data) +
        countContentFields(receipt.manifest_data) +
        receipt.items.reduce(
          (count, item) =>
            count +
            countContentFields(item.source_evidence_data) +
            countContentFields(item.resolution_evidence_data),
          0,
        ) +
        receipt.batches.reduce(
          (count, batch) =>
            count +
            countContentFields(batch.routing_data) +
            countContentFields(batch.analysis_result_data),
          0,
        );
      return { receipt, contentFieldCount: receiptContentCount };
    })
    .filter((candidate) => candidate.contentFieldCount > 0);
  const previewToken = createPrunePreviewToken(
    projectId,
    retentionDays,
    candidates,
  );

  if (!parsed.data.apply) {
    return apiSuccess({
      applied: false,
      retentionDays,
      cutoff: cutoff.toISOString(),
      previewToken,
      receiptCount: candidates.length,
      contentFieldCount: candidates.reduce(
        (count, candidate) => count + candidate.contentFieldCount,
        0,
      ),
      receipts: candidates.slice(0, 100).map((candidate) => ({
        receiptId: candidate.receipt.receipt_id,
        closedAt: candidate.receipt.close_dt?.toISOString() ?? null,
        contentFieldCount: candidate.contentFieldCount,
      })),
    });
  }
  if (!parsed.data.previewToken) {
    return apiError(
      "PRUNE_PREVIEW_REQUIRED",
      "실제 정리 전에 최신 정리 대상을 미리보기 해야 합니다.",
      409,
    );
  }
  if (parsed.data.previewToken.toLowerCase() !== previewToken) {
    return apiError(
      "PRUNE_PREVIEW_STALE",
      "미리보기 이후 정리 대상이 변경됐습니다. 최신 대상을 다시 미리보기 해 주세요.",
      409,
    );
  }
  if (candidates.length === 0) {
    return apiSuccess({
      applied: false,
      retentionDays,
      cutoff: cutoff.toISOString(),
      previewToken,
      receiptCount: 0,
      contentFieldCount: 0,
      receipts: [],
    });
  }

  const prunedAt = new Date();
  await prisma.$transaction(async (tx) => {
    for (const candidate of candidates) {
      const receipt = candidate.receipt;
      const prunedSource = addPruneMetadata(
        pruneEvidence(receipt.source_evidence_data),
        prunedAt,
        retentionDays,
        gate.mberId,
      );
      await tx.tbSpImplReceipt.update({
        where: { receipt_id: receipt.receipt_id },
        data: {
          source_evidence_data: prunedSource,
          evidence_verify_data:
            receipt.evidence_verify_data == null
              ? undefined
              : pruneEvidence(receipt.evidence_verify_data),
          manifest_data:
            receipt.manifest_data == null
              ? undefined
              : pruneEvidence(receipt.manifest_data),
          mdfcn_dt: prunedAt,
        },
      });
      for (const item of receipt.items) {
        await tx.tbSpReconcileItem.update({
          where: { item_id: item.item_id },
          data: {
            source_evidence_data: pruneEvidence(item.source_evidence_data),
            resolution_evidence_data:
              item.resolution_evidence_data == null
                ? undefined
                : pruneEvidence(item.resolution_evidence_data),
            mdfcn_dt: prunedAt,
          },
        });
      }
      for (const batch of receipt.batches) {
        await tx.tbSpReconcileBatch.update({
          where: { batch_id: batch.batch_id },
          data: {
            routing_data:
              batch.routing_data == null
                ? undefined
                : pruneEvidence(batch.routing_data),
            analysis_result_data:
              batch.analysis_result_data == null
                ? undefined
                : pruneEvidence(batch.analysis_result_data),
            mdfcn_dt: prunedAt,
          },
        });
      }
    }
  });

  return apiSuccess({
    applied: true,
    retentionDays,
    cutoff: cutoff.toISOString(),
    receiptCount: candidates.length,
    contentFieldCount: candidates.reduce(
      (count, candidate) => count + candidate.contentFieldCount,
      0,
    ),
    prunedAt: prunedAt.toISOString(),
  });
}

function pruneEvidence(value: Prisma.JsonValue): Prisma.InputJsonValue {
  if (value === null) return {};
  if (Array.isArray(value)) return value.map(pruneEvidence);
  if (typeof value !== "object") return value;
  const output: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) continue;
    if (CONTENT_KEYS.has(key)) {
      output[`${key}Pruned`] = true;
      continue;
    }
    output[key] = pruneEvidence(child);
  }
  return output;
}

function countContentFields(value: Prisma.JsonValue | null): number {
  if (value === null) return 0;
  if (Array.isArray(value)) {
    return value.reduce<number>(
      (count, child) => count + countContentFields(child),
      0,
    );
  }
  if (typeof value !== "object") return 0;
  return Object.entries(value).reduce(
    (count, [key, child]) =>
      count +
      (CONTENT_KEYS.has(key) ? 1 : 0) +
      (child === undefined ? 0 : countContentFields(child)),
    0,
  );
}

function addPruneMetadata(
  value: Prisma.InputJsonValue,
  prunedAt: Date,
  retentionDays: number,
  memberId: string,
): Prisma.InputJsonValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      evidence: value,
      retentionPrunedAt: prunedAt.toISOString(),
      retentionDays,
      prunedBy: memberId,
    };
  }
  return {
    ...value,
    retentionPrunedAt: prunedAt.toISOString(),
    retentionDays,
    prunedBy: memberId,
  };
}

function createPrunePreviewToken(
  projectId: string,
  retentionDays: number,
  candidates: Array<{
    receipt: {
      receipt_id: string;
      mdfcn_dt: Date;
      items: Array<{ item_id: string; mdfcn_dt: Date }>;
      batches: Array<{ batch_id: string; mdfcn_dt: Date }>;
    };
    contentFieldCount: number;
  }>,
) {
  const previewState = {
    projectId,
    retentionDays,
    candidates: candidates.map((candidate) => ({
      receiptId: candidate.receipt.receipt_id,
      modifiedAt: candidate.receipt.mdfcn_dt.toISOString(),
      contentFieldCount: candidate.contentFieldCount,
      items: candidate.receipt.items.map((item) => ({
        itemId: item.item_id,
        modifiedAt: item.mdfcn_dt.toISOString(),
      })),
      batches: candidate.receipt.batches.map((batch) => ({
        batchId: batch.batch_id,
        modifiedAt: batch.mdfcn_dt.toISOString(),
      })),
    })),
  };
  return createHash("sha256")
    .update(JSON.stringify(previewState))
    .digest("hex");
}
