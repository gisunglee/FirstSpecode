/**
 * GET  /api/projects/[id]/asis-questions — AS-IS 미해결 질문 목록
 * POST /api/projects/[id]/asis-questions — AS-IS 미해결 질문 생성
 *
 * tb_ds_review_request(동료 피어리뷰)와는 별도 테이블. AI가 온보딩/분석 중
 * 소스나 대화로 확인 못한 사실을 추적하는 용도라 만족도 평가 필드가 없다.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { randomUUID } from "crypto";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 목록 조회 ─────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const url         = new URL(request.url);
  const purposeCode = url.searchParams.get("purposeCode") ?? undefined;
  const batchId     = url.searchParams.get("batchId")     ?? undefined;
  const refTblNm    = url.searchParams.get("refTblNm")    ?? undefined;
  const refId       = url.searchParams.get("refId")       ?? undefined;
  const statusCode  = url.searchParams.get("statusCode")  ?? undefined;

  // 무조건 전체 조회 금지 — purposeCode, batchId, (refTblNm+refId) 중 최소 하나는 필수.
  // 이 저장소는 여러 세션/용도가 공유하므로, 조건 없는 조회는 무관한 질문끼리 섞여
  // 오용(엉뚱한 목적으로 쓰이거나 잘못 답변)될 위험이 있어 API 레벨에서부터 막는다.
  const hasRefFilter = !!refTblNm && !!refId;
  if (!purposeCode && !batchId && !hasRefFilter) {
    return apiError(
      "VALIDATION_ERROR",
      "purposeCode, batchId, (refTblNm+refId) 중 최소 하나는 지정해야 합니다.",
      400
    );
  }

  try {
    const questions = await prisma.tb_ds_asis_question.findMany({
      where: {
        prjct_id:     projectId,
        ...(purposeCode ? { purpose_code: purposeCode } : {}),
        ...(batchId ? { batch_id: batchId } : {}),
        ...(hasRefFilter ? { ref_tbl_nm: refTblNm, ref_id: refId } : {}),
        ...(statusCode ? { status_code: statusCode } : {}),
      },
      orderBy: { creat_dt: "desc" },
    });

    // 요청자 이름 수집 — 1회 조회
    const memberIds = [...new Set([
      ...questions.map((q) => q.req_mber_id),
      ...questions.map((q) => q.revwr_mber_id).filter((v): v is string => !!v),
    ])];
    const members = await prisma.tbCmMember.findMany({
      where:  { mber_id: { in: memberIds } },
      select: { mber_id: true, mber_nm: true, email_addr: true },
    });
    const memberMap = Object.fromEntries(members.map((m) => [m.mber_id, m.mber_nm ?? m.email_addr ?? m.mber_id]));

    const items = questions.map((q) => ({
      questionId:    q.question_id,
      purposeCode:   q.purpose_code,
      batchId:       q.batch_id,
      refTblNm:      q.ref_tbl_nm,
      refId:         q.ref_id,
      questionCn:    q.question_cn,
      answerCn:      q.answer_cn,
      statusCode:    q.status_code,
      reqMemberId:   q.req_mber_id,
      reqMemberNm:   memberMap[q.req_mber_id] ?? q.req_mber_id,
      revwrMemberId: q.revwr_mber_id,
      revwrMemberNm: q.revwr_mber_id ? (memberMap[q.revwr_mber_id] ?? q.revwr_mber_id) : null,
      createdAt:     q.creat_dt,
      answeredAt:    q.answered_dt,
    }));

    return apiSuccess({ items });
  } catch (e) {
    console.error(e);
    return apiError("INTERNAL_ERROR", "조회 중 오류가 발생했습니다.", 500);
  }
}

// ─── POST: 생성 ─────────────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { purposeCode, batchId, refTblNm, refId, questionCn, revwrMemberId } = body as Record<string, string>;
  if (!purposeCode?.trim()) return apiError("VALIDATION_ERROR", "purposeCode는 필수입니다.", 400);
  if (!refTblNm?.trim())    return apiError("VALIDATION_ERROR", "refTblNm은 필수입니다.", 400);
  if (!refId?.trim())       return apiError("VALIDATION_ERROR", "refId는 필수입니다.", 400);
  if (!questionCn?.trim())  return apiError("VALIDATION_ERROR", "질문 내용을 입력해 주세요.", 400);

  try {
    const question = await prisma.tb_ds_asis_question.create({
      data: {
        question_id:   randomUUID(),
        prjct_id:      projectId,
        purpose_code:  purposeCode.trim(),
        batch_id:      batchId?.trim() || null,
        ref_tbl_nm:    refTblNm.trim(),
        ref_id:        refId.trim(),
        question_cn:   questionCn,
        req_mber_id:   gate.mberId,
        revwr_mber_id: revwrMemberId?.trim() || null,
      },
    });
    return apiSuccess({ questionId: question.question_id }, 201);
  } catch (e) {
    console.error(e);
    return apiError("INTERNAL_ERROR", "생성 중 오류가 발생했습니다.", 500);
  }
}
