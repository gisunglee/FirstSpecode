/**
 * PUT    /api/projects/[id]/configs/[configId] — 설정 항목 메타 수정
 *
 * [2026-05-06] DELETE 제거:
 *   - 환경설정 항목은 SPECODE 코드가 직접 참조하는 키이므로 임의 삭제 시 동작 깨짐.
 *   - 항목 자체 폐기는 시스템 관리자가 /admin/config-templates 에서 use_yn=N 처리하거나
 *     DB 직접 정리. 프로젝트 단위 UI 에서는 노출하지 않는다.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; configId: string }> };

// ── PUT: 설정 항목 메타 수정 (그룹, 키, 설정명, 설명, 유형, 기본값, 선택지) ──
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, configId } = await params;

  const gate = await requirePermission(request, projectId, "config.manage");
  if (gate instanceof Response) return gate;

  let body: {
    group?: string; key?: string; label?: string; description?: string;
    valueType?: string; value?: string; defaultValue?: string; selectOptions?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  try {
    const config = await prisma.tbPjProjectConfig.findUnique({
      where: { config_id: configId },
    });
    if (!config || config.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "설정 항목을 찾을 수 없습니다.", 404);
    }

    // 키 변경 시 중복 확인
    const newKey = body.key?.trim().toUpperCase();
    if (newKey && newKey !== config.config_key) {
      const dup = await prisma.tbPjProjectConfig.findUnique({
        where: { prjct_id_config_key: { prjct_id: projectId, config_key: newKey } },
      });
      if (dup) return apiError("CONFLICT", "이미 존재하는 설정 키입니다.", 409);
    }

    const validTypes = ["BOOLEAN", "TEXT", "SELECT", "NUMBER"];
    if (body.valueType && !validTypes.includes(body.valueType)) {
      return apiError("VALIDATION_ERROR", `값 유형은 ${validTypes.join(", ")} 중 하나여야 합니다.`, 400);
    }

    await prisma.tbPjProjectConfig.update({
      where: { config_id: configId },
      data: {
        ...(body.group     != null ? { config_group:  body.group.trim() || "GENERAL" } : {}),
        ...(newKey                 ? { config_key:    newKey } : {}),
        ...(body.label     != null ? { config_label:  body.label.trim() } : {}),
        ...(body.description !== undefined ? { config_dc: body.description?.trim() || null } : {}),
        ...(body.valueType != null ? { value_type:    body.valueType } : {}),
        ...(body.value    != null ? { config_value:  body.value } : {}),
        ...(body.defaultValue != null ? { default_value: body.defaultValue.trim() } : {}),
        ...(body.selectOptions !== undefined ? { select_options: body.selectOptions?.length ? body.selectOptions : [] } : {}),
        mdfcn_dt: new Date(),
      },
    });

    return apiSuccess({ updated: true });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/configs/${configId}]`, err);
    return apiError("DB_ERROR", "설정 수정에 실패했습니다.", 500);
  }
}

