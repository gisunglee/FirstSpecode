/**
 * GET /api/projects/[id]/requirements/[reqId]/files/[fileId]/download — 첨부파일 다운로드 (FID-00107)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiError } from "@/lib/apiResponse";
import { readFile, fileExists } from "@/lib/fileStorage";

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

    if (!fileExists(file.file_path_nm)) {
      return apiError("NOT_FOUND", "파일이 서버에 존재하지 않습니다.", 404);
    }

    // Node.js Buffer를 ArrayBuffer로 변환 — NextResponse BodyInit 타입 충족
    const nodeBuffer = readFile(file.file_path_nm);
    const buffer = nodeBuffer.buffer.slice(nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength) as ArrayBuffer;

    // Content-Disposition: attachment 헤더로 브라우저 다운로드 유도
    // 파일명에 한글 등 멀티바이트 문자가 있을 수 있어 RFC 5987 인코딩 적용
    const encodedName = encodeURIComponent(file.orgnl_file_nm);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":        "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
        "Content-Length":      String(nodeBuffer.length),
      },
    });
  } catch (err) {
    console.error(`[GET download/${fileId}] 오류:`, err);
    return apiError("SERVER_ERROR", "파일 다운로드 중 오류가 발생했습니다.", 500);
  }
}
