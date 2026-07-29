/**
 * PM 대시보드 타입 — 클라이언트/서버 공유
 *
 * 격리 원칙:
 *   - dashboard.ts, activity.ts, focus.ts, calendar.ts 와 완전 독립
 *   - "PM 의사결정용 종합 시야" 컨셉이라 모델이 다름 — 매트릭스 중심
 *
 * 위젯:
 *   A) teamLoad        — 멤버 × 작업 상태 매트릭스
 *   D) designDelay     — 멤버 × 단위업무 설계 지연 현황 (단위업무 기준, 공수 가중)
 *   E) implDelay       — 멤버 × 4계층(단위업무/화면/영역/기능) 구현 지연 현황 (기능 기준, 공수 가중)
 */

// ── A. 팀 부하 매트릭스 ─────────────────────────────────────────────────────
//
// 한 멤버가 담당한 단위업무 통계.
// 활용률(utilization) = (진행중 + 임박 + 지연) / 가용 슬롯. 단순화: 활성 작업 수만 노출.
// PM 은 절대 수치보다 "다른 멤버 대비 얼마나 무거운가" 가 더 중요.
export type TeamLoadRow = {
  mberId:       string;
  displayName:  string;
  /** 담당 단위업무 총 건수 (진행률 무관) */
  total:        number;
  /** 진행 중 (0 < progrs_rt < 100) */
  inProgress:   number;
  /** 마감 임박 (end_de <= today+7 AND progrs_rt < 100, 지연 제외) */
  dueSoon:      number;
  /** 지연 (end_de < today AND progrs_rt < 100) */
  overdue:      number;
  /** 완료 (progrs_rt = 100). 누적 통계 */
  completed:    number;
  /** 활성 작업량 = inProgress + dueSoon + overdue. 매트릭스 정렬 기준. */
  activeLoad:   number;
};

// ── D/E. 지연 현황 — 설계(단위업무 기준)와 구현(기능 기준)을 분리해서 본다 ────
//
// "팀 부하 매트릭스"와 다른 점: 팀 부하는 단위업무 자체의 plan_dsgn_end_de/진행률로
// 작업 상태(담당/진행중/임박/지연/완료) 분포를 보는 것이 목적이고,
// 이 두 위젯은 "지연"이라는 한 축에 집중해 계층별 개수와 그 무게(공수 가중 지연율)를
// 보는 것이 목적 — 그래서 지연 정의도 다르다.
//
// 설계와 구현은 서로 다른 작업 단위를 쓴다:
//   - 설계 = 단위업무(UnitWork) 기준. 화면이 여러 개(많으면 10개 이상)인 단위업무에서
//     화면마다 설계 일정을 따로 잡는 게 부담이라(2026-07-28 2차 개편), 설계 일정/공수는
//     단위업무의 plan_dsgn_bgng_de/end_de/efrt_val 하나로만 관리한다. 최초엔 화면 기준이었음.
//   - 구현 = 기능(Function) 기준. 기능이 Input/Output·API·처리로직 등 구현 준비 단위이고
//     구현 일정(actl_impl_*)은 화면이 갖는다.
//
// 진척률은 새로 만들지 않고 기능에 이미 있는 TbCmProgress(design_rt/impl_rt)만 참조한다.
// 단위업무의 설계 진척률 = 그 하위 모든 화면→영역→기능의 design_rt 평균
//   (lib/pm/progressRollup.ts fetchUnitWorkProgress 재사용 — 공수 가중평균 아니고 단순평균)
//
// 담당자가 없는 단위업무/기능은 "미할당" 행(mberId=UNASSIGNED_MBER_KEY, lib/pm/delayStatus.ts)으로
// 묶여서 나온다 — 예전엔 그냥 건너뛰어서, 아무도 담당하지 않는 지연 항목이 대시보드에서
// 통째로 안 보이는 사각지대가 있었다(가장 위험한 케이스인데도 0%로 표시됨).
export type DesignDelayRow = {
  mberId:      string;
  displayName: string;

  /** 담당 단위업무 개수 (전체 / 설계 지연) */
  unitWorkTotal:   number;
  unitWorkDelayed: number;

  /** 담당 단위업무들의 계획설계 공수(시간) 합계 */
  totalEffortHours: number;
  /** 지연 단위업무들의 "남은" 설계 공수(시간) 합 = Σ effort × (1 - 단위업무 평균 design_rt/100) */
  delayedEffortHours: number;
  /** 공수 가중 지연율(%). totalEffortHours=0 이면 0 */
  delayRate: number;
};

