/**
 * GET  /api/admin/config-templates — 시스템 환경설정 템플릿 목록 (그룹별)
 * POST /api/admin/config-templates — 템플릿 항목 추가
 *
 * 권한: SUPER_ADMIN 전용 (requireSystemAdmin).
 *
 * 역할:
 *   - tb_sys_config_template 전체를 config_group / sort_ordr 로 정렬 반환
 *   - 이 테이블은 프로젝트 생성 시 tb_pj_project_config 로 복사될 "원본"
 *   - 여기 변경은 이미 생성된 프로젝트에는 자동 반영되지 않음을 UI 에서 안내
 *     (자동 전파는 운영 사고 위험 → 의도적으로 분리)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { apiSuccess, apiError } from "@/lib/apiResponse";

// ── GET: 템플릿 목록 (그룹별) ────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  try {
    const rows = await prisma.tbSysConfigTemplate.findMany({
      orderBy: [{ config_group: "asc" }, { sort_ordr: "asc" }],
    });

    // 기존 프로젝트 configs API 응답 형태와 동일하게 그룹 묶음 구조로 반환
    // → 화면(컴포넌트)을 거의 그대로 재사용하기 위함
    const groupMap = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = groupMap.get(r.config_group) ?? [];
      list.push(r);
      groupMap.set(r.config_group, list);
    }

    const groups = Array.from(groupMap.entries()).map(([group, items]) => ({
      group,
      items: items.map((r) => ({
        // sysTmplId 를 configId 이름으로 내보내 프로젝트 configs 응답과 호환
        configId:      r.sys_tmpl_id,
        key:           r.config_key,
        // 템플릿에는 config_value 가 없음 — default_value 를 value 자리로 대체
        value:         r.default_value,
        label:         r.config_label,
        description:   r.config_dc,
        valueType:     r.value_type,
        defaultValue:  r.default_value,
        selectOptions: r.select_options,
        sortOrder:     r.sort_ordr,
        useYn:         r.use_yn,
      })),
    }));

    return apiSuccess({ groups });
  } catch (err) {
    console.error("[GET /api/admin/config-templates]", err);
    return apiError("DB_ERROR", "환경설정 템플릿 조회에 실패했습니다.", 500);
  }
}

// ── POST: 템플릿 추가 ────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const gate = await requireSystemAdmin(request);
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
  if (!key)              return apiError("VALIDATION_ERROR", "설정 키를 입력해 주세요.", 400);
  if (!body.label?.trim()) return apiError("VALIDATION_ERROR", "설정명을 입력해 주세요.", 400);

  const validTypes = ["BOOLEAN", "TEXT", "SELECT", "NUMBER"];
  const valueType = body.valueType ?? "TEXT";
  if (!validTypes.includes(valueType)) {
    return apiError("VALIDATION_ERROR", `값 유형은 ${validTypes.join(", ")} 중 하나여야 합니다.`, 400);
  }

  try {
    // 키는 전역 유니크 — 프로젝트 설정으로 복사 시 (prjct_id, config_key) 충돌 방지
    const existing = await prisma.tbSysConfigTemplate.findUnique({
      where: { config_key: key },
    });
    if (existing) return apiError("CONFLICT", "이미 존재하는 설정 키입니다.", 409);

    const group = body.group?.trim() || "GENERAL";
    const maxSort = await prisma.tbSysConfigTemplate.findFirst({
      where:   { config_group: group },
      orderBy: { sort_ordr: "desc" },
      select:  { sort_ordr: true },
    });

    const defaultValue = body.defaultValue?.trim() ?? "";

    const created = await prisma.tbSysConfigTemplate.create({
      data: {
        config_group:   group,
        config_key:     key,
        config_label:   body.label!.trim(),
        config_dc:      body.description?.trim() ?? null,
        value_type:     valueType,
        default_value:  defaultValue,
        select_options: body.selectOptions?.length ? body.selectOptions : undefined,
        sort_ordr:      (maxSort?.sort_ordr ?? 0) + 1,
      },
    });

    return apiSuccess({ configId: created.sys_tmpl_id }, 201);
  } catch (err) {
    console.error("[POST /api/admin/config-templates]", err);
    return apiError("DB_ERROR", "환경설정 템플릿 추가에 실패했습니다.", 500);
  }
}
