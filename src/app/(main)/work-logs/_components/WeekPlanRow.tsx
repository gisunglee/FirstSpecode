"use client";

/**
 * WeekPlanRow — 상단 4칸 요약(이번 주 계획/결과, 다음 주 계획/결과)
 *
 * 예전엔 [이번주/다음주/2주후] 3장을 계획+관련일감+결과 한 카드에 다 담아서 옆으로 늘어놓는
 * 구성이었는데, 사용자가 직접 그려온 참고 레이아웃(상단 4칸 요약 → 하단 일별 카드)으로
 * 다시 짰다(2026-07-24). "계획"과 "결과"를 별도 카드(WeekChecklistSummary/WeekResultSummary)로
 * 쪼갰다.
 *
 * "이전 주 계획 복사해오기"/"차주 계획으로 복사하기" 버튼이 한때 있었는데, 굳이 필요 없다는
 * 판단으로 뺐다(2026-07-24c) — 주 단위 일괄 복사보다 일별 카드의 "전일 미완료 복사"(DayCard)가
 * 실제 쓰임에 더 맞는다는 결론.
 *
 * `monday`는 이 페이지에서 지금 선택된 주(TodayTab.weekMonday)를 그대로 받는다 — 예전엔 이
 * 컴포넌트가 실제 "오늘 기준 이번 주"를 스스로 계산해서, 주 탐색으로 다른 주의 일별 카드를
 * 보고 있어도 위 요약 카드는 계속 진짜 "이번 주"만 보여주는 불일치가 있었다. 이제 상단 요약은
 * 항상 하단에 지금 보이는 주와 같은 주를 가리킨다.
 */

import { addDaysStr, getRelativeWeekLabel } from "@/lib/weekUtil";
import WeekChecklistSummary from "./WeekChecklistSummary";
import WeekResultSummary from "./WeekResultSummary";

export default function WeekPlanRow({ projectId, monday }: { projectId: string; monday: string }) {
  const nextMonday = addDaysStr(monday, 7);
  // 지금 실제로 이번/다음 주를 보는 중일 때만 그렇게 부르고, 임의의 주를 탐색 중이면
  // "OO월 N주"로 — 다른 주를 보면서도 계속 "이번 주"라고 잘못 부르지 않도록(2026-07-24).
  const thisLabel = getRelativeWeekLabel(monday);
  const nextLabel = getRelativeWeekLabel(nextMonday);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
      <WeekChecklistSummary projectId={projectId} monday={monday} label={thisLabel} />
      <WeekResultSummary projectId={projectId} monday={monday} label={thisLabel} />
      <WeekChecklistSummary projectId={projectId} monday={nextMonday} label={nextLabel} />
      <WeekResultSummary projectId={projectId} monday={nextMonday} label={nextLabel} />
    </div>
  );
}
