"use client";

/**
 * WeeklyReportsPage — 주간보고 (URL: /weekly-reports)
 *
 * 역할:
 *   - PM 전용 화면 — 팀원 업무일지(/work-logs)를 모아 AI가 금주실적/차주계획 초안을 생성
 *   - 탭: "초안 생성"(주 선택 + AI 요청 + 편집·저장) / "이력"(과거 생성분 조회)
 *
 * 권한:
 *   - weeklyReport.manage (OWNER/ADMIN 역할 또는 PM/PL 직무). LNB 에서도 이 권한 없으면
 *     메뉴 자체가 안 보이지만, 직접 URL 접근은 여기서 별도로 막는다.
 */

import { useState } from "react";
import { useAppStore } from "@/store/appStore";
import { useMyRole } from "@/hooks/useMyRole";
import { getWeekMondayStr } from "@/lib/weekUtil";
import DraftTab from "./_components/DraftTab";
import HistoryTab from "./_components/HistoryTab";

type Tab = "draft" | "history";

export default function WeeklyReportsPage() {
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const { canManageWeeklyReport, isLoading: isRoleLoading } = useMyRole(currentProjectId);
  const [tab, setTab] = useState<Tab>("draft");
  const [weekMonday, setWeekMonday] = useState(getWeekMondayStr());

  return (
    <div style={{ padding: 0 }}>
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 24px", position: "sticky", top: 0, zIndex: 10,
          background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)",
          marginBottom: 16, gap: 12, flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 19, fontWeight: 700, color: "var(--color-text-primary)" }}>
          🧾 주간보고
        </div>
        {currentProjectId && canManageWeeklyReport && (
          <div className="sp-tab-seg">
            <div className={`sp-tab-seg-item${tab === "draft" ? " is-active" : ""}`} onClick={() => setTab("draft")}>
              초안 생성
            </div>
            <div className={`sp-tab-seg-item${tab === "history" ? " is-active" : ""}`} onClick={() => setTab("history")}>
              이력
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: "0 24px 24px" }}>
        {!currentProjectId ? (
          <NoProjectSelected />
        ) : isRoleLoading ? null : !canManageWeeklyReport ? (
          <NoPermission />
        ) : tab === "draft" ? (
          <DraftTab projectId={currentProjectId} weekMonday={weekMonday} onWeekChange={setWeekMonday} />
        ) : (
          <HistoryTab
            projectId={currentProjectId}
            onSelectWeek={(w) => {
              setWeekMonday(w);
              setTab("draft");
            }}
          />
        )}
      </div>
    </div>
  );
}

function NoProjectSelected() {
  return (
    <div className="sp-empty" style={{ padding: "48px 24px", textAlign: "center", background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)" }}>
      <div className="sp-empty-icon">📁</div>
      <div className="sp-empty-title">프로젝트를 선택해 주세요</div>
      <div className="sp-empty-desc">상단 프로젝트 선택기에서 프로젝트를 고르면 주간보고가 표시됩니다.</div>
    </div>
  );
}

function NoPermission() {
  return (
    <div className="sp-empty" style={{ padding: "48px 24px", textAlign: "center", background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)" }}>
      <div className="sp-empty-icon">🔒</div>
      <div className="sp-empty-title">PM 전용 화면입니다</div>
      <div className="sp-empty-desc">주간보고는 프로젝트 관리자(OWNER/ADMIN) 또는 PM/PL 만 볼 수 있습니다.</div>
    </div>
  );
}
