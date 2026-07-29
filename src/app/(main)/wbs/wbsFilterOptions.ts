/**
 * wbsFilterOptions.ts — WbsFilterBar / WbsSettingsPanel 이 공유하는 작은 타입·상수
 *
 * 왜 별도 파일인가: WbsSettingsPanel은 WbsFilterBar 안에서 쓰이는 하위 컴포넌트라
 * 이 값들을 WbsFilterBar.tsx에 두면 WbsSettingsPanel → WbsFilterBar → WbsSettingsPanel
 * 순환 참조가 생긴다. 둘 다 이 파일만 보게 해서 순환을 없앤다.
 */

export type WbsMemberOption = { memberId: string; name: string };

// WBS 탭 — @/types/pm의 DeadlineEntityKind(UNIT_WORK/SCREEN/FUNCTION)는 PM 현황 등 다른
// 화면에서 FUNCTION도 쓰므로 그 타입을 좁힐 수 없어, WBS 전용으로 따로 둔다.
// 기능 탭은 삭제됨(2026-07-29) — 화면 탭이 하위 기능 구현 일정/진척률을 이미 롤업해서
// 보여주고 있어 기능 단위 조회가 중복이라는 피드백으로 뺐다.
export const WBS_ENTITY_ORDER = ["UNIT_WORK", "SCREEN"] as const;
export type WbsEntityKind = (typeof WBS_ENTITY_ORDER)[number];

// 기간 필터 — 프리셋만 여기서 정의하고, 실제 시작일~종료일 계산은 page.tsx가 한다
// (날짜 계산 로직을 한 곳에만 두기 위함). 나중에 "지난 달"/"다음 주" 등을 추가하고
// 싶으면 이 배열에 프리셋 하나만 늘리면 된다.
export const WBS_PERIOD_PRESETS = ["ALL", "THIS_WEEK", "THIS_MONTH"] as const;
export type WbsPeriodPreset = (typeof WBS_PERIOD_PRESETS)[number];

// 좌측 그리드에 켜고 끌 수 있는 컬럼. "작업명"은 항목을 식별하는 유일한 수단이라 항상
// 켜져 있고(고정), 여기 목록에는 없음. 나중에 컬럼이 더 필요하면 이 배열에 하나만 추가하면
// 됨 — WbsGanttChart.tsx의 컬럼 구성과 WbsSettingsPanel의 체크박스가 둘 다 이 배열을 본다.
// id — 예전엔 작업명 앞에 "[FN-00009]"처럼 대괄호로 박아뒀는데, 별도 컬럼으로 뺀 게 더
// 깔끔하다는 피드백으로 분리(buildBarText에서 대괄호 prefix 제거, wbsTasks.ts 참고).
export const WBS_GRID_COLUMNS = ["id", "assignee", "start", "end", "workDays", "progress", "effort"] as const;
export type WbsGridColumn = (typeof WBS_GRID_COLUMNS)[number];
export const WBS_GRID_COLUMN_LABELS: Record<WbsGridColumn, string> = {
  id:       "ID",
  assignee: "담당자",
  start:    "시작일",
  end:      "종료일",
  workDays: "기간",
  progress: "진척률",
  effort:   "공수",
};

// 기본으로 켜둘 컬럼 — 기존에 항상 보이던 시작일/기간 + 이번에 추가된 진척률/ID.
// 담당자/종료일/공수는 선택 시에만 보이게.
export const WBS_GRID_COLUMNS_DEFAULT: WbsGridColumn[] = ["id", "start", "workDays", "progress"];
