/**
 * PUT    /api/projects/[id]/configs/[configId] — 설정 항목 메타 수정
 * DELETE /api/projects/[id]/configs/[configId] — 설정 항목 삭제
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; configId: string }> };

// ── PUT: 설정 항목 메타 수정 (그룹, 키, 설정명, 설명, 유형, 기본값, 선택지) ──
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, configId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM"]);
  if (roleCheck) return roleCheck;

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

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, configId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM"]);
  if (roleCheck) return roleCheck;

  try {
    const config = await prisma.tbPjProjectConfig.findUnique({
      where: { config_id: configId },
    });

    if (!config || config.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "설정 항목을 찾을 수 없습니다.", 404);
    }

    await prisma.tbPjProjectConfig.delete({ where: { config_id: configId } });

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/configs/${configId}]`, err);
    return apiError("DB_ERROR", "설정 삭제에 실패했습니다.", 500);
  }
}
