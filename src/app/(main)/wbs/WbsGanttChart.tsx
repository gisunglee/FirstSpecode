"use client";

/**
 * WbsGanttChart — @svar-ui/react-gantt 래핑 (조회 전용)
 *
 * ssr:false 로만 로드됨(page.tsx 에서 next/dynamic) — GraphCanvas.tsx 와 동일한 이유로
 * DOM 기반 렌더링 라이브러리를 SSR 경계 밖으로 뺀다.
 *
 * 이 파일은 "렌더링"만 담당한다 — WbsTaskItem[] → ITask[] 변환은 wbsTasks.ts,
 * 확대/축소 단계 정의는 wbsZoom.ts 로 분리되어 있다(계속 기능이 늘어날 화면이라
 * 한 파일에 다 몰아넣지 않기 위함).
 *
 * 색상은 이 파일이 아니라 wbs-gantt-theme.css 에서 --wx-gantt-* CSS 변수를 sp- 토큰에
 * 매핑해서 재정의한다 — 라이브러리 기본 하드코딩 색상을 여기서 직접 건드리지 않는다.
 */

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Gantt, Willow, type ITask, type IColumnConfig } from "@svar-ui/react-gantt";
import "@svar-ui/react-core/style.css";
import "@svar-ui/react-gantt/style.css";
import "./wbs-gantt-theme.css";
import type { WbsTaskItem } from "@/app/api/projects/[id]/wbs/route";
import { buildChildTask, buildGroupedTasks, highlightWeekend, findScrollableEl, type BarField } from "./wbsTasks";
import { getWbsZoomLevel, type WbsZoomLevelKey } from "./wbsZoom";
import { WBS_GRID_COLUMNS, WBS_GRID_COLUMN_LABELS, type WbsGridColumn } from "./wbsFilterOptions";
import { WBS_STATUSES, WBS_STATUS_LABELS } from "@/lib/wbs/status";

// 라이브러리는 task.type을 이 목록(id)에 없으면 자동으로 "task"로 되돌린다(막대 클래스가
// wx-${m(o.type)} 형태로 만들어지는데, m()이 등록 안 된 id를 전부 "task"로 치환함 —
// @svar-ui/react-gantt/dist/index.cjs의 바 렌더러 내부 로직). "상태별 색상" 토글이 켜져도
// wbs-done/wbs-delayed 등 커스텀 type을 여기 등록해두지 않으면 색이 전부 기본값(파랑)으로
// 보이는 문제가 있었음 — 기본 3종(task/summary/milestone)에 WBS 상태 4종을 추가로 등록.
const WBS_TASK_TYPES: { id: string; label: string }[] = [
  { id: "task", label: "Task" },
  { id: "summary", label: "Summary task" },
  { id: "milestone", label: "Milestone" },
  ...WBS_STATUSES.map((id) => ({ id, label: WBS_STATUS_LABELS[id] })),
];

export type { BarField } from "./wbsTasks";

// 스크롤 제어 — 필터바(WbsFilterBar)의 버튼이 이 핸들을 통해 실제 DOM 스크롤을 조작한다.
// 실제 스크롤 요소는 이 컴포넌트 안에만 있어서(findScrollableEl), page.tsx 는 몰라도 됨.
export type WbsGanttHandle = {
  // multiplier — 기본 1(화면 폭의 50%). Ctrl+방향키처럼 "더 크게 이동" 요청 시 3 등으로 넘김.
  scrollBy:     (direction: 1 | -1, multiplier?: number) => void;
  scrollToEdge: (direction: 1 | -1) => void;
};

type Props = {
  items:       WbsTaskItem[];
  barFields:   Set<BarField>;
  statusColor: boolean;
  zoomLevel:   WbsZoomLevelKey;
  // 그룹으로 보기 — WbsTaskItem.groupPath[0](단위업무 탭=요구사항명, 화면 탭=단위업무명)
  // 기준으로 요약(summary) 부모 행을 만들어 그 아래 자식으로 묶는다. 페이지네이션은 지금
  // 페이지에 실려온 항목 수 기준 그대로라, 같은 그룹이 페이지 경계에서 나뉘면 그룹이 두
  // 페이지에 걸쳐 보일 수 있음(My Task의 "그룹 개수 기준 페이징"보다 단순한 버전 — 우선 이걸로 시작).
  grouped: boolean;
  // 좌측 그리드에 표시할 컬럼(작업명 제외 — 항상 고정). WbsSettingsPanel의 체크박스와 연결.
  gridColumns: Set<WbsGridColumn>;
  // 마운트 시 스크롤 제어 핸들을 한 번 올려보낸다 — WbsFilterBar의 좌우/끝 이동 버튼이
  // 이걸 통해 이 컴포넌트 내부의 실제 스크롤 DOM을 조작한다.
  onReady?: (handle: WbsGanttHandle) => void;
};

