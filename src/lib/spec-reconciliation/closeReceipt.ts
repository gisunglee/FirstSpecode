/**
 * receipt 종료와 source baseline 전진을 한 트랜잭션에서 처리한다.
 *
 * 호출 전제:
 *   - 호출자가 같은 트랜잭션에서 항목 결정을 저장했다.
 *   - APPLIED/NO_SPEC_CHANGE가 아닌 항목은 미해결로 본다.
 *
 * baseline version updateMany가 0건이면 다른 receipt가 먼저 전진한 것이므로
 * 현재 receipt를 STALE_BASELINE으로 남기고 source 기준점은 건드리지 않는다.
 */

import { Prisma } from "@prisma/client";

export type CloseReceiptResult =
  | { closed: false; reason: "UNRESOLVED" | "UNSTABLE_HEAD" | "UNVERIFIED_EVIDENCE" }
  | { closed: true; reason: null };

export class StaleBaselineConflict extends Error {
  constructor(readonly receiptId: string) {
    super("다른 접수가 source baseline을 먼저 전진시켰습니다.");
  }
}

export async function markReceiptStaleBaseline(receiptId: string) {
  const { prisma } = await import("@/lib/prisma");
  await prisma.tbSpImplReceipt.updateMany({
    where: {
      receipt_id: receiptId,
      receipt_sttus_code: { not: "CLOSED" },
    },
    data: {
      receipt_sttus_code: "STALE_BASELINE",
      review_sttus_code: "STALE_BASELINE",
      mdfcn_dt: new Date(),
    },
  });
}

export async function closeReceiptIfResolved(
  tx: Prisma.TransactionClient,
  receiptId: string,
  memberId: string,
): Promise<CloseReceiptResult> {
  const receipt = await tx.tbSpImplReceipt.findUnique({
    where: { receipt_id: receiptId },
    select: {
      receipt_id:            true,
      baseline_id:           true,
      baseline_version_no:   true,
      checkpoint_ty_code:    true,
      head_checkpoint_val:   true,
      head_stable_yn:         true,
      evidence_trust_code:    true,
      evidence_verify_code:   true,
      override_rsn_cn:        true,
      items: {
        where: {
          item_sttus_code: {
            notIn: ["APPLIED", "NO_SPEC_CHANGE", "RESOLVED", "ROLLED_BACK"],
          },
        },
        select: { item_id: true },
        take: 1,
      },
    },
  });

  if (!receipt || receipt.items.length > 0) {
    return { closed: false, reason: "UNRESOLVED" };
  }
  if (receipt.head_stable_yn !== "Y") {
    return { closed: false, reason: "UNSTABLE_HEAD" };
  }
  const evidenceAccepted = ["VERIFIED", "ATTESTED", "OVERRIDDEN"].includes(
    receipt.evidence_verify_code,
  );
  const uploadedHasOverride =
    receipt.evidence_trust_code !== "USER_UPLOADED" ||
    (receipt.evidence_verify_code === "OVERRIDDEN" &&
      Boolean(receipt.override_rsn_cn?.trim()));
  if (!evidenceAccepted || !uploadedHasOverride) {
    return { closed: false, reason: "UNVERIFIED_EVIDENCE" };
  }

  const advanced = await tx.tbSpSourceBaseline.updateMany({
    where: {
      baseline_id:           receipt.baseline_id,
      checkpoint_version_no: receipt.baseline_version_no,
    },
    data: {
      last_reconciled_commit_sha:
        receipt.checkpoint_ty_code === "GIT_COMMIT"
          ? receipt.head_checkpoint_val
          : null,
      last_reconciled_manifest_hash:
        receipt.checkpoint_ty_code === "SOURCE_MANIFEST"
          ? receipt.head_checkpoint_val
          : null,
      checkpoint_version_no: { increment: 1 },
      last_receipt_id:       receipt.receipt_id,
      reconciled_mber_id:    memberId,
      reconciled_dt:         new Date(),
      mdfcn_dt:              new Date(),
    },
  });

  if (advanced.count !== 1) {
    // 호출자의 스펙 변경까지 같은 트랜잭션에서 되돌려야 하므로 여기서 예외를 던진다.
    // 바깥 catch가 rollback 뒤 receipt만 STALE_BASELINE으로 별도 표시한다.
    throw new StaleBaselineConflict(receipt.receipt_id);
  }

  await tx.tbSpImplReceipt.update({
    where: { receipt_id: receipt.receipt_id },
    data: {
      receipt_sttus_code: "CLOSED",
      review_sttus_code:  "CLOSED",
      close_mber_id:      memberId,
      verified_dt:        new Date(),
      close_dt:           new Date(),
      mdfcn_dt:           new Date(),
    },
  });

  return { closed: true, reason: null };
}
