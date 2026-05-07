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
import path from "path";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/requireAuth";
import { readFile, fileExists } from "@/lib/fileStorage";

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

    if (!fileExists(meta.file_path_nm)) {
      // DB 와 디스크 불일치 — 정리 배치 누락 등. 사용자에게는 404 로 일관 응답.
      console.warn(`[docs/files] DB has record but disk missing: ${meta.file_path_nm}`);
      return apiError("NOT_FOUND", "파일을 찾을 수 없습니다.", 404);
    }

    const buffer = readFile(meta.file_path_nm);

    // Content-Type — DB 의 mime_ty 우선, 없으면 확장자 기반 추정
    const contentType = meta.mime_ty || guessMimeFromExt(meta.file_extsn_nm);

    // Content-Disposition — 한글 파일명 안전 처리 (RFC 5987)
    const safeName    = encodeURIComponent(meta.orgnl_file_nm);
    const disposition = forceDownload
      ? `attachment; filename*=UTF-8''${safeName}`
      // inline 의 경우 파일명도 같이 — 일부 브라우저 다운로드 시 의미있음
      : `inline; filename*=UTF-8''${safeName}`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":        contentType,
        "Content-Disposition": disposition,
        "Content-Length":      String(buffer.length),
        // 캐시 정책 — 인라인은 짧게(1시간) 캐싱, 로그인 사용자만 보므로 private
        "Cache-Control":       "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error("[GET /api/docs/files/[fileId]/view]", err);
    return apiError("FILE_ERROR", "파일을 불러올 수 없습니다.", 500);
  }
}

// 확장자 → MIME 보조 매핑 (DB mime_ty 가 비어있을 때 백업)
function guessMimeFromExt(ext: string): string {
  const m: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif",  webp: "image/webp",
    pdf: "application/pdf",  zip: "application/zip",
    txt: "text/plain", md: "text/markdown",
    mp4: "video/mp4",  mov: "video/quicktime",
  };
  return m[ext.toLowerCase()] ?? "application/octet-stream";
}
