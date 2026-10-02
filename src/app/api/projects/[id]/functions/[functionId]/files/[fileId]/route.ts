/**
 * DELETE /api/projects/[id]/functions/[functionId]/files/[fileId] — 첨부파일 삭제
 * PATCH  /api/projects/[id]/functions/[functionId]/files/[fileId] — req_ref_yn 토글
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { removeStorageObjects } from "@/lib/supabaseStorage";

type RouteParams = { params: Promise<{ id: string; functionId: string; fileId: string }> };

// ─── DELETE: 첨부파일 삭제 ────────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, functionId, fileId } = await params;

  // 권한 가드 — 역할 매트릭스(permissions.ts) 기반.
  // 결제 잠금(§1-6)·지원 세션 읽기전용·프로젝트 삭제 상태도 requirePermission 이 함께 처리한다.
  const auth = await requirePermission(request, projectId, "content.delete");
  if (auth instanceof Response) return auth;

  try {
    const file = await prisma.tbCmAttachFile.findUnique({
      where: { attach_file_id: fileId },
    });

    if (!file || file.ref_id !== functionId || file.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "첨부파일을 찾을 수 없습니다.", 404);
    }

    await removeStorageObjects([file.file_path_nm]);
    await prisma.tbCmAttachFile.delete({ where: { attach_file_id: fileId } });

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/functions/${functionId}/files/${fileId}] 오류:`, err);
    return apiError("DB_ERROR", "파일 삭제 중 오류가 발생했습니다.", 500);
  }
}

// ─── PATCH: req_ref_yn 토글 ────────────────────────────────────────────────
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, functionId, fileId } = await params;

  // 권한 가드 — 역할 매트릭스(permissions.ts) 기반.
  // 결제 잠금(§1-6)·지원 세션 읽기전용·프로젝트 삭제 상태도 requirePermission 이 함께 처리한다.
  const auth = await requirePermission(request, projectId, "content.update");
  if (auth instanceof Response) return auth;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { reqRefYn } = body as { reqRefYn?: string };
  if (reqRefYn !== "Y" && reqRefYn !== "N") {
    return apiError("VALIDATION_ERROR", "reqRefYn 값은 Y 또는 N이어야 합니다.", 400);
  }

  try {
    const file = await prisma.tbCmAttachFile.findUnique({
      where: { attach_file_id: fileId },
    });

    if (!file || file.ref_id !== functionId || file.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "첨부파일을 찾을 수 없습니다.", 404);
    }

    await prisma.tbCmAttachFile.update({
      where: { attach_file_id: fileId },
      data:  { req_ref_yn: reqRefYn },
    });

    return apiSuccess({ fileId, reqRefYn });
  } catch (err) {
    console.error(`[PATCH /api/projects/${projectId}/functions/${functionId}/files/${fileId}] 오류:`, err);
    return apiError("DB_ERROR", "파일 정보 수정 중 오류가 발생했습니다.", 500);
  }
}
