/**
 * PUT    /api/projects/[id]/settings/api-keys/[keyId] — AI API 키 수정 (FID-00079)
 * DELETE /api/projects/[id]/settings/api-keys/[keyId] — AI API 키 삭제 (FID-00080)
 *
 * apiKey.manage 권한(OWNER/ADMIN) 보유자만 접근 가능.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { encryptApiKey, maskApiKey } from "@/lib/encrypt";

type RouteParams = { params: Promise<{ id: string; keyId: string }> };

// ─── PUT: API 키 수정 ─────────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, keyId } = await params;

  const gate = await requirePermission(request, projectId, "apiKey.manage");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { apiKey } = body as { apiKey?: string };
  if (!apiKey?.trim()) {
    return apiError("VALIDATION_ERROR", "API 키를 입력해 주세요.", 400);
  }

  // 기존 키 확인 (프로젝트 소속 검증 + 이전 마스킹값 이력용)
  const existing = await prisma.tbPjProjectApiKey.findFirst({
    where: { api_key_id: keyId, prjct_id: projectId },
  });
  if (!existing) {
    return apiError("NOT_FOUND", "API 키를 찾을 수 없습니다.", 404);
  }

  try {
    const newEncrypted = encryptApiKey(apiKey.trim());
    const newMasked    = maskApiKey(apiKey.trim());

    await prisma.$transaction(async (tx) => {
      await tx.tbPjProjectApiKey.update({
        where: { api_key_id: keyId },
        data: {
          encpt_key_val: newEncrypted,
          mask_key_val:  newMasked,
          mdfcn_dt:      new Date(),
        },
      });

      await tx.tbPjSettingsHistory.create({
        data: {
          prjct_id:    projectId,
          chg_mber_id: gate.mberId,
          chg_item_nm: "API 키 수정",
          bfr_val_cn:  `${existing.provdr_nm} (${existing.mask_key_val})`,
          aftr_val_cn: `${existing.provdr_nm} (${newMasked})`,
        },
      });
    });

    return apiSuccess({ keyId, maskedKey: newMasked });
  } catch (err) {
    console.error(`[PUT /settings/api-keys/${keyId}] DB 오류:`, err);
    return apiError("DB_ERROR", "키 수정 중 오류가 발생했습니다.", 500);
  }
}

// ─── DELETE: API 키 삭제 ──────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, keyId } = await params;

  const gate = await requirePermission(request, projectId, "apiKey.manage");
  if (gate instanceof Response) return gate;

  const existing = await prisma.tbPjProjectApiKey.findFirst({
    where: { api_key_id: keyId, prjct_id: projectId },
  });
  if (!existing) {
    return apiError("NOT_FOUND", "API 키를 찾을 수 없습니다.", 404);
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.tbPjProjectApiKey.delete({ where: { api_key_id: keyId } });

      await tx.tbPjSettingsHistory.create({
        data: {
          prjct_id:    projectId,
          chg_mber_id: gate.mberId,
          chg_item_nm: "API 키 삭제",
          bfr_val_cn:  `${existing.provdr_nm} (${existing.mask_key_val})`,
        },
      });
    });

    return apiSuccess({ ok: true });
  } catch (err) {
    console.error(`[DELETE /settings/api-keys/${keyId}] DB 오류:`, err);
    return apiError("DB_ERROR", "키 삭제 중 오류가 발생했습니다.", 500);
  }
}
