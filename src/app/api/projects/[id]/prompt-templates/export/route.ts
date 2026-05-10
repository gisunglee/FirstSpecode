/**
 * GET /api/projects/[id]/prompt-templates/export — 프롬프트 템플릿 엑셀 다운로드
 */

import { createExportRoute } from "@/lib/exports/excel/createExportRoute";
import { promptTemplatesExportConfig } from "@/lib/exports/excel/entities/prompt-templates";

export const GET = createExportRoute(promptTemplatesExportConfig);
