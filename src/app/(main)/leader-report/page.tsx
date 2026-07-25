"use client";

/**
 * LeaderReportPage — 리더 리포트 (URL: /leader-report)
 *
 * 역할:
 *   - PM 전용. 팀원 전체 업무일지를 모은 AI 초안이 참고 콘텐츠, 금주 실적/차주 계획/금주
 *     코멘트/특이사항을 PM이 직접 쓰는 게 메인이다. 그 아래 참여 현황(그 주 일별 기록을 남긴
 *     팀원 수)과 팀원별 원본을 참고용으로 둔다.
 *   - "업무 리포트"(/work-report, 개인 문서)와 헷갈리지 않도록 완전히 분리된 화면 —
 *     업무 리포트에 있던 AI 관련 기능을 전부 여기로 옮겨왔다(2026-07-21).
 *   - 주차 목록은 상단에 월 네비게이션 + 가로 카드 줄로 둔다(2026-07-23) — 원래 좌측 컬럼이었는데,
 *     주차 카드 하나가 보여주는 정보("N주 날짜범위" + "N/M 작성" + AI 상태 점)가 세로 한 칸을
 *     통째로 쓸 만큼 많지 않아 옆 여백만 차지했다. 카드 자체(LeaderWeekListItem)는 그대로 재사용.
 *
 * 권한:
 *   - weeklyReport.manage (OWNER/ADMIN 역할 또는 PM/PL 직무). 백엔드 API 게이트는 그대로.
 */

import { useState } from "react";
import { useAppStore } from "@/store/appStore";
import { useMyRole } from "@/hooks/useMyRole";
import { getMonthStart, getMonthLabel, addMonths, getMonthDays, getWeekMondayStr, addDaysStr } from "@/lib/weekUtil";
import LeaderWeekListItem from "./_components/LeaderWeekListItem";
import LeaderReportDetail from "./_components/LeaderReportDetail";
import IssueList from "./_components/IssueList";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function getWeeksOverlappingMonth(monthStart: string): string[] {
  const monthEnd = getMonthDays(monthStart).at(-1)!;
  const weeks: string[] = [];
  let cursor = getWeekMondayStr(monthStart);
  while (cursor <= monthEnd) {
    weeks.push(cursor);
    cursor = addDaysStr(cursor, 7);
  }
  return weeks;
}

export default function LeaderReportPage() {
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const { canManageWeeklyReport, isLoading: isRoleLoading } = useMyRole(currentProjectId);
  const [monthStart, setMonthStart] = useState(getMonthStart(todayStr()));
  const [selectedWeek, setSelectedWeek] = useState(getWeekMondayStr());
  // "주간보고"(주 단위 AI 콘텐츠) / "협조·이슈"(주 선택과 무관한 상시 목록) — 협조 및
  // 이슈사항 현황이 자체 CRUD·정렬·인쇄·엑셀까지 갖추며 사실상 독립 기능이 됐는데, 주 단위
  // 콘텐츠 맨 아래 있어 매번 스크롤해야 닿던 문제를 탭 분리로 해결(2026-07-22).
  const [activeTab, setActiveTab] = useState<"ai" | "issues">("ai");
  // "최근 주간 활동 MD"/"인쇄 미리보기" 열림 상태 — 트리거 버튼을 페이지 우상단에 두기 위해
  // LeaderReportDetail이 아니라 여기서 갖고 있다(2026-07-24, 버튼 위치 피드백으로 이동).
  const [mdModalOpen, setMdModalOpen]       = useState(false);
  const [printModalOpen, setPrintModalOpen] = useState(false);

  const weeksInMonth   = getWeeksOverlappingMonth(monthStart);
  const isCurrentMonth = monthStart === getMonthStart(todayStr());
  const showContent    = currentProjectId && !isRoleLoading && canManageWeeklyReport;

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
          🧭 리더 리포트
        </div>
        {showContent && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {/* 주간보고 탭에서만 의미 있는 액션이라 그 탭일 때만 노출 */}
            {activeTab === "ai" && (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="sp-btn sp-btn-secondary sp-btn-sm" onClick={() => setMdModalOpen(true)}>
                  최근 주간 활동 MD
                </button>
                <button type="button" className="sp-btn sp-btn-secondary sp-btn-sm" onClick={() => setPrintModalOpen(true)}>
                  인쇄 미리보기
                </button>
              </div>
            )}
            <div className="sp-tab-seg">
              <div className={`sp-tab-seg-item${activeTab === "ai" ? " is-active" : ""}`} onClick={() => setActiveTab("ai")}>
                주간보고
              </div>
              <div className={`sp-tab-seg-item${activeTab === "issues" ? " is-active" : ""}`} onClick={() => setActiveTab("issues")}>
                협조·이슈
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: "0 24px 24px" }}>
        {!currentProjectId ? (
          <NoProjectSelected />
        ) : isRoleLoading ? null : !canManageWeeklyReport ? (
          <NoPermission />
        ) : activeTab === "issues" ? (
          // 협조·이슈 탭 — 주 선택과 무관한 상시 목록이라 좌측 주 목록·주 네비게이션 없이 전체 폭
          <IssueList projectId={currentProjectId} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* 월 네비게이션 */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
              <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => setMonthStart(addMonths(monthStart, -1))}>
                ←
              </button>
              <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--color-text-primary)" }}>
                {getMonthLabel(monthStart)}
              </span>
              <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => setMonthStart(addMonths(monthStart, 1))}>
                →
              </button>
              {!isCurrentMonth && (
                <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => setMonthStart(getMonthStart(todayStr()))}>
                  이번달
                </button>
              )}
            </div>

            {/* 주차 카드 — 가로 스크롤 (많아야 5장이라 보통 한 줄에 다 들어옴) */}
            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
              {weeksInMonth.map((monday) => (
                <LeaderWeekListItem
                  key={monday}
                  projectId={currentProjectId}
                  monday={monday}
                  active={monday === selectedWeek}
                  onClick={() => setSelectedWeek(monday)}
                />
              ))}
            </div>

            {/* 선택한 주 네비게이션 + AI 결과·참여 현황 */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16 }}>
                <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => setSelectedWeek(addDaysStr(selectedWeek, -7))}>
                  ← 이전주
                </button>
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--color-text-primary)", fontFamily: "var(--font-mono)" }}>
                  {selectedWeek} ~ {addDaysStr(selectedWeek, 6)}
                </span>
                <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => setSelectedWeek(addDaysStr(selectedWeek, 7))}>
                  다음주 →
                </button>
                {selectedWeek !== getWeekMondayStr() && (
                  <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => setSelectedWeek(getWeekMondayStr())}>
                    이번주
                  </button>
                )}
              </div>
              <LeaderReportDetail
                projectId={currentProjectId}
                monday={selectedWeek}
                mdModalOpen={mdModalOpen}
                onCloseMdModal={() => setMdModalOpen(false)}
                printModalOpen={printModalOpen}
                onClosePrintModal={() => setPrintModalOpen(false)}
              />
            </div>
          </div>
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
      <div className="sp-empty-desc">상단 프로젝트 선택기에서 프로젝트를 고르면 리더 리포트가 표시됩니다.</div>
    </div>
  );
}

function NoPermission() {
  return (
    <div className="sp-empty" style={{ padding: "48px 24px", textAlign: "center", background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)" }}>
      <div className="sp-empty-icon">🔒</div>
      <div className="sp-empty-title">PM 전용 화면입니다</div>
      <div className="sp-empty-desc">리더 리포트는 프로젝트 관리자(OWNER/ADMIN) 또는 PM/PL 만 볼 수 있습니다.</div>
    </div>
  );
}
