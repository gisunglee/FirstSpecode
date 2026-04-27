/**
 * GET /api/projects/[id]/documents/release/[releaseId]/docx
 *   — 특정 발행 버전의 docx 파일을 박제된 스냅샷에서 복원해 다운로드한다
 *
 * 동작:
 *   1) release 행 조회 — 권한·소속 검증
 *   2) snapshot_data(JSON) 를 RequirementExportInput 으로 복원
 *   3) buildRequirementDocx() 로 docx 빌드 (현재 양식 코드 그대로 사용)
 *   4) 다운로드 응답
 *
 * 시점 일관성:
 *   원본 도메인 데이터(요구사항 본문/담당자/발주처명) 가 이후에 바뀌어도, 박제된 스냅샷
 *   기반으로 빌드하기 때문에 "그 발행 시점의 docx" 가 그대로 복원된다.
 *
 *   양식 코드(buildRequirementDocx) 자체가 미래에 바뀌면 박제된 데이터로도 새 양식이
 *   적용된다는 점은 의도된 trade-off 이다 (양식 일관성 vs 본문 일관성 — 후자를 보장).
 *
 * 권한:
 *   - "content.export" — VIEWER 차단, MEMBER 이상만 (지원 세션에서 자동 차단)
 *
 * 응답:
 *   - Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
 *   - Content-Disposition: attachment; filename*=UTF-8''<encoded>
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiError } from "@/lib/apiResponse";
import {
  buildRequirementDocx,
  type RequirementExportInput,
} from "@/lib/exports/docx/requirement";

type RouteParams = { params: Promise<{ id: string; releaseId: string }> };

const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOC_KIND_REQUIREMENT = "REQUIREMENT";

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, releaseId } = await params;

  // ① 권한 체크 — content.export
  const gate = await requirePermission(request, projectId, "content.export");
  if (gate instanceof Response) return gate;

  try {
    // ② release 행 조회 — 프로젝트 소속 검증 동시 수행
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

    // ③ 산출물 종류별 빌더 분기 — 현재는 REQUIREMENT 만
    if (release.doc_kind !== DOC_KIND_REQUIREMENT) {
      return apiError("UNSUPPORTED_DOC_KIND", "이 산출물 종류는 아직 다운로드할 수 없습니다.", 400);
    }

    // ④ 스냅샷 → RequirementExportInput 복원
    //   snapshot_data 는 Prisma 가 JsonValue 로 반환. 우리가 발행 시 RequirementExportInput
    //   객체 그대로 박제했으므로 형태가 일치한다는 가정 하에 캐스팅.
    //   (혹시 깨진 데이터가 들어있으면 buildRequirementDocx 내부에서 런타임 에러로 잡힘 → catch)
    const input = release.snapshot_data as unknown as RequirementExportInput;

    // ⑤ docx 생성
    const buffer = await buildRequirementDocx(input);

    // ⑥ 다운로드 응답
    //   파일명 패턴: REQ-00023_요구사항명세서_v1.0.docx — 버전 명시로 식별성 ↑
    const filename = `${input.reqDisplayId}_요구사항명세서_${release.vrsn_no}.docx`;
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":        MIME_DOCX,
        "Content-Length":      buffer.length.toString(),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control":       "private, no-cache",
      },
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/documents/release/${releaseId}/docx] 오류:`, err);
    return apiError("EXPORT_ERROR", "발행 버전 다운로드에 실패했습니다.", 500);
  }
}
