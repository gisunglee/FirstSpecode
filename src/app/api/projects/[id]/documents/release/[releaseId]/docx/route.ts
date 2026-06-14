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
import {
  buildUnitWorkDocx,
  type UnitWorkExportInput,
} from "@/lib/exports/docx/unit-work";
import {
  buildRequirementsDefDocx,
  type RequirementsDefExportInput,
} from "@/lib/exports/docx/requirements-def";
import { buildDocxFilename, docNoFilenamePrefix, filenameSafe } from "@/lib/exports/filename";

type RouteParams = { params: Promise<{ id: string; releaseId: string }> };

const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOC_KIND_REQUIREMENT      = "REQUIREMENT";
const DOC_KIND_UNIT_WORK        = "UNIT_WORK";
const DOC_KIND_REQUIREMENTS_DEF = "REQUIREMENTS_DEF";

/**
 * 단일 다운로드와 같은 파일명 체계("...docx")에 발행 버전 접미사를 끼운다.
 *   "GBMS_D406_프로그램사양서_UW-00001_테스트.docx" + "v1.0"
 *     → "GBMS_D406_프로그램사양서_UW-00001_테스트_v1.0.docx"
 * 버전이 비면 접미사 없이 그대로.
 */
function appendVersion(name: string, vrsnNo: string | null | undefined): string {
  const v = filenameSafe(vrsnNo);
  return v ? name.replace(/\.docx$/i, `_${v}.docx`) : name;
}

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

    // ③ 산출물 종류별 빌더 분기
    //   snapshot_data 는 발행 당시 *ExportInput 객체 통째로 박제됐다는 가정 하에 캐스팅.
    //   깨진 데이터면 buildXxxDocx 내부에서 런타임 에러 → catch 블록에서 잡힘.
    let buffer: Buffer;
    let filename: string;

    if (release.doc_kind === DOC_KIND_REQUIREMENT) {
      const input = release.snapshot_data as unknown as RequirementExportInput;
      buffer = await buildRequirementDocx(input);
      // 단일 다운로드와 동일 체계: [<PREFIX>_]<문서종류>_<표시ID>_<이름>_<버전>.docx
      //   PREFIX = 문서번호 중간코드까지(예 "GBMS_A302"), 없으면 약어. 구버전 스냅샷이면 docMeta 가
      //   없을 수 있어 옵셔널 체이닝으로 방어(없으면 prefix 생략).
      const prefix = docNoFilenamePrefix(input.docMeta?.docNo) || input.projectAbbr;
      filename = appendVersion(
        buildDocxFilename(input.reqDisplayId, input.reqName, "요구사항명세서", { projectAbbr: prefix }),
        release.vrsn_no,
      );
    } else if (release.doc_kind === DOC_KIND_UNIT_WORK) {
      const input = release.snapshot_data as unknown as UnitWorkExportInput;
      buffer = await buildUnitWorkDocx(input);
      // 단일 다운로드와 동일 체계 (요구사항 명세서와 같은 규칙)
      const prefix = docNoFilenamePrefix(input.docMeta?.docNo) || input.projectAbbr;
      filename = appendVersion(
        buildDocxFilename(input.unitWorkDisplayId, input.unitWorkName, "프로그램사양서", { projectAbbr: prefix }),
        release.vrsn_no,
      );
    } else if (release.doc_kind === DOC_KIND_REQUIREMENTS_DEF) {
      const input = release.snapshot_data as unknown as RequirementsDefExportInput;
      buffer = await buildRequirementsDefDocx(input);
      // 정의서는 프로젝트 단위 — 단일 다운로드와 동일하게 PREFIX_요구사항정의서_버전.docx
      const prefix =
        docNoFilenamePrefix(input.docMeta?.docNo) ||
        filenameSafe(input.projectAbbr) ||
        filenameSafe(input.projectName) ||
        "프로젝트";
      filename = appendVersion(`${prefix}_요구사항정의서.docx`, release.vrsn_no);
    } else {
      return apiError("UNSUPPORTED_DOC_KIND", "이 산출물 종류는 아직 다운로드할 수 없습니다.", 400);
    }
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
