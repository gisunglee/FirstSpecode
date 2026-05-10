/**
 * GET /api/projects/[id]/db-tables/export — DB 테이블 목록 엑셀 다운로드
 */

import { createExportRoute } from "@/lib/exports/excel/createExportRoute";
import { dbTablesExportConfig } from "@/lib/exports/excel/entities/db-tables";

export const GET = createExportRoute(dbTablesExportConfig);
