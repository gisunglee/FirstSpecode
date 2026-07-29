/**
 * 내 업무 타입 — 클라이언트/서버 공유
 *
 * 격리 원칙:
 *   - dashboard.ts, calendar.ts, pm.ts 와 완전 독립
 *   - "PM 진단"(전체 시야)의 반대 — 로그인한 나 한 사람 기준으로 요구사항(분석)/단위업무/화면/
 *     기능을 통틀어 "내가 해야 할 것"을 한 스냅샷으로 본다.
 *   - 내가 담당한 4개 엔티티 전체 + 그 하위에 담당자 없는 것까지 한꺼번에 보여주는 종합 스냅샷.
 */

export type MyWorkItemKind = "REQUIREMENT" | "UNIT_WORK" | "SCREEN" | "FUNCTION";

export const MY_WORK_KIND_LABELS: Record<MyWorkItemKind, string> = {
  REQUIREMENT: "요구사항",
  UNIT_WORK:   "단위업무",
  SCREEN:      "화면",
  FUNCTION:    "기능",
};

// ── B. 내 업무 통합 리스트 ────────────────────────────────────────────────────
//
// 요구사항(분석)/단위업무/화면/기능 중 내가 담당자(asign_mber_id)인 것 전부를 한 리스트로.
//
// 진척률 필드가 2개인 이유: 리스트 하나에 4개 엔티티가 섞여 있는데 "진척률"이 행마다 다른
// 기준(화면=설계, 단위업무/기능=구현)이면 숫자만 봐서는 뭘 보는지 헷갈린다는 피드백으로,
// 단위업무/화면/기능은 설계·구현 진척률을 둘 다 내려서 나란히 보여준다.
//   progress       — 요구사항은 분석 진척률(자체 progrs_rt), 단위업무/화면/기능은 구현 진척률
//                     (impl_rt 롤업). excludeCompleted 필터·완료 판정은 이 값 기준.
//   designProgress — 단위업무/화면/기능만 존재(설계 진척률, design_rt 롤업). 요구사항은 null
//                     (분석 단계엔 설계라는 축 자체가 없음).
export type MyWorkItem = {
  kind:      MyWorkItemKind;
  id:        string;
  displayId: string;
  name:      string;
  href:      string;
  startDate: string | null;
  /** 요구사항=분석 종료일, 단위업무=구현 종료일(하위 화면 롤업), 화면=실질구현 종료일, 기능=소속 화면 상속 */
  endDate:   string | null;
  /** 0~100 — 요구사항=분석 진척률, 나머지=구현 진척률(impl_rt 롤업) */
  progress:  number;
  /** 0~100 — 단위업무/화면/기능만(설계 진척률, design_rt 롤업). 요구사항은 null */
  designProgress: number | null;
  /**
   * 설계 종료일 — 단위업무=자신의 계획설계기간, 화면/기능=부모 단위업무 상속. 요구사항은 null
   * (분석 단계엔 설계라는 축 자체가 없어 designProgress와 동일하게 null).
   * endDate(구현/분석)만 보고는 설계 지연 여부를 알 수 없어서 진척률과 같은 방식으로 나란히 내려준다.
   */
  designEndDate: string | null;
  /** 기준일 - 구현/분석 마감일(endDate). 마감일 없으면 null(리스트 맨 뒤로 정렬됨) */
  dDay:      number | null;
  /** 기준일 - 설계 마감일(designEndDate). 요구사항은 null */
  designDDay: number | null;
};

// ── C. 하위 담당자 미지정 ────────────────────────────────────────────────────
//
// 내가 담당하는 요구사항/단위업무/화면의 "직속 자식" 중 담당자가 없는 것.
// 영역(Area)은 담당자 개념 자체가 없어(기존 관례) 화면 밑은 영역을 건너뛰고 바로 기능으로 간다.
export type UnassignedChildItem = {
  parentKind: "REQUIREMENT" | "UNIT_WORK" | "SCREEN";
  parentName: string;
  childKind:  "UNIT_WORK" | "SCREEN" | "FUNCTION";
  id:         string;
  displayId:  string;
  name:       string;
  href:       string;
};

// ── E. 내 업무 미설정 ────────────────────────────────────────────────────────
//
// 내가 담당한 것(B와 동일 대상) 중 시작일·종료일·공수 중 하나라도 비어 있는 것.
// "공수" 항목은 단위업무/요구사항엔 해당 필드 자체가 없어(efrt_val은 화면/기능 전용) 대상에서 뺀다
// — 필드가 없는데 "미설정"이라고 하면 오해를 준다.
export type MissingScheduleField = "시작일" | "종료일" | "공수";

export type MissingScheduleItem = {
  kind:          MyWorkItemKind;
  id:            string;
  displayId:     string;
  name:          string;
  href:          string;
  missingFields: MissingScheduleField[];
};

// ── 통합 응답 ───────────────────────────────────────────────────────────────
export type MyWorkResponse = {
  summary: {
    /** 내가 담당자인 전체 건수(4개 엔티티 합) */
    totalMine: number;
    /** dDay < 0 */
    overdueCount: number;
    /** 0 <= dDay <= 3 */
    dueSoonCount: number;
    /** C(하위 담당자 미지정) 총 건수 */
    unassignedChildrenCount: number;
  };
  items: MyWorkItem[];
  unassignedChildren: UnassignedChildItem[];
  missingSchedule: MissingScheduleItem[];
  /**
   * 내가 담당한 각 엔티티의 평균 진척률(0~100). 건수 0이면 null(집계 대상 없음과 0%를 구분)
   * analysis(분석)는 구현/설계 구분이 없는 자체 진척률(progrs_rt)이라 단일값.
   * unitWork/screen/function은 구현(impl_rt)·설계(design_rt) 롤업을 둘 다 내려서
   * 프론트에서 스위치로 골라볼 수 있게 한다(행마다 기준이 달라 헷갈린다는 피드백으로 통일).
   */
  progressSummary: {
    analysis: number | null;
    unitWork: { impl: number | null; design: number | null };
    screen:   { impl: number | null; design: number | null };
    function: { impl: number | null; design: number | null };
  };
  /** 이 응답을 계산한 기준일(yyyy-MM-dd) — asOf 파라미터 없으면 실제 오늘 */
  asOf: string;
};
