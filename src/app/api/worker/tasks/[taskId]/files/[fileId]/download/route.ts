/**
 * GET /api/worker/tasks/[taskId]/files/[fileId]/download
 *   — 워커 전용 첨부 파일 바이너리 다운로드
 *
 * 역할:
 *   - AI 워커가 첨부 이미지를 받아가는 유일한 경로 (HTTP)
 *   - 서비스 환경에서는 워커가 서버와 다른 머신/컨테이너에서 돌아가므로
 *     로컬 파일 경로를 전달하지 않고 이 엔드포인트로만 파일을 수신한다
 *
 * 인증:
 *   X-Worker-Key 헤더 필수 (세션/JWT 불가)
 *
 * 보안:
 *   - fileId로 조회한 레코드가 실제 해당 taskId의 첨부인지 검증
 *   - ref_tbl_nm="tb_ai_task"가 아닌 레코드(영역/기능 첨부 등)는 거부
 *   - file_path_nm이 uploads/ 밖을 가리키는 경로 조작 공격 방지
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiResponse";
import { requireWorkerAuth } from "@/app/api/worker/_lib/auth";

type RouteParams = { params: Promise<{ taskId: string; fileId: string }> };

// 업로드 루트 — 경로 조작 방지를 위해 실제 파일 경로가 이 하위여야만 한다
const UPLOAD_ROOT = path.join(process.cwd(), "uploads");

// 확장자별 MIME 매핑 — Claude 멀티모달 인식을 위해 image/* 타입을 정확히 설정
// 등록 안 된 확장자는 octet-stream으로 떨어짐
const MIME_BY_EXT: Record<string, string> = {
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  png:  "image/png",
  gif:  "image/gif",
  webp: "image/webp",
  bmp:  "image/bmp",
  svg:  "image/svg+xml",
  pdf:  "application/pdf",
  txt:  "text/plain",
};

export async function GET(request: NextRequest, { params }: RouteParams) {
  // 워커 인증
  const authError = requireWorkerAuth(request);
  if (authError) return authError;

  const { taskId, fileId } = await params;

  try {
    const file = await prisma.tbCmAttachFile.findUnique({
      where: { attach_file_id: fileId },
    });

    // 존재 여부 + AI 태스크 첨부 여부 + 요청된 taskId 소속 여부 동시 검증
    // (다른 리소스의 첨부 파일을 이 경로로 내려받는 것을 차단)
    if (!file || file.ref_tbl_nm !== "tb_ai_task" || file.ref_id !== taskId) {
      return apiError("NOT_FOUND", "첨부 파일을 찾을 수 없습니다.", 404);
    }

    // 경로 조작 방지 — path.resolve 한 결과가 UPLOAD_ROOT 하위여야만 읽기
    // (file_path_nm이 "../etc/passwd" 같은 값이 되면 거부)
    const absolutePath = path.resolve(UPLOAD_ROOT, file.file_path_nm);
    if (!absolutePath.startsWith(UPLOAD_ROOT)) {
      return apiError("FORBIDDEN", "잘못된 파일 경로입니다.", 403);
    }
    if (!fs.existsSync(absolutePath)) {
      return apiError("NOT_FOUND", "파일이 저장소에 존재하지 않습니다.", 404);
    }

    const buffer = fs.readFileSync(absolutePath);
    const ext    = file.file_extsn_nm.toLowerCase();
    const mime   = MIME_BY_EXT[ext] ?? "application/octet-stream";

    // Buffer → Uint8Array (NextResponse body 타입 호환)
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":        mime,
        "Content-Length":      buffer.length.toString(),
        // 파일명에 한글/특수문자가 있어도 다운로드 시 깨지지 않도록 RFC 5987 형식 사용
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.orgnl_file_nm)}`,
        "Cache-Control":       "private, no-cache",
      },
    });
  } catch (err) {
    console.error(`[GET /api/worker/tasks/${taskId}/files/${fileId}/download] 오류:`, err);
    return apiError("SERVER_ERROR", "파일 다운로드 중 오류가 발생했습니다.", 500);
  }
}
