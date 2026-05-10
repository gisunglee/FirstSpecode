/**
 * GET /api/projects/[id]/requirements/export — 요구사항 목록 엑셀 다운로드 (UW-00015)
 */

import { createExportRoute } from "@/lib/exports/excel/createExportRoute";
import { requirementsExportConfig } from "@/lib/exports/excel/entities/requirements";

export const GET = createExportRoute(requirementsExportConfig);