// 지연 판정은 오직 기능(Function) 기준:
//   기능 지연 = impl_end_de < 오늘 AND impl_rt(TbCmProgress) < 100
//   상위(영역/화면/단위업무)는 하위에 지연 기능이 하나라도 있으면 지연으로 롤업
//   (단위업무도 일관성을 위해 자체 end_de/progrs_rt 대신 이 롤업 기준을 사용 —
//    그래서 팀 부하 매트릭스의 "지연" 숫자와 다를 수 있음)
//
// 지연율/지연공수는 "그 멤버가 직접 담당(asign_mber_id)하는 기능"만 집계.
// 공수(구현 공수)·진척률이 기능에만 존재하므로 이게 가장 명확한 기준.
export type ImplDelayRow = {
  mberId:      string;
  displayName: string;

  /** 담당 단위업무 개수 (전체 / 하위에 지연 기능이 있는 것) */
  unitWorkTotal:   number;
  unitWorkDelayed: number;
  /** 담당 화면 개수 (전체 / 하위에 지연 기능이 있는 것) */
  screenTotal:   number;
  screenDelayed: number;
  /** 담당 영역 개수 (전체 / 하위에 지연 기능이 있는 것) */
  areaTotal:   number;
  areaDelayed: number;
  /** 담당 기능 개수 (전체 / 지연) */
  functionTotal:   number;
  functionDelayed: number;

  /** 담당 기능들의 구현 공수(시간) 합계 */
  totalEffortHours: number;
  /** 지연 기능들의 "남은" 공수(시간) 합 = Σ effort × (1 - progress/100) */
  delayedEffortHours: number;
  /** 공수 가중 지연율(%) = delayedEffortHours / totalEffortHours × 100. totalEffortHours=0 이면 0 */
  delayRate: number;
};

// ── F. 분석 현황 — 요구사항(Requirement) 기준 ────────────────────────────────
//
// 설계(화면)/구현(기능)과 달리 요구사항엔 공수(effort) 필드가 없다. 그래서
// "공수 가중 지연율" 대신 건수 기준 지표를 쓴다 — delayRate = reqDelayed / reqTotal * 100.
// avgProgress(담당 요구사항의 progrs_rt 평균)가 사용자가 말한 "분석률".
//
// 설계/구현 지연 현황과 별도 위젯으로 둔 이유: 같은 표에 넣으면 델레이율 계산 기준이
// (공수 가중 vs 건수 기준) 컬럼마다 달라져 오해를 부른다.
export type AnalysisDelayRow = {
  mberId:      string;
  displayName: string;

  /** 담당 요구사항 총 건수 */
  reqTotal:   number;
  /** 완료 건수 (progrs_rt = 100) */
  reqCompleted: number;
  /** 지연 건수 (anls_end_de < today AND progrs_rt < 100) */
  reqDelayed: number;
  /** 담당 요구사항들의 progrs_rt 평균(0~100) — "분석률" */
  avgProgress: number;
  /** 건수 기준 지연율(%) = reqDelayed / reqTotal * 100 */
  delayRate:  number;
};

// 위 매트릭스 요약 숫자를 클릭했을 때 실제 요구사항 이름을 보여주는 원본 목록.
// pm-analysis-detail API 가 페이징 없이 최대 100건 반환.
export type AnalysisDetailItem = {
  reqId:        string;
  reqDisplayId: string;
  reqName:      string;
  mberId:       string | null;
  memberName:   string | null;
  startDate:    string | null;
  endDate:      string | null;
  /** 0~100 */
  progress:  number;
  isDelayed: boolean;
};

