/**
 * POST /api/projects/[id]/requirements/[reqId]/ai/spec — AI spec 초안 생성 (FID-00105)
 *
 * TODO: 실제 AI 연동 구현 전 stub 응답 반환
 *       연동 시 TbAiTask 생성 + AI 모델 호출 로직으로 교체
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; reqId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, reqId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { analysisMemo } = body as { analysisMemo?: string };
  if (!analysisMemo?.trim()) {
    return apiError("VALIDATION_ERROR", "분석 메모를 먼저 작성해 주세요.", 400);
  }

  // 요구사항 존재 확인
  const req = await prisma.tbRqRequirement.findUnique({
    where: { req_id: reqId },
  });
  if (!req || req.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "요구사항을 찾을 수 없습니다.", 404);
  }

  // TODO: 실제 AI 연동으로 교체
  // 현재는 stub — 분석 메모를 기반으로 형식화된 초안 반환
  const stubSpec = [
    `## 개요`,
    ``,
    `${analysisMemo.trim()}`,
    ``,
    `## 기능 상세`,
    ``,
    `- 항목 1: (상세 내용 작성 필요)`,
    `- 항목 2: (상세 내용 작성 필요)`,
    ``,
    `## 비기능 요구사항`,
    ``,
    `- 성능: (작성 필요)`,
    `- 보안: (작성 필요)`,
    ``,
    `> ⚠️ AI 연동 전 stub 초안입니다. 내용을 직접 수정해 주세요.`,
  ].join("\n");

  return apiSuccess({ spec: stubSpec });
}
