/**
 * DELETE /api/projects/[id]/requirements/[reqId]/files/[fileId] — 첨부파일 삭제 (FID-00108)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { removeStorageObjects } from "@/lib/supabaseStorage";

type RouteParams = { params: Promise<{ id: string; reqId: string; fileId: string }> };

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, reqId, fileId } = await params;

  // 권한 가드 — 역할 매트릭스(permissions.ts) 기반.
  // 결제 잠금(§1-6)·지원 세션 읽기전용·프로젝트 삭제 상태도 requirePermission 이 함께 처리한다.
  const auth = await requirePermission(request, projectId, "content.delete");
  if (auth instanceof Response) return auth;

  try {
    const file = await prisma.tbCmAttachFile.findUnique({
      where: { attach_file_id: fileId },
    });

    if (!file || file.ref_id !== reqId || file.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "첨부파일을 찾을 수 없습니다.", 404);
    }

    // Storage 객체 삭제 후 DB 레코드 삭제
    await removeStorageObjects([file.file_path_nm]);
    await prisma.tbCmAttachFile.delete({ where: { attach_file_id: fileId } });

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE files/${fileId}] 오류:`, err);
    return apiError("DB_ERROR", "파일 삭제 중 오류가 발생했습니다.", 500);
  }
}
