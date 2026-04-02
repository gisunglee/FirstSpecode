/**
 * GET    /api/projects/[id]/reviews/[reviewId] — 리뷰 상세
 * PUT    /api/projects/[id]/reviews/[reviewId] — 리뷰 수정 / 상태 변경
 * DELETE /api/projects/[id]/reviews/[reviewId] — 리뷰 삭제 (작성자 또는 관리자)
 *
 * 수정/삭제 권한:
 *   - 요청자 본인: 코멘트 없을 때만 수정/삭제 가능 (관리자는 항상 가능)
 *   - 답변자: result_cn + 상태 변경 가능
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; reviewId: string }> };

// ─── GET: 상세 조회 ─────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, reviewId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const review = await prisma.tb_ds_review_request.findUnique({
      where: { review_id: reviewId },
    });
    if (!review || review.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "리뷰 요청을 찾을 수 없습니다.", 404);
    }

    // 요청자·답변자 이름 조회
    const [reqMember, revwrMember] = await Promise.all([
      prisma.tbCmMember.findUnique({ where: { mber_id: review.req_mber_id }, select: { mber_nm: true, email_addr: true } }),
      prisma.tbCmMember.findUnique({ where: { mber_id: review.revwr_mber_id }, select: { mber_nm: true, email_addr: true } }),
    ]);

    return apiSuccess({
      reviewId:      review.review_id,
      titleNm:       review.review_title_nm,
      reviewCn:      review.review_cn,
      resultCn:      review.result_cn,
      stsfScr:       review.stsf_scr,
      fdbkCode:      review.fdbk_code,
      statusCode:    review.review_sttus_code,
      reqMemberId:   review.req_mber_id,
      reqMemberNm:   reqMember?.mber_nm ?? reqMember?.email_addr ?? review.req_mber_id,
      revwrMemberId: review.revwr_mber_id,
      revwrMemberNm: revwrMember?.mber_nm ?? revwrMember?.email_addr ?? review.revwr_mber_id,
      refTblNm:      review.ref_tbl_nm,
      refId:         review.ref_id,
      createdAt:   review.creat_dt,
      completedAt: review.compl_dt,
      updatedAt:   review.mdfcn_dt,
      // 현재 사용자의 역할 정보 (프론트 권한 제어용)
      isRequester:   review.req_mber_id  === auth.mberId,
      isReviewer:    review.revwr_mber_id === auth.mberId,
    });
  } catch (e) {
    console.error(e);
    return apiError("INTERNAL_ERROR", "조회 중 오류가 발생했습니다.", 500);
  }
}

// ─── PUT: 수정 / 상태 변경 ──────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, reviewId } = await params;

  const [membership, review] = await Promise.all([
    prisma.tbPjProjectMember.findUnique({
      where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
    }),
    prisma.tb_ds_review_request.findUnique({ where: { review_id: reviewId } }),
  ]);

  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  if (!review || review.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "리뷰 요청을 찾을 수 없습니다.", 404);
  }

  const isAdmin     = checkRole(membership.role_code, ["OWNER", "ADMIN"]);
  const isRequester = review.req_mber_id  === auth.mberId;
  const isReviewer  = review.revwr_mber_id === auth.mberId;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { titleNm, reviewCn, resultCn, statusCode, stsfScr, revwrMemberId } = body as Record<string, string>;

  // ① 요청 내용 수정: 검토 전(REQUESTED)에만 가능, 코멘트 없을 때만 (관리자 예외)
  if ((titleNm !== undefined || reviewCn !== undefined || revwrMemberId !== undefined) && !isAdmin) {
    if (!isRequester) return apiError("FORBIDDEN", "요청자만 수정할 수 있습니다.", 403);
    if (review.review_sttus_code !== "REQUESTED") {
      return apiError("FORBIDDEN", "검토가 시작된 요청은 수정할 수 없습니다.", 403);
    }
    const commentCount = await prisma.tb_ds_review_comment.count({ where: { review_id: reviewId } });
    if (commentCount > 0) {
      return apiError("FORBIDDEN", "코멘트가 달린 요청은 수정할 수 없습니다.", 403);
    }
  }

  // ① 답변자 변경: 프로젝트 내 ACTIVE 멤버인지 확인
  if (revwrMemberId !== undefined) {
    const revwrMembership = await prisma.tbPjProjectMember.findUnique({
      where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: revwrMemberId } },
    });
    if (!revwrMembership || revwrMembership.mber_sttus_code !== "ACTIVE") {
      return apiError("VALIDATION_ERROR", "답변자로 지정할 수 없는 멤버입니다.", 400);
    }
  }

  // ② 답변 내용: 답변자 또는 관리자만 기록 가능
  if (resultCn !== undefined && !isAdmin) {
    if (!isReviewer) {
      return apiError("FORBIDDEN", "답변 내용은 답변자만 입력할 수 있습니다.", 403);
    }
  }

  // ③ 만족도 점수: 요청자만, 1~5 범위
  if (stsfScr !== undefined && !isAdmin) {
    if (!isRequester) {
      return apiError("FORBIDDEN", "만족도 점수는 요청자만 입력할 수 있습니다.", 403);
    }
    const score = Number(stsfScr);
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return apiError("VALIDATION_ERROR", "만족도 점수는 1~5 사이의 정수여야 합니다.", 400);
    }
  }

  // ④ 상태 변경: 답변자만 (REVIEWING·COMPLETED)
  if (statusCode !== undefined && !isAdmin) {
    const REVIEWER_STATUSES = ["REVIEWING", "COMPLETED"];
    if (!REVIEWER_STATUSES.includes(statusCode)) {
      return apiError("FORBIDDEN", "유효하지 않거나 권한이 없는 상태 값입니다.", 403);
    }
    if (!isReviewer) {
      return apiError("FORBIDDEN", "답변자만 상태를 변경할 수 있습니다.", 403);
    }
  }

  try {
    const now = new Date();
    const updated = await prisma.tb_ds_review_request.update({
      where: { review_id: reviewId },
      data: {
        ...(titleNm      !== undefined ? { review_title_nm: titleNm.trim()   } : {}),
        ...(reviewCn     !== undefined ? { review_cn:       reviewCn         } : {}),
        ...(revwrMemberId !== undefined ? { revwr_mber_id:  revwrMemberId    } : {}),
        ...(resultCn   !== undefined ? { result_cn:       resultCn       } : {}),
        ...(stsfScr    !== undefined ? { stsf_scr:        Number(stsfScr) } : {}),
        ...(statusCode !== undefined ? {
          review_sttus_code: statusCode,
          // 완료 상태로 전환 시 완료일 기록
          ...(statusCode === "COMPLETED" ? { compl_dt: now } : {}),
        } : {}),
        mdfcn_dt: now,
      },
    });
    return apiSuccess({ reviewId: updated.review_id });
  } catch (e) {
    console.error(e);
    return apiError("INTERNAL_ERROR", "수정 중 오류가 발생했습니다.", 500);
  }
}

// ─── DELETE: 리뷰 삭제 ──────────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, reviewId } = await params;

  const [membership, review] = await Promise.all([
    prisma.tbPjProjectMember.findUnique({
      where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
    }),
    prisma.tb_ds_review_request.findUnique({ where: { review_id: reviewId } }),
  ]);

  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  if (!review || review.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "리뷰 요청을 찾을 수 없습니다.", 404);
  }

  const isAdmin     = checkRole(membership.role_code, ["OWNER", "ADMIN"]);
  const isRequester = review.req_mber_id === auth.mberId;

  if (!isAdmin && !isRequester) {
    return apiError("FORBIDDEN", "요청자 본인 또는 관리자만 삭제할 수 있습니다.", 403);
  }

  // 코멘트 있으면 관리자만 삭제 가능
  if (!isAdmin) {
    const commentCount = await prisma.tb_ds_review_comment.count({ where: { review_id: reviewId } });
    if (commentCount > 0) {
      return apiError("FORBIDDEN", "코멘트가 달린 요청은 삭제할 수 없습니다.", 403);
    }
  }

  try {
    // 코멘트 먼저 삭제 후 요청 삭제
    await prisma.tb_ds_review_comment.deleteMany({ where: { review_id: reviewId } });
    await prisma.tb_ds_review_request.delete({ where: { review_id: reviewId } });
    return apiSuccess({ reviewId });
  } catch (e) {
    console.error(e);
    return apiError("INTERNAL_ERROR", "삭제 중 오류가 발생했습니다.", 500);
  }
}