// "작업명" 클릭 시 상세 페이지로 이동 — href가 있는(=그룹 요약 행이 아닌 실제 항목) 경우만
// 링크로 렌더링. 그룹 요약 행은 실제 엔티티가 아니라 href가 없어 그냥 텍스트로 표시됨.
function TaskNameCell({ row }: { row: ITask }) {
  const href = row.href as string | undefined;
  if (!href) {
    return <div style={{ textAlign: "left" }}>{row.text}</div>;
  }
  return (
    <Link
      href={href}
      style={{ textAlign: "left", display: "block", color: "var(--color-text-link)", textDecoration: "none" }}
    >
      {row.text}
    </Link>
  );
}

// 진척률 컬럼 — task.progress(0~100 숫자)를 그대로 두면 "45"만 보여서 "45%"로 붙여줌
function ProgressCell({ row }: { row: ITask }) {
  return <div style={{ textAlign: "center" }}>{row.progress ?? 0}%</div>;
}

// 막대 위 라벨 — 라이브러리 기본은 이 자리에 task.text를 그대로 그리는데, 그러면 "막대 표시"
// 체크박스(진척률/시작/종료일)를 켰을 때 그리드 "작업명" 칸까지 같이 덧붙어 보이는 문제가
// 있었다(둘 다 같은 text 필드를 읽었으므로). wbsTasks.ts에서 text(그리드 전용, 이름만)와
// barText(막대 전용, 체크박스 반영)를 분리해뒀으니, 막대는 taskTemplate으로 barText만 그린다
// — 라이브러리 기본 렌더링(.wx-content에 text)을 대체하는 자리라 클래스명을 그대로 맞춘다.
function TaskBarContent({ data }: { data: ITask }) {
  return <div className="wx-content">{(data.barText as string | undefined) ?? data.text ?? ""}</div>;
}

// gridColumns 키 → 실제 task 필드 id(wbsTasks.ts에서 채워 넣은 값)
const GRID_COLUMN_FIELD: Record<WbsGridColumn, string> = {
  id:       "displayId",
  assignee: "assignee",
  start:    "startLabel",
  end:      "endLabel",
  workDays: "workDays",
  progress: "progress",
  effort:   "effort",
};

// 컬럼별 실제 내용 폭에 맞춘 고정 너비 — 전부 90px 하나로 뒀더니 "기간"/"진척률"처럼
// 짧은 숫자만 들어가는 컬럼도 이름 컬럼 폭만큼 넓어 낭비였다는 피드백 반영.
// 시작일/종료일(YYYY-MM-DD 10자)만 넉넉히 두고, 나머지는 헤더 라벨 + 내용 기준으로 줄임.
// "진척률"/"진척"처럼 헤더 글자수가 폭을 결정하는 컬럼은 아래 GRID_COLUMN_HEADER_LABEL로
// 라벨 자체를 줄여야 이 폭보다 더 좁힐 수 있다(한글 2자가 이 그리드에서 한 줄로 안 꺾이는
// 사실상의 최소폭이 56px — "기간"은 이미 2자라 더 줄일 여지가 없음).
const GRID_COLUMN_WIDTH: Record<WbsGridColumn, number> = {
  id:       80,
  assignee: 72,
  start:    78,
  end:      78,
  workDays: 56,
  progress: 56,
  effort:   56,
};

// 설정 패널 체크박스는 WBS_GRID_COLUMN_LABELS(전체 라벨)를 그대로 쓰지만, 그리드 헤더는
// 공간이 좁아 "진척률"(3자)만 "진척"(2자)으로 축약 — 폭을 64px에서 56px까지 더 줄일 수 있다.
const GRID_COLUMN_HEADER_LABEL: Partial<Record<WbsGridColumn, string>> = {
  progress: "진척",
};