// ── G. 지연 현황 상세 목록 (팝업 드릴다운) ────────────────────────────────────
//
// 지연 현황 위젯의 집계 숫자를 클릭했을 때, 실제로 어떤 화면/기능이 지연인지
// 이름을 보여주는 원본 행 목록. 페이징 없이 최대 100건만 반환한다(/api/projects/[id]/pm-delay-detail).
// kind="DESIGN" 행은 화면 기준(진척률=화면 하위 기능 design_rt 평균, areaId/functionId=null),
// kind="IMPL" 행은 기능 기준(진척률=impl_rt, 단위업무/화면/영역/기능 이름+ID를 계층 조인으로 채움).
//
// 각 계층 이름 옆에 ID를 같이 내려주는 이유: 프런트에서 단위업무/화면/영역/기능 이름을
// 클릭하면 해당 상세 페이지로 바로 링크 걸기 위함(DelayDetailModal).
export type DelayDetailItem = {
  kind:   "DESIGN" | "IMPL";
  /** unit_work_id(DESIGN, 2026-07-28부터) 또는 func_id(IMPL) — 목록 key 용 */
  itemId: string;
  mberId:     string | null;
  memberName: string | null;
  unitWorkId:   string | null;
  unitWorkName: string | null;
  /** DESIGN 행은 항상 null (단위업무 단위라 특정 화면이 없음, 2026-07-28부터) */
  screenId:     string | null;
  screenName:   string | null;
  /** DESIGN 행은 항상 null */
  areaId:       string | null;
  areaName:     string | null;
  /** DESIGN 행은 항상 null */
  functionId:   string | null;
  functionName: string | null;
  /** 0~100 */
  progress:  number;
  startDate: string | null;
  endDate:   string | null;
  isDelayed: boolean;
};

// ── H. 미지정 현황 — 담당자/일정/공수 입력 누락 감시 ───────────────────────────
//
// "지연 현황"은 마감을 넘긴 것만 잡아낸다 — 애초에 담당자·일정·공수를 아무도
// 입력하지 않은 항목은 마감 판정 자체가 안 돼서 지연 위젯에 아예 안 잡힌다.
// PM 이 "큰 그림 담당자는 내가 지정, 디테일(일정·공수)은 각자 입력" 방식으로 굴릴 때
// 이 사각지대(누가 아직 입력을 안 했는지)를 훑어보는 용도.
//
// 4개 엔티티 × 최대 3개 축(담당자/일정/공수)을 한 매트릭스로 본다. 공수는 화면·기능에만
// 있는 필드라(요구사항·단위업무는 없음) 해당 없는 조합은 effortMissing=null 로 표시.
// "일정 미입력"은 시작일·종료일 중 하나라도 없으면 카운트 — 반쯤 채운 것도 놓치지 않기 위해.
export type MissingEntityKind = "REQUIREMENT" | "UNIT_WORK" | "SCREEN" | "FUNCTION";

export const MISSING_ENTITY_LABELS: Record<MissingEntityKind, string> = {
  REQUIREMENT: "요구사항",
  UNIT_WORK:   "단위업무",
  SCREEN:      "화면",
  FUNCTION:    "기능",
};

export type MissingStat = {
  entity:      MissingEntityKind;
  entityLabel: string;
  total:            number;
  assigneeMissing:  number;
  dateMissing:      number;
  /** 공수 필드가 없는 엔티티(REQUIREMENT/UNIT_WORK)는 null — "해당없음" */
  effortMissing:    number | null;
};

// 미지정 매트릭스의 한 셀(예: "화면 × 공수 미지정")을 클릭했을 때 실제 항목을 보여주는
// 원본 목록. 페이징 없이 최대 100건(/api/projects/[id]/pm-missing-detail).
export type MissingDetailItem = {
  id:         string;
  displayId:  string;
  name:       string;
  /** 상세 페이지 바로가기 링크 — 서버가 엔티티 종류에 맞춰 조립해서 내려줌 */
  href:       string;
  mberId:     string | null;
  memberName: string | null;
  startDate:  string | null;
  endDate:    string | null;
  /** 공수 필드가 없는 엔티티는 항상 null */
  effort:     string | null;
};

// ── I. 마감 임박 × 진척률 히트맵 — pm-summary 와 완전히 독립된 위젯 ─────────────
//
// 지금까지의 지연/분석 위젯은 "멤버별 집계"였는데, 이건 멤버가 아니라 엔티티(단위업무/화면/
// 기능) 중 하나를 골라서 그 엔티티 전체의 분포를 본다 — 우선순위 히트맵과 같은 매트릭스 형태.
//
// 진척률은 화면/단위업무를 선택해도 항상 기능(TbDsFunction)의 진척률 기준으로 롤업한다
// (화면 자체엔 진척률 컬럼이 없고, 단위업무의 progrs_rt는 수기 입력값이라 기준이 달라짐 —
// "진척률은 기능걸로 통일해달라"는 명시적 요청). 구현 진척률(impl_rt)/설계 진척률(design_rt)
// 중 어느 걸 참조할지는 사용자가 고를 수 있다(progressKind).
//
// pm-summary 캐시에 얹지 않고 완전히 독립된 API(/api/projects/[id]/pm-deadline-progress)로
// 서빙한다 — 엔티티·기준일·진척률기준이 바뀔 때마다 그 조합 그대로 새로 fetch.
export type DeadlineEntityKind = "UNIT_WORK" | "SCREEN" | "FUNCTION";

