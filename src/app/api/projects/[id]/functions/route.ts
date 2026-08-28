/**
 * GET  /api/projects/[id]/functions — 기능 목록 조회 (FID-00167)
 * POST /api/projects/[id]/functions — 기능 생성 + 이력 (FID-00172)
 *
 * GET Query: areaId? (선택적 영역 필터), unitWorkId? (선택적 단위업무 필터 — GNB 단위업무 고정)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { getIdPrefix } from "@/lib/idPrefix";
import { computeNextDisplayId } from "@/lib/nextDisplayId";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { functionCreateSchema } from "@/lib/specContentSchemas";
import { listMeaningfulFields } from "@/lib/specContentFieldPolicy";
import { requireSpecCreateFields } from "@/lib/specContentWritePolicy";
import { fetchProjectFunctions } from "@/lib/exports/functions-data";
import { applyTemplateVars } from "@/lib/templateVars";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 기능 목록 조회 ─────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const url        = new URL(request.url);
  const areaId     = url.searchParams.get("areaId") ?? undefined;
  const unitWorkId = url.searchParams.get("unitWorkId") ?? undefined;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    // 데이터 조회+가공 로직은 service 로 분리 — export 라우트와 동일 결과 보장
    const items = await fetchProjectFunctions({ projectId, areaId, unitWorkId });
    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/functions] DB 오류:`, err);
    return apiError("DB_ERROR", "기능 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 기능 생성 + 이력 ──────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  const parsed = await parseJsonBody(request, functionCreateSchema);
  if (parsed instanceof Response) return parsed;
  const {
    areaId, displayId: inputDisplayId, name, type, description, priority, complexity, effort,
    assignMemberId, sortOrder,
  } = parsed.data;
  const fieldError = requireSpecCreateFields(gate, "FUNCTION", listMeaningfulFields(parsed.data));
  if (fieldError) return fieldError;

  if (areaId) {
    const parentArea = await prisma.tbDsArea.findFirst({
      where: { area_id: areaId, prjct_id: projectId },
      select: { area_id: true },
    });
    if (!parentArea) return apiError("NOT_FOUND", "영역을 찾을 수 없습니다.", 404);
  }

  // 장문 텍스트 한도 검증 — 정책은 src/lib/constants/textLimits.ts
  const limitErr = apiTextLimitGuard([
    ["name",        name],
    ["displayId",   inputDisplayId],
    ["description", description],
  ]);
  if (limitErr) return limitErr;

  try {
    // displayId — 사용자 입력값이 있으면 사용, 없으면 FN-NNNNN 형식 자동 생성
    let displayId: string;
    if (inputDisplayId?.trim()) {
      displayId = inputDisplayId.trim();
    } else {
      const fnPrefix = await getIdPrefix(projectId, "FUNCTION");
      const existing = await prisma.tbDsFunction.findMany({
        where:  { prjct_id: projectId },
        select: { func_display_id: true },
      });
      displayId = computeNextDisplayId(existing.map((f) => f.func_display_id), fnPrefix);
    }

    const maxSort = await prisma.tbDsFunction.aggregate({
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

    const fn = await prisma.$transaction(async (tx) => {
      const created = await tx.tbDsFunction.create({
        data: {
          prjct_id:        projectId,
          area_id:         areaId || null,
          func_display_id: displayId,
          func_nm:         name.trim(),
          func_ty_code:    type || "OTHER",
          func_dc:         newDescription,
          priort_code:     priority || "MEDIUM",
          cmplx_code:      complexity || "MEDIUM",
          impl_efrt_val:   effort?.trim() || null,
          asign_mber_id:   assignMemberId || null,
          sort_ordr:       nextSort,
          creat_mber_id:   gate.mberId,
        },
      });
      await tx.tbDsDesignChange.create({
        data: {
          prjct_id:      projectId,
          ref_tbl_nm:    "tb_ds_function",
          ref_id:        created.func_id,
          chg_type_code: "CREATE",
          chg_rsn_cn:    "기능 생성",
          snapshot_data: {
            funcId:    created.func_id,
            displayId,
            name:      name.trim(),
            type:      type || "OTHER",
          },
          chg_mber_id: gate.mberId,
        },
      });
      return created;
    });

    return apiSuccess({ funcId: fn.func_id, displayId }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/functions] DB 오류:`, err);
    return apiError("DB_ERROR", "기능 생성에 실패했습니다.", 500);
  }
}
