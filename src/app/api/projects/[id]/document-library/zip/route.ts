/**
 * POST /api/projects/[id]/document-library/zip
 *   — 선택된 요구사항/단위업무 산출물을 한 zip 파일로 묶어 다운로드
 *
 * 입력 (body):
 *   {
 *     reqIds:      string[],   // 요구사항 명세서로 만들 요구사항 ID 목록
 *     unitWorkIds: string[],   // 프로그램 사양서로 만들 단위업무 ID 목록
 *   }
 *
 * 동작:
 *   1) 권한 체크 (content.export — 지원 세션 자동 차단)
 *   2) 입력 검증 — 둘 다 비어있으면 400
 *   3) 각 항목을 buildXxxDocxWithHistory() 로 빌드 (단일 export 라우트와 동일 헬퍼)
 *   4) JSZip 인스턴스에
 *        요구사항명세서/<RQ-...>.docx
 *        프로그램사양서/<UW-...>.docx
 *      구조로 추가
 *   5) zip Buffer 생성 → application/zip 응답
 *
 * 단일 항목 빌드 실패 시:
 *   부분 실패는 zip 안에 "_빌드실패.txt" 로 기록하고 나머지는 정상 포함.
 *   전체 실패 시 500.
 *
 * 응답 파일명:
 *   <projectName>_산출물_YYYY-MM-DD.zip  (RFC 5987)
 */

import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiError } from "@/lib/apiResponse";
import { buildRequirementDocxWithHistory } from "@/lib/exports/requirement-data";
import { buildUnitWorkDocxWithHistory } from "@/lib/exports/unit-work-data";
import { filenameSafe } from "@/lib/exports/filename";

type RouteParams = { params: Promise<{ id: string }> };

const MIME_ZIP = "application/zip";

// 한 번에 너무 많은 항목을 빌드하면 메모리/타임아웃 위험 → 합계 상한.
// 100건이면 .docx 평균 50KB 가정 시 zip ~5MB 이내로 안전.
const MAX_ITEMS_PER_ZIP = 100;

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  // ── ① 권한 ────────────────────────────────────────────
  const gate = await requirePermission(request, projectId, "content.export");
  if (gate instanceof Response) return gate;

  // ── ② 입력 파싱 + 검증 ──────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { reqIds, unitWorkIds } = (body ?? {}) as {
    reqIds?:      unknown;
    unitWorkIds?: unknown;
  };

  // 두 배열 모두 string[] 인지 검증 — 잘못된 타입 들어오면 빈 배열로 안전 처리
  const reqIdList = Array.isArray(reqIds)
    ? reqIds.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
  const uwIdList = Array.isArray(unitWorkIds)
    ? unitWorkIds.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];

  if (reqIdList.length === 0 && uwIdList.length === 0) {
    return apiError("VALIDATION_ERROR", "다운로드할 항목을 1개 이상 선택해 주세요.", 400);
  }

  if (reqIdList.length + uwIdList.length > MAX_ITEMS_PER_ZIP) {
    return apiError(
      "VALIDATION_ERROR",
      `한 번에 최대 ${MAX_ITEMS_PER_ZIP}건까지 다운로드할 수 있습니다. 선택을 줄여 주세요.`,
      400,
    );
  }

  // ── ③ 프로젝트 정보 (zip 파일명에 사용) ───────────────
  const project = await prisma.tbPjProject.findUnique({
    where:  { prjct_id: projectId },
    select: { prjct_nm: true },
  });
  if (!project) {
    return apiError("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
  }

  try {
    const zip = new JSZip();
    const reqFolder = zip.folder("요구사항명세서");
    const uwFolder  = zip.folder("프로그램사양서");
    if (!reqFolder || !uwFolder) {
      // JSZip.folder() 가 null 을 반환할 일은 사실상 없지만 (이름 충돌 시) 방어 처리
      return apiError("ZIP_ERROR", "ZIP 폴더를 만들 수 없습니다.", 500);
    }

    // ── ④ 각 항목 빌드 — 순차 실행 (병렬은 메모리 폭증 위험) ──────
    // 부분 실패는 zip 안에 텍스트 파일로 기록하고 나머지는 정상 포함.
    const failures: string[] = [];

    for (const reqId of reqIdList) {
      const r = await buildRequirementDocxWithHistory(projectId, reqId);
      if (r.ok) {
        reqFolder.file(r.filename, r.buffer);
      } else {
        failures.push(`[REQ ${reqId}] ${r.code} — ${r.message}`);
      }
    }

    for (const uwId of uwIdList) {
      const r = await buildUnitWorkDocxWithHistory(projectId, uwId);
      if (r.ok) {
        uwFolder.file(r.filename, r.buffer);
      } else {
        failures.push(`[UW ${uwId}] ${r.code} — ${r.message}`);
      }
    }

    // 모든 항목이 실패한 경우 → 500 (빈 zip 의미 없음)
    const reqOk = reqIdList.length > 0 && Object.keys(reqFolder.files).length > 0;
    const uwOk  = uwIdList.length > 0  && Object.keys(uwFolder.files).length > 0;
    if (!reqOk && !uwOk) {
      console.error(`[POST /api/projects/${projectId}/document-library/zip] 모든 항목 빌드 실패:`, failures);
      return apiError("EXPORT_ERROR", "선택한 항목을 모두 만들지 못했습니다.", 500);
    }

    // 부분 실패가 있으면 안내 텍스트 동봉
    if (failures.length > 0) {
      const text = [
        "다음 항목은 빌드에 실패해 zip 에 포함되지 않았습니다.",
        "",
        ...failures,
      ].join("\n");
      zip.file("_빌드실패.txt", text);
    }

    // ── ⑤ zip Buffer 생성 ─────────────────────────────
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    // ── ⑥ 다운로드 응답 ───────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    const safeName = filenameSafe(project.prjct_nm) || "프로젝트";
    const filename = `${safeName}_산출물_${today}.zip`;

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type":        MIME_ZIP,
        "Content-Length":      zipBuffer.length.toString(),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control":       "private, no-cache",
      },
    });
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/document-library/zip] 오류:`, err);
    return apiError("EXPORT_ERROR", "ZIP 파일 생성에 실패했습니다.", 500);
  }
}
