"use client";

/**
 * HistoryTab — "기록 보기" 탭
 *
 * 한 주 단위로만 보여주니 훑어보는 의미가 별로 없다는 피드백으로 한 달치를 통째로 보여주고,
 * 주 단위 구분선으로 그룹을 나눴다(달력처럼 칸을 나누진 않음 — 표 형태가 스캔하기 더 쉽다).
 * 토/일은 날짜 텍스트를 빨간색으로 표시. 행을 누르면 "오늘의 할일" 탭으로 전환되며 그 날이
 * 포함된 주가 선택된다(onEditDate) — 실제 계획/결과 편집은 거기 있는 DayCard를 그대로 재사용.
 */

import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { dayOfWeek, getMonthStart, getMonthLabel, addMonths, getMonthDays, groupByWeek } from "@/lib/weekUtil";
import type { WorkLogResponse } from "@/types/workLog";

const WEEKDAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

function isWeekend(dateStr: string): boolean {
  const dow = dayOfWeek(dateStr);
  return dow === 0 || dow === 6;
}

export default function HistoryTab({
  projectId,
  onEditDate,
}: {
  projectId: string;
  onEditDate: (date: string) => void;
}) {
  const [monthStart, setMonthStart] = useState(getMonthStart(new Date().toISOString().slice(0, 10)));
  const days  = getMonthDays(monthStart);
  const weeks = groupByWeek(days);
  const monthEnd = days[days.length - 1];

  const { data, isLoading } = useQuery({
    queryKey: ["work-log-history", projectId, monthStart],
    queryFn: () =>
      authFetch<{ data: WorkLogResponse }>(
        `/api/projects/${projectId}/work-logs?from=${monthStart}&to=${monthEnd}&logTyCode=DAILY&mberId=me`
      ).then((r) => r.data),
    enabled: !!projectId,
  });

  const byDate = new Map((data?.items ?? []).map((log) => [log.logDt, log]));
  const isCurrentMonth = monthStart === getMonthStart(new Date().toISOString().slice(0, 10));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
          <button type="button" className="sp-btn sp-btn-ghost sp-btn-xs" onClick={() => setMonthStart(getMonthStart(new Date().toISOString().slice(0, 10)))}>
            이번달
          </button>
        )}
      </div>

      {isLoading ? (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>불러오는 중...</div>
      ) : (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                <th style={{ width: 150 }}>날짜</th>
                <th style={{ width: 100 }}>완료율</th>
                <th>결과</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <Fragment key={week[0]}>
                  {/* 주 구분선 — 그 주의 날짜 범위를 라벨로 표시 */}
                  <tr>
                    <td
                      colSpan={3}
                      className="is-muted"
                      style={{
                        fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)",
                        background: "var(--color-bg-elevated)", cursor: "default",
                      }}
                    >
                      {week[0]} ~ {week[week.length - 1]}
                    </td>
                  </tr>
                  {week.map((d) => {
                    const log   = byDate.get(d);
                    const total = log?.items.length ?? 0;
                    const done  = log?.items.filter((i) => i.doneYn === "Y").length ?? 0;
                    const weekend = isWeekend(d);
                    return (
                      <tr key={d} onClick={() => onEditDate(d)}>
                        <td
                          className="is-mono"
                          style={weekend ? { color: "var(--color-error)" } : undefined}
                        >
                          {d} ({WEEKDAY_LABEL[dayOfWeek(d)]})
                        </td>
                        <td className={total === 0 ? "is-muted" : undefined}>
                          {total === 0 ? "-" : `${done}/${total}`}
                        </td>
                        <td className={!log?.noteCn ? "is-muted" : undefined}>
                          {log?.noteCn?.trim() || (log ? "(결과 없음)" : "기록 없음")}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
