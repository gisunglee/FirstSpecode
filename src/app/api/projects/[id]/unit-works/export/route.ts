/**
 * GET /api/projects/[id]/unit-works/export — 단위업무 목록 엑셀 다운로드 (UW-00019)
 */

import { createExportRoute } from "@/lib/exports/excel/createExportRoute";
import { unitWorksExportConfig } from "@/lib/exports/excel/entities/unit-works";

export const GET = createExportRoute(unitWorksExportConfig);
