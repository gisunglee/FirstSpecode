"use client";

/**
 * ViewToggle — 관리뷰 / 개발자뷰 토글 (segment tabs)
 *
 * 역할:
 *   - 두 뷰 사이를 전환하는 segment 토글
 *   - sp-tab-seg 컴포넌트 토큰을 그대로 사용 (3테마 자동 대응)
 */

import type { DashboardView } from "./useDashboardView";

type Props = {
  view:    DashboardView;
  onChange: (next: DashboardView) => void;
};

export default function ViewToggle({ view, onChange }: Props) {
  return (
    <div
      className="sp-tab-seg"
      role="tablist"
      aria-label="대시보드 뷰 전환"
    >
      <div
        role="tab"
        aria-selected={view === "manage"}
        className={`sp-tab-seg-item ${view === "manage" ? "is-active" : ""}`}
        onClick={() => onChange("manage")}
        // 키보드 접근성 — Enter/Space 도 토글로 동작
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onChange("manage"); }
        }}
      >
        관리
      </div>
      <div
        role="tab"
        aria-selected={view === "me"}
        className={`sp-tab-seg-item ${view === "me" ? "is-active" : ""}`}
        onClick={() => onChange("me")}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onChange("me"); }
        }}
      >
        내 작업
      </div>
    </div>
  );
}
