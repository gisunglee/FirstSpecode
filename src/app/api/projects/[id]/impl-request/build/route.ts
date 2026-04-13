/**
 * POST /api/projects/[id]/impl-request/build — 2단계: 프롬프트 생성 (미리보기용)
 *
 * 역할:
 *   - 선택된 기능 기준 4계층 수집 → diff 계산 → 프롬프트 렌더링
 *   - DB 저장 없음 — 프롬프트 생성만 해서 반환
 *   - 사용자가 미리보기로 확인 후 "최종 요청"에서 실제 저장
 */

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/requireAuth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { collectLayers } from "@/lib/impl-request/collector";
import { renderImplPrompt } from "@/lib/impl-request/renderer";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;
  const { id: projectId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  let body: { entryType: string; entryId: string; functionIds: string[]; comentCn?: string };
  try { body = await request.json(); } catch { return apiError("VALIDATION_ERROR", "올바른 JSON이 아닙니다.", 400); }

  if (!body.entryType || !body.entryId) {
    return apiError("VALIDATION_ERROR", "entryType과 entryId는 필수입니다.", 400);
  }
  if (!body.functionIds?.length) {
    return apiError("VALIDATION_ERROR", "기능을 1개 이상 선택해 주세요.", 400);
  }

  try {
    // 선택된 기능 기준으로 4계층 수집 + diff 계산
    const layers = await collectLayers(body.entryType, body.entryId, body.functionIds, projectId);

    if (layers.length === 0) {
      return apiError("NOT_FOUND", "대상 설계서를 찾을 수 없습니다.", 404);
    }

    // 프롬프트 렌더링 (DB 저장 없음)
    const promptMd = renderImplPrompt(layers, body.comentCn);

    return apiSuccess({ promptMd });
  } catch (err) {
    console.error("[POST /impl-request/build]", err);
    return apiError("DB_ERROR", "프롬프트 생성에 실패했습니다.", 500);
  }
}
