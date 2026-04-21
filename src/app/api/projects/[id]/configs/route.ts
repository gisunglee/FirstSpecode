/**
 * GET  /api/projects/[id]/configs — 환경설정 목록 (그룹별)
 * POST /api/projects/[id]/configs — 설정 항목 추가
 * PUT  /api/projects/[id]/configs — 설정값 일괄 저장
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// ── GET: 설정 목록 (그룹별 묶어서 반환) ─────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    const configs = await prisma.tbPjProjectConfig.findMany({
      where: { prjct_id: projectId },
      orderBy: [{ config_group: "asc" }, { sort_ordr: "asc" }],
    });

    // 그룹별로 묶기
    const groupMap = new Map<string, typeof configs>();
    for (const c of configs) {
      const list = groupMap.get(c.config_group) ?? [];
      list.push(c);
      groupMap.set(c.config_group, list);
    }

    const groups = Array.from(groupMap.entries()).map(([group, items]) => ({
      group,
      items: items.map((c) => ({
        configId:      c.config_id,
        key:           c.config_key,
        value:         c.config_value,
        label:         c.config_label,
        description:   c.config_dc,
        valueType:     c.value_type,
        defaultValue:  c.default_value,
        selectOptions: c.select_options,
        sortOrder:     c.sort_ordr,
      })),
    }));

    return apiSuccess({ groups });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/configs]`, err);
    return apiError("DB_ERROR", "환경설정 조회에 실패했습니다.", 500);
  }
}

// ── POST: 설정 항목 추가 ────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "config.manage");
  if (gate instanceof Response) return gate;

  let body: {
    group?: string; key?: string; label?: string; description?: string;
    valueType?: string; defaultValue?: string; selectOptions?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const key = body.key?.trim().toUpperCase();
  if (!key) return apiError("VALIDATION_ERROR", "설정 키를 입력해 주세요.", 400);
  if (!body.label?.trim()) return apiError("VALIDATION_ERROR", "설정명을 입력해 주세요.", 400);

  const validTypes = ["BOOLEAN", "TEXT", "SELECT", "NUMBER"];
  const valueType = body.valueType ?? "TEXT";
  if (!validTypes.includes(valueType)) {
    return apiError("VALIDATION_ERROR", `값 유형은 ${validTypes.join(", ")} 중 하나여야 합니다.`, 400);
  }

  try {
    // 키 중복 확인
    const existing = await prisma.tbPjProjectConfig.findUnique({
      where: { prjct_id_config_key: { prjct_id: projectId, config_key: key } },
    });
    if (existing) return apiError("CONFLICT", "이미 존재하는 설정 키입니다.", 409);

    // 정렬순서: 같은 그룹 내 마지막 + 1
    const group = body.group?.trim() || "GENERAL";
    const maxSort = await prisma.tbPjProjectConfig.findFirst({
      where: { prjct_id: projectId, config_group: group },
      orderBy: { sort_ordr: "desc" },
      select: { sort_ordr: true },
    });

    const defaultValue = body.defaultValue?.trim() ?? "";

    const config = await prisma.tbPjProjectConfig.create({
      data: {
        prjct_id:       projectId,
        config_group:   group,
        config_key:     key,
        config_value:   defaultValue,
        config_label:   body.label!.trim(),
        config_dc:      body.description?.trim() ?? null,
        value_type:     valueType,
        default_value:  defaultValue,
        select_options: body.selectOptions?.length ? body.selectOptions : undefined,
        sort_ordr:      (maxSort?.sort_ordr ?? 0) + 1,
      },
    });

    return apiSuccess({ configId: config.config_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/configs]`, err);
    return apiError("DB_ERROR", "설정 추가에 실패했습니다.", 500);
  }
}

// ── PUT: 설정값 일괄 저장 ───────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "config.manage");
  if (gate instanceof Response) return gate;

  let body: { items: { configId: string; value: string }[] };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return apiError("VALIDATION_ERROR", "저장할 항목이 없습니다.", 400);
  }

  try {
    const now = new Date();
    await prisma.$transaction(
      body.items.map((item) =>
        prisma.tbPjProjectConfig.update({
          where: { config_id: item.configId },
          data:  { config_value: item.value, mdfcn_dt: now },
        })
      )
    );

    return apiSuccess({ updated: body.items.length });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/configs]`, err);
    return apiError("DB_ERROR", "설정 저장에 실패했습니다.", 500);
  }
}
