"use client";

/**
 * WbsSettingsPanel — 자주 안 쓰는 조회 옵션을 모아둔 햄버거 드롭다운
 *
 * WbsFilterBar에서 분리한 이유: 상시 노출 컨트롤(탭/담당자/보기/줌/페이지네이션/스크롤)과
 * "가끔 쓰는" 옵션(상태/기간 필터, 막대 표시, 상태별 색상)을 한 파일에 계속 늘려가면
 * WbsFilterBar가 끝없이 커진다. 새 조회 옵션이 생기면 이 파일에만 추가하면 됨.
 * (담당자 필터는 자주 쓰는 조건이라 여기가 아니라 WbsFilterBar 상시 노출 영역에 있음.)
 */

import { useEffect, useRef, useState } from "react";
import type { BarField } from "./WbsGanttChart";
import {
  WBS_PERIOD_PRESETS, type WbsPeriodPreset,
  WBS_GRID_COLUMNS, WBS_GRID_COLUMN_LABELS, type WbsGridColumn,
} from "./wbsFilterOptions";
import { WBS_STATUSES, WBS_STATUS_LABELS, type WbsStatus } from "@/lib/wbs/status";

const PERIOD_LABELS: Record<WbsPeriodPreset, string> = {
  ALL:        "전체 기간",
  THIS_WEEK:  "이번 주 시작",
  THIS_MONTH: "이번 달 시작",
};

const STATUS_FILTER_OPTIONS = ["ALL", ...WBS_STATUSES] as const;
type WbsStatusFilter = (typeof STATUS_FILTER_OPTIONS)[number];
const STATUS_FILTER_LABELS: Record<WbsStatusFilter, string> = { ALL: "전체 상태", ...WBS_STATUS_LABELS };

const BAR_FIELD_OPTIONS: { key: BarField; label: string }[] = [
  { key: "name",     label: "작업명" },
  { key: "progress", label: "진척률" },
  { key: "start",    label: "시작" },
  { key: "end",      label: "종료일" },
];

// "상태별 색상" 미니 미리보기 — wbs-gantt-theme.css의 .wbs-done/.wbs-in-progress/
// .wbs-not-started/.wbs-delayed 규칙과 정확히 같은 토큰을 씀(색이 실제와 다르면 의미 없음).
const STATUS_COLOR_PREVIEW: { label: string; color: string; desc: string }[] = [
  { label: "완료",   color: "var(--color-success)",       desc: "진척률 100%" },
  { label: "진행중", color: "var(--color-info)",          desc: "진척률 1~99% · 마감 전" },
  { label: "미시작", color: "var(--color-text-tertiary)", desc: "진척률 0% · 마감 전" },
  { label: "지연",   color: "var(--color-error)",         desc: "마감(종료일) 지남 · 미완료" },
];

type Props = {
  statusFilter: WbsStatus | "ALL";
  onStatusFilterChange: (status: WbsStatus | "ALL") => void;

  periodFilter: WbsPeriodPreset;
  onPeriodFilterChange: (preset: WbsPeriodPreset) => void;

  barFields: Set<BarField>;
  onToggleBarField: (field: BarField) => void;

  // 좌측 그리드 표시 컬럼 — 담당자/시작일/종료일/기간/진척률/공수 중 선택.
  gridColumns: Set<WbsGridColumn>;
  onToggleGridColumn: (column: WbsGridColumn) => void;

  // 진척률 선 색상 — 꺼짐(기본): 단일 색. 켜짐: 완료/진행중/미시작/지연 4색 구분.
  statusColor: boolean;
  onStatusColorChange: (value: boolean) => void;
};

