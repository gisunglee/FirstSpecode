/**
 * GET /api/projects/export — 내 프로젝트 목록 엑셀 다운로드 (UW-00008)
 *
 * 시스템 레벨 export — 특정 프로젝트의 권한 모델이 아니라 "본인 데이터" 이므로
 * createExportRoute 의 프로젝트 권한 체크 흐름을 쓰지 않고 requireAuth 만 사용.
 * 코어(buildWorkbook + filename)는 그대로 재사용.
 */

import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/requireAuth";
import { apiError } from "@/lib/apiResponse";
import { buildWorkbook } from "@/lib/exports/excel/buildWorkbook";
import { buildExportFilename } from "@/lib/exports/excel/filename";
import { MAX_EXPORT_ROWS, type ExcelColumn } from "@/lib/exports/excel/types";
import { ROLE_LABEL, isRoleCode } from "@/lib/permissions";
import {
  fetchMyProjects,
  type ProjectListItem,
} from "@/lib/exports/projects-data";

const columns: ExcelColumn<ProjectListItem>[] = [
  { key: "name",         header: "프로젝트명",  width: 30 },
  { key: "abbreviation", header: "약어",       width: 12,
    format: (r) => r.abbreviation ?? "" },
  { key: "clientName",   header: "고객사",     width: 24,
    format: (r) => r.clientName ?? "" },
  { key: "myRole",       header: "내 역할",    width: 12,
    format: (r) => (isRoleCode(r.myRole) ? ROLE_LABEL[r.myRole] : r.myRole) },
  { key: "startDate",    header: "시작일",     width: 14,
    format: (r) => r.startDate ?? "" },
  { key: "endDate",      header: "종료일",     width: 14,
    format: (r) => r.endDate ?? "" },
];

export async function GET(req: NextRequest): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  let rows: ProjectListItem[];
  try {
    rows = await fetchMyProjects({
      mberId: auth.mberId,
      allowedPrjctId: auth.allowedPrjctId ?? null,
    });
  } catch (err) {
    console.error("[GET /api/projects/export] 조회 실패:", err);
    return apiError("DB_ERROR", "프로젝트 목록 조회에 실패했습니다.", 500);
  }

  if (rows.length > MAX_EXPORT_ROWS) {
    return apiError(
      "EXPORT_TOO_LARGE",
      `한 번에 ${MAX_EXPORT_ROWS.toLocaleString()}건까지 다운로드할 수 있습니다.`,
      400,
    );
  }

  let buffer: Buffer;
  try {
    buffer = await buildWorkbook({
      sheetName: "프로젝트 목록",
      columns,
      rows,
    });
  } catch (err) {
    console.error("[GET /api/projects/export] 워크북 생성 실패:", err);
    return apiError("EXPORT_BUILD_ERROR", "엑셀 파일 생성에 실패했습니다.", 500);
  }

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        `attachment; filename="${buildExportFilename("projects")}"`,
      "Cache-Control": "no-store",
    },
  });
}
