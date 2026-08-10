/**
 * PUT /api/projects/[id]/requirements/[reqId]/progress — 분석 진척률만 즉시 저장
 *
 * 요구사항 편집 화면의 진척률 게이지는 클릭/입력 시 다른 미저장 입력값(이름, 내용 등)에
 * 영향을 주지 않고 progrs_rt 컬럼만 즉시 반영해야 한다 — 그래서 본문 PUT(route.ts)과
 * 분리된 전용 엔드포인트로 뺐다. 기능 편집 페이지의 phase-progress 즉시저장 패턴과 동일한 목적.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import {
  requireSpecContentWrite,
  requireSpecChangedFields,
} from "@/lib/specContentWritePolicy";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { requirementProgressSchema } from "@/lib/specContentSchemas";

type RouteParams = { params: Promise<{ id: string; reqId: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, reqId } = await params;

  const gate = await requireSpecContentWrite(request, projectId, "REQUIREMENT", reqId);
  if (gate instanceof Response) return gate;
  const creatorFieldError = requireSpecChangedFields(gate, "REQUIREMENT", ["progress"]);
  if (creatorFieldError) return creatorFieldError;

  const parsed = await parseJsonBody(request, requirementProgressSchema);
  if (parsed instanceof Response) return parsed;
  const { progress } = parsed.data;

  try {
    const existing = await prisma.tbRqRequirement.findUnique({ where: { req_id: reqId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "요구사항을 찾을 수 없습니다.", 404);
    }

    const updated = await prisma.tbRqRequirement.update({
      where: { req_id: reqId },
      data: { progrs_rt: progress, mdfcn_mber_id: gate.mberId, mdfcn_dt: new Date() },
    });

    return apiSuccess({ progress: updated.progrs_rt });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/requirements/${reqId}/progress] DB 오류:`, err);
    return apiError("DB_ERROR", "진척률 저장 중 오류가 발생했습니다.", 500);
  }
}