export default function WbsSettingsPanel({
  statusFilter, onStatusFilterChange,
  periodFilter, onPeriodFilterChange,
  barFields, onToggleBarField,
  gridColumns, onToggleGridColumn,
  statusColor, onStatusColorChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [showStatusColorHelp, setShowStatusColorHelp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 바깥 클릭하면 닫기
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="담당자·필터·표시 항목 설정"
        style={settingsBtnStyle}
      >
        ☰
      </button>
      {open && (
        <div
          style={{
            position: "absolute", top: "100%", right: 0, marginTop: 6, zIndex: 20,
            width: 260, padding: 14,
            background: "var(--color-bg-card)", border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)", boxShadow: "0 4px 16px rgba(0,0,0,0.16)",
            display: "flex", flexDirection: "column", gap: 12,
          }}
        >
          <div>
            <div style={labelStyle}>상태</div>
            <select
              value={statusFilter}
              onChange={(e) => onStatusFilterChange(e.target.value as WbsStatus | "ALL")}
              className="sp-input"
              style={selectStyle}
            >
              {STATUS_FILTER_OPTIONS.map((s) => (
                <option key={s} value={s}>{STATUS_FILTER_LABELS[s]}</option>
              ))}
            </select>
          </div>

          <div>
            <div style={labelStyle}>기간</div>
            <select
              value={periodFilter}
              onChange={(e) => onPeriodFilterChange(e.target.value as WbsPeriodPreset)}
              className="sp-input"
              style={selectStyle}
            >
              {WBS_PERIOD_PRESETS.map((p) => (
                <option key={p} value={p}>{PERIOD_LABELS[p]}</option>
              ))}
            </select>
          </div>

          <div>
            <div style={labelStyle}>그리드 컬럼</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {WBS_GRID_COLUMNS.map((key) => (
                <label key={key} className="sp-checkbox-wrap">
                  <input
                    className="sp-checkbox"
                    type="checkbox"
                    checked={gridColumns.has(key)}
                    onChange={() => onToggleGridColumn(key)}
                  />
                  <span style={{ fontSize: "var(--text-base)" }}>{WBS_GRID_COLUMN_LABELS[key]}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div style={labelStyle}>막대 표시</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {BAR_FIELD_OPTIONS.map((opt) => (
                <label key={opt.key} className="sp-checkbox-wrap">
                  <input
                    className="sp-checkbox"
                    type="checkbox"
                    checked={barFields.has(opt.key)}
                    onChange={() => onToggleBarField(opt.key)}
                  />
                  <span style={{ fontSize: "var(--text-base)" }}>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <label className="sp-checkbox-wrap">
                <input
                  className="sp-checkbox"
                  type="checkbox"
                  checked={statusColor}
                  onChange={(e) => onStatusColorChange(e.target.checked)}
                />
                <span style={{ fontSize: "var(--text-base)" }}>상태별 색상</span>
              </label>
              <button
                type="button"
                onClick={() => setShowStatusColorHelp((v) => !v)}
                aria-expanded={showStatusColorHelp}
                title="설명 보기"
                style={helpBtnStyle}
              >
                ?
              </button>
            </div>

            {showStatusColorHelp && (
              <div
                style={{
                  marginTop: 8, padding: 10,
                  background: "var(--color-bg-elevated)", border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-sm)",
                  display: "flex", flexDirection: "column", gap: 8,
                }}
              >
                <div style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
                  진척률 선(막대 하단 얇은 줄) 색을 항목 상태에 따라 다르게 표시합니다.
                  꺼져 있으면 상태와 무관하게 항상 같은 색 하나만 씁니다.
                </div>
                {/* 미니 미리보기 — 실제 회색 트랙 + 얇은 선 구조를 그대로 축소해서 보여줌 */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {STATUS_COLOR_PREVIEW.map((s) => (
                    <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div
                        aria-hidden
                        style={{
                          position: "relative", width: 64, height: 14, flexShrink: 0,
                          background: "var(--color-border-strong)", borderRadius: "var(--radius-sm)",
                        }}
                      >
                        <div
                          style={{
                            position: "absolute", left: 0, bottom: 2, height: 3, width: "65%",
                            borderRadius: "var(--radius-full)", background: s.color,
                          }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: "var(--text-base)", color: "var(--color-text-primary)", fontWeight: 600 }}>
                          {s.label}
                        </div>
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                          {s.desc}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: "var(--text-base)", color: "var(--color-text-tertiary)", marginBottom: 4,
};

const selectStyle: React.CSSProperties = {
  padding: "2px 6px", fontSize: "var(--text-base)", height: 26, width: "100%",
};

const helpBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)", fontSize: 11, fontWeight: 700,
  cursor: "help", lineHeight: 1, padding: 0,
};

const settingsBtnStyle: React.CSSProperties = {
  width: 28, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
  padding: 0, fontSize: 13, lineHeight: 1, fontWeight: 400,
  border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
  background: "var(--color-bg-card)", color: "var(--color-text-secondary)",
  cursor: "pointer",
};
