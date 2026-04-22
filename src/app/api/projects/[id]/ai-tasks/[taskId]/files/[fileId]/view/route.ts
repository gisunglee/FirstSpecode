/**
 * GET /api/projects/[id]/ai-tasks/[taskId]/files/[fileId]/view
 *   — AI 태스크 첨부파일 인라인 표시 (썸네일/미리보기/다운로드 공용)
 *
 * 역할:
 *   - AI 태스크 상세 다이얼로그의 썸네일/라이트박스 <img src>용
 *   - PDF 등 비이미지 파일은 브라우저 내장 뷰어가 inline 표시 (혹은 브라우저 설정 따라 다운로드)
 *   - 별도 download 엔드포인트를 두지 않고 이 엔드포인트로 다운로드도 겸한다
 *     (다운로드 시에는 클라이언트가 Content-Disposition을 다시 쓰지 못하므로, anchor download 속성 사용)
 *
 * 인증:
 *   JWT (requireAuth) + 프로젝트 멤버십 ACTIVE 필수
 *
 * 보안:
 *   - fileId 조회 결과가 실제 taskId의 첨부이고 동일 프로젝트 소속인지 3중 검증
 *   - ref_tbl_nm="tb_ai_task" 일치 확인 — 다른 리소스의 파일을 이 경로로 가로채는 것 차단
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiError } from "@/lib/apiResponse";
import { readFile, fileExists } from "@/lib/fileStorage";

type RouteParams = { params: Promise<{ id: string; taskId: string; fileId: string }> };

// MIME 타입 맵 — 이미지는 inline, pdf도 inline, 그 외는 octet-stream으로 떨어뜨려 다운로드 유도
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
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, taskId, fileId } = await params;

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

    // 3중 검증: 존재 + 올바른 taskId 소속 + 동일 프로젝트 + AI 태스크 첨부임을 확인
    if (
      !file ||
      file.ref_tbl_nm !== "tb_ai_task" ||
      file.ref_id    !== taskId ||
      file.prjct_id  !== projectId
    ) {
      return apiError("NOT_FOUND", "첨부파일을 찾을 수 없습니다.", 404);
    }

    if (!fileExists(file.file_path_nm)) {
      return apiError("NOT_FOUND", "파일이 서버에 존재하지 않습니다.", 404);
    }

    const nodeBuffer = readFile(file.file_path_nm);
    // Next.js Response body 타입 호환: Node Buffer → ArrayBuffer 슬라이스
    const buffer = nodeBuffer.buffer.slice(
      nodeBuffer.byteOffset,
      nodeBuffer.byteOffset + nodeBuffer.byteLength
    ) as ArrayBuffer;

    const contentType = MIME_MAP[file.file_extsn_nm.toLowerCase()] ?? "application/octet-stream";

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":        contentType,
        // inline 로 브라우저가 직접 표시 — <img src> 및 PDF 뷰어 지원
        // filename은 RFC 5987 형식으로 인코딩 (한글 파일명 안전 전달)
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.orgnl_file_nm)}`,
        "Content-Length":      String(nodeBuffer.length),
        // 짧은 캐싱 — 썸네일 재요청 최소화, 민감성 고려해 private
        "Cache-Control":        "private, max-age=300",
      },
    });
  } catch (err) {
    console.error(`[GET view/ai-tasks/${taskId}/files/${fileId}] 오류:`, err);
    return apiError("SERVER_ERROR", "파일 조회 중 오류가 발생했습니다.", 500);
  }
}
