/**
 * pm/delayStatus — 멤버별 지연 현황 집계 (순수 함수)
 *
 * 설계(단위업무 기준)와 구현(기능 기준) 두 갈래를 각각 계산한다 — 배경은 @/types/pm 의
 * DesignDelayRow/ImplDelayRow 주석 참조.
 *
 * 담당자 집계 주의: 영역(TbDsArea)은 담당자 컬럼이 아예 없다. areas/[areaId]/page.tsx 의
 * 기존 관례를 그대로 따라 "부모 화면의 담당자를 영역 담당자로 간주"해서 집계한다(구현 지연에서만
 * 해당 — 설계 지연은 2026-07-28 2차 개편으로 단위업무 기준이라 영역/화면을 아예 안 다룸).
 *
 * 격리:
 *   - prisma·React 무관 → 단위 테스트 용이 (lib/pm/riskScore.ts 와 같은 패턴)
 *   - PM 대시보드 외부에서 import 금지 (PM 전용 집계)
 */

import type { AnalysisDelayRow, DesignDelayRow, ImplDelayRow } from "@/types/pm";

// 담당자 없는 화면/기능 등을 묶는 그룹 키 — RiskWatchlist의 "미할당" 표기와 동일한 철학.
// 예전엔 담당자 없으면 통째로 continue 해서 집계에서 사라졌는데, 그러면 "아무도 담당 안 하는
// 지연 항목"이 대시보드에서 아예 안 보이는 사각지대가 생긴다(가장 위험한 케이스인데도).
export const UNASSIGNED_MBER_KEY = "__unassigned__";

// 공통: totalEffortHours/delayedEffortHours 반올림 + delayRate 계산 + 지연율 내림차순 정렬.
// DesignDelayRow/ImplDelayRow 둘 다 이 세 필드를 갖고 있어 구조적으로 재사용 가능.
function finalizeDelayRows<T extends { totalEffortHours: number; delayedEffortHours: number; delayRate: number }>(
  rows: T[]
): T[] {
  for (const r of rows) {
    r.totalEffortHours   = Math.round(r.totalEffortHours * 10) / 10;
    r.delayedEffortHours = Math.round(r.delayedEffortHours * 10) / 10;
    r.delayRate = r.totalEffortHours > 0
      ? Math.round((r.delayedEffortHours / r.totalEffortHours) * 1000) / 10
      : 0;
  }
  return rows.sort((a, b) => {
    if (b.delayRate !== a.delayRate) return b.delayRate - a.delayRate;
    return b.delayedEffortHours - a.delayedEffortHours;
  });
}

// ════════════════════════════════════════════════════════════════════════
// 설계 지연 — 단위업무(UnitWork) 기준
//
// 2026-07-28 2차 개편: 화면 기준이었으나, 단위업무 하나에 화면이 10개 이상인 경우도
// 흔해 화면마다 설계 일정을 따로 잡는 게 부담이라는 판단으로 단위업무 기준으로 옮김
// (설계 일정/공수는 이제 화면이 아니라 단위업무의 plan_dsgn_*에만 있음).
// ════════════════════════════════════════════════════════════════════════

export type DesignUnitWorkInput = {
  unitWorkId:  string;
  asignMberId: string | null;
  designEndDe: string | null;
  /** 계획설계 공수(시간) — 이미 숫자로 파싱된 값 (@/lib/effort 의 parseEffortHours 결과) */
  designEffortHours: number;
  /** 이 단위업무 하위 모든 화면→영역→기능의 design_rt(TbCmProgress) 평균(0~100) —
   *  호출자가 lib/pm/progressRollup.ts fetchUnitWorkProgress로 미리 계산해서 전달 */
  avgDesignRt: number;
};

export type BuildDesignDelayInput = {
  unitWorks: DesignUnitWorkInput[];
  /** yyyy-MM-dd — designEndDe(문자열) 와 그대로 비교 */
  todayStr:  string;
  /** mberId → 표시 이름 (없으면 mberId 로 폴백) */
  nameMap:   Map<string, string | null>;
};

export function buildDesignDelayRows(input: BuildDesignDelayInput): DesignDelayRow[] {
  const { unitWorks, todayStr, nameMap } = input;

  const rowMap = new Map<string, DesignDelayRow>();
  function getRow(mberId: string): DesignDelayRow {
    let row = rowMap.get(mberId);
    if (!row) {
      row = {
        mberId,
        displayName: mberId === UNASSIGNED_MBER_KEY ? "미할당" : (nameMap.get(mberId) ?? mberId),
        unitWorkTotal: 0, unitWorkDelayed: 0,
        totalEffortHours: 0, delayedEffortHours: 0,
        delayRate: 0,
      };
      rowMap.set(mberId, row);
    }
    return row;
  }

  for (const u of unitWorks) {
    const isDelayed = !!u.designEndDe && u.designEndDe < todayStr && u.avgDesignRt < 100;
    const row = getRow(u.asignMberId ?? UNASSIGNED_MBER_KEY);
    row.unitWorkTotal++;
    row.totalEffortHours += u.designEffortHours;
    if (isDelayed) {
      row.unitWorkDelayed++;
      row.delayedEffortHours += u.designEffortHours * (1 - u.avgDesignRt / 100);
    }
  }

  const rows = [...rowMap.values()].filter((r) => r.unitWorkTotal > 0);
  return finalizeDelayRows(rows);
}

