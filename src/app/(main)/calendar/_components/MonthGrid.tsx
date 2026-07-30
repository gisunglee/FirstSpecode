"use client";

/**
 * MonthGrid — 월간 캘린더 그리드 (7 × 6행)
 *
 * 역할:
 *   - 한 달을 일~토 요일 헤더 + 6주 행 그리드로 렌더
 *   - 카테고리 체크박스로 걸러진 이벤트를 그 날짜 셀에 배지로 표시
 *   - 공휴일(HOLIDAY)만 배지가 아니라 셀 배경 하이라이트로 별도 표시(2026-07-29) —
 *     날짜당 하나뿐이라(DB @@unique) 배지 자리를 다른 업무 항목과 다투지 않게 하기 위함
 *   - 셀 클릭 → 선택된 날짜 콜백 (상위에서 사이드 패널 등에 활용 가능, 1차에서는 미사용)
 *   - 마일스톤 배지 클릭 → 상세 팝업(MilestoneDetailDialog, 프로젝트 설정 > 일정 탭과 공유,
 *     2026-07-30) — 이동할 상세 페이지가 없는 대신 이름/날짜/본문을 그 자리에서 보여준다.
 *
 * 표시 규칙(배지):
 *   - PHASE(단계일정)   → 고정 회색(neutral)
 *   - MILESTONE(마일스톤) → 고정 강조색(accent)
 *   - REQUIREMENT/UNIT_WORK_DESIGN/SCREEN_IMPL(업무 항목) → 진행률 기준
 *       진행률 100% → success / 마감 지났고 100% 미만 → error(지연) / 그 외 → info
 *   - 한 셀에 배지가 3개 초과면 "+N" 표시(공휴일 제외)
 */

import { useState } from "react";
import Link from "next/link";
import type { CalendarEvent, CalendarEventCategory } from "@/types/calendar";
import MilestoneDetailDialog from "@/components/ui/MilestoneDetailDialog";

type Props = {
  year:  number;
  month: number; // 1~12
  /** 이 월의 전체 이벤트(카테고리 무관) — 체크박스 필터는 이 컴포넌트 안에서 처리 */
  events: CalendarEvent[];
  /** 체크된 카테고리만 화면에 표시 */
  selectedCategories: Set<CalendarEventCategory>;
  /** 본인 담당만 필터 — isMine이 false인 이벤트만 숨김(null인 카테고리는 항상 표시) */
  myOnly: boolean;
};

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const MAX_BADGES_PER_CELL = 3;

export default function MonthGrid({ year, month, events, selectedCategories, myOnly }: Props) {
  // 마일스톤 배지를 클릭했을 때 열리는 상세 팝업 대상 — 그리드 전체에 하나만 있으면 됨
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);

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

  // 체크박스 필터(카테고리) + 담당자 필터를 통과한 이벤트만 남긴다
  const visibleEvents = events.filter((e) => {
    if (!selectedCategories.has(e.category)) return false;
    if (myOnly && e.isMine === false) return false;
    return true;
  });

  // 공휴일은 배지가 아니라 셀 배경 — 날짜별로 따로 분리(날짜당 최대 1개, DB @@unique)
  const holidayByDate = new Map<string, string>();
  const badgeEventsByDate = new Map<string, CalendarEvent[]>();
  for (const e of visibleEvents) {
    if (e.category === "HOLIDAY") {
      holidayByDate.set(e.date, e.label);
      continue;
    }
    const arr = badgeEventsByDate.get(e.date) ?? [];
    arr.push(e);
    badgeEventsByDate.set(e.date, arr);
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
            events={c.dateStr ? (badgeEventsByDate.get(c.dateStr) ?? []) : []}
            holidayName={c.dateStr ? (holidayByDate.get(c.dateStr) ?? null) : null}
            todayStr={todayStr}
            onMilestoneClick={setDetailEvent}
          />
        ))}
      </div>

      {detailEvent && (
        <MilestoneDetailDialog
          milestone={{ name: detailEvent.label, date: detailEvent.date, content: detailEvent.content ?? "" }}
          onClose={() => setDetailEvent(null)}
        />
      )}
    </div>
  );
}

// 단계일정(분석/설계/구현/테스트)은 개수가 8개뿐인 핵심 일정이라 단계마다 고유 아이콘 +
// 꽉 채운 색으로 눈에 띄게(2026-07-30) — label이 "분석 시작"/"분석 종료"처럼 "{단계명} {시작|종료}"
// 형태라 앞 단어만 떼어 매칭. brand는 마일스톤 전용이라 겹치지 않게 나머지 4색을 나눠 씀.
const PHASE_STYLE: Record<string, { icon: string; badgeClass: string }> = {
  "분석":   { icon: "🔍", badgeClass: "sp-badge-solid-info" },
  "설계":   { icon: "✏️", badgeClass: "sp-badge-solid-accent" },
  "구현":   { icon: "🛠️", badgeClass: "sp-badge-solid-success" },
  "테스트": { icon: "🧪", badgeClass: "sp-badge-solid-warning" },
};

