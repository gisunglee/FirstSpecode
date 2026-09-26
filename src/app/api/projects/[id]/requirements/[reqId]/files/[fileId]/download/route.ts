/**
 * GET /api/projects/[id]/requirements/[reqId]/files/[fileId]/download — 첨부파일 다운로드 (FID-00107)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiError } from "@/lib/apiResponse";
import { createStorageDownloadUrl } from "@/lib/supabaseStorage";

type RouteParams = { params: Promise<{ id: string; reqId: string; fileId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, reqId, fileId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const file = await prisma.tbCmAttachFile.findUnique({
      where: { attach_file_id: fileId },
    });

    if (!file || file.ref_id !== reqId || file.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "첨부파일을 찾을 수 없습니다.", 404);
    }

    const signedUrl = await createStorageDownloadUrl(file.file_path_nm, {
      expiresIn: 60,
      downloadName: file.orgnl_file_nm,
    });
    return NextResponse.redirect(signedUrl, 307);
  } catch (err) {
    console.error(`[GET download/${fileId}] 오류:`, err);
    return apiError("SERVER_ERROR", "파일 다운로드 중 오류가 발생했습니다.", 500);
  }
}
