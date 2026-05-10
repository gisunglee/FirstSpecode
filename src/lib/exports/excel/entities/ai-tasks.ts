/**
 * 엑셀 다운로드 — AI 태스크 목록 (UW-00023)
 *
 * 화면이 페이지네이션으로 분할 표시하는 데이터를 엑셀에서는 필터 조건의 전체로 받는다.
 */

import type { ExcelColumn, ExportConfig } from "../types";
import {
  fetchProjectAiTasks,
  type AiTaskListItem,
} from "@/lib/exports/ai-tasks-data";

const STATUS_LABEL: Record<string, string> = {
  PENDING:     "대기",
  IN_PROGRESS: "처리중",
  DONE:        "완료",
  APPLIED:     "반영됨",
  REJECTED:    "반려",
  FAILED:      "실패",
  TIMEOUT:     "시간초과",
};

const TASK_TYPE_LABEL: Record<string, string> = {
  INSPECT:                   "명세 검토",
  DESIGN:                    "설계",
  IMPLEMENT:                 "구현",
  PRE_IMPL:                  "선 구현 적용",
  MOCKUP:                    "목업",
  IMPACT:                    "영향도 분석",
  CUSTOM:                    "자유 요청",
  PLAN_STUDIO_ARTF_GENERATE: "기획실 산출물 생성",
};

const REF_TYPE_LABEL: Record<string, string> = {
  UNIT_WORK:        "단위업무",
  AREA:             "영역",
  FUNCTION:         "기능",
  SCREEN:           "화면",
  PLAN_STUDIO_ARTF: "기획실",
};

// ms → "X시간 Y분" / "Z초" 같은 사람이 읽기 쉬운 표기
function formatElapsed(ms: number): string {
  if (ms < 1000) return "1초 미만";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}초`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분`;
  const hours = Math.floor(min / 60);
  const remainMin = min % 60;
  return remainMin > 0 ? `${hours}시간 ${remainMin}분` : `${hours}시간`;
}

const columns: ExcelColumn<AiTaskListItem>[] = [
  { key: "refType",   header: "요청 구분",     width: 12,
    format: (r) => REF_TYPE_LABEL[r.refType] ?? r.refType },
  { key: "taskType",  header: "작업 유형",     width: 14,
    format: (r) => TASK_TYPE_LABEL[r.taskType] ?? r.taskType },
  { key: "refDisplayId", header: "대상 ID",   width: 14 },
  { key: "refName",   header: "대상명",       width: 36 },
  { key: "unitWorkName", header: "단위업무",  width: 22,
    format: (r) => r.unitWorkName ?? "" },
  { key: "screenName", header: "화면",        width: 22,
    format: (r) => r.screenName ?? "" },
  { key: "areaName",  header: "영역",         width: 22,
    format: (r) => r.areaName ?? "" },
  { key: "status",    header: "상태",         width: 12,
    format: (r) => STATUS_LABEL[r.status] ?? r.status },
  { key: "reqMberName", header: "요청자",     width: 14 },
  { key: "requestedAt", header: "요청일시",   width: 20 },
  { key: "completedAt", header: "완료일시",   width: 20,
    format: (r) => r.completedAt ?? "" },
  { key: "elapsed",   header: "소요",         width: 12,
    format: (r) => formatElapsed(r.elapsedMs) },
  { key: "retryCnt",  header: "재시도",       width: 8 },
  { key: "comment",   header: "요청 코멘트",   width: 40 },
];

export const aiTasksExportConfig: ExportConfig<AiTaskListItem, { id: string }> = {
  permission:   "content.export",
  resolveScope: (p) => ({ projectId: p.id }),
  sheetName:    "AI 태스크 목록",
  entityKey:    "ai-tasks",
  columns,
  fetchData: async ({ req, params, mberId }) => {
    const url             = new URL(req.url);
    const status          = url.searchParams.get("status")           ?? undefined;
    const taskType        = url.searchParams.get("taskType")         ?? undefined;
    const refType         = url.searchParams.get("refType")          ?? undefined;
    const refId           = url.searchParams.get("refId")            ?? undefined;
    const snapshotRefId   = url.searchParams.get("snapshotRefId")    ?? undefined;
    const snapshotRefType = url.searchParams.get("snapshotRefType")  ?? undefined;
    const reqMberId       = url.searchParams.get("reqMberId")        ?? undefined;

    const { items } = await fetchProjectAiTasks({
      projectId: params.id,
      filters: {
        status, taskType, refType, refId,
        snapshotRefId, snapshotRefType,
        reqMberId, meMberId: mberId,
      },
      // 페이지네이션 미적용 — 필터 조건의 전체 데이터를 export
    });
    return items;
  },
};
