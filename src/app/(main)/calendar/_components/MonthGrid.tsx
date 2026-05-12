"use client";

/**
 * MonthGrid — 월간 캘린더 그리드 (7 × N 행)
 *
 * 역할:
 *   - 한 달을 일~토 요일 헤더 + 6주 행 그리드로 렌더
 *   - 각 셀에 그 날 endDate 인 단위업무들을 배지 형태로 표시
 *   - 셀 클릭 → 선택된 날짜 콜백 (상위에서 사이드 패널 등에 활용 가능, 1차에서는 미사용)
 *
 * 표시 규칙:
 *   - 진행률 100% → success 색
 *   - end_de < 오늘 + progrs_rt < 100 → error (지연)
 *   - 그 외 → info (진행 중)
 *   - 한 셀에 항목이 3개 초과면 "+N" 표시
 */

import Link from "next/link";
import { useAppStore } from "@/store/appStore";
import type { CalendarUnitWork } from "@/types/calendar";

type Props = {
  year:  number;
  month: number; // 1~12
  /** 이 월에 endDate 가 떨어진 단위업무들 */
  items: CalendarUnitWork[];
  /** 본인 담당만 필터링 */
  myOnly: boolean;
};

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const MAX_BADGES_PER_CELL = 3;

export default function MonthGrid({ year, month, items, myOnly }: Props) {
  // 1일 요일 + 말일 일수
  const firstWeekday = new Date(year, month - 1, 1).getDay(); // 0=일
  const lastDay      = new Date(year, month, 0).getDate();

  // 6주 × 7일 = 42칸 — 앞뒤 비는 칸은 공백 셀
  // (5주짜리 달도 있지만 42칸 고정이 레이아웃이 안정적)
  const cells: Array<{ dateNum: number | null; dateStr: string | null }> = [];
  for (let i = 0; i < 42; i++) {
    const dayNum = i - firstWeekday + 1;
    if (dayNum < 1 || dayNum > lastDay) {
      cells.push({ dateNum: null, dateStr: null });
    } else {
      cells.push({
        dateNum: dayNum,
        dateStr: `${year}-${pad2(month)}-${pad2(dayNum)}`,
      });
    }
  }

  // 날짜별 항목 매핑
  // 필터(myOnly) 가 켜져 있으면 본인 담당만
  const itemsByDate = new Map<string, CalendarUnitWork[]>();
  for (const it of items) {
    if (myOnly && !it.isMine) continue;
    const arr = itemsByDate.get(it.endDate) ?? [];
    arr.push(it);
    itemsByDate.set(it.endDate, arr);
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div
      className="sp-group"
      style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}
    >
      {/* 요일 헤더 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          background: "var(--color-bg-elevated)",
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        {WEEKDAY_LABELS.map((d, idx) => (
          <div
            key={d}
            style={{
              padding: "8px 10px",
              fontSize: "var(--text-xs)",
              fontWeight: 600,
              letterSpacing: "0.06em",
              textAlign: "center",
              // 일·토는 톤 차이로 주말 표시
              color: idx === 0
                ? "var(--color-error)"
                : idx === 6
                  ? "var(--color-info)"
                  : "var(--color-text-tertiary)",
            }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* 날짜 셀 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gridAutoRows: "minmax(96px, 1fr)",
        }}
      >
        {cells.map((c, idx) => (
          <DayCell
            key={idx}
            dateNum={c.dateNum}
            dateStr={c.dateStr}
            isToday={c.dateStr === todayStr}
            items={c.dateStr ? (itemsByDate.get(c.dateStr) ?? []) : []}
            todayStr={todayStr}
          />
        ))}
      </div>
    </div>
  );
}

// ── 단일 셀 ─────────────────────────────────────────────────────────────────
function DayCell({
  dateNum, dateStr, isToday, items, todayStr,
}: {
  dateNum:  number | null;
  dateStr:  string | null;
  isToday:  boolean;
  items:    CalendarUnitWork[];
  todayStr: string;
}) {
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const visible  = items.slice(0, MAX_BADGES_PER_CELL);
  const overflow = items.length - visible.length;

  return (
    <div
      style={{
        borderRight: "1px solid var(--color-border-subtle)",
        borderBottom: "1px solid var(--color-border-subtle)",
        padding: "6px 6px 8px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        // 빈 셀(이전·다음 달)은 흐리게
        background: dateNum === null ? "var(--color-bg-elevated)" : "transparent",
        minHeight: 96,
        opacity: dateNum === null ? 0.4 : 1,
      }}
    >
      {dateNum !== null && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: "var(--text-xs)",
              fontFamily: "var(--font-mono)",
              fontWeight: isToday ? 700 : 500,
              color: isToday ? "var(--color-text-inverse)" : "var(--color-text-tertiary)",
              background: isToday ? "var(--color-brand)" : "transparent",
              padding: isToday ? "2px 6px" : "2px 2px",
              borderRadius: "var(--radius-full)",
              minWidth: 22,
              textAlign: "center",
            }}
          >
            {dateNum}
          </span>
        </div>
      )}

      {/* 단위업무 배지 — 최대 3개 */}
      {visible.map((it) => {
        const isOverdue = !!dateStr && dateStr < todayStr && it.progress < 100;
        const tone =
          it.progress >= 100 ? "sp-badge-success" :
          isOverdue ? "sp-badge-error" :
          "sp-badge-info";
        return (
          <Link
            key={it.unitWorkId}
            href={`/projects/${currentProjectId}/unit-works/${it.unitWorkId}`}
            className={`sp-badge ${tone}`}
            style={{
              fontSize: "var(--text-xs)",
              padding: "2px 6px",
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              textDecoration: "none",
              cursor: "pointer",
            }}
            title={`${it.displayId} ${it.name}${it.assigneeName ? ` · ${it.assigneeName}` : ""}`}
          >
            {it.displayId} {it.name}
          </Link>
        );
      })}

      {overflow > 0 && (
        <span
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--color-text-tertiary)",
            paddingLeft: 2,
          }}
        >
          +{overflow}건
        </span>
      )}
    </div>
  );
}

function pad2(n: number): string { return String(n).padStart(2, "0"); }