// ════════════════════════════════════════════════════════════════════════
// 구현 지연 — 기능(Function) 기준, 단위업무/화면/영역까지 롤업
// ════════════════════════════════════════════════════════════════════════

export type ImplFunctionInput = {
  funcId:      string;
  areaId:      string | null;
  asignMberId: string | null;
  /** 구현 공수(시간) — 이미 숫자로 파싱된 값 (@/lib/effort 의 parseEffortHours 결과) */
  effortHours: number;
  implEndDe:   string | null;
  /** 구현 진척률(0~100) — TbCmProgress.impl_rt, 없으면 0 */
  implRt:      number;
};

// 영역(Area)은 DB에 자체 담당자 컬럼이 없다 — areas/[areaId]/page.tsx 의 기존 관례와 동일하게
// "부모 화면의 담당자를 영역 담당자로 간주"한다 (asignMberId 없음, scrnId 로 화면 담당자를 역참조).
export type ImplAreaInput     = { areaId: string; scrnId: string | null };
export type ImplScreenInput   = { scrnId: string; unitWorkId: string | null; asignMberId: string | null };
export type ImplUnitWorkInput = { unitWorkId: string; asignMberId: string | null };

export type BuildImplDelayInput = {
  functions:  ImplFunctionInput[];
  areas:      ImplAreaInput[];
  screens:    ImplScreenInput[];
  unitWorks:  ImplUnitWorkInput[];
  /** yyyy-MM-dd — impl_end_de(문자열) 와 그대로 비교 */
  todayStr:   string;
  /** mberId → 표시 이름 (없으면 mberId 로 폴백) */
  nameMap:    Map<string, string | null>;
};

export function buildImplDelayRows(input: BuildImplDelayInput): ImplDelayRow[] {
  const { functions, areas, screens, unitWorks, todayStr, nameMap } = input;

  // ── 1) 기능별 지연 여부 + 지연 공수 계산 ────────────────────────────────
  const funcDelayed = new Map<string, boolean>();
  const funcDelayedEffort = new Map<string, number>();
  for (const f of functions) {
    const isDelayed = !!f.implEndDe && f.implEndDe < todayStr && f.implRt < 100;
    funcDelayed.set(f.funcId, isDelayed);
    funcDelayedEffort.set(f.funcId, isDelayed ? f.effortHours * (1 - f.implRt / 100) : 0);
  }

  // ── 2) 영역 → 지연 여부 (하위 기능 중 하나라도 지연이면 지연) ───────────
  const areaDelayed = new Map<string, boolean>();
  for (const a of areas) areaDelayed.set(a.areaId, false);
  for (const f of functions) {
    if (f.areaId && funcDelayed.get(f.funcId)) areaDelayed.set(f.areaId, true);
  }

  // ── 3) 화면 → 지연 여부 (하위 영역 중 하나라도 지연이면 지연) ───────────
  const screenDelayed = new Map<string, boolean>();
  for (const s of screens) screenDelayed.set(s.scrnId, false);
  for (const a of areas) {
    if (a.scrnId && areaDelayed.get(a.areaId)) screenDelayed.set(a.scrnId, true);
  }

  // ── 4) 단위업무 → 지연 여부 (하위 화면 중 하나라도 지연이면 지연) ──────
  const unitWorkDelayed = new Map<string, boolean>();
  for (const u of unitWorks) unitWorkDelayed.set(u.unitWorkId, false);
  for (const s of screens) {
    if (s.unitWorkId && screenDelayed.get(s.scrnId)) unitWorkDelayed.set(s.unitWorkId, true);
  }

  // ── 5) 멤버별 누적 (담당자 없으면 "미할당" 그룹으로) ───────────────────
  const rowMap = new Map<string, ImplDelayRow>();
  function getRow(mberId: string): ImplDelayRow {
    let row = rowMap.get(mberId);
    if (!row) {
      row = {
        mberId,
        displayName: mberId === UNASSIGNED_MBER_KEY ? "미할당" : (nameMap.get(mberId) ?? mberId),
        unitWorkTotal: 0, unitWorkDelayed: 0,
        screenTotal: 0,   screenDelayed: 0,
        areaTotal: 0,     areaDelayed: 0,
        functionTotal: 0, functionDelayed: 0,
        totalEffortHours: 0, delayedEffortHours: 0,
        delayRate: 0,
      };
      rowMap.set(mberId, row);
    }
    return row;
  }

  for (const u of unitWorks) {
    const row = getRow(u.asignMberId ?? UNASSIGNED_MBER_KEY);
    row.unitWorkTotal++;
    if (unitWorkDelayed.get(u.unitWorkId)) row.unitWorkDelayed++;
  }
  for (const s of screens) {
    const row = getRow(s.asignMberId ?? UNASSIGNED_MBER_KEY);
    row.screenTotal++;
    if (screenDelayed.get(s.scrnId)) row.screenDelayed++;
  }
  // 영역은 자체 담당자가 없어 부모 화면의 담당자를 영역 담당자로 간주 (areas/[areaId]/page.tsx 와 동일 관례)
  const screenAssigneeMap = new Map(screens.map((s) => [s.scrnId, s.asignMberId]));
  for (const a of areas) {
    const effectiveAssignee = (a.scrnId ? screenAssigneeMap.get(a.scrnId) : null) ?? UNASSIGNED_MBER_KEY;
    const row = getRow(effectiveAssignee);
    row.areaTotal++;
    if (areaDelayed.get(a.areaId)) row.areaDelayed++;
  }
  for (const f of functions) {
    const row = getRow(f.asignMberId ?? UNASSIGNED_MBER_KEY);
    row.functionTotal++;
    row.totalEffortHours += f.effortHours;
    if (funcDelayed.get(f.funcId)) {
      row.functionDelayed++;
      row.delayedEffortHours += funcDelayedEffort.get(f.funcId) ?? 0;
    }
  }

  const rows = [...rowMap.values()].filter(
    (r) => r.unitWorkTotal > 0 || r.screenTotal > 0 || r.areaTotal > 0 || r.functionTotal > 0
  );
  return finalizeDelayRows(rows);
}

