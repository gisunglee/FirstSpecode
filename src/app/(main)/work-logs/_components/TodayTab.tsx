"use client";

/**
 * TodayTab — "오늘의 할일" 탭
 *
 * 하루 한 장이 아니라 한 주(월~일) 7장을 카드 그리드로 늘어놓는다 — 하루씩 넘겨보는 것보다
 * 며칠이 한 화면에 같이 보이는 쪽이 흐름 파악에 낫다는 피드백 반영. 카드 하나(DayCard)가
 * 자기 날짜의 로딩/저장을 알아서 처리하므로 이 컴포넌트는 "어떤 주를 보여줄지"만 관리한다.
 *
 * "카드형/리스트형" 토글을 넣었다가 뺐다(2026-07-24) — 리스트형(DayListRow)을 실제로 써보고
 * "쉣이더라"는 피드백으로 리스트형 자체를 삭제, 카드형(DayCard) 그리드만 남겼다.
 *
 * "OO 계획 요약"/"OO 일일 보고" 섹션 라벨 추가(2026-07-24) — 참고 이미지와 비교해 "지금 무슨
 * 주를 보고 있는지도 안 보이고, 레이블이 없어서 허전하다"는 피드백. 처음엔 그 위에 별도로
 * "OO 업무 관리" 큰 제목+부제+날짜 배지까지 얹었는데, "계획 요약" 섹션 라벨과 아이콘·문구가
 * 겹쳐 되려 지저분해졌다는 피드백으로 그 큰 제목 블록은 빼고 날짜 배지만 "계획 요약" 줄
 * 오른쪽으로 옮겼다(2026-07-24b).
 *
 * "이번 달 주" 선택 줄 추가(2026-07-24d) — 지금 보는 주가 이 달의 몇 번째 주인지 한눈에 안
 * 보이고, 다른 주로 옮기려면 화살표를 여러 번 눌러야 한다는 피드백. weekMonday가 속한 달의
 * 주 전체(getOwnedWeeksOfMonth)를 "1주/2주/..." 버튼으로 늘어놓고 클릭하면 바로 그 주로 이동.
 * 2026-07-24i: 이 선택 줄은 page.tsx의 상단 sticky 헤더(타이틀·탭 사이 가운데)로 옮겼다 —
 * 여기 있던 게 헤더와 따로 놀아 "한 줄로 붙여달라"는 피드백.
 */

import { addDaysStr, getWeekMondayStr, getRelativeWeekLabel } from "@/lib/weekUtil";
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
  const pinnedDate = todayStr();
  const weekSunday = addDaysStr(weekMonday, 6);
  const isCurrentWeek = weekMonday === getWeekMondayStr();
  const days = Array.from({ length: 7 }, (_, i) => addDaysStr(weekMonday, i));
  const weekTitle = getRelativeWeekLabel(weekMonday);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 주간 영역 — "일별 보고"와 확실히 구분되도록 아이콘·라벨을 붙였다(2026-07-24,
          "주간/일별이 더 잘 구분되게" 피드백). 날짜 배지는 이 줄 오른쪽에 — 별도 큰 제목
          블록을 얹었더니 라벨이 겹쳐 지저분해진다는 피드백으로 뺐다(2026-07-24b). */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <span style={{ fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--color-text-primary)" }}>
          📆 {weekTitle} 계획 요약
        </span>
        <div
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "6px 12px", border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)", background: "var(--color-bg-card)",
          }}
        >
          {/* 화살표가 너무 작아 보이지도, 누르기도 힘들다는 피드백으로 sm 크기 + 글자 자체를
              키움(2026-07-24c). */}
          <button
            type="button" className="sp-btn sp-btn-secondary sp-btn-sm"
            style={{ fontSize: 16, lineHeight: 1, padding: "6px 12px" }}
            onClick={() => onWeekChange(addDaysStr(weekMonday, -7))}
          >←</button>
          <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--color-text-primary)", fontFamily: "var(--font-mono)" }}>
            📅 {weekMonday} ~ {weekSunday}
          </span>
          <button
            type="button" className="sp-btn sp-btn-secondary sp-btn-sm"
            style={{ fontSize: 16, lineHeight: 1, padding: "6px 12px" }}
            onClick={() => onWeekChange(addDaysStr(weekMonday, 7))}
          >→</button>
          {!isCurrentWeek && (
            <button type="button" className="sp-btn sp-btn-secondary sp-btn-sm" onClick={() => onWeekChange(getWeekMondayStr())}>이번 주</button>
          )}
        </div>
      </div>
      <WeekPlanRow projectId={projectId} monday={weekMonday} />

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--color-text-primary)" }}>
            📝 {weekTitle} 일일 보고
          </span>
          <span
            title='하루하루 계획·결과를 적으면 위 "계획" 카드의 진행률에 자동으로 반영됩니다.'
            style={{ cursor: "help", color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)" }}
          >
            ⓘ
          </span>
          <button type="button" className="sp-btn sp-btn-secondary sp-btn-sm" onClick={() => onWeekChange(addDaysStr(weekMonday, -7))}>
            ← 이전 주
          </button>
          <button type="button" className="sp-btn sp-btn-secondary sp-btn-sm" onClick={() => onWeekChange(addDaysStr(weekMonday, 7))}>
            다음 주 →
          </button>
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
