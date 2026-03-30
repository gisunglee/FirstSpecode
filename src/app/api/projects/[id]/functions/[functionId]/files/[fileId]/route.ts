/**
 * DELETE /api/projects/[id]/functions/[functionId]/files/[fileId] — 첨부파일 삭제
 * PATCH  /api/projects/[id]/functions/[functionId]/files/[fileId] — req_ref_yn 토글
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { deleteFile } from "@/lib/fileStorage";

type RouteParams = { params: Promise<{ id: string; functionId: string; fileId: string }> };

// ─── DELETE: 첨부파일 삭제 ────────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, functionId, fileId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  try {
    const file = await prisma.tbCmAttachFile.findUnique({
      where: { attach_file_id: fileId },
    });

    if (!file || file.ref_id !== functionId || file.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "첨부파일을 찾을 수 없습니다.", 404);
    }

    deleteFile(file.file_path_nm);
    await prisma.tbCmAttachFile.delete({ where: { attach_file_id: fileId } });

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/functions/${functionId}/files/${fileId}] 오류:`, err);
    return apiError("DB_ERROR", "파일 삭제 중 오류가 발생했습니다.", 500);
  }
}

// ─── PATCH: req_ref_yn 토글 ────────────────────────────────────────────────
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, functionId, fileId } = await params;

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
