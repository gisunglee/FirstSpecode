/**
 * GET /api/projects/[id]/artifacts/requirements-def/xlsx
 *   — 프로젝트 단위 "요구사항 정의서" Excel(.xlsx) 다운로드
 *
 * docx 라우트와 동일 옵션 (includeOriginal/includeHistory) 사용.
 * 데이터 매핑도 docx 와 100% 동일 — 빌더만 xlsx 로 분기.
 *
 * 시트 구성:
 *   1) 표지     — 프로젝트 메타
 *   2) 변경 이력 — 산출물 발행 이력
 *   3) 요구사항  — 1행에 메타 + 현행본 + 원본 + 변경이력 모두
 *
 * 권한: content.export
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
import { apiError } from "@/lib/apiResponse";
import {
  buildRequirementsDefXlsxWithHistory,
  type RequirementsDefOptions,
} from "@/lib/exports/requirements-def-data";

type RouteParams = { params: Promise<{ id: string }> };

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function parseBoolFlag(v: string | null): boolean {
  if (!v) return false;
  return v === "true" || v === "1";
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  // ① 권한
  const gate = await requirePermission(request, projectId, "content.export");
  if (gate instanceof Response) return gate;

  // ② 옵션 파싱
  const url  = new URL(request.url);
  const opts: RequirementsDefOptions = {
    includeOriginal: parseBoolFlag(url.searchParams.get("includeOriginal")),
    includeHistory:  parseBoolFlag(url.searchParams.get("includeHistory")),
  };

  try {
    // ③ xlsx Buffer + 파일명
    const result = await buildRequirementsDefXlsxWithHistory(projectId, opts);
    if (!result.ok) {
      return apiError(result.code, result.message, result.httpStatus);
    }

    // ④ 다운로드 응답
    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type":        MIME_XLSX,
        "Content-Length":      result.buffer.length.toString(),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
        "Cache-Control":       "private, no-cache",
      },
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/artifacts/requirements-def/xlsx] 오류:`, err);
    return apiError("EXPORT_ERROR", "요구사항 정의서(엑셀) 생성에 실패했습니다.", 500);
  }
}
