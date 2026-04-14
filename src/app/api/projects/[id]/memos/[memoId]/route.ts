/**
 * GET    /api/projects/[id]/memos/[memoId] — 메모 단건 조회 (조회수 +1)
 * PUT    /api/projects/[id]/memos/[memoId] — 메모 수정 (본인만)
 * DELETE /api/projects/[id]/memos/[memoId] — 메모 삭제 (본인 또는 OWNER/ADMIN)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; memoId: string }> };

// ── GET: 단건 조회 + 조회수 증가 ────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, memoId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const memo = await prisma.tbDsMemo.findUnique({
      where: { memo_id: memoId },
    });

    if (!memo || memo.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "메모를 찾을 수 없습니다.", 404);
    }

    // 접근 권한 확인: 본인 메모이거나 공유 메모여야 함
    if (memo.creat_mber_id !== auth.mberId && memo.share_yn !== "Y") {
      return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
    }

    // 조회수 증가 (비동기, 응답 차단 안 함)
    prisma.tbDsMemo.update({
      where: { memo_id: memoId },
      data:  { view_cnt: { increment: 1 } },
    }).catch(() => { /* 조회수 실패는 무시 */ });

    // 작성자 이름 조회
    const creator = await prisma.tbCmMember.findUnique({
      where: { mber_id: memo.creat_mber_id },
      select: { mber_nm: true },
    });

    return apiSuccess({
      memoId:        memo.memo_id,
      subject:       memo.memo_sj,
      content:       memo.memo_cn ?? "",
      shareYn:       memo.share_yn,
      refTyCode:     memo.ref_ty_code,
      refId:         memo.ref_id,
      viewCnt:       memo.view_cnt + 1,
      creatMberId:   memo.creat_mber_id,
      creatMberName: creator?.mber_nm ?? "",
      isMine:        memo.creat_mber_id === auth.mberId,
      creatDt:       memo.creat_dt,
      mdfcnDt:       memo.mdfcn_dt,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/memos/${memoId}]`, err);
    return apiError("DB_ERROR", "메모 조회에 실패했습니다.", 500);
  }
}

// ── PUT: 메모 수정 (본인만) ─────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, memoId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  const memo = await prisma.tbDsMemo.findUnique({ where: { memo_id: memoId } });
  if (!memo || memo.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "메모를 찾을 수 없습니다.", 404);
  }
  // 본인 메모만 수정 가능
  if (memo.creat_mber_id !== auth.mberId) {
    return apiError("FORBIDDEN", "본인 메모만 수정할 수 있습니다.", 403);
  }

  let body: { subject?: string; content?: string; shareYn?: string };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const subject = body.subject?.trim();
  if (subject !== undefined && !subject) {
    return apiError("VALIDATION_ERROR", "제목을 입력해 주세요.", 400);
  }

  try {
    await prisma.tbDsMemo.update({
      where: { memo_id: memoId },
      data: {
        ...(subject !== undefined && { memo_sj: subject }),
        ...(body.content !== undefined && { memo_cn: body.content }),
        ...(body.shareYn !== undefined && { share_yn: body.shareYn === "Y" ? "Y" : "N" }),
        mdfr_mber_id: auth.mberId,
        mdfcn_dt:     new Date(),
      },
    });

    return apiSuccess({ memoId });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/memos/${memoId}]`, err);
    return apiError("DB_ERROR", "메모 수정에 실패했습니다.", 500);
  }
}

// ── DELETE: 메모 삭제 (본인 또는 OWNER/ADMIN) ──────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, memoId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  const memo = await prisma.tbDsMemo.findUnique({ where: { memo_id: memoId } });
  if (!memo || memo.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "메모를 찾을 수 없습니다.", 404);
  }

  // 삭제 권한: 본인 또는 OWNER/ADMIN
  const isOwnerOrAdmin = ["OWNER", "ADMIN"].includes(membership.role_code);
  if (memo.creat_mber_id !== auth.mberId && !isOwnerOrAdmin) {
    return apiError("FORBIDDEN", "삭제 권한이 없습니다.", 403);
  }

  try {
    await prisma.tbDsMemo.delete({ where: { memo_id: memoId } });
    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/memos/${memoId}]`, err);
    return apiError("DB_ERROR", "메모 삭제에 실패했습니다.", 500);
  }
}
