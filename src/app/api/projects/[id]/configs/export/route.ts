/**
 * GET /api/projects/[id]/configs/export — 환경설정 엑셀 다운로드
 */

import { createExportRoute } from "@/lib/exports/excel/createExportRoute";
import { configsExportConfig } from "@/lib/exports/excel/entities/configs";

export const GET = createExportRoute(configsExportConfig);
