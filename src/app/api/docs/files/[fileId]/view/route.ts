/**
 * GET /api/docs/files/[fileId]/view — 첨부 파일 서빙
 *
 * 역할:
 *   - 본문 ![](url) 의 인라인 이미지 응답
 *   - 별첨 다운로드 (?download=1 시 Content-Disposition: attachment)
 *
 * 권한:
 *   - 로그인 사용자 (requireAuth) — Docs visibility=MEMBER 정책에 맞춤
 *   - 향후 PUBLIC 정책 도입 시 페이지 visibility 에 따라 분기 예정
 *
 * 보안:
 *   - file_path_nm 은 DB 에만 존재 (사용자 입력 X) — path traversal 무관
 *   - use_yn='N' 인 첨부는 404 — 논리 삭제된 파일은 더 이상 서빙되지 않음
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/requireAuth";
import { createStorageDownloadUrl } from "@/lib/supabaseStorage";

type RouteParams = { params: Promise<{ fileId: string }> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { fileId } = await params;
  if (!UUID_PATTERN.test(fileId)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 파일 ID입니다.", 400);
  }

  const url = new URL(request.url);
  const forceDownload = url.searchParams.get("download") === "1";

  try {
    const meta = await prisma.tbSysAttachFile.findFirst({
      where:  { attach_id: fileId, use_yn: "Y" },
      select: {
        file_path_nm:  true,
        orgnl_file_nm: true,
        mime_ty:       true,
        file_extsn_nm: true,
        file_sz:       true,
      },
    });

    if (!meta) return apiError("NOT_FOUND", "파일을 찾을 수 없습니다.", 404);

    const signedUrl = await createStorageDownloadUrl(meta.file_path_nm, {
      expiresIn: 300,
      downloadName: forceDownload ? meta.orgnl_file_nm : undefined,
    });
    return NextResponse.redirect(signedUrl, 307);
  } catch (err) {
    console.error("[GET /api/docs/files/[fileId]/view]", err);
    return apiError("FILE_ERROR", "파일을 불러올 수 없습니다.", 500);
  }
}
