/**
 * POST /api/projects/[id]/requirements/[reqId]/ai/spec — AI spec 초안 생성 (FID-00105)
 *
 * TODO: 실제 AI 연동 구현 전 stub 응답 반환
 *       연동 시 TbAiTask 생성 + AI 모델 호출 로직으로 교체
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; reqId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, reqId } = await params;

  // 권한 가드 — 역할 매트릭스(permissions.ts) 기반.
  // 결제 잠금(§1-6)·지원 세션 읽기전용·프로젝트 삭제 상태도 requirePermission 이 함께 처리한다.
  const auth = await requirePermission(request, projectId, "ai.request");
  if (auth instanceof Response) return auth;

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
