/**
 * GET /api/projects/[id]/requirements/[reqId]/export/docx
 *   — 요구사항 1건의 현재 시점 양식을 Word(.docx) 로 내려받는다
 *
 * 데이터 흐름:
 *   buildRequirementDocxWithHistory() 한 번에 (입력 매핑 → 발행이력 조합 → docx Buffer)
 *   내부 단계는 lib/exports/requirement-data.ts 참조.
 *
 * 권한:
 *   - "content.export" — VIEWER 차단, MEMBER 이상만
 *   - 시스템 관리자 지원 세션에서 자동 차단 (`.read` 가 아니므로)
 *
 * 응답:
 *   - Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
 *   - Content-Disposition: attachment; filename*=UTF-8''<encoded>
 *
 * 관련:
 *   - 특정 발행 버전의 docx 다운로드는 /documents/release/[releaseId]/docx 별도 엔드포인트
 *   - 일괄 zip 다운로드는 /document-library/zip 라우트가 동일 헬퍼를 호출
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
import { apiError } from "@/lib/apiResponse";
import { buildRequirementDocxWithHistory } from "@/lib/exports/requirement-data";

type RouteParams = { params: Promise<{ id: string; reqId: string }> };

const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, reqId } = await params;

  // ① 권한 체크 — content.export (지원 세션 자동 차단)
  const gate = await requirePermission(request, projectId, "content.export");
  if (gate instanceof Response) return gate;

  try {
    // ② docx Buffer + 파일명 한 번에 생성
    const result = await buildRequirementDocxWithHistory(projectId, reqId);
    if (!result.ok) {
      return apiError(result.code, result.message, result.httpStatus);
    }

    // ③ 다운로드 응답 — 한글 파일명 RFC 5987 형식으로 인코딩
    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type":        MIME_DOCX,
        "Content-Length":      result.buffer.length.toString(),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
        "Cache-Control":       "private, no-cache",
      },
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/requirements/${reqId}/export/docx] 오류:`, err);
    return apiError("EXPORT_ERROR", "요구사항 명세서 생성에 실패했습니다.", 500);
  }
}
