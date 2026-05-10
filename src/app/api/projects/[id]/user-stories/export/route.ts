/**
 * GET /api/projects/[id]/user-stories/export — 사용자스토리 목록 엑셀 다운로드 (UW-00016)
 */

import { createExportRoute } from "@/lib/exports/excel/createExportRoute";
import { userStoriesExportConfig } from "@/lib/exports/excel/entities/user-stories";

export const GET = createExportRoute(userStoriesExportConfig);