function phaseStyleFor(label: string): { icon: string; badgeClass: string } {
  const phaseName = label.split(" ")[0];
  return PHASE_STYLE[phaseName] ?? { icon: "📅", badgeClass: "sp-badge-neutral" };
}

// 업무 항목(REQUIREMENT/UNIT_WORK_DESIGN/SCREEN_IMPL)만 진행률 기준 톤 — 나머지는 고정색.
// 마일스톤은 subtle 배경(sp-badge-accent)이 라이트 테마에서 잘 안 보인다는 피드백으로
// 꽉 채운 브랜드색(sp-badge-solid-brand)으로 — 팀 전체가 공유하는 핵심 일정이라 다른
// 배지보다 한 단계 더 눈에 띄어야 함.
function badgeClassFor(e: CalendarEvent, dateStr: string, todayStr: string): string {
  if (e.category === "MILESTONE") return "sp-badge-solid-brand";
  if (e.category === "PHASE") return phaseStyleFor(e.label).badgeClass;
  const progress = e.progress ?? 0;
  const isOverdue = dateStr < todayStr && progress < 100;
  if (progress >= 100) return "sp-badge-success";
  if (isOverdue) return "sp-badge-error";
  return "sp-badge-info";
}

// ── 단일 셀 ─────────────────────────────────────────────────────────────────
function DayCell({
  dateNum, dateStr, isToday, events, holidayName, todayStr, onMilestoneClick,
}: {
  dateNum:  number | null;
  dateStr:  string | null;
  isToday:  boolean;
  events:   CalendarEvent[];
  holidayName: string | null;
  todayStr: string;
  onMilestoneClick: (e: CalendarEvent) => void;
}) {
  const visible  = events.slice(0, MAX_BADGES_PER_CELL);
  const overflow = events.length - visible.length;
  const isHoliday = holidayName !== null;

  return (
    <div
      style={{
        borderRight: "1px solid var(--color-border-subtle)",
        borderBottom: "1px solid var(--color-border-subtle)",
        padding: "6px 6px 8px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        // 빈 셀(이전·다음 달)은 흐리게, 공휴일은 옅은 붉은 배경으로 하이라이트
        background: dateNum === null
          ? "var(--color-bg-elevated)"
          : isHoliday ? "var(--color-error-subtle)" : "transparent",
        minHeight: 96,
        opacity: dateNum === null ? 0.4 : 1,
      }}
    >
      {dateNum !== null && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
          {/* 공휴일 이름 — 배지 대신 날짜 옆에 작은 텍스트로만(날짜당 최대 1개) */}
          {isHoliday && (
            <span
              title={holidayName ?? undefined}
              style={{
                fontSize: "var(--text-xs)", color: "var(--color-error)", fontWeight: 600,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
              }}
            >
              {holidayName}
            </span>
          )}
          <span
            style={{
              marginLeft: "auto",
              fontSize: "var(--text-xs)",
              fontFamily: "var(--font-mono)",
              fontWeight: isToday ? 700 : 500,
              color: isToday ? "var(--color-text-inverse)" : isHoliday ? "var(--color-error)" : "var(--color-text-tertiary)",
              background: isToday ? "var(--color-brand)" : "transparent",
              padding: isToday ? "2px 6px" : "2px 2px",
              borderRadius: "var(--radius-full)",
              minWidth: 22,
              textAlign: "center",
              flexShrink: 0,
            }}
          >
            {dateNum}
          </span>
        </div>
      )}

      {/* 이벤트 배지 — 최대 3개 */}
      {visible.map((e, i) => {
        const tone = badgeClassFor(e, dateStr ?? "", todayStr);
        const content = (
          <span
            className={`sp-badge ${tone}`}
            style={{
              display: "block",
              fontSize: "var(--text-xs)",
              padding: "2px 6px",
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              textDecoration: "none",
              cursor: (e.href || e.category === "MILESTONE") ? "pointer" : "default",
            }}
            title={e.label}
          >
            {e.category === "MILESTONE" ? `📌 ${e.label}`
              : e.category === "PHASE" ? `${phaseStyleFor(e.label).icon} ${e.label}`
              : e.label}
          </span>
        );
        // key: 이벤트 자체엔 id가 없어(카테고리·날짜·라벨 조합이 그 셀 안에서 유일)
        if (e.href) return <Link key={i} href={e.href}>{content}</Link>;
        if (e.category === "MILESTONE") {
          return <div key={i} onClick={() => onMilestoneClick(e)}>{content}</div>;
        }
        return <div key={i}>{content}</div>;
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