// ════════════════════════════════════════════════════════════════════════
// 분석 지연 — 요구사항(Requirement) 기준
//
// 설계/구현과 달리 요구사항엔 공수(effort) 필드가 없어 공수 가중 대신 건수 기준으로
// 집계한다 (delayRate = reqDelayed / reqTotal * 100). 상위 롤업도 없음 — 요구사항이
// 이 위젯의 유일한 단위.
// ════════════════════════════════════════════════════════════════════════

export type AnalysisRequirementInput = {
  reqId:       string;
  asignMberId: string | null;
  analysisEndDe: string | null;
  /** 0~100 — TbRqRequirement.progrs_rt */
  progress:    number;
};

export type BuildAnalysisDelayInput = {
  requirements: AnalysisRequirementInput[];
  /** yyyy-MM-dd — anls_end_de(문자열) 와 그대로 비교 */
  todayStr:     string;
  /** mberId → 표시 이름 (없으면 mberId 로 폴백) */
  nameMap:      Map<string, string | null>;
};

export function buildAnalysisDelayRows(input: BuildAnalysisDelayInput): AnalysisDelayRow[] {
  const { requirements, todayStr, nameMap } = input;

  const rowMap = new Map<string, AnalysisDelayRow & { progressSum: number }>();
  function getRow(mberId: string) {
    let row = rowMap.get(mberId);
    if (!row) {
      row = {
        mberId,
        displayName: mberId === UNASSIGNED_MBER_KEY ? "미할당" : (nameMap.get(mberId) ?? mberId),
        reqTotal: 0, reqCompleted: 0, reqDelayed: 0, avgProgress: 0, delayRate: 0,
        progressSum: 0,
      };
      rowMap.set(mberId, row);
    }
    return row;
  }

  for (const r of requirements) {
    const row = getRow(r.asignMberId ?? UNASSIGNED_MBER_KEY);
    const isDelayed = !!r.analysisEndDe && r.analysisEndDe < todayStr && r.progress < 100;
    row.reqTotal++;
    row.progressSum += r.progress;
    if (r.progress >= 100) row.reqCompleted++;
    if (isDelayed) row.reqDelayed++;
  }

  const rows = [...rowMap.values()].filter((r) => r.reqTotal > 0);
  for (const r of rows) {
    r.avgProgress = Math.round(r.progressSum / r.reqTotal);
    r.delayRate   = Math.round((r.reqDelayed / r.reqTotal) * 1000) / 10;
  }
  return rows
    .map(({ progressSum: _progressSum, ...rest }) => rest)
    .sort((a, b) => {
      if (b.delayRate !== a.delayRate) return b.delayRate - a.delayRate;
      return b.reqDelayed - a.reqDelayed;
    });
}
