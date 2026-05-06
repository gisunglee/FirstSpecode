/**
 * GET  /api/projects/[id]/configs — 환경설정 목록 (그룹별)
 * PUT  /api/projects/[id]/configs — 설정값 일괄 저장
 *
 * [2026-05-06] POST(설정 항목 추가) 제거:
 *   - 새 환경설정 항목은 SPECODE 자체 동작을 제어하는 키이므로 코드 변경과 짝을 이룬다
 *     → 일반 프로젝트 멤버가 임의로 추가할 일이 없음.
 *   - 시스템 관리자는 /admin/config-templates 에서 시스템 표준 템플릿으로 등록한다.
 *     새 프로젝트는 생성 시 default_value='Y' 인 항목들을 자동 복사받는다
 *     (POST /api/projects 의 sysTmpls 복사 로직).
 *   - 기존 프로젝트에 이미 추가됐던 커스텀 항목은 보존됨 (PUT 으로 값 수정만 가능).
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
