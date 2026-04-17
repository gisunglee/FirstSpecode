/**
 * PUT    /api/projects/[id]/reviews/[reviewId]/comments/[commentId] — 코멘트 수정 (작성자 본인)
 * DELETE /api/projects/[id]/reviews/[reviewId]/comments/[commentId] — 코멘트 삭제 (작성자 또는 관리자)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; reviewId: string; commentId: string }> };

// ─── PUT: 코멘트 수정 ───────────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, reviewId, commentId } = await params;

  const [membership, comment] = await Promise.all([
    prisma.tbPjProjectMember.findUnique({
      where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
    }),
    prisma.tb_ds_review_comment.findUnique({ where: { coment_id: commentId } }),
  ]);

  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  if (!comment || comment.review_id !== reviewId) {
    return apiError("NOT_FOUND", "코멘트를 찾을 수 없습니다.", 404);
  }

  // 수정은 작성자 본인만 (관리자도 수정 불가 — 본인 글만)
  if (comment.write_mber_id !== auth.mberId) {
    return apiError("FORBIDDEN", "본인이 작성한 코멘트만 수정할 수 있습니다.", 403);
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { content } = body as { content: string };
  if (!content?.trim()) return apiError("VALIDATION_ERROR", "코멘트 내용을 입력해 주세요.", 400);

  const MAX_SIZE = 5 * 1024 * 1024;
  if (Buffer.byteLength(content, "utf8") > MAX_SIZE) {
    return apiError("VALIDATION_ERROR", "내용이 너무 큽니다.", 400);
  }

  try {
    await prisma.tb_ds_review_comment.update({
      where: { coment_id: commentId },
      data:  { coment_cn: content, mdfcn_dt: new Date() },
    });
    return apiSuccess({ commentId });
  } catch (e) {
    console.error(e);
    return apiError("INTERNAL_ERROR", "수정 중 오류가 발생했습니다.", 500);
  }
}

// ─── DELETE: 코멘트 삭제 ─────────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, reviewId, commentId } = await params;

  const [membership, comment] = await Promise.all([
    prisma.tbPjProjectMember.findUnique({
      where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
    }),
    prisma.tb_ds_review_comment.findUnique({ where: { coment_id: commentId } }),
  ]);

  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  if (!comment || comment.review_id !== reviewId) {
    return apiError("NOT_FOUND", "코멘트를 찾을 수 없습니다.", 404);
  }

  const isAdmin = checkRole(membership.role_code, ["OWNER", "ADMIN"]);
  if (!isAdmin && comment.write_mber_id !== auth.mberId) {
    return apiError("FORBIDDEN", "본인이 작성한 코멘트만 삭제할 수 있습니다.", 403);
  }

  try {
    await prisma.tb_ds_review_comment.delete({ where: { coment_id: commentId } });
    return apiSuccess({ commentId });
  } catch (e) {
    console.error(e);
    return apiError("INTERNAL_ERROR", "삭제 중 오류가 발생했습니다.", 500);
  }
}
