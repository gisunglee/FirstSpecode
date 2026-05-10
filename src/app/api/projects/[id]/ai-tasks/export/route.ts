/**
 * GET /api/projects/[id]/ai-tasks/export — AI 태스크 목록 엑셀 다운로드 (UW-00023)
 */

import { createExportRoute } from "@/lib/exports/excel/createExportRoute";
import { aiTasksExportConfig } from "@/lib/exports/excel/entities/ai-tasks";

export const GET = createExportRoute(aiTasksExportConfig);