export const DEADLINE_ENTITY_LABELS: Record<DeadlineEntityKind, string> = {
  UNIT_WORK: "단위업무",
  SCREEN:    "화면",
  FUNCTION:  "기능",
};

// 진척률 기준 — 기능(TbDsFunction)의 TbCmProgress 두 컬럼 중 무엇을 롤업할지.
export type ProgressKind = "IMPL" | "DESIGN";

export const PROGRESS_KIND_LABELS: Record<ProgressKind, string> = {
  IMPL:   "구현",
  DESIGN: "설계",
};

// 마감 근접도 — 상호 배타적 6구간. dDay = 마감일 - 기준일.
export type DeadlineBucket = "OVERDUE" | "D1" | "D3" | "D5" | "D7" | "D8_PLUS";

export const DEADLINE_BUCKET_ORDER: DeadlineBucket[] = ["OVERDUE", "D1", "D3", "D5", "D7", "D8_PLUS"];
export const DEADLINE_BUCKET_LABELS: Record<DeadlineBucket, string> = {
  OVERDUE: "지연",
  D1:      "D-1",
  D3:      "D-3",
  D5:      "D-5",
  D7:      "D-7",
  D8_PLUS: "D-8+",
};

// 진척률 구간 — 상호 배타적 6구간.
export type ProgressBucket = "P0" | "P1_25" | "P26_50" | "P51_75" | "P76_99" | "P100";

export const PROGRESS_BUCKET_ORDER: ProgressBucket[] = ["P0", "P1_25", "P26_50", "P51_75", "P76_99", "P100"];
export const PROGRESS_BUCKET_LABELS: Record<ProgressBucket, string> = {
  P0:      "미진행",
  P1_25:   "1~25",
  P26_50:  "26~50",
  P51_75:  "51~75",
  P76_99:  "76~99",
  P100:    "완료",
};

export type DeadlineProgressMatrix = {
  cells: Record<DeadlineBucket, Record<ProgressBucket, number>>;
  /** 마감일 자체가 없어 이 그리드에서 제외된 건수 — "미지정 현황" 위젯이 별도로 다루는 영역 */
  excludedNoDeadline: number;
  /** 그리드에 실제로 분류된 건수(= 전체 - excludedNoDeadline) */
  totalCount: number;
};

// 매트릭스의 한 셀(예: "기능 × 지연 × 미진행")을 클릭했을 때 실제 항목을 보여주는 원본 목록.
// 페이징 없이 최대 100건(/api/projects/[id]/pm-deadline-progress-detail).
export type DeadlineProgressDetailItem = {
  id:         string;
  displayId:  string;
  name:       string;
  /** 상세 페이지 바로가기 링크 — 서버가 엔티티 종류에 맞춰 조립해서 내려줌 */
  href:       string;
  mberId:     string | null;
  memberName: string | null;
  startDate:  string | null;
  endDate:    string | null;
  /** 0~100 — 항상 기능(impl_rt) 기준 롤업값 */
  progress:   number;
};

// ── J. 마감 임박 리스트 — "위험 워치리스트/우선순위 히트맵" 대체 카드 3종 ─────────
//
// 엔티티(단위업무/화면/기능) 하나를 기준일 대비 마감 근접도 순으로 쭉 나열한다.
// DeadlineListCard.tsx 가 entity prop 하나로 3용도를 다 커버 — 컴포넌트는 1개, 렌더는 3번.
// 정렬은 endDate 오름차순(지연 중인 것이 자동으로 맨 위), 마감일 없는 항목은 맨 뒤로.
export type DeadlineListItem = {
  id:         string;
  displayId:  string;
  name:       string;
  href:       string;
  mberId:     string | null;
  memberName: string | null;
  startDate:  string | null;
  endDate:    string | null;
  /** 0~100 — 항상 기능 기준 롤업값(impl_rt 고정) */
  progress:   number;
  /** 기준일 - 마감일. 마감일이 없으면 null(리스트 맨 뒤로 정렬됨) */
  dDay:       number | null;
};