// 라이브러리의 좌측 그리드 전체 기본 폭은 440px 고정(@svar-ui/gantt-store 기본값) — 나머지
// 고정폭 컬럼(GRID_COLUMN_WIDTH)들을 뺀 나머지를 "작업명"이 flexgrow로 다 가져가는 구조라,
// 기본 노출 컬럼(id+start+workDays+progress=270px) 기준 "작업명"은 약 170px밖에 안 남았다 —
// 좁아서 이름이 자주 잘린다는 피드백으로 기본 폭 자체를 30% 늘림(170 → 약 220px).
// width를 명시해도 flexgrow는 그대로 둬서, 그리드 폭이 이 값보다 넉넉하면 여전히 남는 공간을
// 더 가져간다(기존 동작 유지 + 최소 보장 폭만 키움).
const TASK_NAME_COLUMN_WIDTH = 220;

// 좌측 그리드 컬럼 — "작업명"은 항목 식별/이동 수단이라 항상 고정, 나머지는 gridColumns
// 선택에 따라 동적으로 붙인다. "시작일"도 라이브러리 기본 포맷이 년월일 순서가 아니라서
// startLabel(wbsTasks.ts 에서 직접 만든 YYYY-MM-DD 문자열)로 대체했었던 것과 같은 이유로,
// 여기 추가되는 컬럼들도 전부 task의 커스텀 필드를 그대로 보여준다(컬럼 id를 그 필드명과
// 맞추면 라이브러리가 알아서 렌더링해준다는 점을 그대로 활용). add-task 컬럼은 조회
// 전용 화면이라 애초에 없음.
function buildColumns(gridColumns: Set<WbsGridColumn>): IColumnConfig[] {
  const columns: IColumnConfig[] = [
    { id: "text", header: "작업명", width: TASK_NAME_COLUMN_WIDTH, flexgrow: 3, cell: TaskNameCell },
  ];
  for (const key of WBS_GRID_COLUMNS) {
    if (!gridColumns.has(key)) continue;
    columns.push({
      id:     GRID_COLUMN_FIELD[key],
      header: GRID_COLUMN_HEADER_LABEL[key] ?? WBS_GRID_COLUMN_LABELS[key],
      align:  "center",
      width:  GRID_COLUMN_WIDTH[key],
      ...(key === "progress" ? { cell: ProgressCell } : {}),
    });
  }
  return columns;
}

export default function WbsGanttChart({ items, barFields, statusColor, zoomLevel, grouped, gridColumns, onReady }: Props) {
  const tasks: ITask[] = grouped
    ? buildGroupedTasks(items, barFields, statusColor)
    : items.map((item) => buildChildTask(item, barFields, statusColor, undefined));

  const columns = buildColumns(gridColumns);
  // 라이브러리의 좌측 그리드 전체 폭은 기본 440px 고정이라, 켜진 컬럼 수에 따라 "작업명"
  // 몫이 들쭉날쭉했다(컬럼을 많이 켤수록 작업명이 440에서 밀려 좁아짐). 컬럼 폭 합으로
  // 직접 계산해서 넘겨주면 TASK_NAME_COLUMN_WIDTH가 항상 최소 보장된다.
  const gridWidth = columns.reduce((sum, c) => sum + (c.width ?? 0), 0);
  const zoom = getWbsZoomLevel(zoomLevel);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 마운트 시 1회만 핸들 전달 — wrapRef 는 리렌더와 무관하게 같은 DOM 노드를 계속 가리킨다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    onReady?.({
      // 화면 폭의 절반씩(× multiplier) 좌/우로 이동 — 넓은 기간을 스크롤 없이 훑어보기 어렵다는 피드백
      scrollBy(direction, multiplier = 1) {
        const root = wrapRef.current;
        if (!root) return;
        const el = findScrollableEl(root);
        if (!el) return;
        el.scrollBy({ left: direction * el.clientWidth * 0.5 * multiplier, behavior: "smooth" });
      },
      // 맨 처음/맨 끝으로 한 번에 이동
      scrollToEdge(direction) {
        const root = wrapRef.current;
        if (!root) return;
        const el = findScrollableEl(root);
        if (!el) return;
        el.scrollTo({ left: direction === 1 ? el.scrollWidth : 0, behavior: "smooth" });
      },
    });
  }, []);

  return (
    <div className="sp-wbs-gantt" ref={wrapRef}>
      <Willow>
        <Gantt
          tasks={tasks}
          columns={columns}
          gridWidth={gridWidth}
          taskTypes={WBS_TASK_TYPES}
          taskTemplate={TaskBarContent}
          cellWidth={zoom.cellWidth}
          scales={zoom.scales}
          highlightTime={highlightWeekend}
          readonly
        />
      </Willow>
    </div>
  );
}
