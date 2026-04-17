/**
 * GET /api/projects/[id]/settings/ai — AI 설정 조회 (FID-00077)
 * PUT /api/projects/[id]/settings/ai — AI 호출 방식 저장 (FID-00081)
 *
 * 역할:
 *   - API 키 목록 (마스킹) + 현재 AI 호출 방식 반환
 *   - AI 호출 방식 변경 (DIRECT / QUEUE) 및 이력 기록
 *   - OWNER/ADMIN만 접근 가능
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

const VALID_CALL_METHODS = ["DIRECT", "QUEUE"] as const;

// OWNER/ADMIN 권한 확인 공통 함수
async function checkAdminAccess(projectId: string, mberId: string) {
  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") return null;
  if (!["OWNER", "ADMIN"].includes(membership.role_code)) return null;
  return membership;
}

// ─── GET: AI 설정 조회 ────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  if (!await checkAdminAccess(projectId, auth.mberId)) {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const [apiKeys, settings] = await Promise.all([
      prisma.tbPjProjectApiKey.findMany({
        where: { prjct_id: projectId },
        select: {
          api_key_id: true,
          provdr_nm:  true,
          mask_key_val: true,
          creat_dt:   true,
        },
        orderBy: { creat_dt: "asc" },
      }),
      prisma.tbPjProjectSettings.findUnique({
        where: { prjct_id: projectId },
        select: { ai_call_mthd_code: true },
      }),
    ]);

    return apiSuccess({
      apiKeys: apiKeys.map((k) => ({
        keyId:      k.api_key_id,
        provider:   k.provdr_nm,
        maskedKey:  k.mask_key_val,
      })),
      callMethod: settings?.ai_call_mthd_code ?? "DIRECT",
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/settings/ai] DB 오류:`, err);
    return apiError("DB_ERROR", "AI 설정 조회에 실패했습니다.", 500);
  }
}

// ─── PUT: AI 호출 방식 저장 ───────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  const membership = await checkAdminAccess(projectId, auth.mberId);
  if (!membership) {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { callMethod } = body as { callMethod?: string };

  if (!callMethod || !(VALID_CALL_METHODS as readonly string[]).includes(callMethod)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 호출 방식입니다. (DIRECT 또는 QUEUE)", 400);
  }

  try {
    // 현재 설정값 조회 (변경 이력용)
    const current = await prisma.tbPjProjectSettings.findUnique({
      where: { prjct_id: projectId },
      select: { ai_call_mthd_code: true },
    });
    const prevMethod = current?.ai_call_mthd_code ?? "DIRECT";

    await prisma.$transaction(async (tx) => {
      // 설정 업데이트
      await tx.tbPjProjectSettings.update({
        where: { prjct_id: projectId },
        data: { ai_call_mthd_code: callMethod, mdfcn_dt: new Date() },
      });

      // 변경 이력 기록 (값이 실제로 바뀐 경우만)
      if (prevMethod !== callMethod) {
        await tx.tbPjSettingsHistory.create({
          data: {
            prjct_id:    projectId,
            chg_mber_id: auth.mberId,
            chg_item_nm: "AI 호출 방식",
            bfr_val_cn:  prevMethod,
            aftr_val_cn: callMethod,
          },
        });
      }
    });

    return apiSuccess({ callMethod });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/settings/ai] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}
