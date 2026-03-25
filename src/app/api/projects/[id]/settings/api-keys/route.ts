/**
 * POST /api/projects/[id]/settings/api-keys — AI API 키 등록 (FID-00078)
 *
 * 역할:
 *   - API 키 원문 AES 암호화 저장
 *   - 마스킹 생성 (sk-****1234)
 *   - 등록 이력 기록
 *   - OWNER/ADMIN만 접근 가능
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { encryptApiKey, maskApiKey } from "@/lib/encrypt";

type RouteParams = { params: Promise<{ id: string }> };

async function checkAdminAccess(projectId: string, mberId: string) {
  const m = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: mberId } },
  });
  if (!m || m.mber_sttus_code !== "ACTIVE") return null;
  if (!["OWNER", "ADMIN"].includes(m.role_code)) return null;
  return m;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  if (!await checkAdminAccess(projectId, auth.mberId)) {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { provider, apiKey } = body as { provider?: string; apiKey?: string };

  if (!provider?.trim()) {
    return apiError("VALIDATION_ERROR", "프로바이더명을 입력해 주세요.", 400);
  }
  if (!apiKey?.trim()) {
    return apiError("VALIDATION_ERROR", "API 키를 입력해 주세요.", 400);
  }

  try {
    const encryptedKey = encryptApiKey(apiKey.trim());
    const maskedKey    = maskApiKey(apiKey.trim());

    const created = await prisma.$transaction(async (tx) => {
      const key = await tx.tbPjProjectApiKey.create({
        data: {
          prjct_id:     projectId,
          provdr_nm:    provider.trim(),
          encpt_key_val: encryptedKey,
          mask_key_val:  maskedKey,
        },
      });

      // 등록 이력
      await tx.tbPjSettingsHistory.create({
        data: {
          prjct_id:    projectId,
          chg_mber_id: auth.mberId,
          chg_item_nm: "API 키 등록",
          aftr_val_cn: `${provider.trim()} (${maskedKey})`,
        },
      });

      return key;
    });

    return apiSuccess({
      keyId:     created.api_key_id,
      provider:  created.provdr_nm,
      maskedKey: created.mask_key_val,
    });
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/settings/api-keys] DB 오류:`, err);
    return apiError("DB_ERROR", "키 등록 중 오류가 발생했습니다.", 500);
  }
}
