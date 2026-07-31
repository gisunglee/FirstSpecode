/**
 * GET /api/projects/[id]/spec-reconciliations — 스펙 반영함 목록 (FID-00211)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(request, projectId, "specReconcile.read");
  if (gate instanceof Response) return gate;

  const url = new URL(request.url);
  const status = url.searchParams.get("status")?.trim() || null;
  const limitRaw = Number(url.searchParams.get("limit") ?? 100);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200)
    : 100;

  try {
    const receipts = await prisma.tbSpImplReceipt.findMany({
      where: {
        prjct_id: projectId,
        ...(status ? { receipt_sttus_code: status } : {}),
      },
      orderBy: { creat_dt: "desc" },
      take: limit,
      select: {
        receipt_id:           true,
        origin_ty_code:       true,
        ai_task_id:           true,
        checkpoint_ty_code:   true,
        base_checkpoint_val:  true,
        head_checkpoint_val:  true,
        evidence_trust_code:  true,
        evidence_verify_code: true,
        summary_cn:           true,
        receipt_sttus_code:   true,
        review_sttus_code:    true,
        submit_mber_id:       true,
        creat_dt:             true,
        close_dt:             true,
        items: {
          select: {
            item_sttus_code: true,
            risk_code:       true,
          },
        },
      },
    });

    const memberIds = Array.from(new Set(
      receipts
        .map((receipt) => receipt.submit_mber_id)
        .filter((id): id is string => Boolean(id)),
    ));
    const members = memberIds.length === 0
      ? []
      : await prisma.tbCmMember.findMany({
          where: { mber_id: { in: memberIds } },
          select: { mber_id: true, mber_nm: true, email_addr: true },
        });
    const memberName = new Map(
      members.map((member) => [
        member.mber_id,
        member.mber_nm || member.email_addr || member.mber_id,
      ]),
    );

    return apiSuccess({
      items: receipts.map((receipt) => ({
        receiptId:          receipt.receipt_id,
        originType:         receipt.origin_ty_code,
        aiTaskId:           receipt.ai_task_id,
        checkpointType:     receipt.checkpoint_ty_code,
        baseCheckpoint:     receipt.base_checkpoint_val,
        headCheckpoint:     receipt.head_checkpoint_val,
        evidenceTrust:      receipt.evidence_trust_code,
        evidenceVerify:     receipt.evidence_verify_code,
        summary:            receipt.summary_cn ?? "",
        status:             receipt.receipt_sttus_code,
        reviewStatus:       receipt.review_sttus_code,
        submitMemberId:     receipt.submit_mber_id,
        submitMemberName:   receipt.submit_mber_id
          ? memberName.get(receipt.submit_mber_id) ?? receipt.submit_mber_id
          : "시스템",
        itemCount:          receipt.items.length,
        unresolvedCount:    receipt.items.filter(
          (item) => ![
            "APPLIED",
            "NO_SPEC_CHANGE",
            "RESOLVED",
            "ROLLED_BACK",
          ].includes(
            item.item_sttus_code,
          ),
        ).length,
        highestRisk:        highestRisk(receipt.items.map((item) => item.risk_code)),
        createdAt:          receipt.creat_dt.toISOString(),
        closedAt:           receipt.close_dt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    console.error(`[GET /api/projects/${projectId}/spec-reconciliations] 오류:`, error);
    return apiError("DB_ERROR", "스펙 반영함을 조회하지 못했습니다.", 500);
  }
}

function highestRisk(risks: string[]) {
  const rank = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  return risks.reduce(
    (highest, current) =>
      rank.indexOf(current) > rank.indexOf(highest) ? current : highest,
    "LOW",
  );
}
