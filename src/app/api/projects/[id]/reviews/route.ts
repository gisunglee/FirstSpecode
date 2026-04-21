/**
 * GET  /api/projects/[id]/reviews — 리뷰 요청 목록 (상태·요청자·답변자·코멘트 수 포함)
 * POST /api/projects/[id]/reviews — 리뷰 요청 생성
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

  try {
    const reviews = await prisma.tb_ds_review_request.findMany({
      where: { prjct_id: projectId },
      orderBy: { creat_dt: "desc" },
    });

    // 요청자·답변자 ID 수집 → 1회 조회
    const memberIds = [...new Set([
      ...reviews.map((r) => r.req_mber_id),
      ...reviews.map((r) => r.revwr_mber_id),
    ])];
    const members = await prisma.tbCmMember.findMany({
      where: { mber_id: { in: memberIds } },
      select: { mber_id: true, mber_nm: true, email_addr: true },
    });
    const memberMap = Object.fromEntries(members.map((m) => [m.mber_id, m.mber_nm ?? m.email_addr ?? m.mber_id]));

    // 코멘트 수 집계
    const reviewIds = reviews.map((r) => r.review_id);
    const commentCounts = await prisma.tb_ds_review_comment.groupBy({
      by: ["review_id"],
      where: { review_id: { in: reviewIds } },
      _count: { coment_id: true },
    });
    const countMap = Object.fromEntries(commentCounts.map((c) => [c.review_id, c._count.coment_id]));

    const items = reviews.map((r) => ({
      reviewId:        r.review_id,
      titleNm:         r.review_title_nm,
      statusCode:      r.review_sttus_code,
      reqMemberId:     r.req_mber_id,
      reqMemberNm:     memberMap[r.req_mber_id] ?? r.req_mber_id,
      revwrMemberId:   r.revwr_mber_id,
      revwrMemberNm:   memberMap[r.revwr_mber_id] ?? r.revwr_mber_id,
      commentCount:    countMap[r.review_id] ?? 0,
      fdbkCode:    r.fdbk_code,
      stsfScr:     r.stsf_scr,
      createdAt:   r.creat_dt,
      completedAt: r.compl_dt,
    }));

    return apiSuccess({ items });
  } catch (e) {
    console.error(e);
    return apiError("INTERNAL_ERROR", "조회 중 오류가 발생했습니다.", 500);
  }
}

// ─── POST: 리뷰 요청 생성 ───────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { titleNm, reviewCn, revwrMemberId, refTblNm, refId } = body as Record<string, string>;
  if (!titleNm?.trim())     return apiError("VALIDATION_ERROR", "제목을 입력해 주세요.", 400);
  if (!reviewCn?.trim())    return apiError("VALIDATION_ERROR", "요청 내용을 입력해 주세요.", 400);
  if (!revwrMemberId?.trim()) return apiError("VALIDATION_ERROR", "답변자를 선택해 주세요.", 400);

  try {
    const review = await prisma.tb_ds_review_request.create({
      data: {
        review_id:         randomUUID(),
        prjct_id:          projectId,
        ref_tbl_nm:        refTblNm ?? "direct",
        ref_id:            refId    ?? projectId,
        review_title_nm:   titleNm.trim(),
        review_cn:         reviewCn,
        req_mber_id:       gate.mberId,
        revwr_mber_id:     revwrMemberId,
        review_sttus_code: "REQUESTED",
      },
    });
    return apiSuccess({ reviewId: review.review_id }, 201);
  } catch (e) {
    console.error(e);
    return apiError("INTERNAL_ERROR", "생성 중 오류가 발생했습니다.", 500);
  }
}
