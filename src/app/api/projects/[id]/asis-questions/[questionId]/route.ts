/**
 * PATCH /api/projects/[id]/asis-questions/[questionId] — AS-IS 미해결 질문 답변
 *
 * 답변 등록만 지원 (질문 내용 자체 수정, 삭제는 없음 — 이력 보존).
 * 상태를 OPEN → ANSWERED로 바꾼다. 답변을 실제 스펙(화면/기능 description 등)에
 * 반영하는 건 이 API의 책임이 아니라 온보딩 커맨드가 별도로 처리한다.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; questionId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, questionId } = await params;

  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { answerCn } = body as { answerCn?: string };
  if (!answerCn?.trim()) {
    return apiError("VALIDATION_ERROR", "답변 내용을 입력해 주세요.", 400);
  }

  try {
    const existing = await prisma.tb_ds_asis_question.findUnique({ where: { question_id: questionId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "질문을 찾을 수 없습니다.", 404);
    }

    await prisma.tb_ds_asis_question.update({
      where: { question_id: questionId },
      data: {
        answer_cn:   answerCn,
        status_code: "ANSWERED",
        answered_dt: new Date(),
        mdfcn_dt:    new Date(),
      },
    });

    return apiSuccess({ questionId, statusCode: "ANSWERED" });
  } catch (e) {
    console.error(e);
    return apiError("INTERNAL_ERROR", "답변 등록 중 오류가 발생했습니다.", 500);
  }
}
