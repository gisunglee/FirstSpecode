/**
 * GET /api/projects/[id]/design-templates/export — 설계 양식 엑셀 다운로드
 */

import { createExportRoute } from "@/lib/exports/excel/createExportRoute";
import { designTemplatesExportConfig } from "@/lib/exports/excel/entities/design-templates";

export const GET = createExportRoute(designTemplatesExportConfig);
