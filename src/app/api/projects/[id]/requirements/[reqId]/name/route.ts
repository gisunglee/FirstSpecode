/**
 * PUT /api/projects/[id]/requirements/[reqId]/name — 요구사항명만 즉시 저장 (목록 인라인 편집)
 *
 * 요구사항 목록에서 이름을 클릭해 바로 고쳐 쓸 때, 본문 PUT(route.ts)이 요구하는
 * priority/source 등 나머지 필수 필드까지 함께 보낼 필요가 없도록 name 하나만 다루는
 * 전용 엔드포인트로 분리했다. progress 라우트와 같은 목적·같은 패턴.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import {
  requireSpecContentWrite,
  requireSpecChangedFields,
} from "@/lib/specContentWritePolicy";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { requirementNameSchema } from "@/lib/specContentSchemas";

type RouteParams = { params: Promise<{ id: string; reqId: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, reqId } = await params;

  const gate = await requireSpecContentWrite(request, projectId, "REQUIREMENT", reqId);
  if (gate instanceof Response) return gate;
  const fieldError = requireSpecChangedFields(gate, "REQUIREMENT", ["name"]);
  if (fieldError) return fieldError;

  const parsed = await parseJsonBody(request, requirementNameSchema);
  if (parsed instanceof Response) return parsed;
  const { name } = parsed.data;

  const limitErr = apiTextLimitGuard([["name", name]]);
  if (limitErr) return limitErr;

  try {
    const existing = await prisma.tbRqRequirement.findUnique({ where: { req_id: reqId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "요구사항을 찾을 수 없습니다.", 404);
    }

    const updated = await prisma.tbRqRequirement.update({
      where: { req_id: reqId },
      data: { req_nm: name.trim(), mdfcn_mber_id: gate.mberId, mdfcn_dt: new Date() },
    });

    return apiSuccess({ name: updated.req_nm });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/requirements/${reqId}/name] DB 오류:`, err);
    return apiError("DB_ERROR", "요구사항명 저장 중 오류가 발생했습니다.", 500);
  }
}
