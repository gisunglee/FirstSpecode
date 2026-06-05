/**
 * GET /api/projects/[id]/artifacts/task-matrix/docx
 *   — 프로젝트 단위 "과업대비표" Word 다운로드 (옵션 포함)
 *
 * 과업대비표 = RFP/제안서 과업(SFR)이 요구사항정의서의 요구사항(REF)으로 어떻게
 * 반영됐는지 확인하는 매핑 문서. 누락 방지·감리/검수 대응이 핵심.
 *
 * 옵션 (query param, "true"/"1" 만 활성):
 *   - includeTaskContent : 과업 본문(dtl_cn) 컬럼 포함
 *   - includeReqContent  : 요구사항 본문(현행본 curncy_cn) 컬럼 포함
 *
 * 권한:
 *   - "content.export" — VIEWER 차단, MEMBER 이상만
 *   - 시스템 관리자 지원 세션에서 자동 차단
 *
 * 응답:
 *   - Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
 *   - Content-Disposition: attachment; filename*=UTF-8''<프로젝트명>_과업대비표[(옵션)].docx
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
import { apiError } from "@/lib/apiResponse";
import {
  buildTaskMatrixDocxWithData,
  type TaskMatrixOptions,
} from "@/lib/exports/task-matrix-data";

type RouteParams = { params: Promise<{ id: string }> };

const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** "true"/"1" 만 true 로 — 그 외(빈 값/"false"/"0"/임의값)는 false. */
function parseBoolFlag(v: string | null): boolean {
  if (!v) return false;
  return v === "true" || v === "1";
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  // ① 권한 — content.export
  const gate = await requirePermission(request, projectId, "content.export");
  if (gate instanceof Response) return gate;

  // ② 옵션 파싱 (query param)
  const url  = new URL(request.url);
  const opts: TaskMatrixOptions = {
    includeTaskContent: parseBoolFlag(url.searchParams.get("includeTaskContent")),
    includeReqContent:  parseBoolFlag(url.searchParams.get("includeReqContent")),
  };

  try {
    // ③ docx Buffer + 파일명 한 번에
    const result = await buildTaskMatrixDocxWithData(projectId, opts);
    if (!result.ok) {
      return apiError(result.code, result.message, result.httpStatus);
    }

    // ④ 다운로드 응답 — RFC 5987 형식 한글 파일명
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
    console.error(`[GET /api/projects/${projectId}/artifacts/task-matrix/docx] 오류:`, err);
    return apiError("EXPORT_ERROR", "과업대비표 생성에 실패했습니다.", 500);
  }
}
