/**
 * GET /api/projects/[id]/functions/[functionId]/files/[fileId]/view — 파일 인라인 표시 (썸네일용)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiError } from "@/lib/apiResponse";
import { readFile, fileExists } from "@/lib/fileStorage";

type RouteParams = { params: Promise<{ id: string; functionId: string; fileId: string }> };

// MIME 타입 맵
const MIME_MAP: Record<string, string> = {
  png:  "image/png",
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  gif:  "image/gif",
  webp: "image/webp",
  bmp:  "image/bmp",
  svg:  "image/svg+xml",
  pdf:  "application/pdf",
};

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, functionId, fileId } = await params;

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

    if (!file || file.ref_id !== functionId || file.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "첨부파일을 찾을 수 없습니다.", 404);
    }

    if (!fileExists(file.file_path_nm)) {
      return apiError("NOT_FOUND", "파일이 서버에 존재하지 않습니다.", 404);
    }

    const nodeBuffer = readFile(file.file_path_nm);
    const buffer = nodeBuffer.buffer.slice(
      nodeBuffer.byteOffset,
      nodeBuffer.byteOffset + nodeBuffer.byteLength
    ) as ArrayBuffer;

    const contentType = MIME_MAP[file.file_extsn_nm.toLowerCase()] ?? "application/octet-stream";

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":   contentType,
        // inline으로 브라우저가 직접 표시 (이미지 <img src> 가능)
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.orgnl_file_nm)}`,
        "Content-Length": String(nodeBuffer.length),
        // 짧은 캐싱으로 썸네일 재요청 최소화
        "Cache-Control":  "private, max-age=300",
      },
    });
  } catch (err) {
    console.error(`[GET view/${fileId}] 오류:`, err);
    return apiError("SERVER_ERROR", "파일 조회 중 오류가 발생했습니다.", 500);
  }
}
