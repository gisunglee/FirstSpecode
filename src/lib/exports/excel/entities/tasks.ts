/**
 * 엑셀 다운로드 — 과업 목록 (UW-00014)
 *
 * 역할:
 *   - 과업 목록 화면(`/projects/[id]/tasks`) 의 엑셀 다운로드 설정
 *   - 컬럼 메타와 데이터 fetch 호출을 한 묶음(ExportConfig) 으로 정의
 *
 * 데이터 정합성:
 *   fetchProjectTasks 를 화면 GET 라우트와 공유한다. 즉 화면에 보이는 행이
 *   곧 엑셀로 떨어지는 행이며, 가공 결과(담당자명/우선순위 집계 등)도 동일하다.
 *
 * 컬럼 변경 시:
 *   - 셀에 새 필드를 노출하려면 TaskListItem 도 함께 확장 (lib/exports/tasks-data.ts).
 *   - 화면 컬럼과 엑셀 컬럼은 의도적으로 분리되어 있다 — 화면에는 안 보이지만
 *     엑셀에는 필요한 정보(예: 담당자 ID, 정렬 순서)는 컬럼만 추가하면 된다.
 */

import type { ExcelColumn, ExportConfig } from "../types";
import {
  fetchProjectTasks,
  type TaskListItem,
} from "@/lib/exports/tasks-data";

// ─── 카테고리 코드 → 한글 라벨 ──────────────────────────────────────────────
// 화면(page.tsx) 의 CATEGORY_LABEL 과 같은 매핑. 추후 공통 코드 테이블로 옮기면
// 두 곳을 한 번에 바꿀 수 있다.
const CATEGORY_LABEL: Record<string, string> = {
  NEW_DEV:  "신규개발",
  IMPROVE:  "기능개선",
  MAINTAIN: "유지보수",
};

// ─── 컬럼 정의 ──────────────────────────────────────────────────────────────
// 화면에 보이는 8개 컬럼을 엑셀에도 그대로 (드래그 핸들 제외).
// H/M/L 은 한 셀에 합치지 않고 3개 컬럼으로 분리 — 엑셀 사용자가 정렬·필터·합산
// 같은 작업을 자유롭게 할 수 있도록 한다 (xlsx 의 진가).
const columns: ExcelColumn<TaskListItem>[] = [
  { key: "displayId", header: "과업 ID",   width: 14 },
  { key: "name",      header: "과업명",     width: 40 },
  { key: "assignee",  header: "담당자",     width: 18,
    format: (r) => r.assignMemberName ?? "" },
  { key: "category",  header: "카테고리",   width: 12,
    format: (r) => CATEGORY_LABEL[r.category] ?? r.category },
  { key: "rfpPageNo", header: "RFP 페이지", width: 14 },
  { key: "outputInfo", header: "산출물",    width: 32 },
  { key: "requirementCount", header: "요구사항 건수", width: 12 },
  { key: "high",      header: "HIGH",   width: 8, format: (r) => r.prioritySummary.high },
  { key: "medium",    header: "MEDIUM", width: 8, format: (r) => r.prioritySummary.medium },
  { key: "low",       header: "LOW",    width: 8, format: (r) => r.prioritySummary.low },
];

// ─── ExportConfig 단일 export ────────────────────────────────────────────────

/**
 * tasks 의 export 설정.
 *
 * URL params 타입:
 *   { id: string }  — projectId (cuid 문자열)
 */
export const tasksExportConfig: ExportConfig<TaskListItem, { id: string }> = {
  permission:   "content.export",
  resolveScope: (p) => ({ projectId: p.id }),
  sheetName:    "과업 목록",
  entityKey:    "tasks",
  columns,
  fetchData: async ({ req, params, mberId }) => {
    const projectId = params.id;
    // 화면 GET 라우트와 동일한 필터 파싱.
    // assignedTo="me" 는 인증된 mberId 로 변환 — "내 담당" 모드로 보고 있던
    // 화면이 그대로 다운로드되도록 보장 (화면-엑셀 결과 일치의 핵심).
    const url        = new URL(req.url);
    const assignedTo = url.searchParams.get("assignedTo") ?? undefined;
    const assigneeFilter = assignedTo === "me" ? mberId : (assignedTo || undefined);

    return fetchProjectTasks({ projectId, assigneeFilter });
  },
};
