"use client";

/**
 * WorkReportPage — 업무 리포트 (URL: /work-report)
 *
 * 역할:
 *   - "업무일지"(/work-logs, 카드+체크박스형)와 완전히 같은 데이터(TbWrWorkLog/Item)를
 *     "정돈된 문서" 형태로 보여주는 대안 뷰. 새 API·컬럼 없음 — 기존 work-logs 엔드포인트만 재사용.
 *   - 뷰 3종: 카드 보기(기본, 그 달의 주차를 요약 카드로 훑어봄) / 주간(한 주 전체 문서) /
 *     월간(그 달의 모든 주간 문서를 이어붙여 조망)
 *
 * 격리:
 *   - work-logs/ 와 별도 폴더. RefPicker 컴포넌트만 예외적으로 재사용(../work-logs/_components).
 */

import { useState } from "react";
import { useAppStore } from "@/store/appStore";
import { getMonthStart, getMonthLabel, addMonths, getMonthDays, getWeekMondayStr, addDaysStr } from "@/lib/weekUtil";
import WeeklyDocView from "./_components/WeeklyDocView";
import WeekCardMini from "./_components/WeekCardMini";

type ViewMode = "cards" | "week" | "month";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// monthStart(그 달 1일)가 걸쳐 있는 모든 "월요일 시작 주"를 반환 — 달 경계에 걸친 주도
// 온전한 한 주(월~일)로 보여주기 위해, 정확히 그 달의 날짜만 자르지 않는다.
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

export default function WorkReportPage() {
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const [mode, setMode]             = useState<ViewMode>("cards");
  const [monthStart, setMonthStart] = useState(getMonthStart(todayStr()));
  const [selectedWeek, setSelectedWeek] = useState(getWeekMondayStr());

  const weeksInMonth  = getWeeksOverlappingMonth(monthStart);
  const isCurrentMonth = monthStart === getMonthStart(todayStr());
  const isCurrentWeek  = selectedWeek === getWeekMondayStr();

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
          📄 업무 리포트
        </div>
        {currentProjectId && (
          <div className="sp-tab-seg">
            <div className={`sp-tab-seg-item${mode === "cards" ? " is-active" : ""}`} onClick={() => setMode("cards")}>
              카드 보기
            </div>
            <div className={`sp-tab-seg-item${mode === "week" ? " is-active" : ""}`} onClick={() => setMode("week")}>
              주간
            </div>
            <div className={`sp-tab-seg-item${mode === "month" ? " is-active" : ""}`} onClick={() => setMode("month")}>
              월간
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: "0 24px 24px" }}>
        {!currentProjectId ? (
          <NoProjectSelected />
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16 }}>
              {mode === "week" ? (
                <>
                  <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => setSelectedWeek(addDaysStr(selectedWeek, -7))}>
                    ← 이전주
                  </button>
                  <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--color-text-primary)", fontFamily: "var(--font-mono)" }}>
                    {selectedWeek} ~ {addDaysStr(selectedWeek, 6)}
                  </span>
                  <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => setSelectedWeek(addDaysStr(selectedWeek, 7))}>
                    다음주 →
                  </button>
                  {!isCurrentWeek && (
                    <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => setSelectedWeek(getWeekMondayStr())}>
                      이번주
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => setMonthStart(addMonths(monthStart, -1))}>
                    ← 이전달
                  </button>
                  <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--color-text-primary)", minWidth: 80, textAlign: "center" }}>
                    {getMonthLabel(monthStart)}
                  </span>
                  <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => setMonthStart(addMonths(monthStart, 1))}>
                    다음달 →
                  </button>
                  {!isCurrentMonth && (
                    <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => setMonthStart(getMonthStart(todayStr()))}>
                      이번달
                    </button>
                  )}
                </>
              )}
            </div>

            {mode === "cards" && (
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                {weeksInMonth.map((monday, idx) => (
                  <WeekCardMini
                    key={monday}
                    projectId={currentProjectId}
                    monday={monday}
                    weekIndex={idx + 1}
                    onClick={() => {
                      setSelectedWeek(monday);
                      setMode("week");
                    }}
                  />
                ))}
              </div>
            )}

            {mode === "week" && <WeeklyDocView projectId={currentProjectId} monday={selectedWeek} />}

            {mode === "month" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {weeksInMonth.map((monday) => (
                  <WeeklyDocView key={monday} projectId={currentProjectId} monday={monday} />
                ))}
              </div>
            )}
          </>
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
        상단 프로젝트 선택기에서 프로젝트를 고르면 업무 리포트가 표시됩니다.
      </div>
    </div>
  );
}
