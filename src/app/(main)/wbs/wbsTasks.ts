/**
 * wbsTasks.ts — WbsTaskItem[] → 라이브러리 ITask[] 변환 (순수 함수, React 없음)
 *
 * WbsGanttChart.tsx 에서 분리한 이유: 렌더링 컴포넌트와 "데이터를 어떻게 태스크로 바꿀지"
 * 로직을 같이 두면 파일이 계속 커진다(줌/필터 등 기능이 계속 추가될 예정). 여기는 오직
 * WbsTaskItem[] + 표시옵션 → ITask[] 변환만 담당하고, 렌더링/DOM/스크롤은 모른다.
 */

import type { ITask } from "@svar-ui/react-gantt";
import type { WbsTaskItem } from "@/app/api/projects/[id]/wbs/route";
import { computeWbsStatus } from "@/lib/wbs/status";

// 막대 위 텍스트에 넣을 수 있는 항목 — WbsFilterBar의 체크박스와 1:1 대응
export type BarField = "name" | "progress" | "start" | "end";

// YYYY-MM-DD — 그룹 요약 행의 롤업 시작일 표시용(자식은 원본 문자열을 그대로 씀)
function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// 토/일을 뺀 영업일수 — endExclusive 기준(당일 미포함)으로 [start, end) 범위를 순회
function workingDaysBetween(start: Date, endExclusive: Date): number {
  let count = 0;
  const cur = new Date(start);
  while (cur < endExclusive) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// 체크박스 선택에 따라 막대 위 텍스트를 조립 — 시작+종료가 둘 다 켜지면 "~"로 묶고,
// 하나만 켜지면 단독 표기. 아무것도 안 켜면 빈 문자열(막대에 라벨 없이 색만 표시).
function buildBarText(item: WbsTaskItem, barFields: Set<BarField>): string {
  const segments: string[] = [];

  if (barFields.has("name")) segments.push(`[${item.displayId}] ${item.name}`);
  if (barFields.has("progress")) segments.push(`${item.progress}%`);

  if (barFields.has("start") && barFields.has("end")) {
    segments.push(`${item.start ?? "-"} ~ ${item.end ?? "-"}`);
  } else if (barFields.has("start")) {
    segments.push(item.start ?? "-");
  } else if (barFields.has("end")) {
    segments.push(item.end ?? "-");
  }

  return segments.join("  ·  ");
}

// 항목 하나 → ITask 변환 (그룹 여부와 무관하게 공통)
// 시작일·종료일이 없는 항목도 배제하지 않고 보여달라는 요청 반영 — start/end 를 아예
// 안 주면 라이브러리가 막대는 못 그리지만(의도된 동작) 좌측 그리드 행 자체는 나온다.
export function buildChildTask(
  item: WbsTaskItem,
  barFields: Set<BarField>,
  statusColor: boolean,
  parentId: string | undefined,
): ITask {
  if (!item.start || !item.end) {
    return {
      id:         item.id,
      text:       buildBarText(item, barFields),
      startLabel: "-",
      endLabel:   "-",
      assignee:   item.assignee ?? "-",
      effort:     item.effort ?? "-",
      progress:   item.progress,
      type:       "task",
      details:    item.groupLabel,
      parent:     parentId,
      href:       item.href,
    };
  }

  // DB의 end_de는 "종료일 포함"(inclusive) 이지만, 이 라이브러리는 end를
  // exclusive로 다루는 일반적인 간트 관례를 따름 — 하루를 더해줘야 종료일 당일이
  // 막대에 포함되고, 시작일=종료일인 단기 항목도 0폭으로 찌그러지지 않는다.
  const endExclusive = new Date(`${item.end}T00:00:00`);
  endExclusive.setDate(endExclusive.getDate() + 1);
  const start = new Date(`${item.start}T00:00:00`);

  return {
    id:       item.id,
    text:     buildBarText(item, barFields),
    start,
    end:      endExclusive,
    startLabel: item.start, // 이미 YYYY-MM-DD 문자열이라 그대로 씀
    endLabel: item.end,
    assignee: item.assignee ?? "-",
    effort:   item.effort ?? "-",
    workDays: workingDaysBetween(start, endExclusive),
    progress: item.progress,
    // 막대(트랙) 색은 항상 동일 — type은 진척률 선(.wx-progress-percent) 색상 결정에만
    // 쓰인다(wbs-gantt-theme.css 참고). 토글 꺼져 있으면 항상 "task"(선 하나 색).
    type:     statusColor ? computeWbsStatus(item) : "task",
    details:  item.groupLabel,
    parent:   parentId,
    href:     item.href,
  };
}

// groupLabel 별로 요약(summary) 부모 행을 만들고 그 아래 자식들을 매단다.
// 부모의 기간은 자식들의 최소 시작일~최대 종료일로, 진척률은 자식 평균으로 롤업.
export function buildGroupedTasks(items: WbsTaskItem[], barFields: Set<BarField>, statusColor: boolean): ITask[] {
  const byGroup = new Map<string, WbsTaskItem[]>();
  for (const item of items) {
    const list = byGroup.get(item.groupLabel) ?? [];
    list.push(item);
    byGroup.set(item.groupLabel, list);
  }

  const tasks: ITask[] = [];
  for (const [groupLabel, groupItems] of byGroup) {
    const parentId = `group:${groupLabel}`;
    const children = groupItems.map((item) => buildChildTask(item, barFields, statusColor, parentId));

    // 날짜 없는 항목도 자식으로는 들어오지만(start/end 없음), 부모의 기간 롤업 계산에는
    // 실제 날짜가 있는 자식만 써야 한다 — 안 그러면 min/max 가 NaN 이 된다.
    const datedChildren = children.filter((c) => c.start && c.end);
    const avgProgress = Math.round(
      children.reduce((sum, c) => sum + (c.progress ?? 0), 0) / children.length
    );

    if (datedChildren.length > 0) {
      const starts = datedChildren.map((c) => (c.start as Date).getTime());
      const ends   = datedChildren.map((c) => (c.end as Date).getTime());
      const groupStart = new Date(Math.min(...starts));
      const groupEnd   = new Date(Math.max(...ends));

      tasks.push({
        id:         parentId,
        text:       groupLabel,
        start:      groupStart,
        end:        groupEnd,
        startLabel: formatDate(groupStart),
        endLabel:   formatDate(groupEnd),
        // 그룹 요약 행은 여러 자식이 섞여 있어 담당자/공수를 하나로 합칠 수 없음 — 빈칸 처리
        assignee:   "-",
        effort:     "-",
        workDays:   workingDaysBetween(groupStart, groupEnd),
        progress:   avgProgress,
        type:       "summary",
        open:       true,
        // href 없음 — 그룹 요약 행은 실제 엔티티가 아니라 상세 페이지가 없음
      });
    } else {
      // 그룹 내 전 항목이 날짜 미지정 — 요약 막대 없이 이름만
      tasks.push({
        id:         parentId,
        text:       groupLabel,
        startLabel: "-",
        endLabel:   "-",
        assignee:   "-",
        effort:     "-",
        progress:   avgProgress,
        type:       "summary",
        open:       true,
      });
    }
    tasks.push(...children);
  }
  return tasks;
}

// 토/일 날짜 컬럼에 wbs-weekend 클래스를 붙여줌 — 실제 배경색은
// wbs-gantt-theme.css의 .wbs-weekend 규칙(옅은 빨강)에서 처리.
export function highlightWeekend(date: Date, unit: "day" | "hour"): string {
  if (unit !== "day") return "";
  const day = date.getDay();
  return day === 0 || day === 6 ? "wbs-weekend" : "";
}

// 라이브러리가 내부에서 실제로 가로 스크롤하는 요소를 클래스명 추측 없이 찾는다
// (버전이 바뀌어도 안 깨지도록 — overflow-x가 auto/scroll이면서 실제로 넘치는 요소 중
// 가장 많이 넘치는 걸 고른다. 그리드+타임라인이 같이 스크롤되는 요소일 가능성이 높음).
export function findScrollableEl(root: HTMLElement): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestOverflow = 0;
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    const overflow = el.scrollWidth - el.clientWidth;
    if (overflow <= 4) continue;
    const style = getComputedStyle(el);
    if (style.overflowX !== "auto" && style.overflowX !== "scroll") continue;
    if (overflow > bestOverflow) {
      bestOverflow = overflow;
      best = el;
    }
  }
  return best;
}
