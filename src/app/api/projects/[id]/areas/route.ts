/**
 * GET  /api/projects/[id]/areas — 영역 목록 조회 (FID-00151)
 * POST /api/projects/[id]/areas — 영역 생성 + 이력 (FID-00154)
 *
 * GET Query: screenId? (선택적 화면 필터), unitWorkId? (선택적 단위업무 필터 — GNB 단위업무 고정)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { getIdPrefix } from "@/lib/idPrefix";
import { computeNextDisplayId } from "@/lib/nextDisplayId";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { areaCreateSchema } from "@/lib/specContentSchemas";
import { listMeaningfulFields } from "@/lib/specContentFieldPolicy";
import { requireSpecCreateFields } from "@/lib/specContentWritePolicy";
import { fetchProjectAreas } from "@/lib/exports/areas-data";
import { applyTemplateVars } from "@/lib/templateVars";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 영역 목록 조회 ────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const url       = new URL(request.url);
  const screenId  = url.searchParams.get("screenId") ?? undefined;
  const unitWorkId = url.searchParams.get("unitWorkId") ?? undefined;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    // 데이터 조회+가공 로직은 service 로 분리 — export 라우트와 동일 결과 보장
    const items = await fetchProjectAreas({ projectId, screenId, unitWorkId });
    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/areas] DB 오류:`, err);
    return apiError("DB_ERROR", "영역 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 영역 생성 + 이력 ──────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  const parsed = await parseJsonBody(request, areaCreateSchema);
  if (parsed instanceof Response) return parsed;
  const { screenId, name, type, displayFormCode, description, sortOrder, displayId: inputDisplayId } = parsed.data;
  const fieldError = requireSpecCreateFields(gate, "AREA", listMeaningfulFields(parsed.data));
  if (fieldError) return fieldError;

  if (screenId) {
    const parentScreen = await prisma.tbDsScreen.findFirst({
      where: { scrn_id: screenId, prjct_id: projectId },
      select: { scrn_id: true },
    });
    if (!parentScreen) return apiError("NOT_FOUND", "화면을 찾을 수 없습니다.", 404);
  }

  // 장문 텍스트 한도 검증 — 정책은 src/lib/constants/textLimits.ts
  const limitErr = apiTextLimitGuard([
    ["name",        name],
    ["displayId",   inputDisplayId],
    ["description", description],
  ]);
  if (limitErr) return limitErr;

  try {
    // displayId — 사용자 입력값이 있으면 사용, 없으면 AR-NNNNN 자동 생성
    let displayId: string;
    if (inputDisplayId?.trim()) {
      displayId = inputDisplayId.trim();
    } else {
      const arPrefix = await getIdPrefix(projectId, "AREA");
      const existing = await prisma.tbDsArea.findMany({
        where:  { prjct_id: projectId },
        select: { area_display_id: true },
      });
      displayId = computeNextDisplayId(existing.map((a) => a.area_display_id), arPrefix);
    }

    // 정렬순서 기본값: 현재 최대 + 1
    const maxSort = await prisma.tbDsArea.aggregate({
      where: { prjct_id: projectId },
      _max:  { sort_ordr: true },
    });
    const nextSort = sortOrder ?? (maxSort._max.sort_ordr ?? 0) + 1;

    // 템플릿 플레이스홀더({{displayId}}/{{name}}) 안전망 — MCP 등 "템플릿 삽입" 버튼을
    // 거치지 않는 경로로 저장될 때도 실제 값으로 치환되도록 저장 직전에 한 번 더 통과시킴.
    const trimmedDescription = description?.trim() || null;
    const newDescription = trimmedDescription
      ? applyTemplateVars(trimmedDescription, { displayId, name: name.trim() })
      : trimmedDescription;

    const area = await prisma.$transaction(async (tx) => {
      const created = await tx.tbDsArea.create({
        data: {
          prjct_id:       projectId,
          scrn_id:        screenId || null,
          area_display_id: displayId,
          area_nm:        name.trim(),
          // 유형 — 미전송 시 LIST(데이터 목록) 기본
          area_ty_code:   type || "LIST",
          // 표시 형태 — 미전송 시 STATIC(고정) 기본
          display_form_code: displayFormCode || "STATIC",
          area_dc:        newDescription,
          sort_ordr:      nextSort,
          creat_mber_id:  gate.mberId,
        },
      });
      await tx.tbDsDesignChange.create({
        data: {
          prjct_id:      projectId,
          ref_tbl_nm:    "tb_ds_area",
          ref_id:        created.area_id,
          chg_type_code: "CREATE",
          chg_rsn_cn:    "영역 생성",
          snapshot_data: {
            areaId:    created.area_id,
            displayId,
            name:      name.trim(),
            type:      type || "LIST",
          },
          chg_mber_id: gate.mberId,
        },
      });
      return created;
    });

    return apiSuccess({ areaId: area.area_id, displayId }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/areas] DB 오류:`, err);
    return apiError("DB_ERROR", "영역 생성에 실패했습니다.", 500);
  }
}
