/**
 * GET /api/projects/[id]/memos/export — 메모 목록 엑셀 다운로드
 */

import { createExportRoute } from "@/lib/exports/excel/createExportRoute";
import { memosExportConfig } from "@/lib/exports/excel/entities/memos";

export const GET = createExportRoute(memosExportConfig);
