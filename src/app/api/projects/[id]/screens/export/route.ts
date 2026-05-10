/**
 * GET /api/projects/[id]/screens/export — 화면 목록 엑셀 다운로드 (UW-00020)
 */

import { createExportRoute } from "@/lib/exports/excel/createExportRoute";
import { screensExportConfig } from "@/lib/exports/excel/entities/screens";

export const GET = createExportRoute(screensExportConfig);
