"use client";

/**
 * WbsFilterBar — WBS 일정 페이지의 "무엇을 보여줄지" 담당 (조회 조건 전용)
 *
 * page.tsx(데이터 오케스트레이션) / WbsGanttChart.tsx(순수 렌더링) 와 역할을 분리 —
 * 이 컴포넌트는 필터·표시옵션·페이지네이션 상태를 화면에 그리고 변경 이벤트만 올려보낼 뿐,
 * 데이터 조회나 간트 렌더링 로직을 전혀 알지 못한다.
 *
 * 레이아웃 — 한 줄에 항상 보이는 것과 "설정" 드롭다운 뒤로 숨는 것을 분리(공간 낭비 피드백 반영):
 *   상시 노출: 탭(단위업무/화면/기능) · 담당자 · 보기(목록/그룹) · 확대/축소(일/주/월) ·
 *              페이지당 · 페이지네이션+좌우/끝 스크롤(한 묶음)
 *   설정(햄버거) 안: 상태 필터 · 기간 필터 · 막대 표시 항목 · 상태별 색상
 *
 * 페이지네이션(이전/다음)과 간트 좌우 스크롤을 같은 테두리 안에 붙여서 하나의 "이동" 묶음으로
 * 보이게 함 — 담당자 필터는 자주 쓰는 조건이라 설정 드롭다운 밖으로 뺌.
 */

import { DEADLINE_ENTITY_LABELS } from "@/types/pm";
import type { DeadlineEntityKind } from "@/types/pm";
import type { BarField } from "./WbsGanttChart";
import { WBS_ZOOM_LEVELS, type WbsZoomLevelKey } from "./wbsZoom";
import type { WbsStatus } from "@/lib/wbs/status";
import WbsSettingsPanel from "./WbsSettingsPanel";
import type { WbsMemberOption, WbsPeriodPreset, WbsGridColumn } from "./wbsFilterOptions";
import { ChevronLeftIcon, ChevronRightIcon, ChevronsLeftIcon, ChevronsRightIcon } from "./wbsIcons";

export type { WbsMemberOption, WbsPeriodPreset } from "./wbsFilterOptions";

export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export type WbsViewMode = "flat" | "group";
const VIEW_LABELS: Record<WbsViewMode, string> = { flat: "목록", group: "그룹" };

// page.tsx의 키보드 단축키(1/2/3)가 이 순서와 항상 같은 걸 가리키도록 export.
export const ENTITY_ORDER: DeadlineEntityKind[] = ["UNIT_WORK", "SCREEN", "FUNCTION"];

type Props = {
  entity: DeadlineEntityKind;
  onEntityChange: (entity: DeadlineEntityKind) => void;

  // 목록(현재 평면 리스트) / 그룹(탭별 상위 관계로 묶어 요약 행 아래 자식으로 표시)
  view: WbsViewMode;
  onViewChange: (view: WbsViewMode) => void;

  zoomLevel: WbsZoomLevelKey;
  onZoomLevelChange: (level: WbsZoomLevelKey) => void;

  members: WbsMemberOption[];
  assigneeId: string; // "" = 전체
  onAssigneeChange: (memberId: string) => void;

  statusFilter: WbsStatus | "ALL";
  onStatusFilterChange: (status: WbsStatus | "ALL") => void;

  periodFilter: WbsPeriodPreset;
  onPeriodFilterChange: (preset: WbsPeriodPreset) => void;

  barFields: Set<BarField>;
  onToggleBarField: (field: BarField) => void;

  gridColumns: Set<WbsGridColumn>;
  onToggleGridColumn: (column: WbsGridColumn) => void;

  // 진척률 선 색상 — 꺼짐(기본): 단일 색. 켜짐: 완료/진행중/미시작/지연 4색 구분.
  statusColor: boolean;
  onStatusColorChange: (value: boolean) => void;

  page: number;
  pageSize: PageSize;
  totalCount: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: PageSize) => void;

  // 간트 좌우/끝 스크롤 — 실제 DOM 조작은 WbsGanttChart 안에서 일어나고, 여기선 트리거만.
  onScroll: (direction: 1 | -1) => void;
  onScrollToEdge: (direction: 1 | -1) => void;
};

