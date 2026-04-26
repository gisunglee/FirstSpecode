/**
 * GET /api/projects/[id]/requirements/[reqId]/export/docx
 *   — 요구사항 1건을 공공 SI 양식 Word(.docx) 로 내려받는 엔드포인트
 *
 * 역할:
 *   - DB 에서 요구사항 + 상위 과업 + 담당자 + 프로젝트 메타를 한 번에 조회
 *   - 양식에 필요한 라벨(우선순위/출처)로 매핑
 *   - 변경이력/작성자/승인자/문서버전 등 DB 미정비 영역은 기본값(fallback)으로 채움
 *   - buildRequirementDocx 호출 → Buffer → 다운로드 응답
 *
 * 권한:
 *   - "content.export" — VIEWER 차단, MEMBER 이상만
 *   - "content.read" 가 아닌 별도 권한이라 시스템 관리자 지원 세션에서 자동 차단됨
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

type RouteParams = { params: Promise<{ id: string; reqId: string }> };

// ─── 코드 → 라벨 매핑 ────────────────────────────────────────
// 화면(requirements/page.tsx)과 동일한 라벨 사용. 향후 공통 코드 테이블로 옮기면 한 곳에서 관리.
const PRIORITY_LABELS: Record<string, string> = {
  HIGH:   "높음 (HIGH)",
  MEDIUM: "중간 (MEDIUM)",
  LOW:    "낮음 (LOW)",
};

const SOURCE_LABELS: Record<string, string> = {
  RFP:    "RFP",
  ADD:    "추가",
  CHANGE: "변경",
};

// ─── DB 미정비 영역 기본값 ──────────────────────────────────
// 추후 DB 정비되면 이 값들은 모두 실제 데이터로 교체 (CLAUDE.md TODO).
// 호출부에서 fallback 만 책임지고, 양식 모듈은 이 값을 그대로 출력한다.
const FALLBACK = {
  copyright:       "Copyright ⓒ SPECODE",
  documentVersion: "v1.0",
  authorName:      "(미지정)",
  approverName:    "(미지정)",
  historyChange:   "최초 작성",
} as const;

// ─── MIME ────────────────────────────────────────────────────
const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, reqId } = await params;

  // ① 권한 체크 — content.export (지원 세션에서 자동 차단)
  const gate = await requirePermission(request, projectId, "content.export");
  if (gate instanceof Response) return gate;

  try {
    // ② DB 조회 — 요구사항 + 상위 과업 (한 번)
    const req = await prisma.tbRqRequirement.findUnique({
      where:   { req_id: reqId },
      include: { task: { select: { task_nm: true } } },
    });
    if (!req || req.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "요구사항을 찾을 수 없습니다.", 404);
    }

    // ③ 프로젝트 / 담당자 병렬 조회 — 의존 관계 없음
    const [project, assignee] = await Promise.all([
      prisma.tbPjProject.findUnique({
        where:  { prjct_id: projectId },
        select: { prjct_nm: true, client_nm: true },
      }),
      req.asign_mber_id
        ? prisma.tbCmMember.findUnique({
            where:  { mber_id: req.asign_mber_id },
            // mber_nm 비어있는 경우 email 로 fallback
            select: { mber_nm: true, email_addr: true },
          })
        : Promise.resolve(null),
    ]);

    if (!project) {
      return apiError("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
    }

    // ④ 양식 입력 데이터 구성
    // 발주처는 프로젝트의 client_nm — 비어있으면 "발주처 미지정"
    const ordererName = project.client_nm?.trim() || "발주처 미지정";
    const assigneeName = assignee
      ? (assignee.mber_nm?.trim() || assignee.email_addr || "미지정")
      : "미지정";

    const writtenAt = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const input: RequirementExportInput = {
      ordererName,
      copyright:   FALLBACK.copyright,
      projectName: project.prjct_nm,

      reqDisplayId:   req.req_display_id,
      reqName:        req.req_nm,
      parentTaskName: req.task?.task_nm ?? "미분류",
      priorityLabel:  PRIORITY_LABELS[req.priort_code] ?? req.priort_code,
      sourceLabel:    SOURCE_LABELS[req.src_code]      ?? req.src_code,
      rfpPage:        req.rfp_page_no ?? "",
      assigneeName,
      sortOrder:      req.sort_ordr ?? 0,
      detailSpec:     req.spec_cn ?? "",

      // DB 미정비 영역 — 기본값
      documentVersion: FALLBACK.documentVersion,
      writtenAt,
      authorName:      FALLBACK.authorName,
      approverName:    FALLBACK.approverName,
      history: [
        {
          version:  FALLBACK.documentVersion,
          date:     writtenAt,
          change:   FALLBACK.historyChange,
          author:   FALLBACK.authorName,
          approver: FALLBACK.approverName,
        },
      ],
    };

    // ⑤ docx 생성
    const buffer = await buildRequirementDocx(input);

    // ⑥ 다운로드 응답
    // 파일명: REQ-00023_요구사항명세서.docx — 한글 포함이라 RFC 5987 형식
    const filename = `${req.req_display_id}_요구사항명세서.docx`;
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
