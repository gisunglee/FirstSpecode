"use client";

/**
 * WorkLogsPage — 업무일지 (URL: /work-logs)
 *
 * 역할:
 *   - 개발자가 하루 시작 전 오늘 할 일을 계획하고, 마무리에 한 일을 기록하는 습관 형성용 화면
 *   - 탭: "오늘의 할일"(한 주 7일을 카드로 늘어놓고 계획+결과 기록, 주 단위 이동) / "기록 보기"(주 단위 과거 조회)
 *   - 여기 쌓인 기록이 "주간보고"(PM 전용, /weekly-reports) AI 초안 생성의 원본 데이터가 된다
 *
 * 격리:
 *   - dashboard/, pm/, my-work/ 등과 완전 분리된 폴더. WBS와 같은 "일정" LNB 그룹에 속하지만
 *     WBS(프로젝트 전체 간트)와는 컨셉이 다른 "개인 일지" — 데이터도 API도 독립적.
 *
 * URL 쿼리:
 *   ?week=YYYY-MM-DD — 그 날짜가 속한 주로 초기 진입(예: "업무 리포트"의 "→ 업무일지에서
 *   편집" 링크). useSearchParams 는 Next 16 규칙상 반드시 Suspense 안에서만 사용 가능.
 */

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAppStore } from "@/store/appStore";
import { getWeekMondayStr, addDaysStr, getMonthStart, getOwnedWeeksOfMonth } from "@/lib/weekUtil";
import TodayTab from "./_components/TodayTab";
import HistoryTab from "./_components/HistoryTab";

type Tab = "today" | "history";

export default function WorkLogsPage() {
  return (
    <Suspense fallback={null}>
      <WorkLogsPageInner />
    </Suspense>
  );
}

function WorkLogsPageInner() {
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const searchParams = useSearchParams();
  const weekParam = searchParams.get("week");
  const initialWeek = weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? getWeekMondayStr(weekParam) : getWeekMondayStr();

  const [tab, setTab] = useState<Tab>("today");
  const [weekMonday, setWeekMonday] = useState(initialWeek);

  // "이번 달 주" 선택 — weekMonday가 속한 달(수요일 기준 귀속) 전체 주를 번호 버튼으로.
  // 원래 TodayTab.tsx 안에서 별도 줄로 렌더했는데, 상단 타이틀 줄과 따로 놀아 "한 줄로,
  // 가운데 정렬로 붙여달라"는 피드백으로 이 sticky 헤더 줄로 옮겼다(2026-07-24i).
  const monthStart = getMonthStart(addDaysStr(weekMonday, 2));
  const monthWeeks = getOwnedWeeksOfMonth(monthStart);

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
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 19, fontWeight: 700, color: "var(--color-text-primary)" }}>
            📓 업무일지
          </div>
          {/* 지금 보는 주 기간이 스크롤해도 계속 안 보인다는 피드백으로 상단 고정 타이틀
              옆에도 노출(2026-07-24d) — "오늘의 할일" 탭에서만 의미가 있다. */}
          {currentProjectId && tab === "today" && (
            <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)" }}>
              {weekMonday} ~ {addDaysStr(weekMonday, 6)}
            </span>
          )}
        </div>

        {/* 이번 달 주 선택 — 좌측 타이틀·우측 탭 사이에서 가운데 정렬(flex:1 + justifyContent:center) */}
        {currentProjectId && tab === "today" && (
          <div style={{ flex: 1, display: "flex", justifyContent: "center", minWidth: 200 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)", marginRight: 2 }}>
                {monthStart.slice(0, 4)}년 {monthStart.slice(5, 7)}월
              </span>
              {monthWeeks.map((w, i) => (
                <button
                  key={w}
                  type="button"
                  className={`sp-btn sp-btn-sm ${w === weekMonday ? "sp-btn-primary" : "sp-btn-secondary"}`}
                  onClick={() => setWeekMonday(w)}
                >
                  {i + 1}주
                </button>
              ))}
            </div>
          </div>
        )}

        {currentProjectId && (
          <div className="sp-tab-seg">
            <div className={`sp-tab-seg-item${tab === "today" ? " is-active" : ""}`} onClick={() => setTab("today")}>
              오늘의 할일
            </div>
            <div className={`sp-tab-seg-item${tab === "history" ? " is-active" : ""}`} onClick={() => setTab("history")}>
              기록 보기
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: "0 24px 24px" }}>
        {!currentProjectId ? (
          <NoProjectSelected />
        ) : tab === "today" ? (
          <TodayTab
            projectId={currentProjectId}
            weekMonday={weekMonday}
            onWeekChange={setWeekMonday}
          />
        ) : (
          <HistoryTab
            projectId={currentProjectId}
            onEditDate={(d) => {
              setWeekMonday(getWeekMondayStr(d));
              setTab("today");
            }}
          />
        )}
      </div>
    </div>
  );
}

function NoProjectSelected() {
  return (
    <div
      className="sp-empty"
      style={{
        padding: "48px 24px", textAlign: "center",
        background: "var(--color-bg-card)", border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-card)",
      }}
    >
      <div className="sp-empty-icon">📁</div>
      <div className="sp-empty-title">프로젝트를 선택해 주세요</div>
      <div className="sp-empty-desc">
        상단 프로젝트 선택기에서 프로젝트를 고르면 업무일지가 표시됩니다.
      </div>
    </div>
  );
}