export default function WbsFilterBar({
  entity, onEntityChange,
  view, onViewChange,
  zoomLevel, onZoomLevelChange,
  members, assigneeId, onAssigneeChange,
  statusFilter, onStatusFilterChange,
  periodFilter, onPeriodFilterChange,
  barFields, onToggleBarField,
  gridColumns, onToggleGridColumn,
  statusColor, onStatusColorChange,
  page, pageSize, totalCount, totalPages, onPageChange, onPageSizeChange,
  onScroll, onScrollToEdge,
}: Props) {
  return (
    <div
      className="sp-group-header"
      style={{ flexWrap: "wrap", rowGap: 8, columnGap: 14 }}
    >
      <div className="sp-tab-seg">
        {ENTITY_ORDER.map((k, i) => (
          <div
            key={k}
            role="tab"
            aria-selected={entity === k}
            className={`sp-tab-seg-item${entity === k ? " is-active" : ""}`}
            onClick={() => onEntityChange(k)}
            title={`단축키: 숫자 ${i + 1}`}
          >
            <span style={{ fontSize: "var(--text-xs)", opacity: 0.6, marginRight: 4 }}>{i + 1}</span>
            {DEADLINE_ENTITY_LABELS[k]}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginLeft: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>
            담당자
          </span>
          <select
            value={assigneeId}
            onChange={(e) => onAssigneeChange(e.target.value)}
            className="sp-input"
            style={{ padding: "2px 6px", fontSize: "var(--text-base)", height: 26 }}
          >
            <option value="">전체</option>
            {members.map((m) => (
              <option key={m.memberId} value={m.memberId}>{m.name}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
          {(["flat", "group"] as WbsViewMode[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onViewChange(v)}
              style={{
                padding: "4px 10px", fontSize: "var(--text-base)", fontWeight: 600,
                border: "none", cursor: "pointer",
                background: view === v ? "var(--color-brand)" : "var(--color-bg-card)",
                color: view === v ? "var(--color-text-inverse)" : "var(--color-text-secondary)",
              }}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }} title="확대/축소">
          {WBS_ZOOM_LEVELS.map((z) => (
            <button
              key={z.key}
              type="button"
              onClick={() => onZoomLevelChange(z.key)}
              style={{
                padding: "4px 10px", fontSize: "var(--text-base)", fontWeight: 600,
                border: "none", cursor: "pointer",
                background: zoomLevel === z.key ? "var(--color-brand)" : "var(--color-bg-card)",
                color: zoomLevel === z.key ? "var(--color-text-inverse)" : "var(--color-text-secondary)",
              }}
            >
              {z.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>
            페이지당
          </span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value) as PageSize)}
            className="sp-input"
            style={{ padding: "2px 6px", fontSize: "var(--text-base)", height: 26 }}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}개</option>
            ))}
          </select>
        </div>

        {/* 페이지네이션 + 간트 좌우/끝 스크롤 — 같은 테두리 안에 묶어 하나의 "이동" 그룹으로 보이게 함 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", padding: "2px 8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }} title="페이지 이동">
            <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1} style={{ ...navBtnStyle, opacity: page <= 1 ? 0.5 : 1 }}>
              <ChevronLeftIcon />
            </button>
            <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
              {page} / {totalPages} · {totalCount}건
            </span>
            <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} style={{ ...navBtnStyle, opacity: page >= totalPages ? 0.5 : 1 }}>
              <ChevronRightIcon />
            </button>
          </div>

          <div style={{ width: 1, alignSelf: "stretch", background: "var(--color-border)" }} />

          <div style={{ display: "flex", alignItems: "center", gap: 2 }} title="간트 좌우 스크롤 (키보드 ← → 도 가능)">
            <button type="button" onClick={() => onScrollToEdge(-1)} style={navBtnStyle} title="맨 앞으로"><ChevronsLeftIcon /></button>
            <button type="button" onClick={() => onScroll(-1)}       style={navBtnStyle} title="이전 구간"><ChevronLeftIcon /></button>
            <button type="button" onClick={() => onScroll(1)}        style={navBtnStyle} title="다음 구간"><ChevronRightIcon /></button>
            <button type="button" onClick={() => onScrollToEdge(1)}  style={navBtnStyle} title="맨 끝으로"><ChevronsRightIcon /></button>
          </div>
        </div>

        <WbsSettingsPanel
          statusFilter={statusFilter}
          onStatusFilterChange={onStatusFilterChange}
          periodFilter={periodFilter}
          onPeriodFilterChange={onPeriodFilterChange}
          barFields={barFields}
          onToggleBarField={onToggleBarField}
          gridColumns={gridColumns}
          onToggleGridColumn={onToggleGridColumn}
          statusColor={statusColor}
          onStatusColorChange={onStatusColorChange}
        />
      </div>
    </div>
  );
}

// 페이지/스크롤 이동 버튼 — 예전엔 텍스트("이전"/"다음")나 유니코드 글자(«‹›»)였는데
// 작고 허접해 보인다는 피드백 반영, 아이콘(wbsIcons.tsx) 하나만 담는 정사각 버튼으로 통일.
const navBtnStyle: React.CSSProperties = {
  width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
  padding: 0, border: "none", borderRadius: "var(--radius-sm)",
  background: "transparent", color: "var(--color-text-secondary)",
  cursor: "pointer",
};
