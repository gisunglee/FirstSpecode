"use client";

/**
 * WorkReportPage — 업무 리포트 (URL: /work-report)
 *
 * 역할:
 *   - "업무일지"(/work-logs, 카드+체크박스형)와 완전히 같은 데이터(TbWrWorkLog/Item)를
 *     "정돈된 문서" 형태로 보여주는 대안 뷰. 새 API·컬럼 없음 — 기존 work-logs 엔드포인트만 재사용.
 *   - 좌측에 그 달의 주차 목록(WeekCardMini)이 항상 떠 있고, 우측에 선택한 주의 문서 상세를
 *     보여주는 마스터-디테일 레이아웃(이메일 클라이언트 받은편지함과 같은 구조).
 *     "카드 보기"를 별도 전체화면 모드로 뒀더니 문서 상세를 보다가 목록으로 돌아가는 길이
 *     불편하다는 피드백으로, 목록을 아예 상시 노출로 바꿨다 — "뒤로 가기" 개념 자체가 없어짐.
 *   - 우측 상세는 "주간"(선택한 한 주 문서 한 장) / "월간"(그 달 모든 주 문서를 이어붙임) 2가지.
 *
 * 순수 개인 문서 — 팀 전체를 모은 AI 요약은 여기 없다(PM 전용 "리더 리포트"로 분리,
 * /leader-report). 그래서 이 페이지는 권한 체크 없이 전 직무가 그대로 본다.
 *
 * 격리:
 *   - work-logs/ 와 별도 폴더. RefPicker 컴포넌트만 예외적으로 재사용(../work-logs/_components).
 */

import { useState } from "react";
import { useAppStore } from "@/store/appStore";
import { getMonthStart, getMonthLabel, addMonths, getMonthDays, getWeekMondayStr, addDaysStr, mmddRange } from "@/lib/weekUtil";
import WeeklyDocView from "./_components/WeeklyDocView";
import WeekCardMini from "./_components/WeekCardMini";

type DetailMode = "week" | "month";

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
  const [detailMode, setDetailMode] = useState<DetailMode>("week");
  const [monthStart, setMonthStart] = useState(getMonthStart(todayStr()));
  const [selectedWeek, setSelectedWeek] = useState(getWeekMondayStr());

  const weeksInMonth   = getWeeksOverlappingMonth(monthStart);
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
            <div className={`sp-tab-seg-item${detailMode === "week" ? " is-active" : ""}`} onClick={() => setDetailMode("week")}>
              주간
            </div>
            <div className={`sp-tab-seg-item${detailMode === "month" ? " is-active" : ""}`} onClick={() => setDetailMode("month")}>
              월간
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: "0 24px 24px" }}>
        {!currentProjectId ? (
          <NoProjectSelected />
        ) : (
          <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
            {/* 좌측 — 주차 목록(항상 노출) */}
            <div style={{ width: 260, flex: "0 0 260px", display: "flex", flexDirection: "column", gap: 10 }}>
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

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {weeksInMonth.map((monday, idx) => (
                  <WeekCardMini
                    key={monday}
                    projectId={currentProjectId}
                    monday={monday}
                    weekIndex={idx + 1}
                    active={detailMode === "week" && monday === selectedWeek}
                    onClick={() => {
                      setSelectedWeek(monday);
                      setDetailMode("week");
                    }}
                  />
                ))}
              </div>
            </div>

            {/* 우측 — 선택한 주(또는 그 달 전체)의 문서 상세 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {detailMode === "week" && (
                <>
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
                    {!isCurrentWeek && (
                      <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => setSelectedWeek(getWeekMondayStr())}>
                        이번주
                      </button>
                    )}
                  </div>
                  <WeeklyDocView projectId={currentProjectId} monday={selectedWeek} />
                </>
              )}

              {detailMode === "month" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {weeksInMonth.map((monday, idx) => (
                    <div key={monday} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {/* 문서와 문서 사이를 확실히 갈라 보여달라는 피드백 — "N월 N주 · 날짜범위" +
                          가로선으로 구분선을 만든다(HistoryTab의 주 구분 행과 같은 개념, 카드용). */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: idx === 0 ? 0 : 8 }}>
                        <span style={{ fontSize: "var(--text-base)", fontWeight: 700, color: "var(--color-text-primary)", whiteSpace: "nowrap" }}>
                          {monday.slice(5, 7)}월 {idx + 1}주
                        </span>
                        <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>
                          {mmddRange(monday, addDaysStr(monday, 6))}
                        </span>
                        <div style={{ flex: 1, height: 1, background: "var(--color-border-strong)" }} />
                      </div>
                      <WeeklyDocView projectId={currentProjectId} monday={monday} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
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
