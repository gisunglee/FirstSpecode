/**
 * GET /api/projects/[id]/members/export — 멤버 목록 엑셀 다운로드
 */

import { createExportRoute } from "@/lib/exports/excel/createExportRoute";
import { membersExportConfig } from "@/lib/exports/excel/entities/members";

export const GET = createExportRoute(membersExportConfig);
