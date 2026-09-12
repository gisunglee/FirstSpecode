/**
 * PATCH /api/projects/[id]/areas/[areaId]/inline — 목록 인라인 편집
 *
 * Body: { field: "scopeStatus", value: string }
 *
 * 역할:
 *   - 영역 목록에서 사업 범위 구분(신규/수정/기존/폐기)만 바로 바꾼다.
 *
 * 왜 이 라우트가 따로 있나:
 *   영역 수정(PUT)은 name 이 필수라 값 하나만 바꾸려 해도 전체 본문을 다시
 *   보내야 한다. AS-IS 대량 등록 후 구분을 정정하는 작업에는 맞지 않아
 *   화면·기능과 같은 인라인 패턴을 영역에도 둔다.
 *
 * 권한:
 *   scopeStatus 는 어느 필드 allow-list 에도 없으므로 MANAGER(OWNER/ADMIN, PM/PL)만
 *   통과한다 — specContentFieldPolicy.ts 주석 참조.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import {
  requireSpecContentWrite,
  requireSpecChangedFields,
} from "@/lib/specContentWritePolicy";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { areaInlineSchema } from "@/lib/specContentSchemas";
import { buildMdfcnAudit } from "@/lib/mdfcnSource";
import { parseScopeSttus, SCOPE_STTUS_ERROR_MSG } from "@/lib/scopeStatus";

type RouteParams = { params: Promise<{ id: string; areaId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, areaId } = await params;

  const gate = await requireSpecContentWrite(request, projectId, "AREA", areaId);
  if (gate instanceof Response) return gate;

  const parsed = await parseJsonBody(request, areaInlineSchema);
  if (parsed instanceof Response) return parsed;
  const { field, value } = parsed.data;

  const fieldError = requireSpecChangedFields(gate, "AREA", [field]);
  if (fieldError) return fieldError;

  // 컬럼이 NOT NULL 이라 빈 값으로 지우는 것은 허용하지 않는다.
  const nextScope = parseScopeSttus(value);
  if (!nextScope) return apiError("VALIDATION_ERROR", SCOPE_STTUS_ERROR_MSG, 400);

  try {
    const existing = await prisma.tbDsArea.findUnique({ where: { area_id: areaId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "영역을 찾을 수 없습니다.", 404);
    }

    await prisma.tbDsArea.update({
      where: { area_id: areaId },
      data:  { scope_sttus_code: nextScope, ...buildMdfcnAudit(gate) },
    });

    return apiSuccess({ areaId, field, value: nextScope });
  } catch (err) {
    console.error(`[PATCH /api/projects/${projectId}/areas/${areaId}/inline] DB 오류:`, err);
    return apiError("DB_ERROR", "인라인 편집 저장에 실패했습니다.", 500);
  }
}
