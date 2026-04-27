/**
 * GET /api/projects/[id]/requirements/[reqId]/export/docx
 *   — 요구사항 1건의 현재 시점 양식을 Word(.docx) 로 내려받는다
 *
 * 데이터 흐름:
 *   1) buildRequirementExportInput() — DB → 양식 입력 객체 매핑 (lib/exports/requirement-data)
 *   2) 발행 이력(TbDsDocumentRelease) 이 있으면 변경이력 표를 그 데이터로 덮어씀
 *   3) buildRequirementDocx()        — 양식 입력 객체 → docx Buffer
 *   4) 다운로드 응답
 *
 * 권한:
 *   - "content.export" — VIEWER 차단, MEMBER 이상만
 *   - ".read" 가 아니라 시스템 관리자 지원 세션에서 자동 차단됨
 *
 * 응답:
 *   - Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
 *   - Content-Disposition: attachment; filename*=UTF-8''<encoded>
 *
 * 관련:
 *   - 특정 발행 버전의 docx 다운로드는 /documents/release/[releaseId]/docx 별도 엔드포인트 사용
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiError } from "@/lib/apiResponse";
import { buildRequirementDocx } from "@/lib/exports/docx/requirement";
import {
  buildRequirementExportInput,
  REQUIREMENT_EXPORT_FALLBACK,
} from "@/lib/exports/requirement-data";
import { bumpMinorVersion } from "@/lib/exports/version";

type RouteParams = { params: Promise<{ id: string; reqId: string }> };

const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOC_KIND_REQUIREMENT = "REQUIREMENT";

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, reqId } = await params;

  // ① 권한 체크 — content.export (지원 세션에서 자동 차단)
  const gate = await requirePermission(request, projectId, "content.export");
  if (gate instanceof Response) return gate;

  try {
    // ② DB → 양식 입력 객체 매핑
    const result = await buildRequirementExportInput(projectId, reqId);
    if (!result.ok) {
      return apiError(result.code, result.message, result.httpStatus);
    }
    const input = result.input;

    // ③ 발행 이력 조회
    //   변경이력 표 = "현재 본문" 1행 (항상) + 발행 이력 행들 (있으면)
    //
    //   "현재 본문" 행을 항상 맨 위에 두는 이유:
    //     - [Word 출력] 으로 받는 docx 는 "지금 시점의 본문" 이지만 표는 발행본만
    //       표시되면 본문/표 시제 불일치로 사용자가 혼란.
    //     - 발행을 안 했어도 변경이력 표가 비어있지 않게 유지 (빈 표보다 나음).
    //   "현재 본문" 행은 입력란 prefill 이 아닌 출력 양식 전용 — DB 박제 안 됨.
    //   (특정 발행 버전 다운로드 /documents/release/[id]/docx 는 박제된 snapshot 사용 →
    //    이 경로는 영향 없음)
    const releases = await prisma.tbDsDocumentRelease.findMany({
      where:   { prjct_id: projectId, doc_kind: DOC_KIND_REQUIREMENT, ref_id: reqId },
      orderBy: { released_dt: "desc" },
      select: {
        vrsn_no: true, change_cn: true, author_nm: true, approver_nm: true, released_dt: true,
      },
    });

    const today = new Date().toISOString().slice(0, 10);
    // "현재 작업 중" 행의 버전 라벨 결정:
    //   - 발행 1건+ : 직전 발행 버전을 마이너 +1 (예: v1.0 → v1.1)
    //                "이 본문이 다음에 발행될 버전" 으로 자연스럽게 읽히도록.
    //   - 발행 0건  : input.documentVersion 그대로 (= 프로젝트 설정의 docVersionDefault
    //                또는 코드 fallback "v1.0").
    // 메이저 자동화는 의도적으로 안 함 — 시스템이 마이너/메이저 의도를 알 수 없으므로
    // 사용자가 발행 시점에 모달에서 직접 수정.
    const currentVersion = releases.length > 0
      ? bumpMinorVersion(releases[0].vrsn_no)
      : input.documentVersion;
    // 변경 내용 라벨 — 상황별 분기
    //   - 발행 0건 (지금 작성한 게 최초 본문)        : "최초 작성"
    //   - 발행 1건+ (직전 발행 이후 수정 중인 본문) : "(현재 작업 중)"
    const currentChange = releases.length > 0
      ? "(현재 작업 중)"
      : REQUIREMENT_EXPORT_FALLBACK.historyChange;
    const currentRow = {
      version:  currentVersion,
      date:     today,
      change:   currentChange,
      author:   input.authorName,
      approver: input.approverName,
    };
    const releaseRows = releases.map((r) => ({
      version:  r.vrsn_no,
      date:     r.released_dt.toISOString().slice(0, 10),
      change:   r.change_cn   ?? "",
      author:   r.author_nm   ?? "",
      approver: r.approver_nm ?? "",
    }));
    input.history = [currentRow, ...releaseRows];

    // ④ docx 생성
    const buffer = await buildRequirementDocx(input);

    // ⑤ 다운로드 응답 — 파일명 한글 포함이라 RFC 5987 형식 사용
    const filename = `${input.reqDisplayId}_요구사항명세서.docx`;
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
    console.error(`[GET /api/projects/${projectId}/requirements/${reqId}/export/docx] 오류:`, err);
    return apiError("EXPORT_ERROR", "요구사항 명세서 생성에 실패했습니다.", 500);
  }
}
