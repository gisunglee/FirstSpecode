/**
 * GET /api/projects/[id]/artifacts/task-matrix/xlsx
 *   — 프로젝트 단위 "과업대비표" Excel(.xlsx) 다운로드
 *
 * docx 라우트와 동일 옵션(includeTaskContent/includeReqContent) 사용.
 * 데이터 매핑도 docx 와 100% 동일 — 빌더만 xlsx 로 분기.
 *
 * 시트 구성:
 *   1) 표지       — 프로젝트 메타
 *   2) 반영 현황   — 전체/반영/미반영 요약 + 발행 이력
 *   3) 과업대비표  — 과업 ↔ 요구사항 매핑 (과업 컬럼 세로병합)
 *
 * 권한: content.export
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
import { apiError } from "@/lib/apiResponse";
import {
  buildTaskMatrixXlsxWithData,
  type TaskMatrixOptions,
} from "@/lib/exports/task-matrix-data";

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
  const opts: TaskMatrixOptions = {
    includeTaskContent: parseBoolFlag(url.searchParams.get("includeTaskContent")),
    includeReqContent:  parseBoolFlag(url.searchParams.get("includeReqContent")),
  };

  try {
    // ③ xlsx Buffer + 파일명
    const result = await buildTaskMatrixXlsxWithData(projectId, opts);
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
    console.error(`[GET /api/projects/${projectId}/artifacts/task-matrix/xlsx] 오류:`, err);
    return apiError("EXPORT_ERROR", "과업대비표(엑셀) 생성에 실패했습니다.", 500);
  }
}
