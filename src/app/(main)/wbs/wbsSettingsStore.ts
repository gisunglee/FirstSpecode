/**
 * wbsSettingsStore — WBS 일정 페이지의 "표시 설정" 영속화 (Zustand + localStorage)
 *
 * 왜 별도 스토어인가: appStore(전역)에 계속 필드를 늘리면 이 페이지 하나만 쓰는 설정이
 * 전역 상태를 오염시킨다. WBS 페이지 전용 관심사라 별도 파일로 분리 — 나중에 설정 항목이
 * 늘어나도 이 파일 안에서만 커진다.
 *
 * 무엇을 영속화하는가: 설정(☰) 드롭다운 안의 항목(상태/기간 필터, 그리드 컬럼, 막대 표시,
 * 상태별 색상) + 상시 노출 표시 옵션(보기/줌/페이지당). "매번 다시 켜야 해서 힘들다"는
 * 피드백 대상이 이 항목들이라 전부 포함.
 *
 * 무엇을 영속화하지 않는가: entity(탭)·assigneeId(담당자)·page(현재 페이지) — 이건
 * "표시 설정"이 아니라 탐색 중인 대상/위치라, 저장해두면 오히려 "왜 데이터가 안 보이지"
 * (담당자 필터가 걸린 채 남아있는 등) 같은 혼란을 만들 수 있어 매번 기본값(전체)으로 시작한다.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BarField } from "./WbsGanttChart";
import type { WbsViewMode, WbsPeriodPreset, PageSize } from "./WbsFilterBar";
import { WBS_GRID_COLUMNS_DEFAULT, type WbsGridColumn } from "./wbsFilterOptions";
import { WBS_ZOOM_DEFAULT, type WbsZoomLevelKey } from "./wbsZoom";
import type { WbsStatus } from "@/lib/wbs/status";
import type { ProgressKind } from "@/types/pm";

// Set은 JSON 직렬화가 안 되므로(persist 미들웨어 기본 storage가 JSON.stringify 사용)
// 저장 형태는 배열로 두고, 컴포넌트에 넘길 때만 Set으로 변환한다(page.tsx에서 useMemo).
type WbsSettingsState = {
  view: WbsViewMode;
  // 설계/구현 — 단위업무·화면·기능 진척률·기간을 기능(function)의 design_rt/impl_rt 중
  // 무엇으로 롤업할지. 기본 IMPL(구현) — 기존 기능탭·PM 히트맵 기본값과 동일.
  phase: ProgressKind;
  zoomLevel: WbsZoomLevelKey;
  barFields: BarField[];
  gridColumns: WbsGridColumn[];
  statusColor: boolean;
  statusFilter: WbsStatus | "ALL";
  periodFilter: WbsPeriodPreset;
  pageSize: PageSize;
};

type WbsSettingsActions = {
  setView: (view: WbsViewMode) => void;
  setPhase: (phase: ProgressKind) => void;
  setZoomLevel: (level: WbsZoomLevelKey) => void;
  toggleBarField: (field: BarField) => void;
  toggleGridColumn: (column: WbsGridColumn) => void;
  setStatusColor: (value: boolean) => void;
  setStatusFilter: (status: WbsStatus | "ALL") => void;
  setPeriodFilter: (preset: WbsPeriodPreset) => void;
  setPageSize: (pageSize: PageSize) => void;
};

export const useWbsSettingsStore = create<WbsSettingsState & WbsSettingsActions>()(
  persist(
    (set) => ({
      view: "flat",
      phase: "IMPL",
      zoomLevel: WBS_ZOOM_DEFAULT,
      barFields: ["name"],
      gridColumns: [...WBS_GRID_COLUMNS_DEFAULT],
      statusColor: false,
      statusFilter: "ALL",
      periodFilter: "ALL",
      pageSize: 20,

      setView: (view) => set({ view }),
      setPhase: (phase) => set({ phase }),
      setZoomLevel: (zoomLevel) => set({ zoomLevel }),

      toggleBarField: (field) =>
        set((s) => ({
          barFields: s.barFields.includes(field)
            ? s.barFields.filter((f) => f !== field)
            : [...s.barFields, field],
        })),

      toggleGridColumn: (column) =>
        set((s) => ({
          gridColumns: s.gridColumns.includes(column)
            ? s.gridColumns.filter((c) => c !== column)
            : [...s.gridColumns, column],
        })),

      setStatusColor: (statusColor) => set({ statusColor }),
      setStatusFilter: (statusFilter) => set({ statusFilter }),
      setPeriodFilter: (periodFilter) => set({ periodFilter }),
      setPageSize: (pageSize) => set({ pageSize }),
    }),
    { name: "specode-wbs-settings" }
  )
);
