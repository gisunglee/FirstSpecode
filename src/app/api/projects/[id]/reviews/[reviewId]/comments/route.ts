/**
 * GET  /api/projects/[id]/reviews/[reviewId]/comments — 코멘트 목록
 * POST /api/projects/[id]/reviews/[reviewId]/comments — 코멘트 작성
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { randomUUID } from "crypto";

type RouteParams = { params: Promise<{ id: string; reviewId: string }> };

// ─── GET: 코멘트 목록 ────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, reviewId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    const comments = await prisma.tb_ds_review_comment.findMany({
      where:   { review_id: reviewId },
      orderBy: { creat_dt: "asc" },
    });

    // 작성자 이름 조회
    const memberIds = [...new Set(comments.map((c) => c.write_mber_id))];
    const members = await prisma.tbCmMember.findMany({
      where:  { mber_id: { in: memberIds } },
      select: { mber_id: true, mber_nm: true, email_addr: true },
    });
    const memberMap = Object.fromEntries(members.map((m) => [m.mber_id, m.mber_nm ?? m.email_addr ?? m.mber_id]));

    const items = comments.map((c) => ({
      commentId:     c.coment_id,
      reviewId:      c.review_id,
      content:       c.coment_cn,
      writeMemberId: c.write_mber_id,
      writeMemberNm: memberMap[c.write_mber_id] ?? c.write_mber_id,
      isOwn:         c.write_mber_id === gate.mberId,
      createdAt:     c.creat_dt,
      updatedAt:     c.mdfcn_dt,
    }));

    return apiSuccess({ items });
  } catch (e) {
    console.error(e);
    return apiError("INTERNAL_ERROR", "조회 중 오류가 발생했습니다.", 500);
  }
}

// ─── POST: 코멘트 작성 ──────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, reviewId } = await params;

  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { content } = body as { content: string };
  if (!content?.trim()) return apiError("VALIDATION_ERROR", "코멘트 내용을 입력해 주세요.", 400);

  // 내용 크기 제한: base64 이미지 포함 최대 5MB
  const MAX_SIZE = 5 * 1024 * 1024;
  if (Buffer.byteLength(content, "utf8") > MAX_SIZE) {
    return apiError("VALIDATION_ERROR", "내용이 너무 큽니다. 이미지를 줄이거나 나눠서 작성해 주세요.", 400);
  }

  try {
    const comment = await prisma.tb_ds_review_comment.create({
      data: {
        coment_id:     randomUUID(),
        review_id:     reviewId,
        coment_cn:     content,
        write_mber_id: gate.mberId,
      },
    });
    return apiSuccess({ commentId: comment.coment_id }, 201);
  } catch (e) {
    console.error(e);
    return apiError("INTERNAL_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}
