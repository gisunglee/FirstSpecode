/**
 * GET /api/projects/[id]/areas/export — 영역 목록 엑셀 다운로드 (UW-00021)
 */

import { createExportRoute } from "@/lib/exports/excel/createExportRoute";
import { areasExportConfig } from "@/lib/exports/excel/entities/areas";

export const GET = createExportRoute(areasExportConfig);
