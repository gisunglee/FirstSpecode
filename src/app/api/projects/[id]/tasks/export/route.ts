/**
 * GET /api/projects/[id]/tasks/export — 과업 목록 엑셀 다운로드 (UW-00014)
 *
 * 본 파일은 보일러플레이트 없이 entity 설정만 createExportRoute 에 위임한다.
 * 권한 체크·행수 가드·워크북 생성·파일 응답은 createExportRoute 의 책임.
 */

import { createExportRoute } from "@/lib/exports/excel/createExportRoute";
import { tasksExportConfig } from "@/lib/exports/excel/entities/tasks";

export const GET = createExportRoute(tasksExportConfig);