// ── 통합 응답 ───────────────────────────────────────────────────────────────
export type PmSummaryResponse = {
  teamLoad:       TeamLoadRow[];   // 활성 작업량 내림차순 정렬
  designDelay:    DesignDelayRow[]; // 지연율 내림차순 정렬
  implDelay:      ImplDelayRow[];   // 지연율 내림차순 정렬
  analysisDelay:  AnalysisDelayRow[]; // 지연율 내림차순 정렬
  /** 프로젝트 전체 분석 현황 요약 — 위젯 상단 caption 용 */
  analysisSummary: {
    totalCount:   number;
    /** 전체 요구사항 progrs_rt 평균(0~100) */
    avgProgress:  number;
    delayedCount: number;
  };
  /** 미지정 현황 매트릭스 — 엔티티 4종 고정 순서(REQUIREMENT/UNIT_WORK/SCREEN/FUNCTION) */
  missingSummary: MissingStat[];
  /** 응답 생성 시점 — 캐시 신선도 확인용 */
  generatedAt:    string;
};

// ── K. PM 현황 — "지금 전반적으로 잘 굴러가는지" 안심용 화면 (/pm-board, pm-summary 와 별도 엔드포인트) ──
//
// PM 진단(A~J)은 전부 멤버 기준("누가 얼마나 밀렸나")인데, PM 현황은 항목 기준이다 —
// 카테고리마다 진척률 4구간 분포(도넛)와 마감 임박 순 목록(표)을 보여준다.
//
// 7개 카테고리: 요구사항 분석 / 단위업무 설계·구현 / 화면 설계·구현 / 기능 설계·구현.
// 요구사항을 뺀 6개는 lib/pm/fetchDeadlineItems.ts(entity × progressKind 조합)를 그대로 재사용 —
// 그 함수가 이미 확립해둔 원칙을 따른다: "설계/구현은 진척률 소스만 다르고(design_rt vs impl_rt),
// 날짜는 그 엔티티가 실제로 가진 필드를 항상 그대로 쓴다"(예: 화면은 구현 전용 날짜가 없으니
// 화면 구현 카드도 design_bgng_de/design_end_de 를 그대로 씀 — 새 날짜 필드를 만들지 않음).
export type ProgressBucket4 = "UNSET" | "IN_PROGRESS_50" | "IN_PROGRESS_99" | "DONE";

export const PROGRESS_BUCKET4_ORDER: ProgressBucket4[] = ["UNSET", "IN_PROGRESS_50", "IN_PROGRESS_99", "DONE"];
export const PROGRESS_BUCKET4_LABELS: Record<ProgressBucket4, string> = {
  UNSET:           "미지정",
  IN_PROGRESS_50:  "진행중(~50)",
  IN_PROGRESS_99:  "진행중(~99)",
  DONE:            "완료",
};

export type BoardCategoryKind =
  | "REQUIREMENT_ANALYSIS"
  | "UNIT_WORK_DESIGN" | "SCREEN_DESIGN" | "FUNCTION_DESIGN"
  | "UNIT_WORK_IMPL"   | "SCREEN_IMPL"   | "FUNCTION_IMPL";

export type BoardItem = {
  id:        string;
  displayId: string;
  name:      string;
  /** 상세 페이지 바로가기 */
  href:      string;
  /** 계층 표시용 부모 이름 — 단위업무/요구사항=[], 화면=[단위업무명], 기능=[단위업무명, 화면명] */
  parentNames: string[];
  mberId:     string | null;
  memberName: string | null;
  startDate:  string | null;
  endDate:    string | null;
  /** 0~100 */
  progress: number;
  /** 기준일 - 마감일. 마감일 없으면 null(리스트 맨 뒤) */
  dDay:     number | null;
  bucket:   ProgressBucket4;
};

export type BoardCategory = {
  kind:  BoardCategoryKind;
  label: string;
  /** 4구간 분포 — 도넛차트용 */
  buckets: Record<ProgressBucket4, number>;
  totalCount: number;
  /** dDay 오름차순(지연·임박 먼저) 정렬, 최대 100건만 */
  items: BoardItem[];
};

export type PmBoardSummaryResponse = {
  /** 고정 순서 7개: REQUIREMENT_ANALYSIS, UNIT_WORK_DESIGN, SCREEN_DESIGN, FUNCTION_DESIGN, UNIT_WORK_IMPL, SCREEN_IMPL, FUNCTION_IMPL */
  categories: BoardCategory[];
  generatedAt: string;
};
