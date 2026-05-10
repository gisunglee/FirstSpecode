/**
 * GET /api/projects/[id]/functions/export — 기능 목록 엑셀 다운로드 (UW-00022)
 */

import { createExportRoute } from "@/lib/exports/excel/createExportRoute";
import { functionsExportConfig } from "@/lib/exports/excel/entities/functions";

export const GET = createExportRoute(functionsExportConfig);
