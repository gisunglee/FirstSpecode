/**
 * GET /api/projects/[id]/documents/release/[releaseId]/xlsx
 *   — 특정 발행 버전의 xlsx 파일을 박제된 스냅샷에서 복원해 다운로드
 *
 * docx 라우트(/docx)와 동일한 패턴 — snapshot_data 에서 input 복원 후 xlsx 빌더로.
 *
 * 지원 doc_kind:
 *   - REQUIREMENTS_DEF: 요구사항 정의서 xlsx (3시트)
 *   - 그 외: xlsx 빌더 미보유 → 400 UNSUPPORTED_DOC_KIND
 *     (요구사항 명세서·프로그램 사양서는 docx 만 지원)
 *
 * 권한: content.export — 시스템 관리자 지원 세션 자동 차단
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiError } from "@/lib/apiResponse";
import {
  buildRequirementsDefXlsx,
} from "@/lib/exports/xlsx/requirements-def";
import { type RequirementsDefExportInput } from "@/lib/exports/docx/requirements-def";

type RouteParams = { params: Promise<{ id: string; releaseId: string }> };

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOC_KIND_REQUIREMENTS_DEF = "REQUIREMENTS_DEF";

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, releaseId } = await params;

  // ① 권한
  const gate = await requirePermission(request, projectId, "content.export");
  if (gate instanceof Response) return gate;

  try {
    // ② release 행 조회 — 프로젝트 소속 검증
    const release = await prisma.tbDsDocumentRelease.findUnique({
      where:  { release_id: releaseId },
      select: {
        prjct_id:      true,
        doc_kind:      true,
        ref_id:        true,
        vrsn_no:       true,
        snapshot_data: true,
      },
    });

    if (!release || release.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "발행 이력을 찾을 수 없습니다.", 404);
    }

    // ③ 산출물 종류별 빌더 분기 — xlsx 는 현재 REQUIREMENTS_DEF 만 지원
    if (release.doc_kind !== DOC_KIND_REQUIREMENTS_DEF) {
      return apiError(
        "UNSUPPORTED_DOC_KIND",
        "이 산출물 종류의 Excel 발행본은 지원하지 않습니다.",
        400,
      );
    }

    const input = release.snapshot_data as unknown as RequirementsDefExportInput;
    const buffer = await buildRequirementsDefXlsx(input);
    const filename = `${input.projectName}_요구사항정의서_${release.vrsn_no}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":        MIME_XLSX,
        "Content-Length":      buffer.length.toString(),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control":       "private, no-cache",
      },
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/documents/release/${releaseId}/xlsx] 오류:`, err);
    return apiError("EXPORT_ERROR", "발행 버전 Excel 다운로드에 실패했습니다.", 500);
  }
}
