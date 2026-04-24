/**
 * PUT    /api/admin/config-templates/[sysTmplId] — 템플릿 메타/값 수정
 * DELETE /api/admin/config-templates/[sysTmplId] — 템플릿 삭제
 *
 * 권한: SUPER_ADMIN 전용.
 *
 * 주의:
 *   - 여기서 기본값/메타를 바꿔도 이미 생성된 프로젝트의 설정에는 반영되지
 *     않는다. 자동 전파는 운영 중 프로젝트의 설정을 덮어쓸 위험이 커서
 *     의도적으로 차단. 일괄 전파가 필요하면 별도 백필 SQL을 돌린다.
 *
 *   - 프로젝트 configs PUT 과 달리 여기서는 config_value 를 받지 않는다.
 *     템플릿은 "기본값 정의서"일 뿐 실제 값은 프로젝트 설정에만 존재.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ sysTmplId: string }> };

// ── PUT: 템플릿 수정 ────────────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { sysTmplId } = await params;

  let body: {
    group?: string; key?: string; label?: string; description?: string;
    valueType?: string; defaultValue?: string; selectOptions?: string[];
    useYn?: string;
  };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  try {
    const tmpl = await prisma.tbSysConfigTemplate.findUnique({
      where: { sys_tmpl_id: sysTmplId },
    });
    if (!tmpl) {
      return apiError("NOT_FOUND", "템플릿을 찾을 수 없습니다.", 404);
    }

    // 키 변경 시 중복 확인 (전역 유니크)
    const newKey = body.key?.trim().toUpperCase();
    if (newKey && newKey !== tmpl.config_key) {
      const dup = await prisma.tbSysConfigTemplate.findUnique({
        where: { config_key: newKey },
      });
      if (dup) return apiError("CONFLICT", "이미 존재하는 설정 키입니다.", 409);
    }

    const validTypes = ["BOOLEAN", "TEXT", "SELECT", "NUMBER"];
    if (body.valueType && !validTypes.includes(body.valueType)) {
      return apiError("VALIDATION_ERROR", `값 유형은 ${validTypes.join(", ")} 중 하나여야 합니다.`, 400);
    }

    await prisma.tbSysConfigTemplate.update({
      where: { sys_tmpl_id: sysTmplId },
      data: {
        ...(body.group        != null      ? { config_group:  body.group.trim() || "GENERAL" } : {}),
        ...(newKey                          ? { config_key:    newKey } : {}),
        ...(body.label        != null      ? { config_label:  body.label.trim() } : {}),
        ...(body.description  !== undefined ? { config_dc:     body.description?.trim() || null } : {}),
        ...(body.valueType    != null      ? { value_type:    body.valueType } : {}),
        ...(body.defaultValue != null      ? { default_value: body.defaultValue.trim() } : {}),
        ...(body.selectOptions !== undefined ? { select_options: body.selectOptions?.length ? body.selectOptions : [] } : {}),
        ...(body.useYn        != null      ? { use_yn:        body.useYn === "N" ? "N" : "Y" } : {}),
        mdfcn_dt: new Date(),
      },
    });

    return apiSuccess({ updated: true });
  } catch (err) {
    console.error(`[PUT /api/admin/config-templates/${sysTmplId}]`, err);
    return apiError("DB_ERROR", "템플릿 수정에 실패했습니다.", 500);
  }
}

// ── DELETE: 템플릿 삭제 ─────────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { sysTmplId } = await params;

  try {
    const tmpl = await prisma.tbSysConfigTemplate.findUnique({
      where:  { sys_tmpl_id: sysTmplId },
      select: { sys_tmpl_id: true },
    });
    if (!tmpl) {
      return apiError("NOT_FOUND", "템플릿을 찾을 수 없습니다.", 404);
    }

    await prisma.tbSysConfigTemplate.delete({
      where: { sys_tmpl_id: sysTmplId },
    });

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/admin/config-templates/${sysTmplId}]`, err);
    return apiError("DB_ERROR", "템플릿 삭제에 실패했습니다.", 500);
  }
}
