"use client";

/**
 * TodayTab — "오늘의 할일" 탭
 *
 * 하루 한 장이 아니라 한 주(월~일) 7장을 카드 그리드로 늘어놓는다 — 하루씩 넘겨보는 것보다
 * 며칠이 한 화면에 같이 보이는 쪽이 흐름 파악에 낫다는 피드백 반영. 카드 하나(DayCard)가
 * 자기 날짜의 로딩/저장을 알아서 처리하므로 이 컴포넌트는 "어떤 주를 보여줄지"만 관리한다.
 */

import { useState } from "react";
import { addDaysStr, getWeekMondayStr } from "@/lib/weekUtil";
import WeekPlanRow from "./WeekPlanRow";
import DayCard from "./DayCard";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function TodayTab({
  projectId,
  weekMonday,
  onWeekChange,
}: {
  projectId: string;
  /** 상위(page.tsx)가 소유 — "기록 보기" 탭에서 특정 날짜를 눌러 그 주로 전환할 때 공유하기 위함 */
  weekMonday: string;
  onWeekChange: (weekMonday: string) => void;
}) {
  const [pinnedDate] = useState(todayStr());
  const weekSunday = addDaysStr(weekMonday, 6);
  const isCurrentWeek = weekMonday === getWeekMondayStr();
  const days = Array.from({ length: 7 }, (_, i) => addDaysStr(weekMonday, i));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <WeekPlanRow projectId={projectId} />

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => onWeekChange(addDaysStr(weekMonday, -7))}>
            ← 이전 주
          </button>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)" }}>
            {weekMonday} ~ {weekSunday}
          </span>
          <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => onWeekChange(addDaysStr(weekMonday, 7))}>
            다음 주 →
          </button>
          {!isCurrentWeek && (
            <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => onWeekChange(getWeekMondayStr())}>
              이번 주
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {days.map((d) => (
            <DayCard key={d} projectId={projectId} date={d} isToday={d === pinnedDate} />
          ))}
        </div>
      </div>
    </div>
  );
}
