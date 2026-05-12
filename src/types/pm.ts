/**
 * PM 대시보드 타입 — 클라이언트/서버 공유
 *
 * 격리 원칙:
 *   - dashboard.ts, activity.ts, focus.ts, calendar.ts 와 완전 독립
 *   - "PM 의사결정용 종합 시야" 컨셉이라 모델이 다름 — 매트릭스·워치리스트 중심
 *
 * MVP 3 위젯:
 *   A) teamLoad        — 멤버 × 작업 상태 매트릭스
 *   B) riskItems       — 위험 단위업무 Top N (점수 정렬)
 *   C) priorityMatrix  — 요구사항 우선순위 × 단위업무 진행 단계 히트맵
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

// ── B. 위험 워치리스트 ──────────────────────────────────────────────────────
//
// 위험 점수 (높을수록 위험):
//   - 지연 일수 × 5 (상한 50)
//   - 마감 임박(D-3 이내) +15, (D-7 이내) +8
//   - 진행률 낮을수록 가산 (100 - progress) × 0.3
//   - 요구사항 priort_code=HIGH +20, MEDIUM +5
//   - 미할당(asign 없음) +10
export type RiskItem = {
  unitWorkId:   string;
  displayId:    string;
  name:         string;
  endDate:      string | null;
  /** 음수 = 지연(일), 0 = 오늘, 양수 = 남은 일수, null = 마감 미설정 */
  dDay:         number | null;
  progress:     number;
  assigneeName: string | null;
  /** 상위 요구사항 우선순위 */
  reqPriority:  "HIGH" | "MEDIUM" | "LOW";
  /** 위험 점수 — 정렬/디버깅용 */
  riskScore:    number;
  /** 위험 사유 라벨 (UI 표시용 짧은 태그들). 예: ["지연 3일", "고우선순위"] */
  reasons:      string[];
};

// ── C. 우선순위 × 진척 히트맵 ───────────────────────────────────────────────
//
// 행: HIGH / MEDIUM / LOW (요구사항 priort_code)
// 열: 미시작(0) / 진행중(1~99) / 완료(100) (해당 요구사항 산하 단위업무 진행률 기준)
//
// 단위업무 1건 = 셀 1 카운트. 한 요구사항의 단위업무들이 여러 상태에 걸쳐있을 수 있으니
// 단위업무를 기준으로 분류 (요구사항을 기준으로 하면 진척이 섞여 평균이 의미 없어짐).
export type PriorityStage = "notStarted" | "inProgress" | "completed";
export type PriorityLevel = "HIGH" | "MEDIUM" | "LOW";

export type PriorityMatrix = {
  /** 각 (우선순위, 단계) 셀의 단위업무 건수 */
  cells: Record<PriorityLevel, Record<PriorityStage, number>>;
  /** 행 합계 — UI 표 가장 우측 컬럼 */
  rowTotals: Record<PriorityLevel, number>;
  /** 전체 단위업무 수 (참조용) */
  grandTotal: number;
};

// ── 통합 응답 ───────────────────────────────────────────────────────────────
export type PmSummaryResponse = {
  teamLoad:       TeamLoadRow[];   // 활성 작업량 내림차순 정렬
  riskItems:      RiskItem[];      // 위험 점수 내림차순 (최대 10건)
  priorityMatrix: PriorityMatrix;
  /** 응답 생성 시점 — 캐시 신선도 확인용 */
  generatedAt:    string;
};
